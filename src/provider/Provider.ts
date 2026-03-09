import { announceProvider } from 'mipd'
import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Hash, Hex, Json, Provider as ox_Provider, RpcRequest, RpcResponse } from 'ox'
import type { Chain } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'

import * as Account from './Account.js'
import type { Adapter } from './Adapter.js'
import * as Client from './Client.js'
import { withDedupe } from './internal/withDedupe.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'
import * as Request from './zod/request.js'

export type Provider = ox_Provider.Provider<{ schema: Schema.Ox }> &
  ox_Provider.Emitter & {
    /** Configured chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Reactive state store. */
    store: Store.Store
  }

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
  const {
    adapter,
    chains = [tempo, tempoModerato],
    testnet,
    storage = typeof window !== 'undefined' ? Storage.idb() : Storage.memory(),
  } = options

  const defaultChain = testnet
    ? (chains.find((c) => c.testnet) ?? chains[chains.length - 1]!)
    : chains[0]!

  const store = Store.create({
    chainId: defaultChain.id,
    internal_persistPrivate: adapter.internal_persistPrivate,
    storage,
  })

  adapter.setup?.({
    getAccount: (address, options) => Account.find({ address, signable: options?.signable, store }),
    getClient: (chainId) => Client.fromChainId(chainId, { chains, store }),
    storage,
    store,
  })

  const emitter = ox_Provider.createEmitter()

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
    (state) => state.accounts.length > 0,
    (connected) => {
      if (connected) emitter.emit('connect', { chainId: Hex.fromNumber(store.getState().chainId) })
      else emitter.emit('disconnect', new ox_Provider.DisconnectedError())
    },
  )

  /** Throws `DisconnectedError` if no accounts are connected. */
  function assertConnected() {
    if (store.getState().accounts.length === 0)
      throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })
  }

  /** Merges new accounts into the store, deduplicating by address, and sets the first new account as active. */
  function mergeAccounts(newAccounts: readonly Store.Account[]) {
    const existing = store.getState().accounts
    const existingAddresses = new Set(existing.map((a) => a.address))
    const unique = newAccounts.filter((a) => !existingAddresses.has(a.address))
    const accounts = [...existing, ...unique]
    const activeAccount = accounts.findIndex((a) => a.address === newAccounts[0]?.address)
    store.setState({ accounts, activeAccount })
  }

  const provider = Object.assign(
    ox_Provider.from(
      {
        ...(emitter as unknown as ox_Provider.Emitter),
        async request({ method, params }: { method: string; params?: any }) {
          await Store.waitForHydration(store)

          const shouldDedupe = [
            'eth_accounts',
            'eth_chainId',
            'eth_requestAccounts',
            'wallet_connect',
            'wallet_getBalances',
            'wallet_getCapabilities',
          ].includes(method)

          return withDedupe(
            async () => {
              // Validate known methods. Unknown methods fall through to the RPC proxy.
              let request: Request.WithDecoded<typeof Schema.Request>
              try {
                request = Request.validate(Schema.Request, { method, params })
              } catch (e) {
                if (!(e instanceof ox_Provider.UnsupportedMethodError)) throw e
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
                  const { accounts: newAccounts } = await adapter.actions.loadAccounts()
                  mergeAccounts(newAccounts)
                  const { accounts, activeAccount } = store.getState()
                  if (accounts.length === 0) return []
                  const sorted = [...accounts]
                  const [active] = sorted.splice(activeAccount, 1)
                  return [active!.address, ...sorted.map((a) => a.address)]
                }

                case 'eth_sendTransaction': {
                  assertConnected()
                  const [decoded] = request._decoded.params
                  return await adapter.actions.sendTransaction({
                    ...decoded,
                    _encoded: { method: request.method, params: request.params },
                  })
                }

                case 'eth_signTransaction': {
                  assertConnected()
                  const [decoded] = request._decoded.params
                  return await adapter.actions.signTransaction({
                    ...decoded,
                    _encoded: { method: request.method, params: request.params },
                  })
                }

                case 'eth_sendTransactionSync': {
                  assertConnected()
                  const [decoded] = request._decoded.params
                  return await adapter.actions.sendTransactionSync({
                    ...decoded,
                    _encoded: { method: request.method, params: request.params },
                  })
                }

                case 'eth_signTypedData_v4': {
                  assertConnected()
                  const [address, data] = request._decoded.params
                  return await adapter.actions.signTypedData({ address, data })
                }

                case 'personal_sign': {
                  assertConnected()
                  const [data, address] = request._decoded.params
                  return await adapter.actions.signPersonalMessage({ address, data })
                }

                case 'wallet_sendCalls': {
                  assertConnected()
                  const decoded = request._decoded.params?.[0]
                  const { calls = [], capabilities } = decoded ?? {}
                  const sync = capabilities?.sync
                  const txRequest = {
                    calls,
                    _encoded: { method: 'eth_sendTransaction' as const, params: [{}] as const },
                  }
                  if (!sync) {
                    const hash = await adapter.actions.sendTransaction(txRequest)
                    const chainId = Hex.fromNumber(store.getState().chainId)
                    const id = Hex.concat(hash, Hex.padLeft(chainId, 32), sendCallsMagic)
                    return { capabilities: { sync }, id }
                  }
                  const receipt = await adapter.actions.sendTransactionSync(txRequest as never)
                  const hash = (receipt as { transactionHash: `0x${string}` }).transactionHash
                  const chainId = Hex.fromNumber(store.getState().chainId)
                  const id = Hex.concat(hash, Hex.padLeft(chainId, 32), sendCallsMagic)
                  return {
                    atomic: true,
                    capabilities: { sync },
                    chainId,
                    id,
                    receipts: [receipt],
                    status: (receipt as { status: string }).status === '0x1' ? 200 : 500,
                    version: '2.0.0',
                  }
                }

                case 'wallet_getBalances': {
                  const decoded = request._decoded.params?.[0]
                  const { accounts, activeAccount } = store.getState()
                  const account = decoded?.account ?? accounts[activeAccount]?.address
                  if (!account)
                    throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })
                  const tokens = decoded?.tokens
                  // TODO: hook up to indexer
                  if (!tokens || tokens.length === 0)
                    throw new RpcResponse.InvalidParamsError({ message: '`tokens` is required.' })
                  const client = Client.fromChainId(decoded?.chainId, { chains, store })
                  return await Promise.all(
                    tokens.map(async (token) => {
                      const [balance, metadata] = await Promise.all([
                        Actions.token.getBalance(client, { account, token }),
                        Actions.token.getMetadata(client, { token }),
                      ])
                      const value = Number(balance) / 10 ** metadata.decimals
                      const display = new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: metadata.currency,
                      }).format(value)
                      return {
                        address: token,
                        balance: Hex.fromNumber(balance),
                        decimals: metadata.decimals,
                        display,
                        name: metadata.name,
                        symbol: metadata.symbol,
                      }
                    }),
                  )
                }

                case 'wallet_getCallsStatus': {
                  const [id] = request._decoded.params ?? []
                  if (!id) throw new Error('`id` not found')
                  if (!id.endsWith(sendCallsMagic.slice(2))) throw new Error('`id` not supported')
                  Hex.assert(id)
                  const hash = Hex.slice(id, 0, 32)
                  const chainId = Hex.slice(id, 32, 64)
                  const client = Client.fromChainId(Number(chainId), { chains, store })
                  const receipt = await client.request({
                    method: 'eth_getTransactionReceipt',
                    params: [hash],
                  })
                  return {
                    atomic: true,
                    chainId,
                    id,
                    receipts: receipt ? [receipt] : [],
                    status: receipt?.status === '0x1' ? 200 : 500,
                    version: '2.0.0',
                  }
                }

                case 'wallet_getCapabilities': {
                  const decoded = request._decoded.params
                  const address = decoded?.[0]
                  const chainIds = decoded?.[1]

                  if (address) {
                    const { accounts } = store.getState()
                    if (!accounts.some((a) => a.address.toLowerCase() === address.toLowerCase()))
                      throw new ox_Provider.UnauthorizedError({
                        message: `Address ${address} is not connected.`,
                      })
                  }

                  const filtered = chainIds
                    ? chains.filter((c) => chainIds.includes(Hex.fromNumber(c.id)))
                    : chains

                  const result: Record<string, { atomic: { status: 'supported' } }> = {}
                  for (const chain of filtered)
                    result[Hex.fromNumber(chain.id)] = { atomic: { status: 'supported' } }
                  return result
                }

                case 'wallet_connect': {
                  const capabilities = request._decoded.params?.[0]?.capabilities
                  const { accounts: newAccounts, signature } = await (async () => {
                    if (capabilities?.method === 'register')
                      return await adapter.actions.createAccount({
                        digest: capabilities.digest,
                        name: capabilities.name ?? 'default',
                        userId: capabilities.userId,
                      })
                    return await adapter.actions.loadAccounts({
                      credentialId: capabilities?.credentialId,
                      digest: capabilities?.digest,
                      selectAccount: capabilities?.selectAccount,
                    })
                  })()
                  mergeAccounts(newAccounts)
                  const { accounts: allAccounts, activeAccount } = store.getState()
                  const sorted = [...allAccounts]
                  const [active] = sorted.splice(activeAccount, 1)
                  const ordered = active ? [active, ...sorted] : sorted
                  const signer = newAccounts[0]?.address
                  return {
                    accounts: ordered.map((a) => ({
                      address: a.address,
                      capabilities: a.address === signer && signature ? { signature } : {},
                    })),
                  }
                }

                case 'wallet_disconnect':
                  await adapter.actions.disconnect?.()
                  store.setState({ accounts: [], activeAccount: 0 })
                  return

                case 'wallet_switchEthereumChain': {
                  const { chainId } = request._decoded.params[0]
                  if (!chains.some((c) => c.id === chainId))
                    throw new ox_Provider.UnsupportedChainIdError({
                      message: `Chain ${chainId} not configured.`,
                    })
                  await adapter.actions.switchChain?.({ chainId })
                  store.setState({ chainId })
                  return
                }
              }
            },
            {
              enabled: shouldDedupe,
              id: Json.stringify({ method, params }),
            },
          )
        },
      },
      { schema: Schema.ox },
    ),
    { chains, store },
  )

  if (typeof window !== 'undefined') {
    announceProvider({
      info: {
        icon: adapter.icon ?? defaultIcon,
        name: adapter.name ?? 'Injected Wallet',
        rdns:
          adapter.rdns ??
          `com.${(adapter.name ?? 'Injected Wallet').toLowerCase().replace(/\s+/g, '')}`,
        uuid: crypto.randomUUID(),
      },
      provider,
    } as never)
  }

  Mppx.create({
    methods: [
      mppx_tempo({
        getClient: ({ chainId }) => {
          const client = Client.fromChainId(chainId, { chains, store })
          const account = Account.find({ store, signable: true })
          return Object.assign(client, { account })
        },
      }),
    ],
  })

  return provider
}

const defaultIcon =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>' as const
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
    /** Storage adapter for persistence. @default Storage.idb() in browser, Storage.memory() otherwise. */
    storage?: Storage.Storage | undefined
    /**
     * Default to the first testnet chain.
     * @default false
     */
    testnet?: boolean | undefined
  }
  type ReturnType = Provider
}
