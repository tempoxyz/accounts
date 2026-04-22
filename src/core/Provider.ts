import { announceProvider } from 'mipd'
import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Hash, Hex, Json, Provider as ox_Provider, RpcResponse } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { Chain, Client as ViemClient, Transport } from 'viem'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import * as z from 'zod/mini'

import * as AccessKey from './AccessKey.js'
import * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import { dialog } from './adapters/dialog.js'
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

const announced = new Set<string>()

/**
 * Creates an EIP-1193 provider with a pluggable adapter.
 *
 * @example
 * ```ts
 * import { Provider } from 'accounts'
 *
 * const provider = Provider.create()
 * ```
 */
export function create(options: create.Options = {}): create.ReturnType {
  const {
    adapter = dialog(),
    chains = [tempo, tempoModerato, tempoDevnet],
    maxAccounts,
    persistCredentials,
    testnet,
    storage = typeof window !== 'undefined' ? Storage.idb() : Storage.memory(),
  } = options

  const feePayerConfig = (() => {
    if (!options.feePayer) return undefined
    if (typeof options.feePayer === 'string')
      return { precedence: 'fee-payer-first' as const, url: options.feePayer }
    return {
      precedence: options.feePayer.precedence ?? ('fee-payer-first' as const),
      url: options.feePayer.url,
    }
  })()

  const defaultChain = testnet
    ? (chains.find((c) => c.testnet) ?? chains[chains.length - 1]!)
    : chains[0]!

  const store = Store.create({
    chainId: defaultChain.id,
    maxAccounts,
    persistCredentials,
    storage,
  })

  const getAccount: Account.Find = (options = {}) => Account.find({ ...options, store }) as never

  // Lazy reference — assigned after the provider is created so the client
  // transport can route provider methods (wallet_connect, etc.) through it.
  let providerRef: ox_Provider.Provider | undefined

  function getClient(
    options: { chainId?: number | undefined; feePayer?: string | false | undefined } = {},
  ) {
    const { chainId, feePayer } = options
    return Client.fromChainId(chainId, {
      chains,
      feePayer: (() => {
        if (feePayer === false) return false
        if (feePayer) return { url: feePayer, precedence: feePayerConfig?.precedence }
        return undefined
      })(),
      store,
    })
  }

  const instance = adapter({ getAccount, getClient, storage, store })
  const { actions } = instance

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

  /** Returns accounts to persist. When `persistAccounts` is set, merges new accounts with existing ones. */
  function resolveAccounts(accounts: readonly Account.Store[]) {
    if (!instance.persistAccounts) return accounts
    const merged = [...accounts]
    for (const a of store.getState().accounts)
      if (!merged.some((m) => m.address.toLowerCase() === a.address.toLowerCase())) merged.push(a)
    return merged
  }

  /** Resolves the `feePayer` field from a transaction request into an absolute URL string or `undefined`. */
  function resolveFeePayer(feePayer: string | boolean | undefined): string | false | undefined {
    if (feePayer === false) return false
    const url = (() => {
      if (typeof feePayer === 'string') return feePayer
      return feePayerConfig?.url
    })()
    if (!url) return undefined
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    if (typeof window !== 'undefined') return new URL(url, window.location.origin).href
    return url
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
                    const { accounts } = await actions.loadAccounts(undefined, {
                      method: 'wallet_connect',
                      params: undefined,
                    })

                    store.setState({ accounts: resolveAccounts(accounts), activeAccount: 0 })

                    return accounts.map(
                      (a) => a.address,
                    ) satisfies Rpc.eth_requestAccounts.Encoded['returns']
                  }

                  case 'eth_sendTransaction': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    const { to, data, ...rest } = decoded
                    const calls =
                      decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
                    return (await actions.sendTransaction(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? store.getState().chainId,
                        ...(calls ? { calls } : {}),
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_sendTransaction.Encoded['returns']
                  }

                  case 'eth_fillTransaction': {
                    const [decoded] = request._decoded.params
                    const parameters = { ...decoded }
                    const chainId = parameters.chainId
                    const feePayer = resolveFeePayer(parameters.feePayer)

                    type FillParams = z.output<typeof Rpc.transactionRequest> & {
                      keyAuthorization?: unknown
                    }
                    const fill = (params: FillParams) => {
                      const client = getClient({ chainId, feePayer })
                      const fillRequest = {
                        ...params,
                        chainId: params.chainId ?? client.chain?.id,
                        ...(feePayer ? { feePayer: true } : {}),
                      }
                      const formatter = client.chain?.formatters?.transactionRequest
                      const formatted =
                        formatter && !fillRequest.keyAuthorization
                          ? formatter.format({ ...fillRequest } as never, 'fillTransaction')
                          : fillRequest
                      return client.request({
                        method: 'eth_fillTransaction',
                        params: [formatted as never],
                      })
                    }

                    // Inject pending keyAuthorization so the node accounts for
                    // key authorization gas during estimation.
                    if (!parameters.keyAuthorization) {
                      const account = (() => {
                        try {
                          return getAccount({ signable: true })
                        } catch {
                          return undefined
                        }
                      })()
                      if (account?.source === 'accessKey') {
                        const keyAuth = AccessKey.getPending(account, { store })
                        if (keyAuth) {
                          try {
                            const result = await fill({
                              ...parameters,
                              keyAuthorization: {
                                address: keyAuth.address,
                                ...KeyAuthorization.toRpc(keyAuth),
                              } as never,
                            })
                            AccessKey.removePending(account, { store })
                            return result
                          } catch {
                            AccessKey.remove(account, { store })
                            return await fill(parameters)
                          }
                        }
                      }
                    }

                    return await fill(parameters)
                  }

                  case 'eth_signTransaction': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    const { to, data, ...rest } = decoded
                    const calls =
                      decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
                    return (await actions.signTransaction(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? store.getState().chainId,
                        ...(calls ? { calls } : {}),
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_signTransaction.Encoded['returns']
                  }

                  case 'eth_sendTransactionSync': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    const { to, data, ...rest } = decoded
                    const calls =
                      decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
                    return (await actions.sendTransactionSync(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? store.getState().chainId,
                        ...(calls ? { calls } : {}),
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
                    const feePayer = resolveFeePayer(
                      capabilities?.feePayer ?? (feePayerConfig ? true : undefined),
                    )
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
                      throw new ox_Provider.DisconnectedError({
                        message: 'No accounts connected.',
                      })
                    const tokens = decoded?.tokens
                    // TODO: hook up to indexer
                    if (!tokens || tokens.length === 0)
                      throw new RpcResponse.InvalidParamsError({
                        message: '`tokens` is required.',
                      })
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
                          currency: 'USD',
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
                      status: (() => {
                        if (!receipt) return 100 // pending
                        if (receipt.status === '0x1') return 200 // success
                        return 500 // failed
                      })(),
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
                        feePayer?: { status: 'supported' } | undefined
                      }
                    > = {}
                    for (const chain of filtered)
                      result[Hex.fromNumber(chain.id)] = {
                        accessKeys: { status: 'supported' },
                        atomic: { status: 'supported' },
                        ...(feePayerConfig ? { feePayer: { status: 'supported' } } : {}),
                      }
                    return result as Rpc.wallet_getCapabilities.Encoded['returns']
                  }

                  case 'wallet_connect': {
                    const chainId = request._decoded.params?.[0]?.chainId
                    if (chainId) store.setState((x) => ({ ...x, chainId }))

                    const capabilities = request._decoded.params?.[0]?.capabilities
                    const authorizeAccessKey =
                      capabilities?.authorizeAccessKey ?? options.authorizeAccessKey?.()

                    const { keyAuthorization, accounts, email, signature, username } =
                      await (async () => {
                        if (capabilities?.method === 'register') {
                          // If a stored account already has this label, sign in
                          // with its credential instead of creating a new one.
                          const existing = capabilities.name
                            ? store
                                .getState()
                                .accounts.find(
                                  (a) =>
                                    'credential' in a &&
                                    a.label?.toLowerCase() === capabilities.name!.toLowerCase(),
                                )
                            : undefined
                          if (existing && 'credential' in existing)
                            return await actions.loadAccounts(
                              {
                                credentialId: existing.credential?.id,
                                digest: capabilities.digest,
                                authorizeAccessKey,
                              },
                              request,
                            )
                          return await actions.createAccount(
                            {
                              digest: capabilities.digest,
                              authorizeAccessKey,
                              name: capabilities.name ?? 'default',
                              userId: capabilities.userId ?? Hex.random(16),
                            },
                            request,
                          )
                        }
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

                    store.setState({ accounts: resolveAccounts(accounts), activeAccount: 0 })

                    const accountAddress = accounts[0]?.address
                    return {
                      accounts: accounts.map((a) => ({
                        address: a.address,
                        capabilities:
                          a.address === accountAddress
                            ? {
                                ...(keyAuthorization
                                  ? {
                                      keyAuthorization: {
                                        ...keyAuthorization,
                                        address: keyAuthorization.keyId,
                                      },
                                    }
                                  : {}),
                                ...(signature && capabilities?.digest ? { signature } : {}),
                                ...(email !== undefined ? { email } : {}),
                                ...(username !== undefined ? { username } : {}),
                              }
                            : {},
                      })),
                    } satisfies Rpc.wallet_connect.Encoded['returns']
                  }

                  case 'wallet_disconnect':
                    await actions.disconnect?.()
                    store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
                    return

                  case 'wallet_authorizeAccessKey': {
                    if (!actions.authorizeAccessKey)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`authorizeAccessKey` not supported by adapter.',
                      })
                    const decoded = request._decoded.params[0]
                    const result = await actions.authorizeAccessKey(decoded, request)
                    return {
                      keyAuthorization: {
                        ...result.keyAuthorization,
                        address: result.keyAuthorization.keyId,
                      },
                      rootAddress: result.rootAddress,
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

                  case 'wallet_deposit': {
                    if (!actions.deposit)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`deposit` not supported by adapter.',
                      })
                    return (await actions.deposit(
                      request._decoded.params[0],
                      request,
                    )) satisfies Rpc.wallet_deposit.Encoded['returns']
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
    {
      chains,
      getAccount,
      getClient(options: { chainId?: number | undefined; feePayer?: string | undefined } = {}) {
        const { chainId, feePayer } = options
        return Client.fromChainId(chainId, { chains, feePayer, provider: providerRef, store })
      },
      store,
    },
  )

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    const rdns =
      adapter.rdns ?? `com.${(adapter.name ?? 'Injected Wallet').toLowerCase().replace(/\s+/g, '')}`

    if (!announced.has(rdns)) {
      announced.add(rdns)
      announceProvider({
        info: {
          icon: adapter.icon ?? defaultIcon,
          name: adapter.name ?? 'Injected Wallet',
          rdns,
          uuid: crypto.randomUUID(),
        },
        provider,
      } as never)
    }
  }

  if (options.mpp)
    Mppx.create({
      methods: [
        mppx_tempo({
          getClient: ({ chainId }) => {
            const client = provider.getClient({ chainId })
            const account = provider.getAccount()
            return Object.assign(client, { account })
          },
          mode: 'pull',
        }),
      ],
    })

  providerRef = provider

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
     * @default [tempo, tempoModerato, tempoDevnet]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Fee payer configuration. @see {@link Client.fromChainId.Options.feePayer} */
    feePayer?: Client.fromChainId.Options['feePayer']
    /** Maximum number of accounts to persist. Oldest accounts are evicted when exceeded (LRU). */
    maxAccounts?: number | undefined
    /** Enable Machine Payment Protocol (mppx) support. @default false */
    mpp?: boolean | undefined
    /** Whether to persist credentials and access keys to storage. When `false`, only account addresses are persisted. @default true */
    persistCredentials?: boolean | undefined
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
