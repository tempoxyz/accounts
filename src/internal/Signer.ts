/**
 * The Viem account of a session on one chain: the access key signs transactions, messages, and typed
 * data, and the account's owner signs messages and typed data while no access key on the chain can
 * sign them.
 * @module
 */
import { Address } from 'ox'
import {
  type LocalAccount,
  type SignableMessage,
  type TypedData,
  type TypedDataDefinition,
} from 'viem'
import { toAccount } from 'viem/accounts'
import { Account } from 'viem/tempo'
import * as AccountActions from '../actions/account.js'
import {
  ChainUnavailableError,
  type Config,
  AccessKeyRequiredError,
  RequestError,
  SignedOutError,
} from '../Accounts.js'
import * as AccessKey from './AccessKey.js'
import type * as Session from '../Session.js'
import type * as TempoAccount from './TempoAccount.js'

/**
 * Returns the Viem account of `session` on the chain `chainId`. Its access key signs transactions,
 * messages, and typed data, also before the chain holds the access key. With `signer` `fallback`,
 * the account's owner signs messages and typed data for a session whose access key cannot sign on
 * the chain: as the cloud wallet through Tempo ID, or as the account's passkey. A session without an
 * access key, or with an access key of another chain, signs only through its owner, and a
 * transaction throws `Accounts.AccessKeyRequiredError`. Returns `undefined` for a session without an
 * access key that can sign nothing.
 */
export function fromSession(
  config: Config,
  session: Pick<Session.Session, 'accessKey' | 'accessKeys' | 'account'>,
  options: fromSession.Options,
): LocalAccount | undefined {
  const { accessToken, chainId, signer } = options
  // An access key authorizes one chain, so on a chain without one the account signs only through its
  // owner.
  const found = [session.accessKey, ...(session.accessKeys ?? [])].find(
    (entry) => entry && Number(entry.chainId) === chainId,
  )
  // A session with access keys on other chains outlives an expired one, so that access key counts as
  // none, and a transaction requests a new one.
  const accessKey =
    found && session.accessKeys?.length && AccessKey.expired(found)
      ? undefined
      : found
  // An access key that another app holds, by its public key alone, signs nothing here, so the owner
  // signs for the session.
  const accessKeyAccount =
    accessKey && AccessKey.held(accessKey)
      ? AccessKey.toAccount(AccessKey.from(accessKey))
      : undefined
  // An access key on the chain names the account there. Without one, the account of another
  // chain's access key stands in, until a transaction requests an access key on this chain.
  const address =
    accessKeyAccount?.address ??
    found?.account ??
    session.accessKey?.account ??
    session.account?.address ??
    session.accessKeys?.[0]?.account
  if (!address) return undefined

  // The access key signs for the account wherever it can, and the owner signs only where no access
  // key of the session signs.
  if (accessKeyAccount) return accessKeyAccount

  const signers = (() => {
    if (signer !== 'fallback') return undefined
    // A sign-in through a redirect, a dialog, or a device reads no account, so the first signature
    // reads it, since only the account names its owner. The session's account belongs to the chain
    // of `session.accessKey`, or without one to the instance's chain, where none of its access keys
    // sits. Another chain reads its own account, with its own owners.
    const account = (() => {
      if (session.accessKey)
        return Number(session.accessKey.chainId) === chainId
          ? session.account
          : undefined
      return found || chainId !== config.chainId ? undefined : session.account
    })()
    if (!account) return deferred(config, { accessToken, address, chainId })
    return ownerSigners(config, { account, address, chainId })
  })()
  // A session with an access key on another chain signs no transaction here, which rejects with
  // `AccessKeyRequiredError`, so the viem plugin can request an access key on the chain.
  if (!signers && !session.accessKey && !session.accessKeys?.length)
    return undefined
  const required = () => Promise.reject(new AccessKeyRequiredError())
  return toAccount({
    address,
    signMessage: required,
    signTypedData: required,
    ...signers,
    signTransaction: required,
  })
}

export declare namespace fromSession {
  type Options = {
    /**
     * Returns a live access token of the session, refreshing it if necessary, or `undefined` when
     * none is available. The read of the account for owner signing sends it, since a page of
     * another site sends no Tempo ID cookie. Without it, the read sends the session cookie alone.
     */
    accessToken?: (() => Promise<string | undefined>) | undefined
    /** The chain of the client, whose configuration of the account signs. */
    chainId: number
    /**
     * Who signs messages and typed data: `accessKey`, the access key alone, or `fallback`, the
     * access key where the session holds one that signs on the chain, and the account's owner
     * otherwise.
     */
    signer: 'accessKey' | 'fallback'
  }
}

/**
 * Returns an account that reads through to `get()` at each use, so it follows a session that changes.
 * While `get()` returns `undefined`, a read throws `Accounts.SignedOutError`, which names
 * `session.get` while `options.pending` returns `true`.
 */
export function live(
  get: () => LocalAccount | undefined,
  options: live.Options = {},
): LocalAccount {
  const { pending } = options

  // Viem reads a client's account when an action runs, through property reads, `in` checks, and
  // spreads. Each trap reads through to the current account.
  return new Proxy({} as LocalAccount, {
    get(_, key) {
      const target = get()
      if (target) return Reflect.get(target, key)
      // Promise resolution, serialization, and inspection probe these, which must not throw.
      if (typeof key === 'symbol' || key === 'then' || key === 'toJSON')
        return undefined
      throw new SignedOutError({ pending: pending?.() })
    },
    getOwnPropertyDescriptor(_, key) {
      const target = get()
      if (!target) return undefined
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      // A proxy may report a property its empty target lacks only as configurable.
      return descriptor && { ...descriptor, configurable: true }
    },
    has: (_, key) => {
      const target = get()
      return target !== undefined && Reflect.has(target, key)
    },
    ownKeys: () => {
      const target = get()
      return target ? Reflect.ownKeys(target) : []
    },
  })
}

export declare namespace live {
  type Options = {
    /**
     * Returns whether the instance reads its saved session or a sign-in runs, such as the session's
     * status `pending` or `reauthorizing`. Absent, a read without a session names the sign-in.
     */
    pending?: (() => boolean) | undefined
  }
}

/**
 * Returns the `signMessage` and `signTypedData` of the account's owner. A cloud wallet signs through
 * Tempo ID, without a prompt. Without one, the account's passkeys sign in the browser, when they
 * reach the threshold. Returns `undefined` when no owner can sign alone.
 */
function ownerSigners(
  config: Config,
  options: {
    account: TempoAccount.TempoAccount | undefined
    address: `0x${string}`
    chainId: number
  },
): Signers | undefined {
  const { account, address, chainId } = options
  // Only the session's own account says who owns it. Without it, Tempo ID's cloud wallet signs.
  if (!account || !Address.isEqual(account.address, address))
    return tempoId(config, { address, chainId })

  const { config: configuration, keys } = account
  if (configuration) {
    if (keys.some((key) => key.type !== 'webAuthn'))
      return tempoId(config, { address, chainId })
    // Only the user's own passkeys sign, and together they must reach the threshold.
    const weight = configuration.owners
      .filter((owner) =>
        account.owners.some((signer) =>
          Address.isEqual(signer.address, owner.owner),
        ),
      )
      .reduce((total, owner) => total + Number(owner.weight), 0)
    if (weight < Number(configuration.threshold)) return undefined
    return {
      signMessage: (parameters) => account.signMessage(parameters),
      signTypedData: (typedData) => account.signTypedData(typedData as never),
    }
  }

  // On a chain without configurable accounts, a passkey of the user's whose key is the account's
  // address is the account. `Api.tempoAccount` keeps only a credential whose public key derives its
  // key's address.
  const own = keys.find(
    (key) => key.credential && Address.isEqual(key.address, address),
  )?.credential
  if (!own) return tempoId(config, { address, chainId })
  const passkey = Account.fromWebAuthnP256(own, {
    getFn: config.getFn,
    rpId: own.rpId,
  })
  return {
    signMessage: (parameters) => passkey.signMessage(parameters),
    signTypedData: (typedData) => passkey.signTypedData(typedData as never),
  }
}

/**
 * Returns signers that read the session's account at the first signature, and then sign as
 * `ownerSigners` does for it. A failed read throws, and the next signature reads again. When no
 * owner signs alone, a signature throws `Accounts.AccessKeyRequiredError`.
 */
function deferred(
  config: Config,
  options: {
    accessToken: fromSession.Options['accessToken']
    address: `0x${string}`
    chainId: number
  },
): Signers {
  const { accessToken, address, chainId } = options
  let pending: Promise<Signers | undefined> | undefined
  const load = () => {
    pending ??= (async () => {
      const token = await accessToken?.()
      const account = await AccountActions.get(config, {
        ...(token ? { accessToken: token } : {}),
        chain: chainId,
        getFn: config.getFn,
      })
      return ownerSigners(config, { account, address, chainId })
    })().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
  const required = () => Promise.reject(new AccessKeyRequiredError())
  return {
    signMessage: async (parameters) => {
      const signers = await load()
      return signers ? signers.signMessage(parameters) : required()
    },
    signTypedData: async (typedData) => {
      const signers = await load()
      return signers ? signers.signTypedData(typedData) : required()
    },
  }
}

/** The signers of messages and typed data. */
type Signers = {
  signMessage: (parameters: {
    message: SignableMessage
  }) => Promise<`0x${string}`>
  signTypedData: <
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  >(
    typedData: TypedDataDefinition<typedData, primaryType>,
  ) => Promise<`0x${string}`>
}

/**
 * Returns signers that sign as the account `address` on the chain `chainId` with the user's cloud
 * wallet, through Tempo ID. A chain that Tempo ID does not list throws `Accounts.ChainUnavailableError`, so
 * a signature never falls back to another chain's configuration.
 */
function tempoId(
  config: Config,
  options: { address: `0x${string}`; chainId: number },
): Signers {
  const { address, chainId } = options
  const refused = (error: unknown): never => {
    if (
      error instanceof RequestError &&
      error.reason === 'invalid_field' &&
      error.field === 'chain'
    )
      throw new ChainUnavailableError({ chainId })
    throw error
  }
  return {
    signMessage: (parameters) =>
      AccountActions.signMessage(config, {
        account: address,
        chain: chainId,
        message: parameters.message,
      }).catch(refused),
    signTypedData: (typedData) =>
      AccountActions.signTypedData(config, {
        account: address,
        chain: chainId,
        typedData,
      }).catch(refused),
  }
}
