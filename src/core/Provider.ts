import { announceProvider } from 'mipd'
import { Mppx, tempo as mppx_tempo } from 'mppx/client'
import { Address, Hash, Hex, Json, Provider as ox_Provider, RpcResponse } from 'ox'
import { http, parseUnits, type Chain, type Client as ViemClient, type Transport } from 'viem'
import type { JsonRpcAccount } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import { Actions } from 'viem/tempo'
import { tempo, tempoDevnet, tempoModerato } from 'viem/tempo/chains'
import * as z from 'zod/mini'

import * as AccessKey from './AccessKey.js'
import * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import { dialog } from './adapters/dialog.js'
import * as Client from './Client.js'
import * as AccessKeyTransaction from './internal/AccessKeyTransaction.js'
import { withDedupe } from './internal/withDedupe.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'
import * as Tokenlist from './Tokenlist.js'
import * as Request from './zod/request.js'
import * as Rpc from './zod/rpc.js'

export type Provider = ox_Provider.Provider<{ schema: Schema.Ox }> &
  ox_Provider.Emitter & {
    /** Configured chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Returns the active root account as a viem JSON-RPC account. */
    getAccount(): JsonRpcAccount
    /** Returns local or on-chain publication status for an access key. */
    getAccessKeyStatus(
      options?: getAccessKeyStatus.Options | undefined,
    ): Promise<getAccessKeyStatus.ReturnType>
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
    relay,
    testnet,
    storage = typeof window !== 'undefined' ? Storage.idb() : Storage.memory(),
  } = options

  // Build per-chain transports from `relay` (if set), then layer caller-provided
  // `transports` on top so explicit per-chain overrides win.
  const transports = (() => {
    if (!relay && !options.transports) return undefined
    const base = relay
      ? Object.fromEntries(
          chains.map((c) => [c.id, http(`${relay.replace(/\/$/, '')}/${c.id}`)] as const),
        )
      : {}
    return { ...base, ...options.transports } as Record<number, Transport>
  })()

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
      transports,
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

  /** Returns connected account addresses with the active account first. */
  function getAccountAddresses() {
    const { accounts, activeAccount } = store.getState()
    if (accounts.length === 0) return []
    const active = accounts[activeAccount]?.address
    const activeIdx = accounts.findIndex((a) => a.address === active)
    const sorted = [...accounts]
    if (activeIdx >= 0) {
      const [account] = sorted.splice(activeIdx, 1)
      return [account!.address, ...sorted.map((a) => a.address)]
    }
    return sorted.map((a) => a.address)
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
                return await Client.fromChainId(undefined, { chains, store, transports }).request({
                  method: method as any,
                  params: params as any,
                })
              }

              const result = await (async () => {
                switch (request.method) {
                  case 'eth_accounts':
                    return getAccountAddresses() satisfies Rpc.eth_accounts.Encoded['returns']

                  case 'eth_chainId':
                    return Hex.fromNumber(
                      store.getState().chainId,
                    ) satisfies Rpc.eth_chainId.Encoded['returns']

                  case 'eth_requestAccounts': {
                    const existing = getAccountAddresses()
                    if (existing.length > 0)
                      return existing satisfies Rpc.eth_requestAccounts.Encoded['returns']

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
                    const state = store.getState()
                    return (await actions.sendTransaction(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? state.chainId,
                        from: decoded.from ?? state.accounts[state.activeAccount]?.address,
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
                    const client = getClient({ chainId, feePayer })
                    const fill = (params: FillParams) => {
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
                      const state = store.getState()
                      const address =
                        parameters.from ?? state.accounts[state.activeAccount]?.address
                      if (address) {
                        const calls =
                          parameters.calls ??
                          (parameters.to
                            ? [
                                {
                                  data: parameters.data,
                                  to: parameters.to,
                                },
                              ]
                            : undefined)
                        const transaction = await AccessKeyTransaction.create({
                          address,
                          calls,
                          chainId: parameters.chainId ?? state.chainId,
                          client,
                          store,
                        })
                        if (transaction)
                          try {
                            return await transaction.fill({
                              ...parameters,
                              chainId: parameters.chainId ?? state.chainId,
                              from: parameters.from ?? address,
                              ...(feePayer ? { feePayer: true } : {}),
                            })
                          } catch {
                            return await fill(parameters)
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
                    const state = store.getState()
                    return (await actions.signTransaction(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? state.chainId,
                        from: decoded.from ?? state.accounts[state.activeAccount]?.address,
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
                    const state = store.getState()
                    return (await actions.sendTransactionSync(
                      {
                        ...rest,
                        chainId: decoded.chainId ?? state.chainId,
                        from: decoded.from ?? state.accounts[state.activeAccount]?.address,
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
                    try {
                      assertConnected()
                      const decoded = request._decoded.params?.[0]
                      const { calls = [], capabilities, chainId, from } = decoded ?? {}
                      const sync = capabilities?.sync
                      const feePayer = resolveFeePayer(
                        capabilities?.feePayer ?? (feePayerConfig ? true : undefined),
                      )
                      const state = store.getState()
                      const txRequest = {
                        calls,
                        chainId,
                        from: from ?? state.accounts[state.activeAccount]?.address,
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
                    } catch (error) {
                      throw withDetails(error)
                    }
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
                    const client = Client.fromChainId(decoded?.chainId, {
                      chains,
                      store,
                      transports,
                    })
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
                    const client = Client.fromChainId(Number(chainId), {
                      chains,
                      store,
                      transports,
                    })
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

                    // Server Authentication: pre-resolve `auth` URLs against
                    // this dapp-side Provider's `window.location.origin`. The
                    // wallet host (different origin in dialog mode) cannot
                    // reconstruct the dapp's origin, so forwarding the raw
                    // relative URLs would resolve to the wrong host. We then
                    // fetch the challenge BEFORE the ceremony so we can fold
                    // its message into the existing `personalSign` capability.
                    // Forwarding adapters (dialog) skip orchestration — the
                    // wallet host's Provider runs it instead.
                    const auth_input = capabilities?.auth ?? options.auth
                    const auth_request = auth_input
                      ? absolutizeAuth(
                          auth_input as NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
                        )
                      : undefined
                    if (auth_request && typeof auth_request === 'object' && !auth_request.challenge)
                      throw new RpcResponse.InvalidParamsError({
                        message:
                          '`auth` capability must include either `url` or an explicit `challenge` endpoint.',
                      })
                    if (auth_request && capabilities?.personalSign)
                      throw new RpcResponse.InvalidParamsError({
                        message:
                          '`auth` and `personalSign` cannot both be set on `wallet_connect`.',
                      })

                    // Patch the raw request so forwarding adapters carry the
                    // absolutized auth URLs downstream.
                    if (auth_request)
                      request = {
                        ...request,
                        params: [
                          {
                            ...request.params?.[0],
                            capabilities: {
                              ...request.params?.[0]?.capabilities,
                              auth: auth_request,
                            },
                          },
                        ] as never,
                      }

                    const auth =
                      auth_request && !instance.forwardsAuth
                        ? await fetchAuthChallenge(
                            auth_request,
                            chainId ?? store.getState().chainId ?? 0,
                          )
                        : undefined

                    const personalSign_request = auth
                      ? { message: auth.message }
                      : capabilities?.personalSign

                    const {
                      accounts,
                      auth: auth_capability,
                      email,
                      keyAuthorization,
                      personalSign,
                      signature,
                      username,
                    } = await (async () => {
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
                              ...(personalSign_request
                                ? { personalSign: personalSign_request }
                                : {}),
                              ...(capabilities.showDeposit !== undefined
                                ? { showDeposit: capabilities.showDeposit }
                                : {}),
                            },
                            request,
                          )
                        return await actions.createAccount(
                          {
                            digest: capabilities.digest,
                            authorizeAccessKey,
                            name: capabilities.name ?? 'default',
                            ...(capabilities.showDeposit !== undefined
                              ? { showDeposit: capabilities.showDeposit }
                              : {}),
                            userId: capabilities.userId ?? Hex.random(16),
                            ...(personalSign_request ? { personalSign: personalSign_request } : {}),
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
                          ...(personalSign_request ? { personalSign: personalSign_request } : {}),
                          ...(capabilities?.showDeposit !== undefined
                            ? { showDeposit: capabilities.showDeposit }
                            : {}),
                        },
                        request,
                      )
                    })()

                    store.setState({
                      accounts: resolveAccounts(accounts),
                      activeAccount: 0,
                      // Persist absolutized auth URLs so a later
                      // `wallet_disconnect` can hit logout even when the
                      // URL was passed per-call. Always overwrite (never
                      // merge) so a connect WITHOUT auth clears stale
                      // state from a prior connect — otherwise a later
                      // disconnect could POST to a logout URL the
                      // current page never opted into.
                      auth:
                        auth_request && typeof auth_request === 'object' ? auth_request : undefined,
                    })

                    const accountAddress = accounts[0]?.address

                    // Server Authentication verify: POST the signed SIWE message
                    // to the verify endpoint. Skipped when the auth capability
                    // omits `verify` — typical when the wallet host strips it
                    // so the dapp-origin Provider does the verify call (and
                    // receives the session cookie on the dapp's origin).
                    //
                    // The signed message comes from one of two places:
                    // - terminal Provider (wallet host): `auth.message` we just fetched.
                    // - forwarding Provider (dapp): `personalSign.message` echoed back
                    //   by the wallet host's Provider.
                    const verifyUrl =
                      auth_request && typeof auth_request === 'object'
                        ? auth_request.verify
                        : undefined
                    const verifyMessage = auth?.message ?? personalSign?.message
                    const auth_result =
                      auth_request && verifyUrl && verifyMessage && signature && accountAddress
                        ? await verifyAuthMessage(auth_request, {
                            address: accountAddress,
                            message: verifyMessage,
                            signature,
                          })
                        : undefined

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
                                ...(signature && (!auth_request || auth_result || !verifyUrl)
                                  ? { signature }
                                  : {}),
                                ...(email !== undefined ? { email } : {}),
                                ...(username !== undefined ? { username } : {}),
                                ...((auth_result ?? auth_capability)
                                  ? { auth: auth_result ?? auth_capability }
                                  : {}),
                                ...(personalSign
                                  ? { personalSign: { message: personalSign.message } }
                                  : {}),
                              }
                            : {},
                      })),
                    } satisfies Rpc.wallet_connect.Encoded['returns']
                  }

                  case 'wallet_disconnect': {
                    // Best-effort logout. Source of the URL, in order:
                    // 1. Last-connected `auth` URLs persisted in the store
                    //    (handles per-call `auth` passed via wallet_connect).
                    // 2. Provider.create({ auth }) option fallback.
                    // Swallows all errors — disconnect must succeed even
                    // when the session is already gone or the server is
                    // unreachable.
                    const logoutUrl = (() => {
                      const stored = store.getState().auth
                      if (stored?.logout) return stored.logout
                      if (!options.auth) return undefined
                      try {
                        const absolute = absolutizeAuth(
                          options.auth as NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
                        )
                        return typeof absolute === 'object' ? absolute.logout : undefined
                      } catch {
                        return undefined
                      }
                    })()
                    if (logoutUrl)
                      await fetch(logoutUrl, {
                        method: 'POST',
                        credentials: 'include',
                      }).catch(() => {})
                    await actions.disconnect?.()
                    store.setState({
                      accessKeys: [],
                      accounts: [],
                      activeAccount: 0,
                      auth: undefined,
                    })
                    return
                  }

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
                      request._decoded.params?.[0] ?? {},
                      request,
                    )) satisfies Rpc.wallet_deposit.Encoded['returns']
                  }

                  case 'wallet_transfer': {
                    assertConnected()
                    // Default to the editable variant when params are
                    // omitted — Read-only mode requires `amount`,
                    // `to`, and `token`, so an empty call only makes
                    // sense as "open the wallet send UI".
                    const decoded = request._decoded.params?.[0] ?? { editable: true as const }

                    // Editable variant: forward to the wallet host UI.
                    if (decoded.editable === true) {
                      if (!actions.transfer)
                        throw new ox_Provider.UnsupportedMethodError({
                          message: '`transfer` not supported by adapter.',
                        })
                      const parameters = {
                        ...decoded,
                        ...(typeof decoded.feePayer !== 'undefined'
                          ? { feePayer: resolveFeePayer(decoded.feePayer) }
                          : {}),
                      } as Adapter.transfer.Parameters
                      return (await actions.transfer(
                        parameters,
                        request,
                      )) satisfies Rpc.wallet_transfer.Encoded['returns']
                    }

                    // Programmatic variant (default): skip the wallet UI,
                    // build the TIP-20 `transfer` call inline, and route
                    // through `eth_sendTransactionSync` (which uses an
                    // access key when one matches, falling back to the
                    // dialog otherwise).
                    const { amount, feePayer, from, memo, to, token } = decoded
                    const state = store.getState()
                    const chainId = decoded.chainId ?? state.chainId
                    const resolvedFeePayer = resolveFeePayer(feePayer)

                    const client = getClient({
                      chainId,
                      feePayer: typeof resolvedFeePayer === 'string' ? resolvedFeePayer : undefined,
                    })
                    const { address: tokenAddress, decimals } = await (async () => {
                      if (Address.validate(token)) {
                        const metadata = await Actions.token.getMetadata(client, {
                          token,
                        })
                        return { address: token, decimals: metadata.decimals }
                      }
                      const resolved = await Tokenlist.resolveSymbol({
                        chainId: client.chain.id,
                        symbol: token,
                      })
                      if (!resolved)
                        throw new ox_Provider.ProviderRpcError(
                          -32602,
                          `Unknown token symbol "${token}".`,
                        )
                      return { address: resolved.address, decimals: resolved.decimals }
                    })()
                    const amountUnits = parseUnits(amount, decimals)

                    // The signer is the active account (or its access
                    // key). `from` here is the TIP-20 source for
                    // `transferFrom` semantics, so we only forward it
                    // when the caller explicitly set it to a different
                    // address — otherwise `Actions.token.transfer.call`
                    // emits `transferFrom` (different selector) instead
                    // of plain `transfer`, breaking access-key scope
                    // matching.
                    const signerAddress = state.accounts[state.activeAccount]?.address
                    const sourceFrom =
                      from && signerAddress && from.toLowerCase() !== signerAddress.toLowerCase()
                        ? from
                        : undefined
                    const call = Actions.token.transfer.call({
                      amount: amountUnits,
                      ...(sourceFrom ? { from: sourceFrom } : {}),
                      memo: memo ? Hex.fromString(memo) : undefined,
                      to,
                      token: tokenAddress,
                    })

                    const txRequest = {
                      calls: [call],
                      chainId,
                      from: signerAddress,
                      ...(resolvedFeePayer !== undefined ? { feePayer: resolvedFeePayer } : {}),
                    }
                    const receipt = await actions.sendTransactionSync(txRequest, {
                      method: 'eth_sendTransactionSync',
                      params: [z.encode(Rpc.transactionRequest, txRequest)] as const,
                    })
                    return {
                      chainId: Hex.fromNumber(chainId),
                      receipt,
                    } satisfies Rpc.wallet_transfer.Encoded['returns']
                  }

                  case 'wallet_swap': {
                    assertConnected()
                    if (!actions.swap)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`swap` not supported by adapter.',
                      })
                    return (await actions.swap(
                      (request._decoded.params?.[0] ?? {}) as Adapter.swap.Parameters,
                      request,
                    )) satisfies Rpc.wallet_swap.Encoded['returns']
                  }

                  case 'wallet_depositZone': {
                    assertConnected()
                    if (!actions.depositZone)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`depositZone` not supported by adapter.',
                      })
                    const decoded = request._decoded.params?.[0] ?? {}
                    const parameters = {
                      ...decoded,
                      ...(typeof decoded.feePayer !== 'undefined'
                        ? { feePayer: resolveFeePayer(decoded.feePayer) }
                        : {}),
                    } as Adapter.depositZone.Parameters
                    return (await actions.depositZone(
                      parameters,
                      request,
                    )) satisfies Rpc.wallet_depositZone.Encoded['returns']
                  }

                  case 'wallet_withdrawZone': {
                    assertConnected()
                    if (!actions.withdrawZone)
                      throw new ox_Provider.UnsupportedMethodError({
                        message: '`withdrawZone` not supported by adapter.',
                      })
                    return (await actions.withdrawZone(
                      (request._decoded.params?.[0] ?? {}) as Adapter.withdrawZone.Parameters,
                      request,
                    )) satisfies Rpc.wallet_withdrawZone.Encoded['returns']
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
      getAccount() {
        const account = getAccount()
        return { address: account.address, type: 'json-rpc' as const }
      },
      async getAccessKeyStatus(options: getAccessKeyStatus.Options = {}) {
        const state = store.getState()
        const address = options.address ?? state.accounts[state.activeAccount]?.address
        if (!address) return 'missing'
        const chainId = options.chainId ?? state.chainId
        const { accessKey, calls } = options
        return await AccessKey.getStatus({
          account: address,
          ...(accessKey ? { accessKey } : {}),
          ...(calls ? { calls } : {}),
          chainId,
          client: provider.getClient({ chainId }),
          store,
        })
      },
      getClient(options: { chainId?: number | undefined; feePayer?: string | undefined } = {}) {
        const { chainId, feePayer } = options
        return Client.fromChainId(chainId, {
          chains,
          feePayer,
          provider: providerRef,
          store,
          transports,
        })
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

  const mpp = (() => {
    if (options.mpp === false) return undefined
    if (typeof options.mpp === 'object') return options.mpp
    return {}
  })()
  if (mpp) {
    const { mode = 'push', polyfill: polyfill_option, ...methodOptions } = mpp
    // Skip polyfill on runtimes where `globalThis.fetch` is read-only (e.g.
    // Cloudflare Workers). Caller can also explicitly opt out via `mpp.polyfill`.
    const polyfill = polyfill_option ?? isFetchWritable()
    const getClient = ({ chainId }: { chainId?: number | undefined }) => {
      const client = provider.getClient({ chainId })
      const account = store.getState().accounts[store.getState().activeAccount]
      if (!account) throw new ox_Provider.DisconnectedError({ message: 'No active account.' })
      return Object.assign(client, {
        account: {
          address: account.address,
          type: 'json-rpc' as const,
        },
      })
    }
    Mppx.create({
      methods: [
        mppx_tempo({ ...methodOptions, getClient, mode }),
        mppx_tempo.subscription({ getClient }),
      ],
      polyfill,
    })
  }

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
     * Default Server Authentication configuration for `wallet_connect`.
     *
     * When set, every `wallet_connect` call orchestrates the round-trip
     * against this endpoint unless the caller passes their own
     * `capabilities.auth` (per-call override).
     */
    auth?: z.input<typeof Rpc.wallet_connect.auth> | undefined
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
    /**
     * Enable Machine Payment Protocol (mppx) support.
     *
     * Pass an options object to configure, or `false` to disable.
     *
     * @default true
     */
    mpp?: boolean | mpp.Options | undefined
    /** Whether to persist credentials and access keys to storage. When `false`, only account addresses are persisted. @default true */
    persistCredentials?: boolean | undefined
    /**
     * Base URL for a wallet relay endpoint. When set, every chain's transport
     * defaults to `http(`${relay}/${chainId}`)` — a single endpoint that
     * routes by chain ID via the path. Per-chain entries in `transports`
     * override this on a chain-by-chain basis.
     *
     * @example
     * ```ts
     * const provider = Provider.create({ relay: '/relay' })
     * // tempo (33139) → http('/relay/33139')
     * // tempoModerato → http('/relay/<id>')
     * ```
     */
    relay?: string | undefined
    /** Storage adapter for persistence. @default Storage.idb() in browser, Storage.memory() otherwise. */
    storage?: Storage.Storage | undefined
    /**
     * Use testnet.
     * @default false
     */
    testnet?: boolean | undefined
    /**
     * Per-chain transports keyed by chain ID. When omitted, defaults to
     * `http()` for each chain (uses the chain's default RPC URL).
     *
     * @example
     * ```ts
     * import { http } from 'viem'
     * import { tempo, tempoModerato } from 'viem/tempo/chains'
     *
     * const provider = Provider.create({
     *   transports: {
     *     [tempo.id]: http('/relay/' + tempo.id),
     *     [tempoModerato.id]: http('/relay/' + tempoModerato.id),
     *   },
     * })
     * ```
     */
    transports?: Record<number, Transport> | undefined
  }
  type ReturnType = Provider
}

export declare namespace getAccessKeyStatus {
  /** Options for {@link Provider.getAccessKeyStatus}. */
  type Options = {
    /** Root account address. Defaults to the active account. */
    address?: Address.Address | undefined
    /** Specific access key address to query. When omitted, the first locally matching key is used. */
    accessKey?: Address.Address | undefined
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    /** Chain ID the access key must be authorized on. Defaults to the active chain. */
    chainId?: number | undefined
  }

  /** Access-key publication status. */
  type ReturnType = 'missing' | 'pending' | 'published' | 'expired'
}

export declare namespace mpp {
  /** Options for Machine Payment Protocol (mppx) integration. */
  type Options = Omit<mppx_tempo.Parameters, 'account' | 'getClient'> & {
    /**
     * Whether to polyfill `globalThis.fetch` with the payment-aware wrapper.
     *
     * Defaults to `true` when `globalThis.fetch` is writable, and `false`
     * otherwise (e.g. Cloudflare Workers, where `globalThis.fetch` is
     * read-only).
     */
    polyfill?: boolean | undefined
  }
}

function withDetails(error: unknown): Error & { details: string } {
  if (error instanceof Error) {
    const details = (error as { details?: unknown }).details
    if (typeof details === 'string') return error as Error & { details: string }
    Object.assign(error, { details: error.message })
    return error as Error & { details: string }
  }
  const next = new Error(String(error))
  Object.assign(next, { details: next.message })
  return next as Error & { details: string }
}

/**
 * Returns `true` if `globalThis.fetch` can be reassigned. Some runtimes
 * (notably Cloudflare Workers) expose a non-writable, non-configurable
 * `fetch` that throws when `Mppx.create({ polyfill: true })` tries to
 * replace it.
 *
 * Tries an actual no-op self-reassignment because some runtimes report a
 * writable descriptor but still throw at assignment time (e.g. Workers
 * dev runner via Durable Objects).
 */
function isFetchWritable(): boolean {
  try {
    const original = globalThis.fetch
    globalThis.fetch = original
    return true
  } catch {
    return false
  }
}

/**
 * Heuristic for whether the current runtime carries cookies on
 * `fetch(..., { credentials: 'include' })`:
 *
 * - **Browser**: `document.cookie` exists → uses the browser cookie jar.
 * - **React Native**: `navigator.product === 'ReactNative'` → uses the
 *   native cookie store.
 * - **Node / CLI**: neither — `credentials: 'include'` is a no-op.
 *
 * False negatives are possible (Node with `tough-cookie` shimmed in); the
 * caller can always force token mode via `auth: { returnToken: true }`.
 */
function hasCookieJar(): boolean {
  if (typeof document !== 'undefined' && typeof document.cookie === 'string') return true
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') return true
  return false
}

/**
 * Resolves a Server Authentication endpoint from the `auth` capability
 * into an absolute URL.
 *
 * - `auth: '/api/auth'`            → `/api/auth/challenge`, `/api/auth` (verify), `/api/auth/logout`
 * - `auth: { url: '/api/auth' }`   → same as above
 * - `auth: { challenge, verify }`  → explicit per-endpoint
 * - Mix: explicit endpoint wins over derivation from `url`.
 *
 * Relative paths (`/api/auth`, `auth/challenge`) are absolutized against
 * `window.location.origin` when available — same shape as `resolveFeePayer`.
 * Already-absolute `http(s)://` URLs pass through verbatim.
 */
function resolveAuthEndpoint(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
  kind: 'challenge' | 'verify' | 'logout',
): string {
  const path = (() => {
    if (typeof auth === 'string') {
      const base = auth.endsWith('/') ? auth.slice(0, -1) : auth
      return kind === 'verify' ? base : `${base}/${kind}`
    }
    const explicit = auth[kind]
    if (explicit) return explicit
    if (auth.url) {
      const base = auth.url.endsWith('/') ? auth.url.slice(0, -1) : auth.url
      return kind === 'verify' ? base : `${base}/${kind}`
    }
    throw new RpcResponse.InvalidParamsError({
      message: `\`auth\` capability must include either \`url\` or an explicit \`${kind}\` endpoint.`,
    })
  })()
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (typeof window !== 'undefined') return new URL(path, window.location.origin).href
  return path
}

/**
 * Pre-resolves the `auth` capability into its absolute object form. Run
 * once at the dapp-side Provider so forwarding adapters (dialog) carry
 * absolute URLs to the wallet host — the wallet's `window.location.origin`
 * belongs to the wallet, not the dapp, and cannot resolve relative paths
 * correctly.
 *
 * Individual endpoints are omitted when the input doesn't supply enough
 * info to derive them. `logout` is optional in the protocol; `verify` can
 * also be omitted by wallet-host re-entry so the dapp-origin Provider runs
 * verification and receives the session cookie.
 */
function absolutizeAuth(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
): NonNullable<z.output<typeof Rpc.wallet_connect.auth>> {
  // Wallet-host re-entry can strip endpoints (e.g. drop `verify` so the
  // dapp-origin Provider runs verify). Only resolve endpoints the input
  // can derive — pass through everything else as-is.
  const hasUrl = typeof auth === 'string' || Boolean(auth.url)
  const hasChallenge = hasUrl || (typeof auth === 'object' && Boolean(auth.challenge))
  const hasVerify = hasUrl || (typeof auth === 'object' && Boolean(auth.verify))
  const hasLogout = hasUrl || (typeof auth === 'object' && Boolean(auth.logout))
  const resolved = {
    ...(hasChallenge ? { challenge: resolveAuthEndpoint(auth, 'challenge') } : {}),
    ...(hasVerify ? { verify: resolveAuthEndpoint(auth, 'verify') } : {}),
    ...(hasLogout ? { logout: resolveAuthEndpoint(auth, 'logout') } : {}),
    ...(typeof auth === 'object' && auth.returnToken ? { returnToken: true } : {}),
  }
  assertSameAuthOrigin(resolved)
  return resolved
}

function assertSameAuthOrigin(auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>): void {
  if (typeof auth !== 'object') return
  const urls = [auth.challenge, auth.verify, auth.logout].filter(
    (u): u is string => typeof u === 'string',
  )
  const origins = urls.map((url) => {
    try {
      return new URL(url).origin
    } catch {
      throw new RpcResponse.InvalidParamsError({
        message: `\`auth\` endpoint is not a valid URL: ${url}`,
      })
    }
  })
  const first = origins[0]!
  if (origins.some((origin) => origin !== first))
    throw new RpcResponse.InvalidParamsError({
      message: '`auth` endpoints (`challenge`, `verify`, `logout`) must share the same origin.',
    })
}

/**
 * Hint appended to "domain mismatch" / "uri mismatch" errors raised in
 * {@link fetchAuthChallenge}. Most of the time these come from a server
 * sitting behind a TLS-terminating proxy (Cloudflare Tunnel, ngrok, a
 * CDN) that forwards `x-forwarded-proto` / `x-forwarded-host` headers the
 * auth handler isn't honoring by default.
 */
const authOriginHint =
  ' Hint: if the server is behind a reverse proxy or tunnel, set `Handler.auth({ trustProxy: true })` to honor `x-forwarded-*` headers, or pin the public origin with `Handler.auth({ origin: "https://app.example.com" })`.'

/**
 * Fetches an auth challenge from the auth endpoint and validates that the
 * server-supplied message is bound to the auth endpoint's origin and the
 * requested chain.
 *
 * Expects an absolutized auth capability (post-`absolutizeAuth`).
 *
 * The signature produced from this challenge is a portable artifact: once
 * the wallet signs, anyone holding the bytes can replay it against any
 * auth verifier that accepts the embedded domain. We therefore refuse to
 * sign a message whose `domain`/`uri` doesn't match the auth endpoint —
 * otherwise a compromised auth provider could trick the wallet into
 * signing "Sign in to attacker.com" and use it to log in as the user
 * elsewhere.
 */
async function fetchAuthChallenge(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
  chainId: number,
): Promise<{ message: string }> {
  const url = typeof auth === 'object' ? auth.challenge! : resolveAuthEndpoint(auth, 'challenge')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId }),
  })
  if (!res.ok)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` returned ${res.status}.`,
    })
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  if (!body.message)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` response missing \`message\`.`,
    })

  const parsed = parseSiweMessage(body.message)
  const expected = new URL(url)

  if (parsed.version !== '1')
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` returned a non-SIWE-v1 message.`,
    })
  if (!parsed.nonce)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` response is missing a \`nonce\`.`,
    })
  if (parsed.domain !== expected.host)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` returned a message bound to \`${parsed.domain}\` (expected \`${expected.host}\`).${authOriginHint}`,
    })
  if (parsed.uri !== expected.origin)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` returned a message with \`uri\` \`${parsed.uri}\` (expected \`${expected.origin}\`).${authOriginHint}`,
    })
  if (parsed.chainId !== chainId)
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` returned a message bound to chainId \`${parsed.chainId}\` (expected \`${chainId}\`).`,
    })

  return { message: body.message }
}

/**
 * Posts the signed message to the auth `verify` endpoint and returns
 * the SDK-shaped `auth` capability output (`{ token }` in token mode,
 * `{}` in cookie mode).
 */
async function verifyAuthMessage(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
  body: { address: Address.Address; message: string; signature: Hex.Hex },
): Promise<{ token?: string }> {
  const url = typeof auth === 'object' ? auth.verify! : resolveAuthEndpoint(auth, 'verify')
  // Auto-request the token in environments without a cookie jar (Node
  // CLI). Browser / React Native let the cookie do the work; explicit
  // `returnToken: true` always wins.
  const explicitReturnToken = typeof auth === 'object' && auth.returnToken === true
  const returnToken = explicitReturnToken || !hasCookieJar()
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      ...(returnToken ? { returnToken: true } : {}),
    }),
  })
  if (!res.ok)
    throw new RpcResponse.InternalError({
      message: `Server Authentication verify endpoint \`${url}\` returned ${res.status}.`,
    })
  const json = (await res.json().catch(() => ({}))) as { token?: string }
  return json.token ? { token: json.token } : {}
}
