import { Address as core_Address, Hex, Provider as core_Provider, PublicKey, Secp256k1 } from 'ox'
import { isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Account from '../Account.js'
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
export function turnkey<const client extends turnkey.Client>(
  options: turnkey.Options<client>,
): Adapter.Adapter {
  const { icon, name = 'Turnkey', rdns = 'com.turnkey', sessionSkewMs = 10_000 } = options

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { store } = parameters
    let turnkeyClient_promise: Promise<client> | undefined
    let expiry_timeout: ReturnType<typeof setTimeout> | undefined

    async function getTurnkeyClient() {
      turnkeyClient_promise ??= (async () => {
        const { client } = options
        await client.init?.()
        return client
      })()
      return await turnkeyClient_promise
    }

    function toStoreAccount(account: turnkey.WalletAccount, label?: string | undefined) {
      const publicKey = account.publicKey
      Hex.assert(publicKey, { strict: true })

      return {
        address: core_Address.from(account.address),
        keyType: 'secp256k1',
        ...(label ? { label } : {}),
        publicKey,
        source: 'turnkey',
      } satisfies turnkey.Account
    }

    function toTempoAccount(account: turnkey.Account): TempoAccount.Account {
      const publicKey = PublicKey.from(
        Secp256k1.noble.ProjectivePoint.fromHex(account.publicKey.slice(2)),
      )

      const sign = async (parameters: { hash: Hex.Hex }) =>
        await signPayload({
          payload: parameters.hash,
          signWith: account.address,
          turnkeyClient: await getTurnkeyClient(),
        })

      return TempoAccount.from({
        keyType: 'secp256k1',
        publicKey,
        sign,
      })
    }

    function clear() {
      if (expiry_timeout) clearTimeout(expiry_timeout)
      expiry_timeout = undefined
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

    async function requireSession() {
      const session = await getValidSession()
      if (!session)
        throw new core_Provider.DisconnectedError({ message: 'Turnkey session expired.' })
    }

    async function accountForSigning(address: Address | undefined) {
      await Store.waitForHydration(store)
      await requireSession()

      const state = store.getState()
      if (state.accounts.length === 0)
        throw new core_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      const address_target = address ?? state.accounts[state.activeAccount]?.address
      if (!address_target)
        throw new core_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const address_ = core_Address.from(address_target)
      const account = state.accounts.find((account) => isAddressEqual(account.address, address_))
      if (!account)
        throw new core_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })
      if (!isTurnkeyAccount(account)) {
        clear()
        throw new core_Provider.DisconnectedError({
          message: 'Turnkey account must reconnect.',
        })
      }

      return account
    }

    function isTurnkeyAccount(account: Account.Store): account is turnkey.Account {
      if (account.source !== 'turnkey') return false
      if (account.keyType !== 'secp256k1') return false
      if (typeof account.publicKey !== 'string') return false
      try {
        Hex.assert(account.publicKey, { strict: true })
        return true
      } catch {
        return false
      }
    }

    function signatureToHex(value: turnkey.SignatureResponse): Hex.Hex {
      const r = hexFromSignaturePart(value.r)
      const s = hexFromSignaturePart(value.s)
      const v = value.v.startsWith('0x') ? value.v : Hex.fromNumber(Number(value.v))
      Hex.assert(v, { strict: true })

      return Hex.concat(r, s, Hex.padLeft(v, 1))
    }

    function hexFromSignaturePart(value: string) {
      const hex = value.startsWith('0x') ? value : `0x${value}`
      Hex.assert(hex, { strict: true })
      return hex
    }

    async function signPayload(parameters: {
      payload: Hex.Hex
      signWith: Address
      turnkeyClient: turnkey.Client
    }) {
      const { payload, signWith, turnkeyClient } = parameters
      const result = await turnkeyClient.httpClient
        .signRawPayload({
          encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
          hashFunction: 'HASH_FUNCTION_NO_OP',
          payload,
          signWith,
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

    return base({
      ...parameters,
      async createAccount(parameters) {
        const turnkeyClient = await getTurnkeyClient()
        const account = await options.createAccount({ client: turnkeyClient, parameters })
        await requireSession()
        const account_store = toStoreAccount(account, parameters.name)
        return {
          account: toTempoAccount(account_store),
          accounts: [account_store],
        }
      },
      async disconnect() {
        await (await getTurnkeyClient()).logout()
        clear()
      },
      async loadAccounts(parameters) {
        const turnkeyClient = await getTurnkeyClient()
        const accounts = await options.loadAccounts({ client: turnkeyClient, parameters })
        await requireSession()
        const accounts_store = accounts.map((account) => toStoreAccount(account))
        return {
          ...(accounts_store[0] ? { account: toTempoAccount(accounts_store[0]) } : {}),
          accounts: accounts_store,
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
  type Options<client extends Client = Client> = {
    /** Existing Turnkey client, such as `TurnkeyClient` from `@turnkey/core`. */
    client: client
    /** Creates/registers a Turnkey wallet account. UI is allowed. */
    createAccount: (parameters: {
      /** Initialized Turnkey client. */
      client: client
      /** Provider create-account parameters. */
      parameters: Adapter.createAccount.Parameters
    }) => Promise<WalletAccount>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Loads/logs into existing Turnkey wallet accounts. UI is allowed. */
    loadAccounts: (parameters: {
      /** Initialized Turnkey client. */
      client: client
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

  /** Minimal structural Turnkey wallet account used by the adapter. */
  type WalletAccount = {
    /** EVM address for the Turnkey wallet account. */
    address: string
    /** Turnkey address format. Account discovery callbacks should return EVM accounts. */
    addressFormat?: string | undefined
    /** Compressed secp256k1 public key for the Turnkey wallet account. */
    publicKey: string
  }

  /** Stored Turnkey account metadata used to reconstruct a remote Tempo account. */
  type Account = Store.Account & {
    /** Turnkey-managed remote signer. */
    source: 'turnkey'
    /** Remote signer key type. */
    keyType: 'secp256k1'
    /** Compressed secp256k1 public key for the Turnkey signer. */
    publicKey: Hex.Hex
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
