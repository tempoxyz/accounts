import { Hash, Hex, Provider as oxProvider } from 'ox'
import type { Chain } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'

import * as Account from './Account.js'
import type { Adapter } from './Adapter.js'
import * as Client from './Client.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'
import * as RpcRequest from './zod/request.js'

/**
 * Creates an EIP-1193 provider with a pluggable adapter.
 *
 * @example
 * ```ts
 * import { Provider, local } from 'zyzz/provider'
 * import { Account } from 'viem/tempo'
 * import { tempo } from 'viem/chains'
 *
 * const account = Account.fromSecp256k1(privateKey)
 *
 * const provider = Provider.create({
 *   adapter: local({
 *     loadAccounts: async () => [{ address: account.address }],
 *   }),
 * })
 * ```
 */
export function create(options: create.Options): create.ReturnType {
  const { adapter, chains = [tempo, tempoModerato], storage, storageKey } = options

  const store = Store.create({
    chainId: chains[0]!.id,
    internal_persistPrivate: adapter.internal_persistPrivate,
    storage,
    storageKey,
  })

  adapter.setup?.({
    getAccount: (address, options) =>
      Account.fromAddress({ address, signable: options?.signable, store }),
    getClient: (chainId) => Client.fromChainId(chainId, { chains, store }),
    store,
  })

  /** Merges new accounts into the store, deduplicating by address, and sets the first new account as active. */
  function mergeAccounts(newAccounts: readonly Store.Account[]) {
    const existing = store.getState().accounts
    const existingAddresses = new Set(existing.map((a) => a.address))
    const unique = newAccounts.filter((a) => !existingAddresses.has(a.address))
    const accounts = [...existing, ...unique]
    const activeAccount = accounts.findIndex((a) => a.address === newAccounts[0]?.address)
    store.setState({ accounts, activeAccount, status: 'connected' })
  }

  const emitter = oxProvider.createEmitter()

  // Emit EIP-1193 events on state changes.
  store.subscribe(
    (state) => state.accounts.map((a) => a.address).join(),
    () =>
      emitter.emit(
        'accountsChanged',
        store.getState().accounts.map((a) => a.address),
      ),
  )
  store.subscribe(
    (state) => state.chainId,
    (chainId) => emitter.emit('chainChanged', Hex.fromNumber(chainId)),
  )
  store.subscribe(
    (state) => state.status,
    (status) => {
      if (status === 'connected')
        emitter.emit('connect', { chainId: Hex.fromNumber(store.getState().chainId) })
      if (status === 'disconnected') emitter.emit('disconnect', new oxProvider.DisconnectedError())
    },
  )

  return Object.assign(oxProvider.from(
    {
      ...(emitter as unknown as oxProvider.Emitter),
      async request({ method, params }: { method: string; params?: any }) {
        await Store.waitForHydration(store)

        // Validate known methods. Unknown methods fall through to the RPC proxy.
        let request: RpcRequest.WithDecoded<typeof Schema.Request>
        try {
          request = RpcRequest.validate(Schema.Request, { method, params })
        } catch (e) {
          if (!(e instanceof oxProvider.UnsupportedMethodError)) throw e
          // Proxy unknown methods to the RPC node.
          return await Client.fromChainId(undefined, { chains, store }).request({
            method: method as any,
            params: params as any,
          })
        }

        switch (request.method) {
          case 'eth_accounts': {
            const { accounts, activeAccount } = store.getState()
            if (accounts.length === 0) return []
            const sorted = [...accounts]
            const [active] = sorted.splice(activeAccount, 1)
            return [active!.address, ...sorted.map((a) => a.address)]
          }

          case 'eth_chainId':
            return Hex.fromNumber(store.getState().chainId)

          case 'eth_requestAccounts': {
            const newAccounts = await adapter.actions.loadAccounts()
            mergeAccounts(newAccounts)
            const { accounts, activeAccount } = store.getState()
            if (accounts.length === 0) return []
            const sorted = [...accounts]
            const [active] = sorted.splice(activeAccount, 1)
            return [active!.address, ...sorted.map((a) => a.address)]
          }

          case 'eth_sendTransaction': {
            const [decoded] = request._decoded.params
            return await adapter.actions.sendTransaction({
              ...decoded,
              _encoded: { method: request.method, params: request.params },
            })
          }

          case 'eth_sendTransactionSync': {
            const [decoded] = request._decoded.params
            return await adapter.actions.sendTransactionSync({
              ...decoded,
              _encoded: { method: request.method, params: request.params },
            })
          }

          case 'wallet_sendCalls': {
            const decoded = request._decoded.params?.[0]
            const { calls = [], capabilities } = decoded ?? {}
            const sync = capabilities?.sync
            const txRequest = { calls, _encoded: { method: 'eth_sendTransaction' as const, params: [{}] as const } }
            const hash = await (async () => {
              if (!sync) return adapter.actions.sendTransaction(txRequest)
              const receipt = await adapter.actions.sendTransactionSync(txRequest as never)
              return (receipt as { transactionHash: `0x${string}` }).transactionHash
            })()
            const chainId = Hex.fromNumber(store.getState().chainId)
            const id = Hex.concat(hash, Hex.padLeft(chainId, 32), sendCallsMagic)
            return { capabilities: { sync }, id }
          }

          case 'wallet_connect': {
            const capabilities = request._decoded.params?.[0]?.capabilities
            const newAccounts =
              capabilities?.method === 'register'
                ? await adapter.actions.createAccount()
                : await adapter.actions.loadAccounts()
            mergeAccounts(newAccounts)
            const { accounts: allAccounts, activeAccount } = store.getState()
            const sorted = [...allAccounts]
            const [active] = sorted.splice(activeAccount, 1)
            const ordered = active ? [active, ...sorted] : sorted
            return {
              accounts: ordered.map((a) => ({ address: a.address, capabilities: {} })),
            }
          }

          case 'wallet_disconnect':
            await adapter.actions.disconnect?.()
            store.setState({ accounts: [], activeAccount: 0, status: 'disconnected' })
            return

          case 'wallet_switchEthereumChain': {
            const { chainId } = request._decoded.params[0]
            if (!chains.some((c) => c.id === chainId))
              throw new oxProvider.ProviderRpcError(4902, `Chain ${chainId} not configured.`)
            await adapter.actions.switchChain?.({ chainId })
            store.setState({ chainId })
            return
          }
        }
      },
    },
    { schema: Schema.ox },
  ), { chains, store })
}

const sendCallsMagic = Hash.keccak256(Hex.fromString('TEMPO_5792'))

export declare namespace create {
  type Options = {
    /** Adapter to use for account management. */
    adapter: Adapter
    /**
     * Supported chains. First chain is the default.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Storage adapter for persistence. */
    storage?: Storage.Storage | undefined
    /** Storage key for persistence. */
    storageKey?: string | undefined
  }
  type ReturnType = oxProvider.Provider<{ schema: Schema.Ox }> &
    oxProvider.Emitter & {
      /** Configured chains. */
      chains: readonly [Chain, ...Chain[]]
      /** Reactive state store. */
      store: Store.Store
    }
}
