import { announceProvider } from 'mipd'
import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Hash, Hex, Json, Provider as ox_Provider, RpcResponse } from 'ox'
import type { Chain, Client as ViemClient, Transport } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import * as z from 'zod/mini'

import * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import { tempoWallet } from './adapters/tempoWallet.js'
import * as Client from './Client.js'
import { withDedupe } from './internal/withDedupe.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'
import * as Request from './zod/request.js'
import * as Rpc from './zod/rpc.js'

export type Provider = ox_Provider.Provider<{ schema: Schema.Ox }> &
  ox_Provider.Emitter & {
    /** Configured chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Returns a viem Account for the given address (or active account). */
    getAccount: Account.Find
    /** Returns a viem Client for the given (or current) chain ID. */
    getClient(options?: {
      chainId?: number | undefined
      feePayer?: string | undefined
    }): ViemClient<Transport, typeof tempo>
    /** Reactive state store. */
    store: Store.Store
  }

/**
 * Creates an EIP-1193 provider with a pluggable adapter.
 *
 * @example
 * ```ts
 * import { Provider } from 'tempodk'
 *
 * const provider = Provider.create()
 * ```
 */
export function create(options: create.Options = {}): create.ReturnType {
  const {
    adapter = tempoWallet(),
    chains = [tempo, tempoModerato],
    feePayerUrl,
    testnet,
    storage = typeof window !== 'undefined' ? Storage.idb() : Storage.memory(),
  } = options

  const defaultChain = testnet
    ? (chains.find((c) => c.testnet) ?? chains[chains.length - 1]!)
    : chains[0]!

  const store = Store.create({
    chainId: defaultChain.id,
    storage,
  })

  const getAccount: Account.Find = (options = {}) => Account.find({ ...options, store }) as never

  function getClient(
    options: { chainId?: number | undefined; feePayer?: string | undefined } = {},
  ) {
    const { chainId, feePayer } = options
    return Client.fromChainId(chainId, { chains, feePayer, store })
  }

  const { actions } = adapter({ getAccount, getClient, storage, store })

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

  /** Resolves the `feePayer` field from a transaction request into a URL string or `undefined`. */
  function resolveFeePayer(feePayer: string | boolean | undefined): string | undefined {
    if (typeof feePayer === 'string') return feePayer
    if (feePayer === true) return feePayerUrl
    return undefined
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

              const result = await (async () => {
                switch (request.method) {
                  case 'eth_accounts': {
                    const { accounts, activeAccount } = store.getState()
                    if (accounts.length === 0) return []
                    const activeAddr = accounts[activeAccount]?.address
                    const activeIdx = accounts.findIndex((a) => a.address === activeAddr)
                    const sorted = [...accounts]
                    if (activeIdx >= 0) {
                      const [active] = sorted.splice(activeIdx, 1)
                      return [active!.address, ...sorted.map((a) => a.address)]
                    }
                    return sorted.map(
                      (a) => a.address,
                    ) satisfies Rpc.eth_accounts.Encoded['returns']
                  }

                  case 'eth_chainId':
                    return Hex.fromNumber(
                      store.getState().chainId,
                    ) satisfies Rpc.eth_chainId.Encoded['returns']

                  case 'eth_requestAccounts': {
                    const { accounts: newAccounts } = await actions.loadAccounts(undefined, {
                      method: 'wallet_connect',
                      params: undefined,
                    })
                    mergeAccounts(newAccounts)
                    const { accounts, activeAccount } = store.getState()
                    if (accounts.length === 0) return []
                    const activeAddr = accounts[activeAccount]?.address
                    const activeIdx = accounts.findIndex((a) => a.address === activeAddr)
                    const sorted = [...accounts]
                    if (activeIdx >= 0) {
                      const [active] = sorted.splice(activeIdx, 1)
                      return [active!.address, ...sorted.map((a) => a.address)]
                    }
                    return sorted.map(
                      (a) => a.address,
                    ) satisfies Rpc.eth_requestAccounts.Encoded['returns']
                  }

                  case 'eth_sendTransaction': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    return (await actions.sendTransaction(
                      {
                        ...decoded,
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_sendTransaction.Encoded['returns']
                  }

                  case 'eth_signTransaction': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    return (await actions.signTransaction(
                      {
                        ...decoded,
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_signTransaction.Encoded['returns']
                  }

                  case 'eth_sendTransactionSync': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    return (await actions.sendTransactionSync(
                      {
                        ...decoded,
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_sendTransactionSync.Encoded['returns']
                  }

                  case 'eth_signTypedData_v4': {
                    assertConnected()
                    const [address, data] = request._decoded.params
                    return (await actions.signTypedData(
                      {
                        address,
                        data,
                      },
                      request,
                    )) satisfies Rpc.eth_signTypedData_v4.Encoded['returns']
                  }

                  case 'personal_sign': {
                    assertConnected()
                    const [data, address] = request._decoded.params
                    return (await actions.signPersonalMessage(
                      {
                        address,
                        data,
                      },
                      request,
                    )) satisfies Rpc.personal_sign.Encoded['returns']
                  }

                  case 'wallet_sendCalls': {
                    assertConnected()
                    const decoded = request._decoded.params?.[0]
                    const { calls = [], capabilities, chainId, from } = decoded ?? {}
                    const sync = capabilities?.sync
                    const feePayer = resolveFeePayer(feePayerUrl ? true : undefined)
                    const txRequest = {
                      calls,
                      chainId,
                      from,
                      ...(feePayer ? { feePayer } : {}),
                    }
                    if (!sync) {
                      const hash = await actions.sendTransaction(txRequest, {
                        method: 'eth_sendTransaction',
                        params: [z.encode(Rpc.transactionRequest, txRequest)] as const,
                      })
                      const chainId = Hex.fromNumber(store.getState().chainId)
                      const id = Hex.concat(hash, Hex.padLeft(chainId, 32), sendCallsMagic)
                      return { capabilities: { sync }, id }
                    }
                    const receipt = await actions.sendTransactionSync(txRequest as never, {
                      method: 'eth_sendTransactionSync',
                      params: [z.encode(Rpc.transactionRequest, txRequest)] as const,
                    })
                    const hash = receipt.transactionHash
                    const chainIdHex = Hex.fromNumber(store.getState().chainId)
                    const id = Hex.concat(hash, Hex.padLeft(chainIdHex, 32), sendCallsMagic)
                    return {
                      atomic: true,
                      capabilities: { sync },
                      chainId: chainIdHex,
                      id,
                      receipts: [receipt],
                      status: (receipt as { status: string }).status === '0x1' ? 200 : 500,
                      version: '2.0.0',
                    } satisfies Rpc.wallet_sendCalls.Encoded['returns']
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
                    return (await Promise.all(
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
                    )) satisfies Rpc.wallet_getBalances.Encoded['returns']
                  }

                  case 'wallet_getCallsStatus': {
                    const [id] = request._decoded.params ?? []
                    if (!id) throw new Error('`id` not found')
                    if (!id.endsWith(sendCallsMagic.slice(2))) throw new Error('`id` not supported')
                    Hex.assert(id)
                    const hash = Hex.slice(id, 0, 32)
                    const chainId = Hex.fromNumber(Number(Hex.slice(id, 32, 64)))
                    const client = Client.fromChainId(Number(chainId), { chains, store })
                    const receipt = await client.request({
                      method: 'eth_getTransactionReceipt',
                      params: [hash],
                    })
                    return {
                      atomic: true,
                      chainId,
                      id,
                      receipts: receipt ? [receipt as never] : [],
                      status: receipt?.status === '0x1' ? 200 : 500,
                      version: '2.0.0',
                    } satisfies Rpc.wallet_getCallsStatus.Encoded['returns']
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

                    const result: Record<
                      string,
                      {
                        accessKeys: { status: 'supported' }
                        atomic: { status: 'supported' }
                      }
                    > = {}
                    for (const chain of filtered)
                      result[Hex.fromNumber(chain.id)] = {
                        accessKeys: { status: 'supported' },
                        atomic: { status: 'supported' },
                      }
                    return result as Rpc.wallet_getCapabilities.Encoded['returns']
                  }

                  case 'wallet_connect': {
                    const capabilities = request._decoded.params?.[0]?.capabilities
                    const authorizeAccessKey =
                      capabilities?.authorizeAccessKey ?? options.authorizeAccessKey?.()

                    const {
                      keyAuthorization,
                      accounts: newAccounts,
                      signature,
                    } = await (async () => {
                      if (capabilities?.method === 'register')
                        return await actions.createAccount(
                          {
                            digest: capabilities.digest,
                            authorizeAccessKey,
                            name: capabilities.name ?? 'default',
                            userId: capabilities.userId,
                          },
                          request,
                        )
                      return await actions.loadAccounts(
                        {
                          credentialId: capabilities?.credentialId,
                          digest: capabilities?.digest,
                          authorizeAccessKey,
                          selectAccount: capabilities?.selectAccount,
                        },
                        request,
                      )
                    })()
                    mergeAccounts(newAccounts)

                    const { accounts: allAccounts, activeAccount } = store.getState()
                    const activeAddr = allAccounts[activeAccount]?.address
                    const activeIdx = allAccounts.findIndex((a) => a.address === activeAddr)
                    const sorted = [...allAccounts]
                    if (activeIdx >= 0) sorted.splice(activeIdx, 1)
                    const active = activeIdx >= 0 ? allAccounts[activeIdx] : undefined
                    const ordered = active ? [active, ...sorted] : sorted
                    const signer = newAccounts[0]?.address
                    return {
                      accounts: ordered.map((a) => {
                        if (a.address !== signer) return { address: a.address, capabilities: {} }
                        return {
                          address: a.address,
                          capabilities: {
                            ...(keyAuthorization
                              ? {
                                  keyAuthorization: {
                                    ...keyAuthorization,
                                    address: keyAuthorization.keyId,
                                  },
                                }
                              : {}),
                            ...(signature && capabilities?.digest ? { signature } : {}),
                          },
                        }
                      }),
                    } satisfies Rpc.wallet_connect.Encoded['returns']
                  }

                  case 'wallet_disconnect':
                    await actions.disconnect?.()
                    store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
                    return

                  case 'wallet_authorizeAccessKey': {
                    assertConnected()
                    if (!actions.authorizeAccessKey)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`authorizeAccessKey` not supported by adapter.',
                      })
                    const decoded = request._decoded.params[0]
                    const result = await actions.authorizeAccessKey(decoded, request)
                    return {
                      ...result,
                      address: result.keyId,
                    } satisfies Rpc.wallet_authorizeAccessKey.Encoded['returns']
                  }

                  case 'wallet_revokeAccessKey': {
                    assertConnected()
                    if (!actions.revokeAccessKey)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`revokeAccessKey` not supported by adapter.',
                      })
                    const [decoded] = request._decoded.params
                    await actions.revokeAccessKey(
                      {
                        ...decoded,
                      },
                      request,
                    )
                    return
                  }

                  case 'wallet_switchEthereumChain': {
                    const { chainId } = request._decoded.params[0]
                    if (!chains.some((c) => c.id === chainId))
                      throw new ox_Provider.UnsupportedChainIdError({
                        message: `Chain ${chainId} not configured.`,
                      })
                    await actions.switchChain?.({ chainId })
                    store.setState({ chainId })
                    return
                  }
                }
              })()

              return result
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
    { chains, getAccount, getClient, store },
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
    /** Adapter to use for account management. @default dialog() */
    adapter?: Adapter.Adapter | undefined
    /**
     * Default access key parameters for `wallet_connect`.
     *
     * When set, `wallet_connect` will automatically authorize an access key.
     */
    authorizeAccessKey?: (() => Adapter.authorizeAccessKey.Parameters) | undefined
    /**
     * Supported chains. First chain is the default.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /**
     * Fee payer URL for interacting with a service running `Handler.feePayer`
     * from `tempodk/server`.
     */
    feePayerUrl?: string | undefined
    /** Storage adapter for persistence. @default Storage.idb() in browser, Storage.memory() otherwise. */
    storage?: Storage.Storage | undefined
    /**
     * Use testnet.
     * @default false
     */
    testnet?: boolean | undefined
  }
  type ReturnType = Provider
}
