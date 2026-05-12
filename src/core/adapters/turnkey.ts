import { Address as core_Address, Hex, Provider as core_Provider, Signature } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { hashMessage, hashTypedData, isAddressEqual, keccak256 } from 'viem'
import type { Address } from 'viem/accounts'
import type { Account as TempoAccount } from 'viem/tempo'
import { Transaction as TempoTransaction } from 'viem/tempo'

import * as Adapter from '../Adapter.js'
import * as Store from '../Store.js'
import { base } from './base.js'

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

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { store } = parameters
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

    function toTempoAccount(account: turnkey.WalletAccount): TempoAccount.Account {
      const address = core_Address.from(account.address)
      const sign = async (parameters: { hash: Hex.Hex }) =>
        await signPayload({
          payload: parameters.hash,
          turnkeyClient: await getTurnkeyClient(),
          walletAccount: account,
        })

      return {
        address,
        keyType: 'secp256k1',
        type: 'local',
        sign,
        async signMessage(parameters) {
          return await sign({ hash: hashMessage((parameters as { message: never }).message) })
        },
        async signTransaction(transaction) {
          const presign = (() => {
            if ('feePayerSignature' in transaction && transaction.feePayerSignature)
              return { ...transaction, feePayerSignature: null }
            return transaction
          })()
          const unsignedTransaction = await TempoTransaction.serialize(presign as never)
          const signature = await sign({ hash: keccak256(unsignedTransaction) })
          return await TempoTransaction.serialize(
            transaction as never,
            SignatureEnvelope.from(Signature.fromHex(signature)) as never,
          )
        },
        async signTypedData(parameters) {
          return await sign({ hash: hashTypedData(parameters as never) })
        },
      } as TempoAccount.Account
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
      if (!session)
        throw new core_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
    }

    async function accountForSigning(address: Address | undefined) {
      await restore()
      await requireSession()

      const address_ = address ?? store.getState().accounts[store.getState().activeAccount]?.address
      if (!address_)
        throw new core_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const account = walletAccounts.find((account) =>
        isAddressEqual(core_Address.from(account.address), address_),
      )
      if (account) return account

      if (walletAccounts.length === 0)
        throw new core_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      throw new core_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
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
          throw new core_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
        })

      return signatureToHex(result)
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

    return base({
      ...parameters,
      async createAccount(parameters) {
        const turnkeyClient = await getTurnkeyClient()
        const account = await options.createAccount({ client: turnkeyClient, parameters })
        await requireSession()
        walletAccounts = [account]
        restore_promise = undefined
        return {
          account: toTempoAccount(account),
          accounts: [toStoreAccount(account, parameters.name)],
        }
      },
      async disconnect() {
        await (await getTurnkeyClient()).logout()
        clear()
      },
      async loadAccounts(parameters) {
        const turnkeyClient = await getTurnkeyClient()
        walletAccounts = await options.loadAccounts({ client: turnkeyClient, parameters })
        await requireSession()
        restore_promise = undefined
        const account = walletAccounts[0]
        return {
          ...(account ? { account: toTempoAccount(account) } : {}),
          accounts: walletAccounts.map((account) => toStoreAccount(account)),
        }
      },
      async resolveAccount(parameters = {}) {
        return toTempoAccount(await accountForSigning(parameters.address))
      },
    })
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
