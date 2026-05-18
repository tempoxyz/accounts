import {
  Address as core_Address,
  Hex,
  Provider as ox_Provider,
  PublicKey,
  Secp256k1,
  Signature,
  WebCryptoP256,
} from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { hashMessage, hashTypedData, isAddressEqual, keccak256 } from 'viem'
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
 * Creates a Privy adapter backed by `@privy-io/js-sdk-core` Privy sessions and embedded
 * Ethereum wallets.
 *
 * The adapter owns silent reconnect, session-expiry cleanup, and signing. Apps supply
 * the UI-bearing registration/login flows via `createAccount` and `loadAccounts`, which
 * fire only on user-initiated `wallet_connect`/registration — never during silent
 * restore on page reload.
 *
 * Silent restore on page reload pulls wallets directly from the Privy SDK
 * (`client.user.get` + `client.embeddedWallet.getEthereumProvider`), so apps don't
 * need to re-run the login UI when the user returns with a still-valid Privy session.
 *
 * @example
 * ```ts
 * import Privy from '@privy-io/js-sdk-core'
 *
 * const client = new Privy({ appId: import.meta.env.VITE_PRIVY_APP_ID })
 *
 * const provider = Provider.create({
 *   adapter: privy({
 *     client,
 *     createAccount: async ({ client }) => {
 *       // ...drive Privy email/OTP UI, then return the new embedded wallet.
 *     },
 *     loadAccounts: async ({ client }) => {
 *       // ...drive Privy login UI, then return the user's embedded wallets.
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
    let privyClient_promise: Promise<client> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly privy.EmbeddedWallet[] = []

    async function getPrivyClient(): Promise<client> {
      privyClient_promise ??= (async () => {
        await options.client.initialize?.()
        return options.client
      })()
      return await privyClient_promise
    }

    function toStoreAccount(account: privy.EmbeddedWallet, label?: string | undefined) {
      return {
        address: core_Address.from(account.address),
        ...(label ? { label } : {}),
      }
    }

    function clear() {
      restore_promise = undefined
      walletAccounts = []
      store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
    }

    async function hasValidSession() {
      const token = await (await getPrivyClient()).getAccessToken().catch((error) => {
        if (isSessionError(error)) return null
        throw error
      })
      return !!token
    }

    async function loadEthereumWallets(
      privyClient: privy.Client,
    ): Promise<readonly privy.EmbeddedWallet[]> {
      const { user } = await privyClient.user.get()
      const wallets = (user.linked_accounts ?? [])
        .filter(
          (account) =>
            account.type === 'wallet' &&
            account.wallet_client_type === 'privy' &&
            account.connector_type === 'embedded' &&
            account.chain_type === 'ethereum' &&
            typeof account.address === 'string',
        )
        .slice()
        .sort((a, b) => (a.wallet_index ?? 0) - (b.wallet_index ?? 0))

      return await Promise.all(
        wallets.map(async (wallet) => {
          const address = core_Address.from(wallet.address as string)
          const provider = await privyClient.embeddedWallet.getEthereumProvider({
            wallet,
            entropyId: address,
            entropyIdVerifier: 'ethereum-address-verifier',
          })
          return { address, provider }
        }),
      )
    }

    async function restore() {
      await Store.waitForHydration(store)
      if (walletAccounts.length > 0) return
      if (restore_promise) return await restore_promise

      restore_promise = (async () => {
        const state = store.getState()
        const persisted = state.accounts
        if (persisted.length === 0) return

        if (!(await hasValidSession())) {
          clear()
          throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
        }

        const restored = await loadEthereumWallets(await getPrivyClient()).catch((error) => {
          if (!isSessionError(error)) throw error
          clear()
          throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
        })
        walletAccounts = persisted
          .map((account) =>
            restored.find((walletAccount) =>
              isAddressEqual(core_Address.from(walletAccount.address), account.address),
            ),
          )
          .filter((account): account is privy.EmbeddedWallet => !!account)

        if (walletAccounts.length === 0) return

        store.setState({
          accounts: walletAccounts.map((account) => toStoreAccount(account)),
          activeAccount: Math.min(state.activeAccount, walletAccounts.length - 1),
        })
      })()

      try {
        await restore_promise
      } finally {
        restore_promise = undefined
      }
    }

    async function requireSession() {
      if (await hasValidSession()) return
      clear()
      throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
    }

    async function accountForSigning(address: Address | undefined) {
      await restore()
      await requireSession()

      const address_ = address ?? store.getState().accounts[store.getState().activeAccount]?.address
      if (!address_) throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const account = walletAccounts.find((account) =>
        isAddressEqual(core_Address.from(account.address), address_),
      )
      if (account) return account

      if (walletAccounts.length === 0)
        throw new ox_Provider.DisconnectedError({
          message: 'No Privy account connected.',
        })

      throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
    }

    async function signPayload(parameters: {
      payload: Hex.Hex
      walletAccount: privy.EmbeddedWallet
    }) {
      const { payload, walletAccount } = parameters
      const result = await walletAccount.provider
        .request({ method: 'secp256k1_sign', params: [payload] })
        .catch((error) => {
          if (isUnsupportedError(error)) throw unsupportedRawSigningError()
          if (isSessionError(error)) {
            clear()
            throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
          }
          throw error
        })
      const signature = assertHexResult(result)

      // Verify Privy returned a signature for the wallet we asked.
      const expected = core_Address.from(walletAccount.address)
      const recovered = (() => {
        try {
          return Secp256k1.recoverAddress({ payload, signature: Signature.fromHex(signature) })
        } catch {
          return undefined
        }
      })()
      if (!recovered || !isAddressEqual(recovered, expected))
        throw new ox_Provider.UnauthorizedError({
          message: `Privy provider returned a signature for "${recovered ?? 'unknown'}" that does not match the requested wallet "${expected}".`,
        })
      return signature
    }

    function assertHexResult(result: unknown): Hex.Hex {
      if (typeof result !== 'string' || !Hex.validate(result))
        throw new ox_Provider.ProviderRpcError(
          -32603,
          'Privy provider returned a non-hex secp256k1_sign result.',
        )
      // secp256k1 signature is 65 bytes (r,s,v) → 130 hex chars + '0x'.
      if (result.length !== 132)
        throw new ox_Provider.ProviderRpcError(
          -32603,
          `Privy provider returned a malformed secp256k1_sign result (expected 65 bytes, got ${(result.length - 2) / 2}).`,
        )
      return result
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
      account: privy.EmbeddedWallet,
      prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
    ) {
      const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
      const signature = await signPayload({
        payload: digest,
        walletAccount: account,
      })
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
      options: {
        address?: Address | undefined
        calls?: Adapter.signTransaction.Parameters['calls']
        chainId?: number | undefined
      },
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ): Promise<{ account: TempoAccount.Account; result: result } | undefined> {
      const account = (() => {
        try {
          return getAccount({ ...options, signable: true })
        } catch {
          return undefined
        }
      })()
      if (!account || account.source !== 'accessKey') return undefined

      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        return { account, result }
      } catch (error) {
        AccessKey.invalidate(account, error, { store })
        return undefined
      }
    }

    async function signTransaction(parameters: Adapter.signTransaction.Parameters) {
      const account = await accountForSigning(parameters.from)
      const { feePayer, ...rest } = parameters
      const viemClient = getClient({
        chainId: parameters.chainId,
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

    function isUnsupportedError(error: unknown) {
      const code = getPrivyErrorCode(error)
      if (typeof code === 'number' && (code === 4200 || code === -32601)) return true
      if (typeof code === 'string' && code.toLowerCase().includes('unsupported')) return true
      const message = getPrivyErrorMessage(error).toLowerCase()
      return message.includes('unsupported') || message.includes('method not found')
    }

    function unsupportedRawSigningError() {
      return new ox_Provider.UnsupportedMethodError({
        message:
          'Privy adapter requires raw secp256k1 hash signing via `secp256k1_sign` for Tempo transactions and access keys.',
      })
    }

    function isSessionError(error: unknown) {
      const code = getPrivyErrorCode(error)
      if (typeof code === 'string') {
        const normalized = code.toLowerCase()
        if (privySessionErrorCodes.has(normalized)) return true
        if (normalized.includes('session')) return true
        if (normalized.includes('before_logged_in')) return true
      }

      const message = getPrivyErrorMessage(error).toLowerCase()
      return (
        message.includes('missing privy token') ||
        message.includes('must be logged in') ||
        message.includes('not authenticated') ||
        message.includes('not logged in') ||
        message.includes('session expired')
      )
    }

    function getPrivyErrorCode(error: unknown): string | number | undefined {
      if (!isObject(error)) return undefined

      if (typeof error.code === 'string' || typeof error.code === 'number') return error.code
      if (typeof error.error_code === 'string' || typeof error.error_code === 'number')
        return error.error_code
      if (typeof error.errorCode === 'string' || typeof error.errorCode === 'number')
        return error.errorCode

      return getPrivyErrorCode(error.cause)
    }

    function getPrivyErrorMessage(error: unknown): string {
      if (error instanceof Error) {
        const caused = getPrivyErrorMessage(error.cause)
        return caused ? `${error.message} ${caused}` : error.message
      }
      if (!isObject(error)) return ''
      const own =
        (typeof error.message === 'string' && error.message) ||
        (typeof error.error === 'string' && error.error) ||
        ''
      const caused = getPrivyErrorMessage(error.cause)
      if (own && caused) return `${own} ${caused}`
      return own || caused
    }

    function isObject(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    void restore().catch(() => undefined)

    return {
      cleanup() {},
      actions: {
        async createAccount(parameters) {
          const { authorizeAccessKey, personalSign } = parameters
          if (personalSign && parameters.digest)
            throw new ox_Provider.ProviderRpcError(
              -32602,
              '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
            )

          const privyClient = await getPrivyClient()
          const account = await options.createAccount({ client: privyClient, parameters })
          await requireSession()
          walletAccounts = [account]
          restore_promise = undefined

          const digest = personalSign ? hashMessage(personalSign.message) : parameters.digest
          const keyAuthorization = authorizeAccessKey
            ? await signKeyAuthorization(account, await prepareKeyAuthorization(authorizeAccessKey))
            : undefined

          return {
            accounts: [toStoreAccount(account, parameters.name)],
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature: digest
              ? await signPayload({
                  payload: digest,
                  walletAccount: account,
                })
              : undefined,
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

          const privyClient = await getPrivyClient()
          walletAccounts = await options.loadAccounts({ client: privyClient, parameters })
          await requireSession()
          restore_promise = undefined

          const digest = personalSign ? hashMessage(personalSign.message) : parameters?.digest
          const account = walletAccounts[0]
          const keyAuthorization =
            authorizeAccessKey && account
              ? await signKeyAuthorization(
                  account,
                  await prepareKeyAuthorization(authorizeAccessKey),
                )
              : undefined

          return {
            accounts: walletAccounts.map((account) => toStoreAccount(account)),
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature:
              digest && account
                ? await signPayload({
                    payload: digest,
                    walletAccount: account,
                  })
                : undefined,
          }
        },
        async authorizeAccessKey(parameters) {
          const account = await accountForSigning(undefined)
          const prepared = await prepareKeyAuthorization(parameters)
          const keyAuthorization = await signKeyAuthorization(account, prepared)
          return { keyAuthorization, rootAddress: core_Address.from(account.address) }
        },
        async signPersonalMessage(parameters) {
          const account = await accountForSigning(parameters.address)
          return await signPayload({
            payload: hashMessage({ raw: parameters.data }),
            walletAccount: account,
          })
        },
        async signTransaction(parameters) {
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => {
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
              return await account.signTransaction(prepared as never)
            },
          )
          if (result !== undefined) return result.result
          return await signTransaction(parameters)
        },
        async signTypedData(parameters) {
          const account = await accountForSigning(parameters.address)
          const typedData = JSON.parse(parameters.data) as {
            domain: Record<string, unknown>
            message: Record<string, unknown>
            primaryType: string
            types: Record<string, unknown>
          }
          return await signPayload({
            payload: hashTypedData(typedData as never),
            walletAccount: account,
          })
        },
        async sendTransaction(parameters) {
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => {
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
            },
          )
          if (result !== undefined) {
            AccessKey.removePending(result.account, { store })
            return result.result
          }
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
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls, chainId: parameters.chainId },
            async (account, keyAuthorization) => {
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
            },
          )
          if (result !== undefined) {
            AccessKey.removePending(result.account, { store })
            return result.result
          }
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
          try {
            const privyClient = await getPrivyClient()
            const userId = await privyClient.user
              .get()
              .then(({ user }) => user.id)
              .catch(() => undefined)
            await privyClient.auth.logout(userId ? { userId } : undefined)
          } finally {
            clear()
          }
        },
      },
    }
  })
}

export declare namespace privy {
  /** Options for {@link privy}. */
  type Options<client extends Client = Client> = {
    /** Existing Privy client, such as `Privy` from `@privy-io/js-sdk-core`. */
    client: client
    /** Creates/registers a Privy embedded wallet. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<EmbeddedWallet>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /**
     * Loads/logs into existing Privy embedded wallets in response to a
     * user-initiated `wallet_connect`. UI is allowed and expected.
     *
     * Silent restore on page reload happens internally via the Privy SDK
     * (`client.user.get` + `client.embeddedWallet.getEthereumProvider`) and does
     * NOT call this function.
     */
    loadAccounts: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<readonly EmbeddedWallet[]>
    /** Display name of the provider. @default "Privy" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "io.privy" */
    rdns?: string | undefined
  }

  /**
   * Minimal structural Privy client surface used by the adapter for both signing
   * (`createAccount`/`loadAccounts` callbacks) and silent restore (no callback).
   *
   * Satisfied by `Privy` from `@privy-io/js-sdk-core` — apps pass the SDK instance
   * directly. The adapter never imports `@privy-io/js-sdk-core` itself; the structural
   * shape keeps the dependency one-way.
   */
  type Client = {
    /** Auth API; the adapter only needs `logout`. */
    auth: {
      /**
       * Clears the current Privy session. The adapter passes the current user id
       * (when available) so multi-tab/multi-user setups scope the logout correctly.
       */
      logout: (parameters?: { userId: string } | undefined) => Promise<void> | void
    }
    /** Embedded wallet API used by the adapter for silent restore. */
    embeddedWallet: {
      /** Returns an EIP-1193 provider for a Privy embedded Ethereum wallet. */
      getEthereumProvider(parameters: {
        wallet: LinkedAccount
        entropyId: string
        entropyIdVerifier: string
      }): Promise<EthereumProvider>
    }
    /** Returns the current Privy access token, or `null` if no session. */
    getAccessToken: () => Promise<string | null>
    /** Initializes the client. Called once by the adapter, before any other method. */
    initialize?: (() => Promise<void> | void) | undefined
    /** User API used by the adapter for silent restore. */
    user: {
      /** Returns the currently authenticated Privy user. */
      get: () => Promise<{ user: User }>
    }
  }

  /** Minimal Privy user shape used by the adapter for silent restore and disconnect. */
  type User = {
    /** Privy user id. */
    id: string
    /** Linked accounts attached to the Privy user. */
    linked_accounts?: readonly LinkedAccount[] | undefined
  }

  /** Minimal Privy linked-account shape used by the adapter for silent restore. */
  type LinkedAccount = {
    /** EVM address when the linked account is a wallet. */
    address?: string | undefined
    /** Privy chain type (`'ethereum'` for the EVM wallets used by this adapter). */
    chain_type?: string | undefined
    /** Privy connector type (`'embedded'` for embedded wallets). */
    connector_type?: string | undefined
    /** Linked-account type (`'wallet'` for wallets). */
    type?: string | undefined
    /** Privy wallet client type (`'privy'` for embedded wallets). */
    wallet_client_type?: string | undefined
    /** HD wallet index used to order embedded wallets. */
    wallet_index?: number | null | undefined
  }

  /** Minimal EIP-1193 provider surface used by the adapter for `secp256k1_sign`. */
  type EthereumProvider = {
    request(parameters: {
      method: string
      params?: readonly unknown[] | undefined
    }): Promise<unknown>
  }

  /**
   * Embedded-wallet shape returned from `createAccount`/`loadAccounts`. The adapter
   * calls `provider.request({ method: 'secp256k1_sign', params: [hash] })` for signing.
   */
  type EmbeddedWallet = {
    address: string
    provider: EthereumProvider
  }
}
