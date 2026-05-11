import {
  Address as core_Address,
  Hex,
  Provider as ox_Provider,
  PublicKey,
  Signature,
  WebCryptoP256,
} from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { isAddressEqual, keccak256 } from 'viem'
import type { Address } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import type { Account as TempoAccount } from 'viem/tempo'
import { Transaction as TempoTransaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import * as Store from '../Store.js'

const privySessionErrorCodes = new Set([
  'attempted_rpc_call_before_logged_in',
  'attempted_to_read_storage_before_client_initialized',
  'embedded_wallet_before_logged_in',
  'embedded_wallet_does_not_exist',
  'embedded_wallet_request_error',
  'missing_auth_token',
  'missing_privy_token',
  'oauth_session_failed',
  'oauth_session_timeout',
  'session_expired',
  'unauthenticated',
  'unauthorized',
])

/**
 * Creates a Privy adapter backed by an app-provided Privy client and embedded EVM wallet provider.
 *
 * The adapter owns Accounts state, access-key authorization, Tempo transaction
 * preparation, raw hash signing, and broadcasting. Apps keep ownership of Privy
 * auth UI, wallet creation, wallet selection, and secure-context recovery in
 * `createAccount` and `loadAccounts`.
 *
 * @example
 * ```ts
 * import Privy, { LocalStorage } from '@privy-io/js-sdk-core'
 * import { Provider } from 'accounts'
 * import { privy } from 'accounts/privy'
 *
 * const client = new Privy({
 *   appId,
 *   clientId,
 *   storage: new LocalStorage(),
 * })
 *
 * const provider = Provider.create({
 *   adapter: privy({
 *     client,
 *     createAccount: async ({ client, parameters }) => {
 *       await openSignupUi(parameters)
 *       return await getPrivyWalletAccount(client)
 *     },
 *     loadAccounts: async ({ client }) => {
 *       await openLoginUi()
 *       return await getPrivyWalletAccounts(client)
 *     },
 *   }),
 * })
 * ```
 */
export function privy<const client extends privy.Client>(
  options: privy.Options<client>,
): Adapter.Adapter {
  const { icon, name = 'Privy', rdns = 'io.privy' } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    let client_promise: Promise<client> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly privy.WalletAccount[] = []

    async function getPrivyClient() {
      client_promise ??= (async () => {
        const { client } = options
        await client.initialize?.()
        return client
      })()
      return await client_promise
    }

    function toStoreAccount(account: privy.WalletAccount, label?: string | undefined) {
      return {
        address: core_Address.from(account.address),
        ...(label ? { label } : {}),
      }
    }

    function cache(accounts: readonly privy.WalletAccount[]) {
      walletAccounts = accounts.map((account) => {
        core_Address.from(account.address)
        return account
      })
    }

    function clear() {
      restore_promise = undefined
      walletAccounts = []
      store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
    }

    function accountByAddress(address: Address) {
      return walletAccounts.find((account) =>
        isAddressEqual(core_Address.from(account.address), address),
      )
    }

    async function getUser(client: client) {
      if (client.user?.get)
        return await client.user
          .get()
          .then((result) => result.user ?? undefined)
          .catch((error) => {
            if (!isSessionError(error)) throw error
            return undefined
          })

      if (!client.getAuthenticatedUser) return undefined
      return await client
        .getAuthenticatedUser()
        .then((user) => user ?? undefined)
        .catch((error) => {
          if (!isSessionError(error)) throw error
          return undefined
        })
    }

    async function hasSession(client: client) {
      if (client.getAccessToken)
        return await client
          .getAccessToken()
          .then((token) => !!token)
          .catch((error) => {
            if (!isSessionError(error)) throw error
            return false
          })

      if (!client.user?.get && !client.getAuthenticatedUser) return undefined
      return !!(await getUser(client))
    }

    async function requireSession(client: client) {
      const session = await hasSession(client)
      if (session !== false) return
      clear()
      throw new ox_Provider.DisconnectedError({
        message: 'Privy session disconnected.',
      })
    }

    function linkedAccounts(user: privy.User) {
      return user.linked_accounts ?? user.linkedAccounts ?? []
    }

    function embeddedWallets(user: privy.User) {
      return linkedAccounts(user)
        .map(toEmbeddedWallet)
        .filter((account): account is privy.EmbeddedWallet => !!account)
        .sort((a, b) => a.wallet_index - b.wallet_index)
    }

    function toEmbeddedWallet(account: privy.LinkedAccount): privy.EmbeddedWallet | undefined {
      const chain_type = account.chain_type ?? account.chainType
      const connector_type = account.connector_type ?? account.connectorType
      const wallet_client_type = account.wallet_client_type ?? account.walletClientType
      if (
        account.type !== 'wallet' ||
        typeof account.address !== 'string' ||
        chain_type !== 'ethereum' ||
        connector_type !== 'embedded' ||
        wallet_client_type !== 'privy'
      )
        return undefined

      const recovery_method = account.recovery_method ?? account.recoveryMethod
      const wallet_index = account.wallet_index ?? account.walletIndex ?? 0
      return {
        ...account,
        address: account.address,
        chain_type: 'ethereum',
        chainType: 'ethereum',
        connector_type: 'embedded',
        connectorType: 'embedded',
        type: 'wallet',
        wallet_client_type: 'privy',
        walletClientType: 'privy',
        wallet_index,
        walletIndex: wallet_index,
        ...(recovery_method ? { recovery_method, recoveryMethod: recovery_method } : {}),
      }
    }

    async function providerFor(client: client, wallet: privy.EmbeddedWallet) {
      if (client.embeddedWallet?.getProvider) return await client.embeddedWallet.getProvider(wallet)

      throw new ox_Provider.UnsupportedMethodError({
        message:
          'Privy adapter restore requires `restoreAccounts` or `embeddedWallet.getProvider` on the Privy client.',
      })
    }

    async function restoreAccounts() {
      const client = await getPrivyClient()
      await requireSession(client)
      const user = await getUser(client)
      if (!user)
        throw new ox_Provider.DisconnectedError({
          message: 'Privy session disconnected.',
        })

      if (options.restoreAccounts) return await options.restoreAccounts({ client, user })

      return await Promise.all(
        embeddedWallets(user).map(async (wallet) => ({
          address: wallet.address,
          provider: await providerFor(client, wallet),
        })),
      )
    }

    async function restore(address?: Address | undefined) {
      await Store.waitForHydration(store)
      const state = store.getState()
      const persisted = state.accounts
      if (persisted.length === 0) return
      if (restore_promise) {
        await restore_promise
        if (address && !accountByAddress(address)) {
          clear()
          throw new ox_Provider.DisconnectedError({
            message: 'No Privy account connected.',
          })
        }
        return
      }

      restore_promise = (async () => {
        const loaded = await restoreAccounts().catch((error) => {
          if (!isSessionError(error) && !(error instanceof ox_Provider.DisconnectedError))
            throw error
          clear()
          throw new ox_Provider.DisconnectedError({
            message: 'Privy session disconnected.',
          })
        })
        cache(loaded)

        const restored = persisted
          .map((account) => accountByAddress(account.address))
          .filter((account): account is privy.WalletAccount => !!account)

        const matched = (() => {
          if (!address) return restored.length > 0 && restored.length === persisted.length
          return restored.some((account) =>
            isAddressEqual(core_Address.from(account.address), address),
          )
        })()

        if (!matched) {
          clear()
          throw new ox_Provider.DisconnectedError({
            message: 'No Privy account connected.',
          })
        }

        walletAccounts = restored
        store.setState({
          accounts: restored.map((account) => toStoreAccount(account)),
          activeAccount: Math.min(state.activeAccount, restored.length - 1),
        })
      })()

      try {
        await restore_promise
      } finally {
        restore_promise = undefined
      }
    }

    async function accountForSigning(address: Address | undefined) {
      await Store.waitForHydration(store)
      const state = store.getState()
      const address_ = address ?? state.accounts[state.activeAccount]?.address
      if (!address_) throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const account = accountByAddress(address_)
      if (account) return account

      const persisted = state.accounts.some((account) => isAddressEqual(account.address, address_))
      await restore(persisted ? address_ : undefined)

      const restored = accountByAddress(address_)
      if (restored) return restored

      if (walletAccounts.length === 0)
        throw new ox_Provider.DisconnectedError({
          message: 'No Privy account connected.',
        })

      throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
    }

    async function requestHex(
      account: privy.WalletAccount,
      request: { method: string; params?: unknown[] | undefined },
      options: { rawSigning?: boolean | undefined } = {},
    ): Promise<Hex.Hex> {
      const result = await account.provider.request(request).catch((error) => {
        if (options.rawSigning && isUnsupportedError(error)) throw unsupportedRawSigningError()
        if (!isSessionError(error)) throw error
        clear()
        throw new ox_Provider.DisconnectedError({ message: 'Privy session disconnected.' })
      })

      if (typeof result !== 'string') {
        if (options.rawSigning) throw unsupportedRawSigningError()
        throw new ox_Provider.ProviderRpcError(
          -32603,
          'Privy provider returned a non-hex signature.',
        )
      }

      try {
        Hex.assert(result)
        return result
      } catch {
        if (options.rawSigning) throw unsupportedRawSigningError()
        throw new ox_Provider.ProviderRpcError(
          -32603,
          'Privy provider returned a non-hex signature.',
        )
      }
    }

    async function signPayload(parameters: {
      payload: Hex.Hex
      walletAccount: privy.WalletAccount
    }) {
      const { payload, walletAccount } = parameters
      return await requestHex(
        walletAccount,
        {
          method: 'secp256k1_sign',
          params: [payload],
        },
        { rawSigning: true },
      )
    }

    async function signPersonalMessage(parameters: {
      message: string
      walletAccount: privy.WalletAccount
    }) {
      const { message, walletAccount } = parameters
      return await requestHex(walletAccount, {
        method: 'personal_sign',
        params: [message, core_Address.from(walletAccount.address)],
      })
    }

    async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
      const { expiry, limits, scopes } = options
      const chainId = options.chainId ?? getClient().chain.id

      if (options.publicKey || options.address) {
        const address =
          options.address ?? core_Address.fromPublicKey(PublicKey.from(options.publicKey!))
        const keyAuthorization = KeyAuthorization.from({
          address,
          chainId: BigInt(chainId),
          expiry,
          limits,
          scopes,
          type: options.keyType ?? 'secp256k1',
        })
        return { keyAuthorization }
      }

      const keyPair = await WebCryptoP256.createKeyPair()
      const address = core_Address.fromPublicKey(PublicKey.from(keyPair.publicKey))
      const keyAuthorization = KeyAuthorization.from({
        address,
        chainId: BigInt(chainId),
        expiry,
        limits,
        scopes,
        type: 'p256',
      })
      return { keyAuthorization, keyPair }
    }

    async function signKeyAuthorization(
      account: privy.WalletAccount,
      prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
      options: {
        signature?: Hex.Hex | undefined
      } = {},
    ) {
      const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
      const signature =
        options.signature ?? (await signPayload({ payload: digest, walletAccount: account }))
      const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
        signature: SignatureEnvelope.from(signature),
      })

      AccessKey.save({
        address: core_Address.from(account.address),
        keyAuthorization,
        ...(prepared.keyPair ? { keyPair: prepared.keyPair } : {}),
        store,
      })

      return KeyAuthorization.toRpc(keyAuthorization)
    }

    async function withAccessKey<result>(
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ) {
      const account = (() => {
        try {
          return getAccount({ signable: true })
        } catch {
          return undefined
        }
      })()
      if (!account || account.source !== 'accessKey') return undefined

      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch {
        AccessKey.remove(account, { store })
        return undefined
      }
    }

    async function signTransaction(parameters: Adapter.signTransaction.Parameters) {
      const account = await accountForSigning(parameters.from)
      const { feePayer, ...rest } = parameters
      const viemClient = getClient({
        feePayer: feePayer === true ? undefined : feePayer,
      })
      const prepared = await prepareTransactionRequest(viemClient, {
        account: core_Address.from(account.address),
        ...rest,
        ...(feePayer ? { feePayer: true } : {}),
        type: 'tempo',
      } as never)
      const presign = (() => {
        if ('feePayerSignature' in prepared && prepared.feePayerSignature)
          return { ...prepared, feePayerSignature: null }
        return prepared
      })()
      const unsignedTransaction = await TempoTransaction.serialize(presign as never)

      const signature = await signPayload({
        payload: keccak256(unsignedTransaction),
        walletAccount: account,
      })
      return await TempoTransaction.serialize(
        prepared as never,
        SignatureEnvelope.from(Signature.fromHex(signature)) as never,
      )
    }

    function isSessionError(error: unknown) {
      const code = getErrorCode(error)
      if (typeof code === 'string') {
        const normalized = code.toLowerCase()
        if (privySessionErrorCodes.has(normalized)) return true
        if (normalized.includes('before_logged_in')) return true
        if (normalized.includes('session')) return true
      }

      const message = getErrorMessage(error).toLowerCase()
      return (
        message.includes('missing privy token') ||
        message.includes('must be logged in') ||
        message.includes('not authenticated') ||
        message.includes('not logged in') ||
        message.includes('session expired')
      )
    }

    function isUnsupportedError(error: unknown) {
      const code = getErrorCode(error)
      if (code === 4200 || code === -32601) return true
      if (typeof code === 'string' && code.toLowerCase().includes('unsupported')) return true

      const message = getErrorMessage(error).toLowerCase()
      return message.includes('unsupported') || message.includes('method not found')
    }

    function unsupportedRawSigningError() {
      return new ox_Provider.UnsupportedMethodError({
        message:
          'Privy adapter requires raw secp256k1 hash signing via `secp256k1_sign` for Tempo transactions and access keys.',
      })
    }

    function getErrorCode(error: unknown): string | number | undefined {
      if (!isObject(error)) return undefined
      const { cause, code } = error
      if (typeof code === 'string' || typeof code === 'number') return code
      return getErrorCode(cause)
    }

    function getErrorMessage(error: unknown): string {
      if (error instanceof Error) return error.message
      if (!isObject(error)) return ''
      const { cause, error: error_, message } = error
      const own = (() => {
        if (typeof message === 'string') return message
        if (typeof error_ === 'string') return error_
        return ''
      })()
      const caused = getErrorMessage(cause)
      return caused ? `${own} ${caused}` : own
    }

    function isObject(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    void restore().catch(() => undefined)

    return {
      actions: {
        async createAccount(parameters) {
          const { authorizeAccessKey, personalSign } = parameters
          if (personalSign && parameters.digest)
            throw new ox_Provider.ProviderRpcError(
              -32602,
              '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
            )

          const client = await getPrivyClient()
          const account = await options.createAccount({ client, parameters })
          await requireSession(client)
          cache([account])
          restore_promise = undefined

          const keyAuthorization = authorizeAccessKey
            ? await signKeyAuthorization(
                account,
                await prepareKeyAuthorization(authorizeAccessKey),
                { signature: authorizeAccessKey.signature },
              )
            : undefined

          return {
            accounts: [toStoreAccount(account, parameters.name)],
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature: await (async () => {
              if (personalSign)
                return signPersonalMessage({
                  message: personalSign.message,
                  walletAccount: account,
                })
              if (parameters.digest)
                return signPayload({ payload: parameters.digest, walletAccount: account })
              return undefined
            })(),
          }
        },
        async loadAccounts(parameters) {
          const { authorizeAccessKey, personalSign } =
            parameters ?? ({} as Adapter.loadAccounts.Parameters)
          if (personalSign && parameters?.digest)
            throw new ox_Provider.ProviderRpcError(
              -32602,
              '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
            )

          const client = await getPrivyClient()
          const accounts = await options.loadAccounts({ client, parameters })
          await requireSession(client)
          cache(accounts)
          restore_promise = undefined

          const account = walletAccounts[0]
          const keyAuthorization =
            authorizeAccessKey && account
              ? await signKeyAuthorization(
                  account,
                  await prepareKeyAuthorization(authorizeAccessKey),
                  { signature: authorizeAccessKey.signature },
                )
              : undefined

          return {
            accounts: walletAccounts.map((account) => toStoreAccount(account)),
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature: await (async () => {
              if (!account) return undefined
              if (personalSign)
                return signPersonalMessage({
                  message: personalSign.message,
                  walletAccount: account,
                })
              if (parameters?.digest)
                return signPayload({ payload: parameters.digest, walletAccount: account })
              return undefined
            })(),
          }
        },
        async authorizeAccessKey(parameters) {
          const account = await accountForSigning(undefined)
          const prepared = await prepareKeyAuthorization(parameters)
          const keyAuthorization = await signKeyAuthorization(account, prepared, {
            signature: parameters.signature,
          })
          return { keyAuthorization, rootAddress: core_Address.from(account.address) }
        },
        async signPersonalMessage(parameters) {
          const account = await accountForSigning(parameters.address)
          return await signPersonalMessage({
            message: parameters.data,
            walletAccount: account,
          })
        },
        async signTransaction(parameters) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const viemClient = getClient({
              feePayer: feePayer === true ? undefined : feePayer,
            })
            const prepared = await prepareTransactionRequest(viemClient, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            } as never)
            return await account.signTransaction(prepared as never)
          })
          if (result !== undefined) return result
          return await signTransaction(parameters)
        },
        async signTypedData(parameters) {
          const account = await accountForSigning(parameters.address)
          return await requestHex(account, {
            method: 'eth_signTypedData_v4',
            params: [core_Address.from(account.address), parameters.data],
          })
        },
        async sendTransaction(parameters) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const viemClient = getClient({
              chainId: parameters.chainId,
              feePayer: feePayer === true ? undefined : feePayer,
            })
            const prepared = await prepareTransactionRequest(viemClient, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            } as never)
            const signed = await account.signTransaction(prepared as never)
            return await viemClient.request({
              method: 'eth_sendRawTransaction' as never,
              params: [signed],
            })
          })
          if (result !== undefined) return result
          const signed = await signTransaction(parameters)
          const viemClient = getClient({
            chainId: parameters.chainId,
            feePayer: parameters.feePayer === true ? undefined : parameters.feePayer,
          })
          return await viemClient.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const viemClient = getClient({
              chainId: parameters.chainId,
              feePayer: feePayer === true ? undefined : feePayer,
            })
            const prepared = await prepareTransactionRequest(viemClient, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            } as never)
            const signed = await account.signTransaction(prepared as never)
            return await viemClient.request({
              method: 'eth_sendRawTransactionSync' as never,
              params: [signed],
            })
          })
          if (result !== undefined) return result
          const signed = await signTransaction(parameters)
          const viemClient = getClient({
            chainId: parameters.chainId,
            feePayer: parameters.feePayer === true ? undefined : parameters.feePayer,
          })
          return await viemClient.request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
        async disconnect() {
          const client = await getPrivyClient()
          const user = await getUser(client)
          if (client.auth?.logout) {
            if (user && client.auth.logout.length > 0) await client.auth.logout({ userId: user.id })
            else await client.auth.logout()
          }
          else if (client.logout) await client.logout()
          clear()
        },
      },
    }
  })
}

export declare namespace privy {
  /** Options for {@link privy}. */
  type Options<client extends Client = Client> = {
    /** Existing Privy Core client. Instantiate once per app, or pass the provider-owned client from Privy React when available. */
    client: client
    /** Creates/registers a Privy-backed wallet account. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<WalletAccount>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads/logs into existing Privy-backed wallet accounts. UI is allowed. */
    loadAccounts: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<readonly WalletAccount[]>
    /**
     * Loads accounts from the current Privy session without showing UI.
     *
     * Use this with Privy Core clients that require app-owned entropy or secure-context
     * handling before an embedded wallet provider can be rebuilt.
     */
    restoreAccounts?: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Current authenticated Privy user. */
      user: User
    }) => Promise<readonly WalletAccount[]>
    /** Display name of the provider. @default "Privy" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "io.privy" */
    rdns?: string | undefined
  }

  /** Minimal structural Privy client surface used by the adapter. */
  type Client = {
    /** Auth namespace used for disconnect when available. */
    auth?:
      | {
          /** Clears the current Privy session for the given user. */
          logout: (parameters?: { userId?: string | undefined } | undefined) => Promise<void> | void
        }
      | undefined
    /** Embedded wallet namespace used for silent restore when available. */
    embeddedWallet?:
      | {
          /** Returns an EIP-1193 provider for a Privy embedded Ethereum wallet. */
          getProvider?:
            | ((
                wallet: EmbeddedWallet,
                recoveryPassword?: string | undefined,
                recoveryAccessToken?: string | undefined,
                recoverySecretOverride?: string | undefined,
                recoveryKey?: string | undefined,
              ) => Promise<EthereumProvider>)
            | undefined
        }
      | undefined
    /** Returns the current Privy user on React client shapes when available. */
    getAuthenticatedUser?: (() => Promise<User | null | undefined>) | undefined
    /** Returns the current access token when available, or null if no session exists. */
    getAccessToken?: (() => Promise<string | null | undefined>) | undefined
    /** Initializes the client. Called once by the adapter when available. */
    initialize?: (() => Promise<void> | void) | undefined
    /** Clears the current Privy session on React client shapes when available. */
    logout?: (() => Promise<void> | void) | undefined
    /** User namespace used for disconnect when available. */
    user?:
      | {
          /** Returns the current Privy user, if any. */
          get: () => Promise<{ user?: User | null | undefined }>
        }
      | undefined
  }

  /** Minimal Privy user shape used by the adapter. */
  type User = {
    /** Privy user id. */
    id: string
    /** Privy Core linked accounts. */
    linked_accounts?: readonly LinkedAccount[] | undefined
    /** Privy React linked accounts. */
    linkedAccounts?: readonly LinkedAccount[] | undefined
  }

  /** Minimal Privy linked account shape used during silent restore. */
  type LinkedAccount = {
    /** Wallet address when the linked account is a wallet. */
    address?: string | undefined
    /** Privy Core chain type. */
    chain_type?: string | undefined
    /** Privy React chain type. */
    chainType?: string | undefined
    /** Privy Core connector type. */
    connector_type?: string | undefined
    /** Privy React connector type. */
    connectorType?: string | undefined
    /** Privy Core recovery method. */
    recovery_method?: string | undefined
    /** Privy React recovery method. */
    recoveryMethod?: string | undefined
    /** Linked account type. */
    type?: string | undefined
    /** Privy Core wallet client type. */
    wallet_client_type?: string | undefined
    /** Privy React wallet client type. */
    walletClientType?: string | undefined
    /** Privy Core HD wallet index. */
    wallet_index?: number | null | undefined
    /** Privy React HD wallet index. */
    walletIndex?: number | null | undefined
  }

  /** Minimal Privy embedded Ethereum wallet shape used during silent restore. */
  type EmbeddedWallet = LinkedAccount & {
    /** EVM address for the embedded wallet. */
    address: string
    /** Privy Core chain type. */
    chain_type: 'ethereum'
    /** Privy React chain type. */
    chainType: 'ethereum'
    /** Privy Core connector type. */
    connector_type: 'embedded'
    /** Privy React connector type. */
    connectorType: 'embedded'
    /** Linked account type. */
    type: 'wallet'
    /** Privy Core wallet client type. */
    wallet_client_type: 'privy'
    /** Privy React wallet client type. */
    walletClientType: 'privy'
    /** Privy Core HD wallet index. */
    wallet_index: number
    /** Privy React HD wallet index. */
    walletIndex: number
  }

  /** Minimal Privy-backed account returned by app-owned callbacks. */
  type WalletAccount = {
    /** EVM address for the Privy wallet. */
    address: string
    /** EIP-1193 provider returned by Privy for the selected wallet. */
    provider: EthereumProvider
  }

  /** Minimal EIP-1193 provider surface used by the adapter. */
  type EthereumProvider = {
    /** Sends a JSON-RPC request to the Privy wallet provider. */
    request: (parameters: { method: string; params?: unknown[] | undefined }) => Promise<unknown>
  }
}
