import { Address as core_Address, Hex, Provider as ox_Provider, Signature } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { hashMessage, hashTypedData, isAddressEqual, keccak256 } from 'viem'
import type { Address } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import type { Account as TempoAccount } from 'viem/tempo'
import { Transaction as TempoTransaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
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
 * Apps provide the UI-bearing registration and login flows through `createAccount` and
 * `loadAccounts`.
 *
 * @example
 * ```ts
 * import { TurnkeyClient } from '@turnkey/core'
 * import { Provider, turnkey } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: turnkey({
 *     client: new TurnkeyClient({ organizationId, authProxyConfigId }),
 *     createAccount: async ({ client, parameters }) => {
 *       await client.signUpWithPasskey({
 *         createSubOrgParams: { userName: parameters.name },
 *       })
 *       return (await client.fetchWallets())
 *         .flatMap((wallet) => wallet.accounts)
 *         .find((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM')!
 *     },
 *     loadAccounts: async ({ client }) => {
 *       const session = await client.getSession()
 *       if (!session || session.expiry * 1000 <= Date.now()) await client.loginWithPasskey()
 *       return (await client.fetchWallets())
 *         .flatMap((wallet) => wallet.accounts)
 *         .filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM')
 *     },
 *   }),
 * })
 * ```
 */
export function turnkey(options: turnkey.Options): Adapter.Adapter {
  const { icon, name = 'Turnkey', rdns = 'com.turnkey', sessionSkewMs = 10_000 } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    let turnkeyClient_promise: Promise<turnkey.Client> | undefined
    let expiry_timeout: ReturnType<typeof setTimeout> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly turnkey.WalletAccount[] = []

    async function getTurnkeyClient() {
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

    function clear() {
      if (expiry_timeout) clearTimeout(expiry_timeout)
      expiry_timeout = undefined
      restore_promise = undefined
      walletAccounts = []
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
      if (walletAccounts.length > 0) return
      if (restore_promise) return await restore_promise

      restore_promise = (async () => {
        const state = store.getState()
        const persisted = state.accounts
        if (persisted.length === 0) return

        const session = await getValidSession()
        if (!session) return

        const turnkeyClient = await getTurnkeyClient()
        const restored = (await turnkeyClient.fetchWallets()).flatMap((wallet) =>
          wallet.accounts.filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM'),
        )
        walletAccounts = persisted
          .map((account) =>
            restored.find((walletAccount) =>
              isAddressEqual(core_Address.from(walletAccount.address), account.address),
            ),
          )
          .filter((account): account is turnkey.WalletAccount => !!account)

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
      const session = await getValidSession()
      if (!session) throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
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
          message: 'No Turnkey account connected.',
        })

      throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
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

    async function prepareKeyAuthorization(options: Adapter.authorizeAccessKey.Parameters) {
      const { address, expiry, keyType, limits, scopes } = options
      return await AccessKey.prepare({
        address,
        chainId: options.chainId ?? getClient().chain.id,
        expiry,
        keyType,
        limits,
        scopes,
      })
    }

    async function signKeyAuthorization(
      account: turnkey.WalletAccount,
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
          turnkeyClient: await getTurnkeyClient(),
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
      options: {
        address?: Address | undefined
        calls?: Adapter.signTransaction.Parameters['calls']
      },
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ) {
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
        AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        AccessKey.invalidate(account, error, { store })
        return undefined
      }
    }

    async function signTransaction(parameters: Adapter.signTransaction.Parameters) {
      const turnkeyClient = await getTurnkeyClient()
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
        turnkeyClient,
        walletAccount: account,
      })
      return await TempoTransaction.serialize(
        prepared as never,
        SignatureEnvelope.from(Signature.fromHex(signature)) as never,
      )
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
          const account = await options.createAccount({ client: turnkeyClient, parameters })
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
          walletAccounts = await options.loadAccounts({ client: turnkeyClient, parameters })
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
                    turnkeyClient,
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
          const turnkeyClient = await getTurnkeyClient()
          const account = await accountForSigning(parameters.address)
          return await signPayload({
            payload: hashMessage({ raw: parameters.data }),
            turnkeyClient,
            walletAccount: account,
          })
        },
        async signTransaction(parameters) {
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls },
            async (account, keyAuthorization) => {
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
            },
          )
          if (result !== undefined) return result
          return await signTransaction(parameters)
        },
        async signTypedData(parameters) {
          const turnkeyClient = await getTurnkeyClient()
          const account = await accountForSigning(parameters.address)
          const typedData = JSON.parse(parameters.data) as {
            domain: Record<string, unknown>
            message: Record<string, unknown>
            primaryType: string
            types: Record<string, unknown>
          }
          return await signPayload({
            payload: hashTypedData(typedData as never),
            turnkeyClient,
            walletAccount: account,
          })
        },
        async sendTransaction(parameters) {
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls },
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
          const result = await withAccessKey(
            { address: parameters.from, calls: parameters.calls },
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
          await (await getTurnkeyClient()).logout()
          clear()
        },
      },
    }
  })
}

export declare namespace turnkey {
  /** Options for {@link turnkey}. */
  type Options = {
    /** Existing Turnkey client, such as `TurnkeyClient` from `@turnkey/core`. */
    client: Client
    /** Creates/registers a Turnkey wallet account. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized Turnkey client. */
      client: Client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<WalletAccount>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads/logs into existing Turnkey wallet accounts. UI is allowed. */
    loadAccounts: (parameters: {
      /** Initialized Turnkey client. */
      client: Client
      /** Provider load-accounts parameters. */
      parameters?: Adapter.loadAccounts.Parameters | undefined
    }) => Promise<readonly WalletAccount[]>
    /** Display name of the provider. @default "Turnkey" */
    name?: string | undefined
    /** Reverse DNS identifier. @default "com.turnkey" */
    rdns?: string | undefined
    /** Milliseconds before Turnkey session expiry to proactively disconnect. @default 10000 */
    sessionSkewMs?: number | undefined
  }

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

  /** Minimal structural Turnkey wallet account used by the adapter. */
  type WalletAccount = {
    /** EVM address for the Turnkey wallet account. */
    address: string
    /** Turnkey Ethereum address format. */
    addressFormat?: 'ADDRESS_FORMAT_ETHEREUM' | undefined
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
