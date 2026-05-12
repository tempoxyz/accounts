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

/**
 * Creates a BitGo adapter backed by a BitGo wallet for custodial signing.
 *
 * BitGo wallets use TSS (threshold signature scheme) / MPC for signing.
 * The adapter accepts a structurally typed client that wraps the BitGo REST
 * API or JavaScript SDK. Because BitGo's signing protocol is multi-round
 * (user key share + BitGo HSM co-sign), raw digest signing must go through
 * the BitGo `sendcoins` / `prebuildAndSignTransaction` flow.
 *
 * Use {@link createBitGoClient} to construct a client from a BitGo access
 * token and wallet configuration, or provide your own structural client.
 *
 * @example
 * ```ts
 * import { Provider, bitgo } from 'accounts'
 * import { createBitGoClient } from 'accounts/bitgo'
 *
 * const client = createBitGoClient({
 *   accessToken: 'v2x...',
 *   walletId: '63bd84ea...',
 *   walletPassphrase: 'my-passphrase',
 *   coin: 'hteth',
 *   env: 'test',
 * })
 *
 * const provider = Provider.create({
 *   adapter: bitgo({
 *     client,
 *     createAccount: async ({ client }) => {
 *       const addresses = await client.getAddresses()
 *       const first = addresses[0]
 *       if (!first) throw new Error('No BitGo wallet address found.')
 *       return first
 *     },
 *     loadAccounts: async ({ client }) => client.getAddresses(),
 *   }),
 * })
 * ```
 */
export function bitgo(options: bitgo.Options): Adapter.Adapter {
  const { icon, name = 'BitGo', rdns = 'com.bitgo' } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    let bitgoClient_promise: Promise<bitgo.Client> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly bitgo.WalletAccount[] = []

    async function getBitGoClient() {
      bitgoClient_promise ??= (async () => {
        const { client } = options
        await client.initialize?.()
        return client
      })()
      return await bitgoClient_promise
    }

    function toStoreAccount(account: bitgo.WalletAccount, label?: string | undefined) {
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
      const client = await getBitGoClient()
      const valid = await client.isAuthenticated().catch(() => false)
      if (!valid) {
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
          client: await getBitGoClient(),
          parameters: undefined,
        })
        walletAccounts = persisted
          .map((account) =>
            restored.find((walletAccount) =>
              isAddressEqual(core_Address.from(walletAccount.address), account.address),
            ),
          )
          .filter((account): account is bitgo.WalletAccount => !!account)

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
        throw new ox_Provider.DisconnectedError({ message: 'BitGo session expired.' })
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
          message: 'No BitGo account connected.',
        })

      throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
    }

    async function signPayload(parameters: {
      payload: Hex.Hex
      walletAccount: bitgo.WalletAccount
    }) {
      const { payload, walletAccount } = parameters
      return await walletAccount.signRawHash(payload).catch((error) => {
        if (!isSessionError(error)) throw error
        clear()
        throw new ox_Provider.DisconnectedError({ message: 'BitGo session expired.' })
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
      account: bitgo.WalletAccount,
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
      const code = getBitGoErrorCode(error)
      return !!code && bitgoSessionErrorCodes.has(code)
    }

    function getBitGoErrorCode(error: unknown): string | undefined {
      if (!isObject(error)) return undefined
      if (typeof error.code === 'string') return error.code
      if (typeof error.status === 'number' && (error.status === 401 || error.status === 403))
        return 'unauthorized'
      if (typeof error.message === 'string') {
        const msg = error.message.toLowerCase()
        if (msg.includes('unauthorized') || msg.includes('authentication'))
          return 'unauthorized'
      }
      return getBitGoErrorCode(error.cause)
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

          const client = await getBitGoClient()
          const account = await options.createAccount({ client, parameters })
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

          const client = await getBitGoClient()
          walletAccounts = await options.loadAccounts({ client, parameters })
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
          await (await getBitGoClient()).logout?.()
          clear()
        },
      },
    }
  })
}

const bitgoSessionErrorCodes = new Set([
  'invalid_token',
  'token_expired',
  'unauthorized',
  'unauthenticated',
  'needs_otp',
  'needs_unlock',
])

/**
 * Constructs a {@link bitgo.Client} from a BitGo access token and wallet
 * configuration by wrapping the BitGo REST API directly.
 *
 * This avoids pulling in the full `bitgo` npm package (which bundles every
 * coin module) and keeps the dependency footprint small.
 *
 * The returned client implements `isAuthenticated` via `GET /api/v2/me`,
 * `getAddresses` via `GET /api/v2/{coin}/wallet/{walletId}`, and
 * `signRawHash` via `POST /api/v2/{coin}/wallet/{walletId}/signmessage`
 * (available on MPC/TSS wallets running BitGo Express or the hosted API).
 *
 * @example
 * ```ts
 * import { createBitGoClient } from 'accounts/bitgo'
 *
 * const client = createBitGoClient({
 *   accessToken: 'v2x...',
 *   walletId: '63bd84ea...',
 *   walletPassphrase: 'my-passphrase',
 *   coin: 'hteth',        // or 'eth' for mainnet
 *   env: 'test',           // 'test' | 'prod' | custom base URL
 * })
 * ```
 */
export function createBitGoClient(options: createBitGoClient.Options): bitgo.Client & {
  /** Lists wallet addresses usable as {@link bitgo.WalletAccount}. */
  getAddresses: () => Promise<readonly bitgo.WalletAccount[]>
} {
  const { accessToken, coin, walletId, walletPassphrase } = options

  const baseUrl = (() => {
    if (options.env === 'test') return 'https://app.bitgo-test.com'
    if (options.env === 'prod' || !options.env) return 'https://app.bitgo.com'
    return options.env
  })()

  const expressUrl = options.expressUrl

  async function apiFetch(path: string, init: RequestInit = {}) {
    const url = `${baseUrl}${path}`
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw Object.assign(new Error(`BitGo API error: ${response.status} ${body}`), {
        status: response.status,
        body,
      })
    }
    return await response.json()
  }

  async function expressFetch(path: string, init: RequestInit = {}) {
    const url = `${expressUrl ?? baseUrl}${path}`
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw Object.assign(new Error(`BitGo API error: ${response.status} ${body}`), {
        status: response.status,
        body,
      })
    }
    return await response.json()
  }

  function makeWalletAccount(address: string): bitgo.WalletAccount {
    return {
      address,
      async signRawHash(hash) {
        const result = await expressFetch(
          `/api/v2/${coin}/wallet/${walletId}/signmessage`,
          {
            method: 'POST',
            body: JSON.stringify({
              message: { messageRaw: hash },
              walletPassphrase,
            }),
          },
        )
        if (typeof result.signature === 'string') return result.signature as Hex.Hex
        throw new Error('BitGo signmessage did not return a signature.')
      },
    }
  }

  return {
    async isAuthenticated() {
      try {
        await apiFetch('/api/v2/me')
        return true
      } catch {
        return false
      }
    },

    async getAddresses() {
      const wallet = await apiFetch(`/api/v2/${coin}/wallet/${walletId}`)
      const baseAddress: string | undefined =
        wallet.receiveAddress?.address ?? wallet.coinSpecific?.baseAddress
      if (!baseAddress) throw new Error('BitGo wallet has no base address.')
      return [makeWalletAccount(baseAddress)]
    },

    logout() {
      // BitGo access tokens are long-lived; there is no session to clear
      // client-side. To revoke, call DELETE /api/v2/user/session.
    },
  }
}

export declare namespace createBitGoClient {
  type Options = {
    /** BitGo API access token (`v2x...`). */
    accessToken: string
    /** Coin ticker (e.g. `'eth'`, `'hteth'`, `'polygon'`). */
    coin: string
    /** BitGo environment. `'test'` for testnet, `'prod'` for mainnet, or a custom base URL. @default 'prod' */
    env?: 'test' | 'prod' | string | undefined
    /**
     * BitGo Express URL for signing operations. If not set, signing
     * requests go to the same `baseUrl` (works for hosted BitGo API when
     * your wallet is custodial or uses server-side signing).
     */
    expressUrl?: string | undefined
    /** Wallet ID. */
    walletId: string
    /** Wallet passphrase to decrypt the user key for signing. */
    walletPassphrase: string
  }
}

export declare namespace bitgo {
  /** Options for {@link bitgo}. */
  type Options = {
    /** BitGo client. Use {@link createBitGoClient} or provide your own. */
    client: Client
    /** Creates/registers a BitGo wallet account. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized BitGo client. */
      client: Client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<WalletAccount>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads existing BitGo wallet accounts. UI is allowed. */
    loadAccounts: (parameters: {
      /** Initialized BitGo client. */
      client: Client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<readonly WalletAccount[]>
    /** Display name of the provider. @default "BitGo" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "com.bitgo" */
    rdns?: string | undefined
  }

  /**
   * Minimal structural BitGo client surface used by the adapter.
   *
   * Use {@link createBitGoClient} to construct one from a BitGo access
   * token, or provide your own implementation wrapping the BitGo SDK
   * (`bitgo` or `@bitgo/sdk-api`).
   */
  type Client = {
    /** Returns `true` if the current access token is still valid. */
    isAuthenticated: () => Promise<boolean>
    /** Initializes the client. Called once by the adapter. */
    initialize?: (() => Promise<void> | void) | undefined
    /** Clears the current BitGo session. */
    logout?: (() => Promise<void> | void) | undefined
  }

  /**
   * Wallet account shape used by the adapter.
   *
   * `signRawHash` signs a 32-byte hex digest using the wallet's key
   * material. For MPC/TSS wallets this goes through BitGo's
   * `signmessage` endpoint (which performs the multi-round TSS signing
   * protocol with BitGo's HSM). For multisig wallets it goes through
   * BitGo Express `signtx`.
   *
   * Use {@link createBitGoClient} to get accounts with `signRawHash`
   * pre-wired to the BitGo API, or construct them yourself.
   */
  type WalletAccount = {
    /** EVM address for the wallet account. */
    address: string
    /** Signs a 32-byte digest with the wallet's key. Returns `0x{r}{s}{v}`. */
    signRawHash: (hash: Hex.Hex) => Promise<Hex.Hex>
  }
}
