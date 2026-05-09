import { Hex, Provider as ox_Provider, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { hashMessage, hashTypedData, isAddressEqual, keccak256 } from 'viem'
import type { Address } from 'viem/accounts'
import { prepareTransactionRequest } from 'viem/actions'
import { Transaction as TempoTransaction } from 'viem/tempo'

import * as Adapter from '../Adapter.js'
import * as Store from '../Store.js'

/**
 * Creates a Turnkey adapter backed by `@turnkey/core` client sessions and wallet accounts.
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

  return Adapter.define({ icon, name, rdns }, ({ getClient, store }) => {
    let client_promise: Promise<turnkey.Client> | undefined
    let expiry_timeout: ReturnType<typeof setTimeout> | undefined
    let restore_promise: Promise<void> | undefined
    let walletAccounts: readonly turnkey.WalletAccount[] = []

    async function client() {
      client_promise ??= (async () => {
        const { client } = options
        await client.init?.()
        return client
      })()
      return await client_promise
    }

    function toStoreAccount(account: turnkey.WalletAccount, label?: string | undefined) {
      return {
        address: account.address,
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
      if (!session.expiry) return

      const delay = Math.max(session.expiry * 1000 - Date.now() - sessionSkewMs, 0)
      expiry_timeout = setTimeout(() => clear(), delay)
    }

    async function getValidSession() {
      const client_ = await client()
      const session = await client_.getSession()

      if (!session || (session.expiry && session.expiry * 1000 - sessionSkewMs <= Date.now())) {
        clear()
        return undefined
      }

      scheduleExpiry(session)
      return session
    }

    async function restoreAccounts() {
      const client_ = await client()
      if (options.restoreAccounts)
        return await options.restoreAccounts({
          client: client_,
        })

      const wallets = await client_.fetchWallets()
      return wallets.flatMap((wallet) =>
        wallet.accounts.filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM'),
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

        const session = await getValidSession()
        if (!session) return

        const restored = await restoreAccounts()
        walletAccounts = persisted
          .map((account) =>
            restored.find((walletAccount) =>
              isAddressEqual(walletAccount.address, account.address),
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

    async function withSession<result>(fn: () => Promise<result>) {
      const session = await getValidSession()
      if (!session) throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })

      try {
        return await fn()
      } catch (error) {
        if (isSessionError(error)) {
          clear()
          throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
        }
        throw error
      }
    }

    async function assertSession() {
      const session = await getValidSession()
      if (session) return
      throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
    }

    async function accountForSigning(address: Address | undefined) {
      await restore()

      const session = await getValidSession()
      if (!session) throw new ox_Provider.DisconnectedError({ message: 'Turnkey session expired.' })

      const address_ = address ?? store.getState().accounts[store.getState().activeAccount]?.address
      if (!address_) throw new ox_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const account = walletAccounts.find((account) => isAddressEqual(account.address, address_))
      if (account) return account

      if (walletAccounts.length === 0)
        throw new ox_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      throw new ox_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
    }

    function signatureToHex(value: turnkey.SignatureResponse): Hex.Hex {
      if (typeof value === 'string') return value as Hex.Hex
      if ('signature' in value) return value.signature
      if ('activity' in value) return signatureToHex(value.activity.result.signRawPayloadResult)

      const v =
        typeof value.v === 'string' && value.v.startsWith('0x')
          ? (value.v as Hex.Hex)
          : Hex.fromNumber(Number(value.v))

      return Hex.concat(value.r, value.s, Hex.padLeft(v, 1))
    }

    async function signPayload(parameters: turnkey.SignPayloadParameters) {
      if (options.signPayload) return await withSession(() => options.signPayload!(parameters))

      const { client, payload, walletAccount } = parameters
      const result = await withSession(
        async () =>
          await client.httpClient.signRawPayload({
            encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
            hashFunction: 'HASH_FUNCTION_NO_OP',
            payload,
            signWith: walletAccount.address,
          }),
      )

      return signatureToHex(result)
    }

    async function signTransaction(parameters: Adapter.signTransaction.Parameters) {
      const client_ = await client()
      const account = await accountForSigning(parameters.from)
      const { feePayer, ...rest } = parameters
      const client_tempo = getClient({ feePayer: resolveFeePayer(feePayer) })
      const prepared = await prepareTransactionRequest(client_tempo, {
        account: account.address,
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

      if (options.signTransaction)
        return await withSession(() =>
          options.signTransaction!({
            client: client_,
            unsignedTransaction,
            walletAccount: account,
          }),
        )

      const signature = await signPayload({
        client: client_,
        payload: keccak256(unsignedTransaction),
        walletAccount: account,
      })
      return await TempoTransaction.serialize(
        prepared as never,
        SignatureEnvelope.from(Signature.fromHex(signature)) as never,
      )
    }

    function resolveFeePayer(feePayer: string | boolean | undefined) {
      if (feePayer === false) return false
      if (typeof feePayer === 'string') return feePayer
      return undefined
    }

    function assertNoAccessKey(parameters: {
      authorizeAccessKey?: Adapter.authorizeAccessKey.Parameters | undefined
    }) {
      if (!parameters.authorizeAccessKey) return
      throw new ox_Provider.UnsupportedMethodError({
        message: '`authorizeAccessKey` is not supported by the Turnkey adapter.',
      })
    }

    function isSessionError(error: unknown) {
      if (options.isSessionError?.(error)) return true
      const message = error instanceof Error ? error.message : String(error)
      return /API_KEY_EXPIRED|UNAUTHENTICATED|SIGNATURE_MISSING|SIGNATURE_INVALID|expired api key|cannot authenticate|no active session|session expired|not authenticated/i.test(
        message,
      )
    }

    void restore()

    return {
      cleanup() {
        if (expiry_timeout) clearTimeout(expiry_timeout)
      },
      actions: {
        async createAccount(parameters) {
          assertNoAccessKey(parameters)

          const client_ = await client()
          const account = await options.createAccount({ client: client_, parameters })
          await assertSession()
          walletAccounts = [account]
          restore_promise = undefined

          const digest = parameters.personalSign
            ? hashMessage(parameters.personalSign.message)
            : parameters.digest

          return {
            accounts: [toStoreAccount(account, parameters.name)],
            signature: digest
              ? await signPayload({ client: client_, payload: digest, walletAccount: account })
              : undefined,
          }
        },
        async loadAccounts(parameters) {
          assertNoAccessKey(parameters ?? {})

          const client_ = await client()
          walletAccounts = await options.loadAccounts({ client: client_, parameters })
          await assertSession()
          restore_promise = undefined

          const digest = parameters?.personalSign
            ? hashMessage(parameters.personalSign.message)
            : parameters?.digest
          const account = walletAccounts[0]

          return {
            accounts: walletAccounts.map((account) => toStoreAccount(account)),
            signature:
              digest && account
                ? await signPayload({ client: client_, payload: digest, walletAccount: account })
                : undefined,
          }
        },
        async signPersonalMessage(parameters) {
          const client_ = await client()
          const account = await accountForSigning(parameters.address)
          return await signPayload({
            client: client_,
            payload: hashMessage({ raw: parameters.data }),
            walletAccount: account,
          })
        },
        async signTransaction(parameters) {
          return await signTransaction(parameters)
        },
        async signTypedData(parameters) {
          const client_ = await client()
          const account = await accountForSigning(parameters.address)
          const typedData = JSON.parse(parameters.data) as {
            domain: Record<string, unknown>
            message: Record<string, unknown>
            primaryType: string
            types: Record<string, unknown>
          }
          return await signPayload({
            client: client_,
            payload: hashTypedData(typedData as never),
            walletAccount: account,
          })
        },
        async sendTransaction(parameters) {
          const signed = await signTransaction(parameters)
          return await getClient({
            chainId: parameters.chainId,
            feePayer: resolveFeePayer(parameters.feePayer),
          }).request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const signed = await signTransaction(parameters)
          return await getClient({
            chainId: parameters.chainId,
            feePayer: resolveFeePayer(parameters.feePayer),
          }).request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
        async disconnect() {
          await (await client()).logout()
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
    /** Optional hook for classifying Turnkey session/auth failures. */
    isSessionError?: ((error: unknown) => boolean) | undefined
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
    /** Optional silent account restoration. Defaults to Ethereum accounts from `client.fetchWallets()`. */
    restoreAccounts?:
      | ((parameters: {
          /** Initialized Turnkey client. */
          client: Client
        }) => Promise<readonly WalletAccount[]>)
      | undefined
    /** Optional override for Turnkey payload signing across SDK versions. */
    signPayload?: ((parameters: SignPayloadParameters) => Promise<Hex.Hex>) | undefined
    /** Optional override for Turnkey transaction signing across SDK versions. */
    signTransaction?: ((parameters: SignTransactionParameters) => Promise<Hex.Hex>) | undefined
  }

  /** Minimal structural Turnkey client surface used by the adapter. */
  type Client = {
    /** Fetches wallets visible to the current Turnkey session. */
    fetchWallets: () => Promise<readonly Wallet[]>
    /** Returns the current Turnkey session, if any. */
    getSession: () => Promise<Session | null>
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
    expiry?: number | undefined
  }

  /** Minimal structural Turnkey wallet shape used by the adapter. */
  type Wallet = {
    /** Wallet accounts. */
    accounts: readonly WalletAccount[]
  }

  /** Minimal structural Turnkey wallet account used by the adapter. */
  type WalletAccount = {
    /** EVM address for the Turnkey wallet account. */
    address: Address
    /** Turnkey address format. */
    addressFormat?: string | undefined
    /** Turnkey signing curve. */
    curve?: string | undefined
  }

  /** Supported Turnkey signature response shapes. */
  type SignatureResponse =
    | Hex.Hex
    | Signature
    | { signature: Hex.Hex }
    | {
        activity: {
          result: {
            signRawPayloadResult: Signature
          }
        }
      }

  /** Signature parts returned by Turnkey signing APIs. */
  type Signature = {
    /** Signature r value. */
    r: Hex.Hex
    /** Signature s value. */
    s: Hex.Hex
    /** Signature recovery id/value. */
    v: bigint | number | string
  }

  /** Parameters for payload signing. */
  type SignPayloadParameters = {
    /** Initialized Turnkey client. */
    client: Client
    /** Payload digest to sign. */
    payload: Hex.Hex
    /** Turnkey wallet account to sign with. */
    walletAccount: WalletAccount
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
    signWith: Address
  }

  /** Parameters for Turnkey transaction signing. */
  type SignTransactionParameters = {
    /** Initialized Turnkey client. */
    client: Client
    /** Serialized unsigned transaction. */
    unsignedTransaction: Hex.Hex
    /** Turnkey wallet account to sign with. */
    walletAccount: WalletAccount
  }
}
