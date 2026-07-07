import { announceProvider } from 'mipd'
import { Mppx, tempo as mppx_tempo, type ResolveAccountInfo } from 'mppx/client'
import { Address, Hash, Hex, Json, Provider as ox_Provider, RpcResponse } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import {
  createWalletClient,
  custom,
  hashMessage,
  hashTypedData,
  http,
  parseUnits,
  type Chain,
  type Client as ViemClient,
  type Transport,
} from 'viem'
import type { JsonRpcAccount } from 'viem/accounts'
import {
  prepareTransactionRequest,
  sendTransaction,
  sendTransactionSync as viem_sendTransactionSync,
  signTransaction as viem_signTransaction,
} from 'viem/actions'
import { parseSiweMessage } from 'viem/siwe'
import { Account as TempoAccount, Actions } from 'viem/tempo'
import { tempo, tempoDevnet, tempoModerato } from 'viem/tempo/chains'
import * as z from 'zod/mini'

import * as AccessKey from './AccessKey.js'
import * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import { dialog } from './adapters/dialog.js'
import * as Client from './Client.js'
import * as AccessKeyTransaction from './internal/AccessKeyTransaction.js'
import * as AddressUtil from './internal/address.js'
import { withDedupe } from './internal/withDedupe.js'
import * as Keystore from './Keystore.js'
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
    /** Returns the active root account as a viem account. */
    getAccount(
      options: Omit<Account.find.Options, 'store'> & { signable: true },
    ): TempoAccount.Account
    getAccount(options?: Omit<Account.find.Options, 'store'>): JsonRpcAccount
    /** Returns local or on-chain publication status for an access key. */
    getAccessKeyStatus(
      options?: getAccessKeyStatus.Options | undefined,
    ): Promise<getAccessKeyStatus.ReturnType>
    /** Returns a viem Client for the given (or current) chain ID. */
    getClient(options?: {
      chainId?: number | undefined
      feePayer?: string | undefined
    }): ViemClient<Transport, typeof tempo>
    /** Returns mppx Tempo client parameters backed by this provider. */
    getMppxParameters(options?: getMppxParameters.Options | undefined): MppxParameters
    /** Reactive state store. */
    store: Store.Store
  }

const announced = new Set<string>()

type TransactionParameters = Adapter.ActionRequest<typeof Rpc.eth_sendTransaction.schema>

type WalletConnectCapabilities = NonNullable<
  NonNullable<Rpc.wallet_connect.Decoded['params']>[number]['capabilities']
>
type AuthCapabilityResult = NonNullable<
  Rpc.wallet_connect.Encoded['returns']['accounts'][number]['capabilities']['auth']
>

type MppxParameters = {
  getClient: NonNullable<mppx_tempo.Parameters['getClient']>
  resolveAccount: NonNullable<mppx_tempo.Parameters['resolveAccount']>
}

function isBrowserWebCrypto() {
  return typeof document !== 'undefined' && !!globalThis.crypto?.subtle
}

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
  const authorizeAccessKey_default = options.accessKey?.authorize ?? options.authorizeAccessKey
  // Filled in below once the adapter instance exists (adapters may supply
  // environment defaults). The object identity is shared with the store's
  // access-key manager and serializer; nothing reads it before the first
  // request.
  const keystores: Keystore.Keystores = {}

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
    keystores,
    maxAccounts,
    persistCredentials,
    schema: adapter.schema,
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

  // App-level keystores override adapter-supplied defaults.
  const keystores_configured = options.accessKey?.keystores ?? instance.accessKey?.keystores
  Object.assign(keystores, keystores_configured ?? Keystore.defaults)

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

  function unsupported(action: string): never {
    throw new ox_Provider.UnsupportedMethodError({
      message: `\`${action}\` not supported by adapter.`,
    })
  }

  async function getAdapterAccount(
    options: Adapter.getAccount.Options = {},
  ): Promise<Awaited<Adapter.getAccount.ReturnType>> {
    if (!instance.getAccount) unsupported('getAccount')
    return await instance.getAccount(options)
  }

  function getWalletClient(options: {
    account: Awaited<Adapter.getAccount.ReturnType>['account']
    chainId?: number | undefined
    feePayer?: string | false | undefined
    transport?: Transport | undefined
  }) {
    const client = getClient({ chainId: options.chainId, feePayer: options.feePayer })
    return createWalletClient({
      account: options.account,
      chain: client.chain,
      transport: options.transport ?? custom({ request: client.request }),
    })
  }

  async function prepareRootTransaction(parameters: TransactionParameters) {
    const { feePayer, ...rest } = parameters
    const selected = await getAdapterAccount({ address: parameters.from })
    const client = getWalletClient({
      account: selected.account,
      chainId: parameters.chainId,
      feePayer: feePayer === true ? undefined : feePayer,
      transport: selected.transport,
    })
    const request = {
      ...rest,
      ...(feePayer ? { feePayer: true as const } : {}),
    }
    if (selected.account.type === 'json-rpc') return { client, request, selected }
    const prepared = await prepareTransactionRequest(client, {
      account: selected.account,
      ...request,
      type: 'tempo',
    } as never)
    return { client, request: prepared, selected }
  }

  async function signTransaction_(parameters: TransactionParameters) {
    {
      const state = store.getState()
      const chainId = parameters.chainId ?? state.chainId
      const client = getClient({
        chainId,
        feePayer: (() => {
          if (parameters.feePayer === false) return false
          if (typeof parameters.feePayer === 'string') return parameters.feePayer
          return undefined
        })(),
      })
      const address = parameters.from ?? state.accounts[state.activeAccount]?.address
      const transaction = address
        ? await AccessKeyTransaction.create({
            address,
            calls: parameters.calls,
            chainId,
            client,
            store,
          })
        : undefined
      if (transaction)
        try {
          const { feePayer, ...rest } = parameters
          const prepared = await transaction.prepare({
            ...rest,
            ...(feePayer ? { feePayer: true as never } : {}),
          })
          return await prepared.sign()
        } catch {}
    }

    const { client, request, selected } = await prepareRootTransaction(parameters)
    if (selected.account.type === 'json-rpc')
      return await viem_signTransaction(client, request as never)
    return await selected.account.signTransaction!(request as never)
  }

  async function sendTransaction_(parameters: TransactionParameters) {
    {
      const state = store.getState()
      const chainId = parameters.chainId ?? state.chainId
      const client = getClient({
        chainId,
        feePayer: (() => {
          if (parameters.feePayer === false) return false
          if (typeof parameters.feePayer === 'string') return parameters.feePayer
          return undefined
        })(),
      })
      const address = parameters.from ?? state.accounts[state.activeAccount]?.address
      const transaction = address
        ? await AccessKeyTransaction.create({
            address,
            calls: parameters.calls,
            chainId,
            client,
            store,
          })
        : undefined
      if (transaction)
        try {
          const { feePayer, ...rest } = parameters
          const prepared = await transaction.prepare({
            ...rest,
            ...(feePayer ? { feePayer: true as never } : {}),
          })
          return await prepared.send()
        } catch {}
    }

    const { feePayer, ...rest } = parameters
    const selected = await getAdapterAccount({ address: parameters.from })
    const client = getWalletClient({
      account: selected.account,
      chainId: parameters.chainId,
      feePayer: feePayer === true ? undefined : feePayer,
      transport: selected.transport,
    })
    return await sendTransaction(client, {
      ...rest,
      ...(feePayer ? { feePayer: true as never } : {}),
    } as never)
  }

  async function sendTransactionSync_(parameters: TransactionParameters) {
    {
      const state = store.getState()
      const chainId = parameters.chainId ?? state.chainId
      const client = getClient({
        chainId,
        feePayer: (() => {
          if (parameters.feePayer === false) return false
          if (typeof parameters.feePayer === 'string') return parameters.feePayer
          return undefined
        })(),
      })
      const address = parameters.from ?? state.accounts[state.activeAccount]?.address
      const transaction = address
        ? await AccessKeyTransaction.create({
            address,
            calls: parameters.calls,
            chainId,
            client,
            store,
          })
        : undefined
      if (transaction)
        try {
          const { feePayer, ...rest } = parameters
          const prepared = await transaction.prepare({
            ...rest,
            ...(feePayer ? { feePayer: true as never } : {}),
          })
          return await prepared.sendSync()
        } catch {}
    }

    const { feePayer, ...rest } = parameters
    const selected = await getAdapterAccount({ address: parameters.from })
    const client = getWalletClient({
      account: selected.account,
      chainId: parameters.chainId,
      feePayer: feePayer === true ? undefined : feePayer,
      transport: selected.transport,
    })
    const request = {
      ...rest,
      ...(feePayer ? { feePayer: true as const } : {}),
    }
    if (selected.account.type === 'json-rpc')
      return (await client.request({
        method: 'eth_sendTransactionSync' as never,
        params: [z.encode(Rpc.transactionRequest, request)] as never,
      })) as Rpc.eth_sendTransactionSync.Encoded['returns']
    const receipt = await viem_sendTransactionSync(client, {
      account: selected.account,
      ...request,
    } as never)
    return z.encode(Rpc.receipt, receipt as never) as Rpc.eth_sendTransactionSync.Encoded['returns']
  }

  async function signPersonalMessage(parameters: { address: Address.Address; data: Hex.Hex }) {
    const selected = await getAdapterAccount({ address: parameters.address })
    const client = getWalletClient({ account: selected.account, transport: selected.transport })
    if (selected.account.type === 'json-rpc')
      return await client.signMessage({
        account: selected.account,
        message: { raw: parameters.data },
      })
    return await selected.account.sign!({ hash: hashMessage({ raw: parameters.data }) })
  }

  async function signTypedData(parameters: { address: Address.Address; data: string }) {
    const typedData = JSON.parse(parameters.data) as {
      domain: Record<string, unknown>
      message: Record<string, unknown>
      primaryType: string
      types: Record<string, unknown>
    }
    const selected = await getAdapterAccount({ address: parameters.address })
    const client = getWalletClient({ account: selected.account, transport: selected.transport })
    if (selected.account.type === 'json-rpc')
      return await client.signTypedData({
        account: selected.account,
        ...typedData,
      } as never)
    return await selected.account.sign!({ hash: hashTypedData(typedData as never) })
  }

  async function authorizeAccessKey(parameters: Adapter.authorizeAccessKey.Parameters) {
    const selected = await getAdapterAccount()
    const chainId = parameters.chainId ?? getClient().chain.id
    if (selected.account.type !== 'json-rpc') {
      const keyAuthorization = await store.accessKeys.authorize({
        account: selected.account as Pick<TempoAccount.Account, 'address' | 'sign'>,
        chainId,
        parameters,
      })
      return { keyAuthorization, rootAddress: selected.account.address }
    }

    const prepared = await prepareAuthorizeAccessKey(parameters, Number(chainId))
    const client = getWalletClient({
      account: selected.account,
      chainId: Number(chainId),
      transport: selected.transport,
    })
    const result = (await client.request({
      method: 'wallet_authorizeAccessKey' as never,
      params: [z.encode(Rpc.wallet_authorizeAccessKey.parameters, prepared.parameters)] as never,
    })) as Adapter.authorizeAccessKey.ReturnType
    await savePreparedAccessKey({
      account: result.rootAddress,
      accessKey: prepared,
      keyAuthorization: result.keyAuthorization,
    })
    return result
  }

  async function prepareAuthorizeAccessKey(
    parameters: Adapter.authorizeAccessKey.Parameters,
    chainId: number | undefined,
  ): Promise<{
    key?: { handle: Keystore.Handle; publicKey: Hex.Hex } | undefined
    parameters: Adapter.authorizeAccessKey.Parameters
    privateKey?: Hex.Hex | undefined
  }> {
    const chainId_ = parameters.chainId ?? chainId ?? getClient().chain.id
    if (parameters.privateKey || parameters.address || parameters.publicKey) {
      const prepared = await AccessKey.prepareAuthorization({
        ...parameters,
        chainId: chainId_,
      })
      return {
        parameters: toAuthorizeAccessKeyParameters(parameters, prepared.keyAuthorization),
        ...(prepared.privateKey ? { privateKey: prepared.privateKey } : {}),
      }
    }

    // Resolve the key source: configured keystores (app-level, else the
    // adapter's defaults) win; otherwise the built-in keystore — in browsers
    // only, since elsewhere the wallet generates the key.
    if (!keystores_configured && !isBrowserWebCrypto()) return { parameters }

    const { key, keyAuthorization } = await AccessKey.prepareAuthorization({
      ...parameters,
      chainId: chainId_,
      keystores,
    })
    if (!key)
      throw new RpcResponse.InternalError({
        message: 'Keystore did not produce access-key material.',
      })
    return {
      key,
      parameters: {
        ...toAuthorizeAccessKeyParameters(parameters, keyAuthorization),
        publicKey: key.publicKey,
      },
    }
  }

  function toAuthorizeAccessKeyParameters(
    parameters: Adapter.authorizeAccessKey.Parameters,
    keyAuthorization: Awaited<
      ReturnType<typeof AccessKey.prepareAuthorization>
    >['keyAuthorization'],
  ) {
    const parameters_rpc = { ...parameters }
    delete parameters_rpc.privateKey
    return {
      ...parameters_rpc,
      address: keyAuthorization.address,
      chainId: keyAuthorization.chainId,
      keyType: keyAuthorization.type,
    }
  }

  async function savePreparedAccessKey(options: {
    accessKey: Awaited<ReturnType<typeof prepareAuthorizeAccessKey>> | undefined
    account: Address.Address | undefined
    keyAuthorization: KeyAuthorization.Rpc | undefined
  }) {
    const { accessKey, account, keyAuthorization } = options
    if (!account || !keyAuthorization || !accessKey) return
    const { key, privateKey } = accessKey
    const material = key
      ? { handle: key.handle, publicKey: key.publicKey }
      : privateKey
        ? { privateKey }
        : undefined
    if (!material) return
    store.accessKeys.add({
      account,
      authorization: KeyAuthorization.fromRpc(keyAuthorization),
      ...material,
    })
  }

  async function revokeAccessKey(parameters: {
    address: Address.Address
    accessKeyAddress: Address.Address
  }) {
    const selected = await getAdapterAccount({ address: parameters.address })
    const client = getWalletClient({
      account: selected.account,
      transport: selected.transport,
    })
    if (selected.account.type === 'json-rpc') {
      await client.request({
        method: 'wallet_revokeAccessKey' as never,
        params: [parameters] as never,
      })
    } else {
      try {
        await Actions.accessKey.revoke(getClient(), {
          account: selected.account as TempoAccount.Account,
          accessKey: parameters.accessKeyAddress,
        })
      } catch (error) {
        if (!AccessKey.isUnavailableError(error)) throw error
      }
    }
    store.accessKeys.remove({
      accessKey: parameters.accessKeyAddress,
      account: parameters.address,
      chainId: store.getState().chainId,
    })
  }

  async function updateAccessKey(parameters: Adapter.updateAccessKey.Parameters) {
    const selected = await getAdapterAccount({ address: parameters.address })
    const chainId = Number(parameters.chainId ?? getClient().chain.id)
    if (selected.account.type === 'json-rpc') {
      const client = getWalletClient({
        account: selected.account,
        chainId,
        transport: selected.transport,
      })
      await client.request({
        method: 'wallet_updateAccessKey' as never,
        params: [z.encode(Rpc.wallet_updateAccessKey.parameters, parameters)] as never,
      })
      return
    }
    // One transaction; `updateSpendingLimit` writes each token's remaining
    // allowance directly, preserving period configuration.
    const calls = parameters.limits.map((limit) =>
      Actions.accessKey.updateLimit.call({
        accessKey: parameters.accessKeyAddress,
        limit: limit.limit,
        token: limit.token,
      }),
    )
    await viem_sendTransactionSync(getClient({ chainId }), {
      account: selected.account,
      calls,
    })
  }

  async function signTransactionAction(
    parameters: TransactionParameters,
    request: Pick<Rpc.eth_signTransaction.Encoded, 'method' | 'params'>,
  ) {
    if (actions.signTransaction) return await actions.signTransaction(parameters, request)
    if (instance.getAccount) return await signTransaction_(parameters)
    unsupported('signTransaction')
  }

  async function sendTransactionAction(
    parameters: TransactionParameters,
    request: Pick<Rpc.eth_sendTransaction.Encoded, 'method' | 'params'>,
  ) {
    if (actions.sendTransaction) return await actions.sendTransaction(parameters, request)
    if (instance.getAccount) return await sendTransaction_(parameters)
    unsupported('sendTransaction')
  }

  async function sendTransactionSyncAction(
    parameters: TransactionParameters,
    request: Pick<Rpc.eth_sendTransactionSync.Encoded, 'method' | 'params'>,
  ) {
    if (actions.sendTransactionSync) return await actions.sendTransactionSync(parameters, request)
    if (instance.getAccount) return await sendTransactionSync_(parameters)
    unsupported('sendTransactionSync')
  }

  async function signPersonalMessageAction(
    parameters: { address: Address.Address; data: Hex.Hex },
    request: Pick<Rpc.personal_sign.Encoded, 'method' | 'params'>,
  ) {
    if (actions.signPersonalMessage) return await actions.signPersonalMessage(parameters, request)
    if (instance.getAccount) return await signPersonalMessage(parameters)
    unsupported('signPersonalMessage')
  }

  async function signTypedDataAction(
    parameters: { address: Address.Address; data: string },
    request: Pick<Rpc.eth_signTypedData_v4.Encoded, 'method' | 'params'>,
  ) {
    if (actions.signTypedData) return await actions.signTypedData(parameters, request)
    if (instance.getAccount) return await signTypedData(parameters)
    unsupported('signTypedData')
  }

  async function authorizeAccessKeyAction(
    parameters: Adapter.authorizeAccessKey.Parameters,
    request: Pick<Rpc.wallet_authorizeAccessKey.Encoded, 'method' | 'params'>,
  ) {
    if (actions.authorizeAccessKey) return await actions.authorizeAccessKey(parameters, request)
    if (instance.getAccount) return await authorizeAccessKey(parameters)
    unsupported('authorizeAccessKey')
  }

  async function revokeAccessKeyAction(
    parameters: Adapter.revokeAccessKey.Parameters,
    request: Pick<Rpc.wallet_revokeAccessKey.Encoded, 'method' | 'params'>,
  ) {
    if (actions.revokeAccessKey) return await actions.revokeAccessKey(parameters, request)
    if (instance.getAccount) return await revokeAccessKey(parameters)
    unsupported('revokeAccessKey')
  }

  async function updateAccessKeyAction(
    parameters: Adapter.updateAccessKey.Parameters,
    request: Pick<Rpc.wallet_updateAccessKey.Encoded, 'method' | 'params'>,
  ) {
    if (actions.updateAccessKey) return await actions.updateAccessKey(parameters, request)
    if (instance.getAccount) return await updateAccessKey(parameters)
    unsupported('updateAccessKey')
  }

  /** Returns accounts to persist. When `persistAccounts` is set, merges new accounts with existing ones. */
  function resolveAccounts(accounts: readonly Account.Store[]) {
    if (!instance.persistAccounts) return accounts
    const merged = [...accounts]
    for (const a of store.getState().accounts)
      if (!merged.some((m) => AddressUtil.isEqual(m.address, a.address))) merged.push(a)
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

  function stripAuthorizeAccessKey(
    parameters: create.AuthorizeAccessKeyParameters,
  ): Adapter.authorizeAccessKey.Parameters {
    const { reuse: _reuse, ...rest } = parameters
    return rest
  }

  function resolveDefaultAuthorizeAccessKey(): create.AuthorizeAccessKeyParameters | undefined {
    if (typeof authorizeAccessKey_default === 'function') return authorizeAccessKey_default()
    return authorizeAccessKey_default
  }

  async function defaultAuthorizeAccessKeyForConnect(options_: {
    capabilities: WalletConnectCapabilities | undefined
    chainId: number
  }): Promise<Adapter.authorizeAccessKey.Parameters | undefined> {
    const parameters = resolveDefaultAuthorizeAccessKey()
    if (!parameters) return undefined
    const address = reusableConnectAccount(options_.capabilities)
    if (
      address &&
      (await AccessKey.hasReusableAuthorization({
        account: address,
        chainId: Number(parameters.chainId ?? options_.chainId),
        parameters,
        store: { keystores, state: store },
      }))
    )
      return undefined
    return stripAuthorizeAccessKey(parameters)
  }

  function reusableConnectAccount(
    capabilities: WalletConnectCapabilities | undefined,
  ): Address.Address | undefined {
    const state = store.getState()
    if (state.accounts.length === 0) return undefined
    if (capabilities && 'selectAccount' in capabilities && capabilities.selectAccount)
      return undefined
    if (capabilities && 'credentialId' in capabilities && capabilities.credentialId) {
      const account = state.accounts.find(
        (a) => 'credential' in a && a.credential?.id === capabilities.credentialId,
      )
      return account?.address
    }
    if (capabilities?.method === 'register' && capabilities.name) {
      const account = state.accounts.find(
        (a) => 'credential' in a && a.label?.toLowerCase() === capabilities.name!.toLowerCase(),
      )
      return account?.address
    }
    return state.accounts[state.activeAccount]?.address ?? state.accounts[0]?.address
  }

  async function authorizeDefaultAccessKeyForTransaction(options_: {
    address: Address.Address
    calls?: readonly AccessKey.Call[] | undefined
    chainId: number
  }): Promise<void> {
    const parameters = resolveDefaultAuthorizeAccessKey()
    if (!parameters) return
    const existing = await store.accessKeys.select({
      account: options_.address,
      ...(options_.calls ? { calls: options_.calls } : {}),
      chainId: Number(parameters.chainId ?? options_.chainId),
    })
    if (existing) return
    if (!AccessKey.canAuthorizeCalls({ parameters, calls: options_.calls })) return
    const decoded = stripAuthorizeAccessKey(parameters)
    await authorizeAccessKeyAction(decoded, {
      method: 'wallet_authorizeAccessKey',
      params: [z.encode(Rpc.wallet_authorizeAccessKey.parameters, decoded)!],
    })
  }

  function assertMppAccountConnected(address: Address.Address) {
    const { accounts } = store.getState()
    if (accounts.length === 0)
      throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })
    if (!accounts.some((account) => AddressUtil.isEqual(account.address, address)))
      throw new ox_Provider.UnauthorizedError({ message: `Account "${address}" not found.` })
  }

  async function resolveMppAccount(
    info: ResolveAccountInfo,
    options_: { accessKey?: Address.Address | undefined } = {},
  ) {
    const account = AddressUtil.from(info.account.address)
    if (!account) return undefined
    assertMppAccountConnected(account)

    if (options_.accessKey) {
      const authority =
        info.operation.kind === 'authorizePaymentChannel'
          ? AddressUtil.from(info.operation.authority)
          : undefined
      if (authority && !AddressUtil.isEqual(authority, options_.accessKey))
        throw new ox_Provider.UnauthorizedError({
          message: `Access key "${options_.accessKey}" cannot satisfy channel authority "${authority}".`,
        })
      const query = {
        account,
        accessKey: options_.accessKey,
        chainId: info.chainId,
      } as const
      if (info.operation.kind === 'executeCalls' && !info.operation.calls) {
        const accessKey = await store.accessKeys.get(query)
        const record = store.accessKeys.list(query)[0]
        if (accessKey && record?.scopes)
          throw new ox_Provider.UnauthorizedError({
            message: `Access key "${options_.accessKey}" cannot be selected for executeCalls without transaction call details.`,
          })
        if (accessKey) return accessKey
      }
      const accessKey = await store.accessKeys.get({
        ...query,
        ...(info.operation.kind === 'executeCalls' ? { calls: info.operation.calls } : {}),
      })
      if (!accessKey) {
        throw new ox_Provider.UnauthorizedError({
          message: `Access key "${options_.accessKey}" cannot sign for account "${account}".`,
        })
      }
      return accessKey
    }

    if (info.operation.kind === 'executeCalls')
      return await store.accessKeys.select({
        account,
        ...(info.operation.calls ? { calls: info.operation.calls } : {}),
        chainId: info.chainId,
      })

    const accessKey = AddressUtil.from(info.operation.authority)
    if (!accessKey) return await store.accessKeys.select({ account, chainId: info.chainId })
    if (AddressUtil.isZero(accessKey) || AddressUtil.isEqual(accessKey, account)) return undefined

    return await store.accessKeys.get({
      account,
      accessKey,
      chainId: info.chainId,
    })
  }

  function getMppxParameters(options_: getMppxParameters.Options = {}): MppxParameters {
    const accessKey = (() => {
      if (!options_.accessKey) return undefined
      const accessKey = AddressUtil.from(options_.accessKey)
      if (!accessKey)
        throw new RpcResponse.InvalidParamsError({
          message: `Invalid access key address "${options_.accessKey}".`,
        })
      return accessKey
    })()

    return {
      getClient({ chainId }: { chainId?: number | undefined }) {
        if (chainId !== undefined && !chains.some((chain) => chain.id === chainId))
          throw new ox_Provider.UnsupportedChainIdError({
            message: `Chain ${chainId} not configured.`,
          })
        const client = provider.getClient({ chainId })
        const account = store.getState().accounts[store.getState().activeAccount]
        if (!account) throw new ox_Provider.DisconnectedError({ message: 'No active account.' })
        return Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
          account: {
            address: account.address,
            type: 'json-rpc' as const,
          },
        })
      },
      resolveAccount: (info: ResolveAccountInfo) => resolveMppAccount(info, { accessKey }),
    }
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
                    const chainId = decoded.chainId ?? state.chainId
                    const from = decoded.from ?? state.accounts[state.activeAccount]?.address
                    if (from)
                      await authorizeDefaultAccessKeyForTransaction({
                        address: from,
                        ...(calls ? { calls } : {}),
                        chainId,
                      })
                    return (await sendTransactionAction(
                      {
                        ...rest,
                        chainId,
                        from,
                        ...(calls ? { calls } : {}),
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_sendTransaction.Encoded['returns']
                  }

                  case 'eth_fillTransaction': {
                    const [decoded] = request._decoded.params
                    const parameters = { ...decoded }
                    const feePayer = resolveFeePayer(parameters.feePayer)
                    const client = getClient({ chainId: parameters.chainId, feePayer })
                    const state = store.getState()
                    const chainId = parameters.chainId ?? state.chainId
                    const address = parameters.from ?? state.accounts[state.activeAccount]?.address

                    // The node sizes intrinsic gas from the signing key's signature
                    // type; absent it, it assumes secp256k1 (the smallest signature)
                    // and underestimates gas for p256/webAuthn signers. The key type
                    // is the *signer's*, not the embedded `keyAuthorization`'s (which
                    // is just a registration payload). The `fill` path below always
                    // signs with the root account, so resolve its key type (a caller's
                    // explicit `keyType` wins) and hand viem's tempo formatter an
                    // account carrying it — viem forwards `keyType` and derives the
                    // webAuthn `keyData` hint. secp256k1 (the node default) flows
                    // through the legacy formatter unchanged. The managed access-key
                    // path carries the access key's type via its own viem account.
                    const signer = ((): JsonRpcAccount | undefined => {
                      if (!address) return undefined
                      const keyType =
                        parameters.keyType ??
                        Account.signatureKeyType(
                          state.accounts.find((a) => AddressUtil.isEqual(a.address, address)),
                        )
                      if (!keyType) return undefined
                      return { address, keyType, type: 'json-rpc' } as JsonRpcAccount
                    })()
                    const fill = (account = signer) => {
                      const fillRequest = {
                        ...parameters,
                        ...(account ? { account, from: account.address } : {}),
                        chainId,
                        ...(feePayer ? { feePayer: true } : {}),
                      }
                      const formatter = client.chain?.formatters?.transactionRequest
                      const formatted = formatter
                        ? formatter.format({ ...fillRequest } as never, 'fillTransaction')
                        : fillRequest
                      return client.request({
                        method: 'eth_fillTransaction',
                        params: [formatted as never],
                      })
                    }

                    // Dapp-provided `keyAuthorization`: the root account signs and
                    // the authorization rides along in `parameters` (so the node
                    // prices its on-chain registration). Skip managed access-key
                    // routing, which would otherwise attach a second authorization.
                    if (parameters.keyAuthorization) return await fill()

                    // Locally-managed access key: the access key signs, and viem
                    // attaches a stored `keyAuthorization` if one is still pending
                    // (i.e. not yet authorized on-chain). When it does, the estimate
                    // must include the gas to authorize the key on-chain — so this
                    // path can't be collapsed into the plain root fill. Falls back to
                    // the root account on failure.
                    if (address) {
                      const calls =
                        parameters.calls ??
                        (parameters.to ? [{ data: parameters.data, to: parameters.to }] : undefined)
                      const transaction = await AccessKeyTransaction.create({
                        address,
                        calls,
                        chainId,
                        client,
                        store,
                      })
                      if (transaction)
                        try {
                          return await transaction.fill({
                            ...parameters,
                            chainId,
                            from: address,
                            ...(feePayer ? { feePayer: true } : {}),
                          })
                        } catch {
                          // Fall through to the root account fill.
                        }
                    }

                    return await fill()
                  }

                  case 'eth_signTransaction': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    const { to, data, ...rest } = decoded
                    const calls =
                      decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
                    const state = store.getState()
                    return (await signTransactionAction(
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
                    const chainId = decoded.chainId ?? state.chainId
                    const from = decoded.from ?? state.accounts[state.activeAccount]?.address
                    if (from)
                      await authorizeDefaultAccessKeyForTransaction({
                        address: from,
                        ...(calls ? { calls } : {}),
                        chainId,
                      })
                    return (await sendTransactionSyncAction(
                      {
                        ...rest,
                        chainId,
                        from,
                        ...(calls ? { calls } : {}),
                        feePayer: resolveFeePayer(decoded.feePayer),
                      },
                      request,
                    )) satisfies Rpc.eth_sendTransactionSync.Encoded['returns']
                  }

                  case 'eth_signTypedData_v4': {
                    assertConnected()
                    const [address, data] = request._decoded.params
                    return (await signTypedDataAction(
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
                    return (await signPersonalMessageAction(
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
                      const from_ = from ?? state.accounts[state.activeAccount]?.address
                      if (from_)
                        await authorizeDefaultAccessKeyForTransaction({
                          address: from_,
                          calls,
                          chainId: chainId ?? state.chainId,
                        })
                      const txRequest = {
                        calls,
                        chainId,
                        from: from_,
                        ...(feePayer ? { feePayer } : {}),
                      }
                      if (!sync) {
                        const hash = await sendTransactionAction(txRequest, {
                          method: 'eth_sendTransaction',
                          params: [z.encode(Rpc.transactionRequest, txRequest)] as const,
                        })
                        const chainId = Hex.fromNumber(store.getState().chainId)
                        const id = Hex.concat(hash, Hex.padLeft(chainId, 32), sendCallsMagic)
                        return { capabilities: { sync }, id }
                      }
                      const receipt = await sendTransactionSyncAction(txRequest as never, {
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
                        const value = Number(balance.amount) / 10 ** metadata.decimals
                        const display = new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                        }).format(value)
                        return {
                          address: token,
                          balance: Hex.fromNumber(balance.amount),
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
                      if (!accounts.some((a) => AddressUtil.isEqual(a.address, address)))
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
                      capabilities?.authorizeAccessKey ??
                      (await defaultAuthorizeAccessKeyForConnect({
                        capabilities,
                        chainId: chainId ?? store.getState().chainId,
                      }))

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

                    const authChainId = chainId ?? store.getState().chainId ?? 0
                    const accessKey = authorizeAccessKey
                      ? await prepareAuthorizeAccessKey(authorizeAccessKey, chainId)
                      : undefined

                    // Patch the raw request so forwarding adapters carry the
                    // absolutized auth URLs and prepared access-key material
                    // downstream.
                    if (auth_request || accessKey)
                      request = {
                        ...request,
                        params: [
                          {
                            ...request.params?.[0],
                            capabilities: {
                              ...request.params?.[0]?.capabilities,
                              ...(auth_request ? { auth: auth_request } : {}),
                              ...(accessKey
                                ? {
                                    authorizeAccessKey: z.encode(
                                      Rpc.wallet_connect.authorizeAccessKey,
                                      accessKey.parameters,
                                    ),
                                  }
                                : {}),
                            },
                          },
                        ] as never,
                      }

                    const auth =
                      auth_request && !instance.forwardsAuth
                        ? await fetchAuthChallenge(auth_request, authChainId)
                        : undefined

                    const personalSign_request = auth
                      ? { message: auth.message }
                      : capabilities?.personalSign

                    const {
                      accounts,
                      auth: auth_capability,
                      identity,
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
                              authorizeAccessKey: accessKey?.parameters,
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
                            authorizeAccessKey: accessKey?.parameters,
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
                          authorizeAccessKey: accessKey?.parameters,
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
                    await savePreparedAccessKey({
                      accessKey,
                      account: accountAddress,
                      keyAuthorization,
                    })

                    // Local adapters return no identity claims — there is no
                    // wallet host to mint them. When the request asks for the
                    // email and an issuer is configured, mint the id token
                    // provider-side. Best-effort, mirroring the wallet host: a
                    // failed mint omits the claim, never the connect.
                    const identity_result =
                      identity ??
                      (await (async () => {
                        const email = capabilities?.identity?.email
                        if (!email || !options.identity || instance.forwardsAuth) return undefined
                        if (!accountAddress) return undefined
                        const audience = options.identity.audience ?? globalThis.location?.origin
                        if (!audience) return undefined
                        const nonce =
                          (typeof email === 'object' ? email.nonce : undefined) ??
                          (auth ? parseAuthNonce(auth.message) : undefined)
                        return await mintIdentity(options.identity.issuer, {
                          audience,
                          nonce,
                          subject: accountAddress,
                        }).catch(() => undefined)
                      })())

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
                    if (auth_request && verifyUrl && verifyMessage && signature && accountAddress)
                      validateAuthMessage(auth_request, {
                        chainId: authChainId,
                        message: verifyMessage,
                      })
                    const auth_result =
                      auth_request && verifyUrl && verifyMessage && signature && accountAddress
                        ? await verifyAuthMessage(auth_request, {
                            address: accountAddress,
                            message: verifyMessage,
                            signature,
                            // Forward the verified-email id token so a
                            // `Handler.auth({ identity })` can verify it and fold
                            // the email onto the session in the same round-trip.
                            // The minter reused this SIWE nonce, so the
                            // handler's nonce check passes.
                            ...(identity_result?.idToken
                              ? { idToken: identity_result.idToken }
                              : {}),
                            ...(personalSign?.keyAuthorization
                              ? { keyAuthorization: personalSign.keyAuthorization }
                              : {}),
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
                                ...(username !== undefined ? { username } : {}),
                                ...((auth_result ?? auth_capability)
                                  ? { auth: auth_result ?? auth_capability }
                                  : {}),
                                ...(identity_result ? { identity: identity_result } : {}),
                                ...(personalSign
                                  ? {
                                      personalSign: {
                                        message: personalSign.message,
                                        ...(personalSign.keyAuthorization
                                          ? { keyAuthorization: personalSign.keyAuthorization }
                                          : {}),
                                      },
                                    }
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
                    store.disconnect()
                    return
                  }

                  case 'wallet_authorizeAccessKey': {
                    const decoded = request._decoded.params[0]
                    const result = await authorizeAccessKeyAction(decoded, request)
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
                    const [decoded] = request._decoded.params
                    await revokeAccessKeyAction({ ...decoded }, request)
                    return
                  }

                  case 'wallet_updateAccessKey': {
                    assertConnected()
                    const [decoded] = request._decoded.params
                    await updateAccessKeyAction({ ...decoded }, request)
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
                    const receipt = await sendTransactionSyncAction(txRequest, {
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
      getAccount: ((options?: Omit<Account.find.Options, 'store'>) => {
        const account = getAccount(options)
        if (options?.signable) return account
        return { address: account.address, type: 'json-rpc' as const }
      }) as Provider['getAccount'],
      async getAccessKeyStatus(options: getAccessKeyStatus.Options = {}) {
        const state = store.getState()
        const address = options.address ?? state.accounts[state.activeAccount]?.address
        if (!address) return 'missing'
        const chainId = options.chainId ?? state.chainId
        const { accessKey, calls } = options
        return await store.accessKeys.getStatus({
          account: address,
          ...(accessKey ? { accessKey } : {}),
          ...(calls ? { calls } : {}),
          chainId,
          client: provider.getClient({ chainId }),
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
      getMppxParameters,
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
    const parameters = provider.getMppxParameters()
    const tempoOptions = {
      ...methodOptions,
      ...parameters,
      mode,
    }
    Mppx.create({
      methods: [mppx_tempo(tempoOptions), mppx_tempo.subscription(parameters)],
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
    /** Access-key configuration: authorization policy and key material. */
    accessKey?:
      | {
          /**
           * Access-key parameters to authorize automatically when no stored
           * key satisfies a request.
           *
           * Applies to `wallet_connect` and transaction sends. Pass an object
           * to use the same parameters for every request, or a function to
           * compute them per request — return `undefined` to skip
           * authorization for that request.
           */
          authorize?: AuthorizeAccessKey | undefined
          /**
           * Keystores backing provider-generated access keys, one per key
           * type. A keystore creates key material and turns persisted
           * records back into signing accounts — see
           * {@link Keystore.Keystore} for the contract.
           *
           * App-level keystores override adapter-supplied defaults.
           * Keystores hold key material; `storage` persists provider state.
           * Access keys created before a keystore was configured keep
           * working.
           *
           * @default Keystore.defaults — `{ p256: Keystore.webCryptoP256() }`
           *
           * @example
           * ```ts
           * import { Keystore, Provider } from 'accounts'
           *
           * const provider = Provider.create({
           *   accessKey: {
           *     keystores: { p256: Keystore.webCryptoP256({ extractable: true }) },
           *   },
           * })
           * ```
           */
          keystores?: Keystore.Keystores | undefined
        }
      | undefined
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
    /** @deprecated Use `accessKey.authorize` instead. */
    authorizeAccessKey?: AuthorizeAccessKey | undefined
    /**
     * Supported chains. First chain is the default.
     * @default [tempo, tempoModerato, tempoDevnet]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Fee payer configuration. @see {@link Client.fromChainId.Options.feePayer} */
    feePayer?: Client.fromChainId.Options['feePayer']
    /**
     * Identity (verified email) token minting for local adapters. When a
     * `wallet_connect` request asks for `identity.email` and the adapter
     * returns no identity claims (local adapters have no wallet host to mint
     * them), the provider mints the id token from this issuer's `/token`
     * route (`Handler.oidcProvider` shape). The issuer must trust
     * body-supplied subjects, so this is for development deployments.
     */
    identity?:
      | {
          /** Audience (`aud`) bound into minted tokens. @default `location.origin` */
          audience?: string | undefined
          /** OIDC issuer whose `/token` route mints the id token. */
          issuer: string
        }
      | undefined
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

  /** Access-key parameters to authorize automatically, with SDK-only reuse policy. */
  type AuthorizeAccessKeyParameters = Adapter.authorizeAccessKey.Parameters & {
    /** SDK-only policy for deciding whether a stored local key can be reused. */
    reuse?: AccessKey.ReusePolicy | undefined
  }
  /** Static or per-request access-key authorization parameters. */
  type AuthorizeAccessKey =
    | AuthorizeAccessKeyParameters
    | (() => AuthorizeAccessKeyParameters | undefined)
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

export declare namespace getMppxParameters {
  /** Options for {@link Provider.getMppxParameters}. */
  type Options = {
    /** Specific access key address to use for mppx signing. */
    accessKey?: Address.Address | undefined
  }
}

export declare namespace mpp {
  /** Options for Machine Payment Protocol (mppx) integration. */
  type Options = Omit<mppx_tempo.Parameters, 'account' | 'getClient' | 'resolveAccount'> & {
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
 * - **React Native / Node / CLI**: neither — `credentials: 'include'` is not
 *   enough for the SDK to surface a bearer token to the caller.
 *
 * False negatives are possible (Node with `tough-cookie` shimmed in); the
 * caller can always force token mode via `auth: { returnToken: true }`.
 */
function hasCookieJar(): boolean {
  if (typeof document !== 'undefined' && typeof document.cookie === 'string') return true
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
    ...(typeof auth === 'object' && auth.resources !== undefined
      ? { resources: auth.resources }
      : {}),
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

function stringsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function validateAuthMessage(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
  options: {
    chainId: number
    message: string
    url?: string | undefined
  },
): void {
  const { chainId, message } = options
  const url =
    options.url ??
    (typeof auth === 'object' ? auth.challenge! : resolveAuthEndpoint(auth, 'challenge'))
  const resources = typeof auth === 'object' ? auth.resources : undefined
  const parsed = parseSiweMessage(message)
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
  if (resources !== undefined && !stringsEqual(parsed.resources ?? [], resources))
    throw new RpcResponse.InvalidParamsError({
      message: `Server Authentication challenge endpoint \`${url}\` did not echo the requested SIWE resources.`,
    })
}

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
  const resources = typeof auth === 'object' ? auth.resources : undefined
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId,
      ...(resources !== undefined ? { resources } : {}),
    }),
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

  validateAuthMessage(auth, { chainId, message: body.message, url })

  return { message: body.message }
}

/**
 * Extracts the nonce from an EIP-4361 (SIWE) challenge message so a minted
 * identity token binds to the same single-use value the server checks.
 */
function parseAuthNonce(message: string) {
  return message.match(/^Nonce: (.+)$/m)?.[1]
}

/**
 * Mints a verified-email identity token from an OIDC issuer's `/token` route
 * (`Handler.oidcProvider` shape). Local adapters fulfill the connect ceremony
 * without a wallet host, so the provider mints the token itself when
 * configured (see `create.Options.identity`).
 */
async function mintIdentity(
  issuer: string,
  body: { audience: string; nonce?: string | undefined; subject: string },
): Promise<{ email: string | null; idToken: string }> {
  const res = await fetch(`${issuer.replace(/\/+$/, '')}/token`, {
    body: JSON.stringify({
      audience: body.audience,
      ...(body.nonce ? { nonce: body.nonce } : {}),
      subject: body.subject,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Identity issuer \`${issuer}\` returned ${res.status}.`)
  const { idToken } = (await res.json()) as { idToken: string }
  // Display-only claim read; server-side trust comes from JWKS verification.
  const payload = JSON.parse(
    atob(idToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
  ) as { email?: string | undefined }
  return { email: payload.email ?? null, idToken }
}

/**
 * Posts the signed message to the auth `verify` endpoint and returns
 * the SDK-shaped `auth` capability output. `{ token }` remains reserved
 * for token mode; other JSON fields returned by the verify endpoint are
 * preserved for application-specific metadata.
 */
async function verifyAuthMessage(
  auth: NonNullable<z.output<typeof Rpc.wallet_connect.auth>>,
  body: {
    address: Address.Address
    idToken?: string | undefined
    message: string
    signature: Hex.Hex
    keyAuthorization?: Hex.Hex | undefined
  },
): Promise<AuthCapabilityResult> {
  const url = typeof auth === 'object' ? auth.verify! : resolveAuthEndpoint(auth, 'verify')
  // Auto-request the token in environments without a cookie jar (React
  // Native / Node / CLI). Browser lets the cookie do the work; explicit
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
  const json = await res.json().catch(() => ({}))
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  return json as AuthCapabilityResult
}
