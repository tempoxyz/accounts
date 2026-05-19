import {
  Address as core_Address,
  Bytes,
  Hex,
  Provider as ox_Provider,
  PublicKey,
  RpcResponse,
  Secp256k1,
} from 'ox'
import { hashMessage, hashTypedData, isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import * as AccessKeyTransaction from '../internal/AccessKeyTransaction.js'
import * as Store from '../Store.js'

const turnkeySessionErrorCodes = new Set([
  'API_KEY_EXPIRED',
  'NO_SESSION_FOUND',
  'REQUEST_NOT_AUTHORIZED',
  'SESSION_EXPIRED',
  'SIGNATURE_INVALID',
  'SIGNATURE_MISSING',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
])

/**
 * Creates a Turnkey adapter backed by `@turnkey/core` client sessions and Ethereum wallet accounts.
 *
 * The adapter owns silent reconnect, session-expiry cleanup, and provider signing actions.
 * Apps provide the UI-bearing login or sign-up flow through `loadAccounts`. The adapter
 * fetches Ethereum wallet accounts from Turnkey after the flow completes. Provide
 * `createAccount` only when registration needs a distinct Turnkey flow.
 *
 * @example
 * ```ts
 * import { TurnkeyClient, generateWalletAccountsFromAddressFormat } from '@turnkey/core'
 * import { Provider, turnkey } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: turnkey({
 *     client: new TurnkeyClient({ organizationId, authProxyConfigId }),
 *     createAccount: async ({ client, parameters }) => {
 *       await client.signUpWithPasskey({
 *         passkeyDisplayName: parameters.name,
 *         createSubOrgParams: {
 *           userName: parameters.name,
 *           customWallet: {
 *             walletName: 'FooBar',
 *             walletAccounts: generateWalletAccountsFromAddressFormat({
 *               addresses: ['ADDRESS_FORMAT_ETHEREUM'],
 *             }),
 *           },
 *         },
 *       })
 *     },
 *     loadAccounts: async ({ client }) => {
 *       await client.loginWithPasskey()
 *     },
 *   }),
 * })
 * ```
 */
export function turnkey<const client extends turnkey.Client>(
  options: turnkey.Options<client>,
): Adapter.Adapter {
  const { icon, name = 'Turnkey', rdns = 'com.turnkey', sessionSkewMs = 10_000 } = options

  return Adapter.define({ icon, name, rdns }, ({ getClient, store }) => {
    let turnkeyClient_promise: Promise<client> | undefined
    let expiry_timeout: ReturnType<typeof setTimeout> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts_cache: readonly turnkey.WalletAccount[] | undefined

    async function getTurnkeyClient(): Promise<client> {
      turnkeyClient_promise ??= (async () => {
        const { client } = options
        await client.init?.()
        return client
      })()
      return await turnkeyClient_promise
    }

    function toStoreAccount(account: turnkey.WalletAccount, label?: string | undefined) {
      return {
        address: core_Address.from(account.address),
        ...(label ? { label } : {}),
      }
    }

    function toTempoAccount(account: turnkey.WalletAccount): TempoAccount.Account {
      const publicKey = toPublicKey(account)
      assertAddress(account, publicKey)

      const sign = async (parameters: { hash: Hex.Hex }) =>
        await signPayload({
          payload: parameters.hash,
          turnkeyClient: await getTurnkeyClient(),
          walletAccount: account,
        })

      return TempoAccount.from({
        keyType: 'secp256k1',
        publicKey,
        sign,
      })
    }

    function toPublicKey(account: turnkey.WalletAccount) {
      const publicKey = account.publicKey.startsWith('0x')
        ? account.publicKey
        : `0x${account.publicKey}`
      Hex.assert(publicKey, { strict: true })
      return PublicKey.from(Secp256k1.noble.ProjectivePoint.fromHex(Bytes.fromHex(publicKey)))
    }

    function assertAddress(account: turnkey.WalletAccount, publicKey: PublicKey.PublicKey) {
      const address = core_Address.from(account.address)
      const address_publicKey = core_Address.fromPublicKey(publicKey)
      if (isAddressEqual(address, address_publicKey)) return

      throw new RpcResponse.InternalError({
        message: `Turnkey account publicKey does not match address "${address}".`,
      })
    }

    async function fetchWalletAccounts(): Promise<readonly turnkey.WalletAccount[]> {
      const turnkeyClient = await getTurnkeyClient()
      return (await turnkeyClient.fetchWallets()).flatMap((wallet) =>
        wallet.accounts.filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM'),
      )
    }

    async function refreshWalletAccounts() {
      walletAccounts_cache = await fetchWalletAccounts()
      return walletAccounts_cache
    }

    async function getWalletAccounts() {
      walletAccounts_cache ??= await fetchWalletAccounts()
      return walletAccounts_cache
    }

    function selectWalletAccounts(
      accounts: readonly turnkey.WalletAccount[],
      addresses: turnkey.AccountSelection,
    ) {
      if (!addresses) return accounts

      return addresses.map((address) => {
        const address_ = core_Address.from(address)
        const account = accounts.find((account) =>
          isAddressEqual(core_Address.from(account.address), address_),
        )
        if (account) return account

        throw new RpcResponse.InternalError({
          message: `Turnkey callback returned address "${address_}" that was not found in fetched wallet accounts.`,
        })
      })
    }

    function clear() {
      if (expiry_timeout) clearTimeout(expiry_timeout)
      expiry_timeout = undefined
      restore_promise = undefined
      walletAccounts_cache = undefined
      store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
    }

    function scheduleExpiry(session: turnkey.Session) {
      if (expiry_timeout) clearTimeout(expiry_timeout)
      expiry_timeout = undefined

      const delay = Math.max(session.expiry * 1000 - Date.now() - sessionSkewMs, 0)
      expiry_timeout = setTimeout(() => clear(), delay)
    }

    async function getValidSession() {
      const turnkeyClient = await getTurnkeyClient()
      const session = await turnkeyClient.getSession()

      if (!session || session.expiry * 1000 - sessionSkewMs <= Date.now()) {
        clear()
        return undefined
      }

      scheduleExpiry(session)
      return session
    }

    async function restore() {
      await Store.waitForHydration(store)
      if (walletAccounts_cache) return
      if (restore_promise) return await restore_promise

      restore_promise = (async () => {
        const state = store.getState()
        const persisted = state.accounts
        if (persisted.length === 0) return

        const session = await getValidSession()
        if (!session) return

        await refreshWalletAccounts()
      })()

      try {
        await restore_promise
      } finally {
        restore_promise = undefined
      }
    }

    async function requireSession() {
      const session = await getValidSession()
      if (!session) throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
    }

    async function getTurnkeyAccount(address: Address | undefined) {
      await restore()
      await requireSession()

      const state = store.getState()
      const address_ = address ?? state.accounts[state.activeAccount]?.address
      if (!address_) throw new ox_Provider.DisconnectedError({ message: 'No active account.' })

      if (state.accounts.length === 0)
        throw new ox_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      const connected = state.accounts.some((account) => isAddressEqual(account.address, address_))
      if (!connected)
        throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })

      const find = (accounts: readonly turnkey.WalletAccount[]) =>
        accounts.find((account) => isAddressEqual(core_Address.from(account.address), address_))

      const account = find(await getWalletAccounts())
      if (account) return toTempoAccount(account)

      throw new RpcResponse.InternalError({
        message: `Connected Turnkey account "${address_}" was not found in fetched Turnkey wallet accounts. Reconnect with Turnkey.`,
      })
    }

    function signatureToHex(value: turnkey.SignatureResponse): Hex.Hex {
      const v = value.v.startsWith('0x') ? (value.v as Hex.Hex) : Hex.fromNumber(Number(value.v))

      return Hex.concat(value.r as Hex.Hex, value.s as Hex.Hex, Hex.padLeft(v, 1))
    }

    async function signPayload(parameters: {
      payload: Hex.Hex
      turnkeyClient: turnkey.Client
      walletAccount: turnkey.WalletAccount
    }) {
      const { payload, turnkeyClient, walletAccount } = parameters
      const result = await turnkeyClient.httpClient
        .signRawPayload({
          encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
          hashFunction: 'HASH_FUNCTION_NO_OP',
          payload,
          signWith: walletAccount.address,
        })
        .catch((error) => {
          if (!isSessionError(error)) throw error
          clear()
          throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
        })

      return signatureToHex(result)
    }

    async function signTransaction(parameters: Adapter.signTransaction.Parameters) {
      const account = await getTurnkeyAccount(parameters.from)
      const { feePayer, ...rest } = parameters
      const viemClient = getClient({
        chainId: parameters.chainId,
        feePayer: feePayer === true ? undefined : feePayer,
      })
      const prepared = await prepareTransactionRequest(viemClient, {
        account,
        ...rest,
        ...(feePayer ? { feePayer: true } : {}),
        type: 'tempo',
      } as never)
      return await account.signTransaction(prepared as never)
    }

    function isSessionError(error: unknown) {
      const code = getTurnkeyErrorCode(error)
      return !!code && turnkeySessionErrorCodes.has(code)
    }

    function getTurnkeyErrorCode(error: unknown): string | undefined {
      if (!isObject(error)) return undefined

      if (typeof error.code === 'string') return error.code

      if (Array.isArray(error.details)) {
        for (const detail of error.details) {
          if (!isObject(detail)) continue
          if (typeof detail.turnkeyErrorCode === 'string') return detail.turnkeyErrorCode
        }
      }

      return getTurnkeyErrorCode(error.cause)
    }

    function isObject(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    void restore()

    return {
      cleanup() {
        if (expiry_timeout) clearTimeout(expiry_timeout)
      },
      actions: {
        async createAccount(parameters) {
          const { authorizeAccessKey, personalSign } = parameters
          if (personalSign && parameters.digest)
            throw new ox_Provider.ProviderRpcError(
              -32602,
              '`digest` and `personalSign` cannot both be set on `wallet_connect`.',
            )

          const turnkeyClient = await getTurnkeyClient()
          const addresses = options.createAccount
            ? await options.createAccount({ client: turnkeyClient, parameters })
            : await options.loadAccounts({
                client: turnkeyClient,
                parameters: {
                  authorizeAccessKey,
                  digest: parameters.digest,
                  ...(personalSign ? { personalSign } : {}),
                },
              })
          await requireSession()
          const accounts = selectWalletAccounts(await refreshWalletAccounts(), addresses)
          restore_promise = undefined

          const digest = personalSign ? hashMessage(personalSign.message) : parameters.digest
          const account = accounts[0]
          const keyAuthorization = authorizeAccessKey
            ? account
              ? await AccessKey.authorize({
                  account: toTempoAccount(account),
                  chainId: getClient().chain.id,
                  parameters: authorizeAccessKey,
                  store,
                })
              : undefined
            : undefined

          return {
            accounts: accounts.map((account, index) =>
              toStoreAccount(account, index === 0 ? parameters.name : undefined),
            ),
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature:
              digest && account
                ? await signPayload({
                    payload: digest,
                    turnkeyClient,
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

          const turnkeyClient = await getTurnkeyClient()
          const addresses = await options.loadAccounts({ client: turnkeyClient, parameters })
          await requireSession()
          const accounts = selectWalletAccounts(await refreshWalletAccounts(), addresses)
          restore_promise = undefined

          const digest = personalSign ? hashMessage(personalSign.message) : parameters?.digest
          const account = accounts[0]
          const keyAuthorization =
            authorizeAccessKey && account
              ? await AccessKey.authorize({
                  account: toTempoAccount(account),
                  chainId: getClient().chain.id,
                  parameters: authorizeAccessKey,
                  store,
                })
              : undefined

          return {
            accounts: accounts.map((account) => toStoreAccount(account)),
            ...(personalSign ? { personalSign: { message: personalSign.message } } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            signature:
              digest && account
                ? await signPayload({
                    payload: digest,
                    turnkeyClient,
                    walletAccount: account,
                  })
                : undefined,
          }
        },
        async authorizeAccessKey(parameters) {
          const account = await getTurnkeyAccount(undefined)
          const keyAuthorization = await AccessKey.authorize({
            account,
            chainId: getClient().chain.id,
            parameters,
            store,
          })
          return { keyAuthorization, rootAddress: account.address }
        },
        async signPersonalMessage(parameters) {
          return await (
            await getTurnkeyAccount(parameters.address)
          ).sign({
            hash: hashMessage({ raw: parameters.data }),
          })
        },
        async signTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const viemClient = getClient({
            chainId: parameters.chainId,
            feePayer: feePayer === true ? undefined : feePayer,
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
            try {
              const prepared = await transaction.prepare({
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
              })
              return await prepared.sign()
            } catch {}
          }
          return await signTransaction(parameters)
        },
        async signTypedData(parameters) {
          const typedData = JSON.parse(parameters.data) as {
            domain: Record<string, unknown>
            message: Record<string, unknown>
            primaryType: string
            types: Record<string, unknown>
          }
          return await (
            await getTurnkeyAccount(parameters.address)
          ).sign({
            hash: hashTypedData(typedData as never),
          })
        },
        async sendTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const viemClient = getClient({
            chainId: parameters.chainId,
            feePayer: feePayer === true ? undefined : feePayer,
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
            try {
              const prepared = await transaction.prepare({
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
              })
              return await prepared.send()
            } catch {}
          }
          const signed = await signTransaction(parameters)
          return await viemClient.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const { feePayer, ...rest } = parameters
          const viemClient = getClient({
            chainId: parameters.chainId,
            feePayer: feePayer === true ? undefined : feePayer,
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
            try {
              const prepared = await transaction.prepare({
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
              })
              return await prepared.sendSync()
            } catch {}
          }
          const signed = await signTransaction(parameters)
          return await viemClient.request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
        async disconnect() {
          await (await getTurnkeyClient()).logout()
          clear()
        },
      },
    }
  })
}

export declare namespace turnkey {
  /** Options for {@link turnkey}. */
  type Options<client extends Client = Client> = {
    /** Existing Turnkey client, such as `TurnkeyClient` from `@turnkey/core`. */
    client: client
    /**
     * Creates/registers a Turnkey wallet account. UI is allowed. Defaults to `loadAccounts`.
     * May return selected addresses; the first address is treated as active by default.
     */
    createAccount?:
      | ((parameters: {
          /** Initialized Turnkey client. */
          client: client
          /** Provider create-account parameters. */
          parameters: Adapter.createAccount.Parameters
        }) => Promise<AccountSelection>)
      | undefined
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /**
     * Loads/logs into existing Turnkey wallet accounts. UI is allowed. May return selected
     * addresses; the first address is treated as active by default.
     */
    loadAccounts: (parameters: {
      /** Initialized Turnkey client. */
      client: client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<AccountSelection>
    /** Display name of the provider. @default "Turnkey" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "com.turnkey" */
    rdns?: string | undefined
    /** Milliseconds before Turnkey session expiry to proactively disconnect. @default 10000 */
    sessionSkewMs?: number | undefined
  }

  /**
   * Optional selected addresses returned from a Turnkey login/sign-up callback.
   * When omitted, all fetched Turnkey Ethereum accounts are used. When provided,
   * fetched accounts are ordered to match this list, and the first address is active by default.
   */
  type AccountSelection = readonly Address[] | void

  /** Minimal structural Turnkey client surface used by the adapter. */
  type Client = {
    /** Fetches wallets visible to the current Turnkey session. */
    fetchWallets: () => Promise<readonly Wallet[]>
    /** Returns the current Turnkey session, if any. */
    getSession: () => Promise<Session | null | undefined>
    /** Low-level Turnkey HTTP client. */
    httpClient: {
      /** Signs a raw payload with Turnkey. */
      signRawPayload: (parameters: SignRawPayloadParameters) => Promise<SignatureResponse>
    }
    /** Initializes the client. Called once by the adapter. */
    init?: (() => Promise<void> | void) | undefined
    /** Clears the current Turnkey session. */
    logout: () => Promise<void> | void
  }

  /** Minimal Turnkey session shape used by the adapter. */
  type Session = {
    /** Session expiry in Unix seconds. */
    expiry: number
  }

  /** Minimal structural Turnkey wallet shape used by the adapter. */
  type Wallet = {
    /** Wallet accounts. */
    accounts: readonly WalletAccount[]
  }

  /** Minimal structural Turnkey wallet account fetched by the adapter. */
  type WalletAccount = {
    /** EVM address for the Turnkey wallet account. */
    address: string
    /** Turnkey Ethereum address format. */
    addressFormat?: 'ADDRESS_FORMAT_ETHEREUM' | undefined
    /** Raw compressed secp256k1 public key for the Turnkey wallet account. */
    publicKey: string
  }

  /** Signature parts returned by Turnkey raw-payload signing. */
  type SignatureResponse = {
    /** Signature r value. */
    r: string
    /** Signature s value. */
    s: string
    /** Signature recovery id/value. */
    v: string
  }

  /** Parameters for low-level Turnkey raw payload signing. */
  type SignRawPayloadParameters = {
    /** Payload encoding. */
    encoding: 'PAYLOAD_ENCODING_HEXADECIMAL'
    /** Hash function Turnkey should apply. */
    hashFunction: 'HASH_FUNCTION_NO_OP'
    /** Payload digest. */
    payload: Hex.Hex
    /** Turnkey signer identifier. */
    signWith: string
  }
}
