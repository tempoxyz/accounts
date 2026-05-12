import { Address as core_Address, Hex, Provider as core_Provider, PublicKey, Secp256k1 } from 'ox'
import { isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

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
    let remoteAccounts_promise: Promise<ReadonlyMap<Address, turnkey.WalletAccount>> | undefined

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
      const key = account.publicKey.startsWith('0x') ? account.publicKey : `0x${account.publicKey}`
      Hex.assert(key, { strict: true })
      const publicKey = PublicKey.from(Secp256k1.noble.ProjectivePoint.fromHex(key.slice(2)))

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

    function clear() {
      if (expiry_timeout) clearTimeout(expiry_timeout)
      expiry_timeout = undefined
      remoteAccounts_promise = undefined
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

    async function getRemoteAccounts() {
      if (remoteAccounts_promise) return await remoteAccounts_promise

      remoteAccounts_promise = (async () => {
        await requireSession()

        const turnkeyClient = await getTurnkeyClient()
        const accounts = (await turnkeyClient.fetchWallets()).flatMap((wallet) =>
          wallet.accounts.filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM'),
        )

        return new Map<Address, turnkey.WalletAccount>(
          accounts.map((account) => [core_Address.from(account.address), account]),
        )
      })()

      try {
        return await remoteAccounts_promise
      } catch (error) {
        remoteAccounts_promise = undefined
        throw error
      }
    }

    async function getWalletAccount(address: Address) {
      const account = (await getRemoteAccounts()).get(address)
      if (account) return account

      remoteAccounts_promise = undefined
      const refreshed = await getRemoteAccounts()
      const account_refreshed = refreshed.get(address)
      if (account_refreshed) return account_refreshed

      if (refreshed.size === 0)
        throw new core_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      throw new core_Provider.UnauthorizedError({ message: `Account "${address}" not found.` })
    }

    async function accountForSigning(address: Address | undefined) {
      await Store.waitForHydration(store)

      const state = store.getState()
      if (state.accounts.length === 0)
        throw new core_Provider.DisconnectedError({
          message: 'No Turnkey account connected.',
        })

      const address_target = address ?? state.accounts[state.activeAccount]?.address
      if (!address_target)
        throw new core_Provider.DisconnectedError({ message: 'No accounts connected.' })

      const address_ = core_Address.from(address_target)
      if (!state.accounts.some((account) => isAddressEqual(account.address, address_)))
        throw new core_Provider.UnauthorizedError({ message: `Account "${address_}" not found.` })

      return await getWalletAccount(address_)
    }

    function signatureToHex(value: turnkey.SignatureResponse): Hex.Hex {
      const { r, s } = value
      const v = value.v.startsWith('0x') ? value.v : Hex.fromNumber(Number(value.v))
      Hex.assert(r, { strict: true })
      Hex.assert(s, { strict: true })
      Hex.assert(v, { strict: true })

      return Hex.concat(r, s, Hex.padLeft(v, 1))
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

    return base({
      ...parameters,
      async createAccount(parameters) {
        const turnkeyClient = await getTurnkeyClient()
        const account = await options.createAccount({ client: turnkeyClient, parameters })
        await requireSession()
        remoteAccounts_promise = Promise.resolve(
          new Map([[core_Address.from(account.address), account]]),
        )
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
        const accounts = await options.loadAccounts({ client: turnkeyClient, parameters })
        await requireSession()
        remoteAccounts_promise = Promise.resolve(
          new Map(accounts.map((account) => [core_Address.from(account.address), account])),
        )
        const account = accounts[0]
        return {
          ...(account ? { account: toTempoAccount(account) } : {}),
          accounts: accounts.map((account) => toStoreAccount(account)),
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
    /** Compressed secp256k1 public key for the Turnkey wallet account. */
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
