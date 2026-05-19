import {
  Address as core_Address,
  Hex,
  Provider as ox_Provider,
  PublicKey,
  RpcResponse,
  Secp256k1,
  Signature,
  WebCryptoP256,
} from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { hashMessage, hashTypedData, isAddressEqual, keccak256 } from 'viem'
import type { Address, LocalAccount } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import { Actions, Transaction as TempoTransaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import * as AccessKeyTransaction from '../internal/AccessKeyTransaction.js'
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
 * the UI-bearing login flow via `loadAccounts` (and optionally a distinct `createAccount`
 * for registration). Callbacks fire only on user-initiated `wallet_connect`/registration —
 * never during silent restore on page reload.
 *
 * Silent restore on page reload pulls wallets directly from the Privy SDK
 * (`client.user.get` + `client.embeddedWallet.getEthereumProvider`), so apps don't
 * need to re-run the login UI when the user returns with a still-valid Privy session.
 *
 * Callbacks only run the Privy auth UI. They may optionally return a subset of
 * embedded wallet addresses to expose; if omitted, the adapter exposes every
 * embedded wallet on the resulting Privy user.
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
 *     // Optional: omit to route registration through `loadAccounts`.
 *     createAccount: async ({ client }) => {
 *       await myPrivyRegisterUI(client)
 *     },
 *     loadAccounts: async ({ client }) => {
 *       await myPrivyLoginUI(client)
 *     },
 *   }),
 * })
 * ```
 */
export function privy<const client extends privy.Client>(
  options: privy.Options<client>,
): Adapter.Adapter {
  const { icon, name = 'Privy', rdns = 'io.privy' } = options

  return Adapter.define({ icon, name, rdns }, ({ getClient, store }) => {
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

    /**
     * Loads the user's Privy embedded Ethereum wallets and constructs their
     * EIP-1193 providers. Mirrors `getAllUserEmbeddedEthereumWallets` +
     * `getEntropyDetailsFromUser` from `@privy-io/js-sdk-core`: per the SDK,
     * `entropyId` is the **primary** embedded wallet's address (wallet_index === 0)
     * shared across all wallets of the same user, and `entropyIdVerifier` is
     * hardcoded to `'ethereum-address-verifier'` for Ethereum wallets.
     */
    async function loadEthereumWallets(
      privyClient: privy.Client,
    ): Promise<readonly privy.EmbeddedWallet[]> {
      const { user } = await privyClient.user.get()
      const wallets = (user?.linked_accounts ?? [])
        .filter(
          (account) =>
            account.type === 'wallet' &&
            account.wallet_client_type === 'privy' &&
            account.connector_type === 'embedded' &&
            account.chain_type === 'ethereum' &&
            typeof account.address === 'string',
        )
        .slice()
        .sort((a, b) => {
          // Wallets without a `wallet_index` are sorted to the end so they
          // never accidentally become primary when a sibling has an index.
          const a_index = a.wallet_index ?? Number.POSITIVE_INFINITY
          const b_index = b.wallet_index ?? Number.POSITIVE_INFINITY
          return a_index - b_index
        })

      // Primary is the wallet with `wallet_index === 0`. Fall back to the
      // lowest-indexed wallet only when no wallet declares index 0.
      const primary = wallets.find((wallet) => wallet.wallet_index === 0) ?? wallets[0]
      if (!primary) return []
      const entropyId = primary.address as string

      return await Promise.all(
        wallets.map(async (wallet) => ({
          address: core_Address.from(wallet.address as string),
          provider: await privyClient.embeddedWallet.getEthereumProvider({
            wallet,
            entropyId,
            entropyIdVerifier: 'ethereum-address-verifier',
          }),
        })),
      )
    }

    function selectWalletAccounts(
      accounts: readonly privy.EmbeddedWallet[],
      addresses: privy.AccountSelection,
    ): readonly privy.EmbeddedWallet[] {
      if (!addresses) return accounts

      return addresses.map((address) => {
        const address_ = core_Address.from(address)
        const account = accounts.find((account) =>
          isAddressEqual(core_Address.from(account.address), address_),
        )
        if (account) return account

        throw new ox_Provider.UnauthorizedError({
          message: `Privy callback returned address "${address_}" that was not found in the user's embedded wallets.`,
        })
      })
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

        // If the persisted accounts no longer exist in Privy (different user
        // signed in, wallets removed), wipe the stale state so callers see a
        // clean disconnected state instead of ghost accounts without providers.
        if (walletAccounts.length === 0) {
          clear()
          throw new ox_Provider.DisconnectedError({
            message: 'Privy session no longer matches persisted accounts.',
          })
        }

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
          const code = getPrivyErrorCode(error)
          const message = getPrivyErrorMessage(error).toLowerCase()
          const unsupported =
            (typeof code === 'number' && (code === 4200 || code === -32601)) ||
            (typeof code === 'string' && code.toLowerCase().includes('unsupported')) ||
            message.includes('unsupported') ||
            message.includes('method not found')
          if (unsupported)
            throw new ox_Provider.UnsupportedMethodError({
              message:
                'Privy adapter requires raw secp256k1 hash signing via `secp256k1_sign` for Tempo transactions and access keys.',
            })
          if (isSessionError(error)) {
            clear()
            throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
          }
          throw error
        })
      if (typeof result !== 'string' || !Hex.validate(result))
        throw new ox_Provider.ProviderRpcError(
          -32603,
          'Privy provider returned a non-hex secp256k1_sign result.',
        )
      const signature: Hex.Hex = result

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

    /**
     * Builds, signs, and saves an access key authorization for the given Privy
     * wallet. Generates a local P256 key pair when no external key is provided.
     */
    async function authorizeAccessKeyFor(
      account: privy.EmbeddedWallet,
      options: Adapter.authorizeAccessKey.Parameters,
    ) {
      const { expiry, limits, scopes } = options
      const chainId = options.chainId ?? getClient().chain.id

      const prepared = await (async () => {
        if (options.publicKey || options.address) {
          const address =
            options.address ?? core_Address.fromPublicKey(PublicKey.from(options.publicKey!))
          return {
            keyAuthorization: KeyAuthorization.from({
              address,
              chainId: BigInt(chainId),
              expiry,
              limits,
              scopes,
              type: options.keyType ?? 'secp256k1',
            }),
          }
        }

        if (options.keyType && options.keyType !== 'p256')
          throw new RpcResponse.InvalidParamsError({
            message: `\`keyType: "${options.keyType}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
          })

        const keyPair = await WebCryptoP256.createKeyPair()
        const address = core_Address.fromPublicKey(PublicKey.from(keyPair.publicKey))
        return {
          keyAuthorization: KeyAuthorization.from({
            address,
            chainId: BigInt(chainId),
            expiry,
            limits,
            scopes,
            type: 'p256',
          }),
          keyPair,
        }
      })()

      const signature = await signPayload({
        payload: KeyAuthorization.getSignPayload(prepared.keyAuthorization),
        walletAccount: account,
      })
      const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
        signature: SignatureEnvelope.from(signature),
      })

      AccessKey.add({
        account: core_Address.from(account.address),
        authorization: keyAuthorization,
        ...(prepared.keyPair ? { keyPair: prepared.keyPair } : {}),
        store,
      })

      return KeyAuthorization.toRpc(keyAuthorization)
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
      return await signPreparedTransaction(account, prepared)
    }

    async function signPreparedTransaction(account: privy.EmbeddedWallet, prepared: unknown) {
      const presign = (() => {
        if (
          prepared &&
          typeof prepared === 'object' &&
          'feePayerSignature' in prepared &&
          prepared.feePayerSignature
        )
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

    async function prepareTransaction(parameters: Adapter.signTransaction.Parameters) {
      const viemClient = getClient({
        chainId: parameters.chainId,
        feePayer: parameters.feePayer === true ? undefined : parameters.feePayer,
      })

      const state = store.getState()
      const address = parameters.from ?? state.accounts[state.activeAccount]?.address
      const transaction = address
        ? await AccessKeyTransaction.create({
            address,
            calls: parameters.calls,
            chainId: parameters.chainId ?? state.chainId,
            client: viemClient,
            store,
          })
        : undefined
      if (transaction) {
        const { feePayer, ...rest } = parameters
        try {
          return await transaction.prepare({
            ...rest,
            ...(feePayer ? { feePayer: true } : {}),
          })
        } catch {}
      }

      async function sign() {
        return await signTransaction(parameters)
      }

      return {
        request: undefined as never,
        sign,
        async send() {
          const signed = await sign()
          return await viemClient.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendSync() {
          const signed = await sign()
          return await viemClient.request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
      }
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
          const addresses = options.createAccount
            ? await options.createAccount({ client: privyClient, parameters })
            : await options.loadAccounts({
                client: privyClient,
                parameters: {
                  ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
                  ...(parameters.digest ? { digest: parameters.digest } : {}),
                  ...(personalSign ? { personalSign } : {}),
                },
              })
          await requireSession()
          walletAccounts = selectWalletAccounts(await loadEthereumWallets(privyClient), addresses)
          // Drop any in-flight `restore()` (from a concurrent `accountForSigning`)
          // so re-entrant `restore()` calls don't `await` a stale IIFE that would
          // later overwrite `walletAccounts` with the intersection against
          // now-replaced persisted accounts.
          restore_promise = undefined

          const account = walletAccounts[0]
          if (!account)
            throw new ox_Provider.DisconnectedError({
              message: 'Privy returned no wallet.',
            })

          const digest = personalSign ? hashMessage(personalSign.message) : parameters.digest
          const keyAuthorization = authorizeAccessKey
            ? await authorizeAccessKeyFor(account, authorizeAccessKey)
            : undefined

          return {
            accounts: walletAccounts.map((wallet, index) =>
              toStoreAccount(wallet, index === 0 ? parameters.name : undefined),
            ),
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
          const addresses = await options.loadAccounts({ client: privyClient, parameters })
          await requireSession()
          walletAccounts = selectWalletAccounts(await loadEthereumWallets(privyClient), addresses)
          // Drop any in-flight `restore()` (from a concurrent `accountForSigning`)
          // so re-entrant `restore()` calls don't `await` a stale IIFE that would
          // later overwrite `walletAccounts` with the intersection against
          // now-replaced persisted accounts.
          restore_promise = undefined

          const digest = personalSign ? hashMessage(personalSign.message) : parameters?.digest
          const account = walletAccounts[0]
          const keyAuthorization =
            authorizeAccessKey && account
              ? await authorizeAccessKeyFor(account, authorizeAccessKey)
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
          const keyAuthorization = await authorizeAccessKeyFor(account, parameters)
          return { keyAuthorization, rootAddress: core_Address.from(account.address) }
        },
        async revokeAccessKey(parameters) {
          const account = await accountForSigning(parameters.address)
          const account_tempo = {
            address: core_Address.from(account.address),
            source: 'privy',
            signTransaction: async (request: unknown) =>
              await signPreparedTransaction(account, request),
            type: 'local',
          } satisfies {
            address: Address
            signTransaction: (request: unknown) => Promise<Hex.Hex>
            source: 'privy'
            type: 'local'
          }
          try {
            await Actions.accessKey.revoke(getClient(), {
              account: account_tempo as LocalAccount<'privy'>,
              accessKey: parameters.accessKeyAddress,
            })
          } catch (error) {
            if (!AccessKey.isUnavailableError(error)) throw error
          }
          AccessKey.remove({
            accessKey: parameters.accessKeyAddress,
            account: core_Address.from(account.address),
            chainId: store.getState().chainId,
            store,
          })
        },
        async signPersonalMessage(parameters) {
          const account = await accountForSigning(parameters.address)
          return await signPayload({
            payload: hashMessage({ raw: parameters.data }),
            walletAccount: account,
          })
        },
        async signTransaction(parameters) {
          return await (await prepareTransaction(parameters)).sign()
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
          return await (await prepareTransaction(parameters)).send()
        },
        async sendTransactionSync(parameters) {
          return await (await prepareTransaction(parameters)).sendSync()
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
    /**
     * Runs the Privy registration UI. May optionally return a subset of the user's
     * embedded wallet addresses to expose to the provider; if omitted, the adapter
     * exposes every embedded wallet on the resulting Privy user.
     *
     * The adapter materializes EIP-1193 providers internally via
     * `client.embeddedWallet.getEthereumProvider` — callbacks should not.
     *
     * Defaults to `loadAccounts` — apps that don't distinguish register vs login
     * can omit this.
     */
    createAccount?:
      | ((parameters: {
          /** Initialized Privy client. */
          client: client
          /** Provider create-account parameters. */
          parameters: Adapter.createAccount.Parameters
        }) => Promise<AccountSelection>)
      | undefined
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /**
     * Runs the Privy login UI in response to a user-initiated `wallet_connect`.
     * May optionally return a subset of the user's embedded wallet addresses to
     * expose to the provider; if omitted, the adapter exposes every embedded
     * wallet on the Privy user.
     *
     * Silent restore on page reload pulls wallets directly from the Privy SDK
     * (`client.user.get` + `client.embeddedWallet.getEthereumProvider`) and does
     * NOT call this function.
     */
    loadAccounts: (parameters: {
      /** Initialized Privy client. */
      client: client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<AccountSelection>
    /** Display name of the provider. @default "Privy" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "io.privy" */
    rdns?: string | undefined
  }

  /**
   * Optional subset of embedded wallet addresses returned from `createAccount` /
   * `loadAccounts`. `void`/`undefined` means "expose every embedded wallet".
   */
  type AccountSelection = readonly Address[] | void

  /**
   * Minimal structural Privy client surface used by the adapter for session checks,
   * silent restore, and disconnect. User-initiated `wallet_connect`/registration
   * is delegated to the app's `loadAccounts` / `createAccount` callbacks.
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
    /** Embedded wallet API used by the adapter to materialize EIP-1193 providers. */
    embeddedWallet: {
      /** Returns an EIP-1193 provider for a Privy embedded Ethereum wallet. */
      getEthereumProvider(parameters: {
        wallet: LinkedAccount
        entropyId: string
        entropyIdVerifier: string
      }): Promise<EthereumProvider> | EthereumProvider
    }
    /** Returns the current Privy access token, or `null` if no session. */
    getAccessToken: () => Promise<string | null>
    /** Initializes the client. Called once by the adapter, before any other method. */
    initialize?: (() => Promise<void> | void) | undefined
    /** User API used by the adapter to scope `auth.logout` and to silently restore wallets. */
    user: {
      /** Returns the currently authenticated Privy user. */
      get: () => Promise<{ user: User }>
    }
  }

  /** Minimal Privy user shape used by the adapter for silent restore. */
  type User = {
    id: string
    linked_accounts?: readonly LinkedAccount[] | undefined
  }

  /** Minimal Privy linked account shape used by the adapter for silent restore. */
  type LinkedAccount = {
    address?: string | undefined
    chain_type?: string | undefined
    connector_type?: string | undefined
    type?: string | undefined
    wallet_client_type?: string | undefined
    wallet_index?: number | undefined
  }

  /** Minimal EIP-1193 provider surface used by the adapter for `secp256k1_sign`. */
  type EthereumProvider = {
    request(parameters: {
      method: string
      params?: readonly unknown[] | undefined
    }): Promise<unknown>
  }

  /**
   * Materialized Privy embedded wallet — the `{ address, provider }` shape the
   * adapter caches internally after calling
   * `client.embeddedWallet.getEthereumProvider`. The adapter calls
   * `provider.request({ method: 'secp256k1_sign', params: [hash] })` for signing.
   */
  type EmbeddedWallet = {
    address: string
    provider: EthereumProvider
  }
}
