import {
  Address as core_Address,
  Hex,
  Provider as ox_Provider,
  PublicKey,
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
  'invalid_auth',
  'invalid_credentials',
  'invalid_token',
  'missing_token',
  'must_be_authenticated',
  'not_authenticated',
  'session_expired',
  'token_expired',
  'unauthenticated',
  'unauthorized',
])

/**
 * Creates a Privy adapter backed by `@privy-io/js-sdk-core` Privy sessions and embedded
 * Ethereum wallets.
 *
 * The adapter owns silent reconnect, session-expiry cleanup, and provider signing actions.
 * Apps provide the UI-bearing registration and login flows through `createAccount` and
 * `loadAccounts`.
 *
 * @example
 * ```ts
 * import Privy, {
 *   LocalStorage,
 *   getAllUserEmbeddedEthereumWallets,
 *   getEntropyDetailsFromUser,
 * } from '@privy-io/js-sdk-core'
 * import { Provider, privy } from 'accounts'
 *
 * const client = new Privy({ appId, storage: new LocalStorage() })
 * // App must mount the Privy secure-context iframe and call
 * // `client.setMessagePoster(iframe.contentWindow)` per
 * // https://docs.privy.io/recipes/core-js
 *
 * async function toEmbeddedWallets(client: Privy, user: any) {
 *   const wallets = getAllUserEmbeddedEthereumWallets(user)
 *   const entropy = getEntropyDetailsFromUser(user)
 *   if (!entropy) return []
 *   return Promise.all(
 *     wallets.map(async (wallet) => {
 *       const provider = await client.embeddedWallet.getEthereumProvider({
 *         wallet,
 *         entropyId: entropy.entropyId,
 *         entropyIdVerifier: entropy.entropyIdVerifier,
 *       })
 *       return {
 *         address: wallet.address,
 *         signRawHash: async (hash) =>
 *           (await provider.request({ method: 'secp256k1_sign', params: [hash] })) as `0x${string}`,
 *       }
 *     }),
 *   )
 * }
 *
 * const provider = Provider.create({
 *   adapter: privy({
 *     client,
 *     createAccount: async ({ client }) => {
 *       await client.auth.email.sendCode(email)
 *       await client.auth.email.loginWithCode(email, code, 'login-or-sign-up', {
 *         embedded: { ethereum: { createOnLogin: 'users-without-wallets' } },
 *       })
 *       const { user } = await client.user.get()
 *       const [account] = await toEmbeddedWallets(client, user)
 *       if (!account) throw new Error('No Privy embedded Ethereum wallet')
 *       return account
 *     },
 *     loadAccounts: async ({ client }) => {
 *       const { user } = await client.user.get()
 *       return toEmbeddedWallets(client, user)
 *     },
 *   }),
 * })
 * ```
 */
export function privy(options: privy.Options): Adapter.Adapter {
  const { icon, name = 'Privy', rdns = 'io.privy' } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    let privyClient_promise: Promise<privy.Client> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly privy.EmbeddedWallet[] = []

    async function getPrivyClient() {
      privyClient_promise ??= (async () => {
        const { client } = options
        await client.initialize?.()
        return client
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
      const privyClient = await getPrivyClient()
      const token = await privyClient.getAccessToken().catch(() => null)
      if (!token) {
        clear()
        return false
      }
      return true
    }

    async function restore() {
      await Store.waitForHydration(store)
      if (walletAccounts.length > 0) return
      if (restore_promise) return await restore_promise

      restore_promise = (async () => {
        const state = store.getState()
        const persisted = state.accounts
        if (persisted.length === 0) return

        if (!(await hasValidSession())) return

        const restored = await options.loadAccounts({
          client: await getPrivyClient(),
          parameters: undefined,
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
      if (!(await hasValidSession()))
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
      return await walletAccount.signRawHash(payload).catch((error) => {
        if (!isSessionError(error)) throw error
        clear()
        throw new ox_Provider.DisconnectedError({ message: 'Privy session expired.' })
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
      account: privy.EmbeddedWallet,
      prepared: Awaited<ReturnType<typeof prepareKeyAuthorization>>,
      options: {
        signature?: Hex.Hex | undefined
      } = {},
    ) {
      const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
      const signature =
        options.signature ??
        (await signPayload({
          payload: digest,
          walletAccount: account,
        }))
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
      const code = getPrivyErrorCode(error)
      return !!code && privySessionErrorCodes.has(code)
    }

    function getPrivyErrorCode(error: unknown): string | undefined {
      if (!isObject(error)) return undefined

      if (typeof error.code === 'string') return error.code
      if (typeof error.error_code === 'string') return error.error_code
      if (typeof error.errorCode === 'string') return error.errorCode

      return getPrivyErrorCode(error.cause)
    }

    function isObject(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    void restore()

    return {
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
                  { signature: authorizeAccessKey.signature },
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
          const keyAuthorization = await signKeyAuthorization(account, prepared, {
            signature: parameters.signature,
          })
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
          await (await getPrivyClient()).auth.logout()
          clear()
        },
      },
    }
  })
}

export declare namespace privy {
  /** Options for {@link privy}. */
  type Options = {
    /** Existing Privy client, such as `Privy` from `@privy-io/js-sdk-core`. */
    client: Client
    /** Creates/registers a Privy embedded wallet. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized Privy client. */
      client: Client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<EmbeddedWallet>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads/logs into existing Privy embedded wallets. UI is allowed. */
    loadAccounts: (parameters: {
      /** Initialized Privy client. */
      client: Client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<readonly EmbeddedWallet[]>
    /** Display name of the provider. @default "Privy" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "io.privy" */
    rdns?: string | undefined
  }

  /** Minimal structural Privy client surface used by the adapter. */
  type Client = {
    /** Auth API; the adapter only needs `logout`. */
    auth: {
      /** Clears the current Privy session. */
      logout: () => Promise<void> | void
    }
    /** Returns the current Privy access token, or `null` if no session. */
    getAccessToken: () => Promise<string | null>
    /** Initializes the client. Called once by the adapter. */
    initialize?: (() => Promise<void> | void) | undefined
  }

  /**
   * Minimal embedded-wallet shape used by the adapter. Apps construct this in their
   * `createAccount`/`loadAccounts` callbacks by wrapping a Privy `EmbeddedWalletProvider`.
   *
   * `signRawHash` should call `provider.request({ method: 'secp256k1_sign', params: [hash] })`.
   */
  type EmbeddedWallet = {
    /** EVM address for the embedded wallet. */
    address: string
    /** Signs a 32-byte digest with the wallet's secp256k1 key. Returns `0x{r}{s}{v}`. */
    signRawHash: (hash: Hex.Hex) => Promise<Hex.Hex>
  }
}
