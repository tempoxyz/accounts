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
import * as Actions from './Actions.js'
import {
  ChainUnavailableError,
  type Config,
  KeyRequiredError,
  RequestError,
  SignedOutError,
} from '../Accounts.js'
import * as AccessKey from './AccessKey.js'
import type * as Session from '../Session.js'
import type * as TempoAccount from './TempoAccount.js'

/**
 * Returns the Viem account of `session` on the chain `chainId`. Its access key signs transactions,
 * and `signer` decides who signs messages and typed data. The account's owner signs them as the
 * cloud wallet through Tempo ID, or as the account's passkey. A session without an access key, or
 * with an access key of another chain, signs only through its owner, and a transaction throws
 * `Accounts.KeyRequiredError`. Returns `undefined` for a session without an access key that can sign
 * nothing.
 */
export function fromSession(
  config: Config,
  session: Session.Session,
  options: fromSession.Options,
): LocalAccount | undefined {
  const { accessToken, chainId, registered, signer } = options
  // An access key authorizes one chain, so on another chain the account signs only through its owner.
  const key =
    session.key && Number(session.key.chainId) === chainId
      ? session.key
      : undefined
  const accessKey = key && AccessKey.toAccount(AccessKey.from(key))
  const address =
    accessKey?.address ?? session.key?.account ?? session.account?.address
  if (!address) return undefined

  // A verifier accepts an access key's signature only once the chain holds the access key, so until
  // then the owner signs, and the access key signs only where no owner signs alone.
  const owner =
    signer === 'fallback' && (!accessKey || registered !== undefined)
  const signers = (() => {
    if (!owner) return undefined
    // A sign-in through a redirect, a dialog, or a device reads no account, so the first signature
    // reads it, since only the account names its owner.
    if (!session.account)
      return deferred(config, { accessKey, accessToken, address, chainId })
    return ownerSigners(config, { account: session.account, address, chainId })
  })()
  if (accessKey) {
    if (!signers || !key || !registered) return accessKey
    return {
      ...accessKey,
      ...untilRegistered({ accessKey, key, registered, signers }),
    }
  }
  if (!signers && !session.key) return undefined
  const required = () => Promise.reject(new KeyRequiredError())
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
     * Returns whether the chain holds `accessKey`, registered, unexpired, and unrevoked. With
     * `signer` `fallback`, each signature of a message or typed data calls it until it returns
     * `true`. Without it, the access key signs them at once.
     */
    registered?:
      | ((accessKey: Account.AccessKeyAccount) => Promise<boolean>)
      | undefined
    /**
     * Who signs messages and typed data: `accessKey`, the access key alone, or `fallback`, the
     * access key once `registered` returns `true`, and the account's owner before that or for a
     * session without an access key on the chain.
     */
    signer: 'accessKey' | 'fallback'
  }
}

/**
 * Returns an account that reads through to `get()` at each use, so it follows a session that changes.
 * While `get()` returns `undefined`, a read throws `Accounts.SignedOutError`.
 */
export function live(get: () => LocalAccount | undefined): LocalAccount {
  // Viem reads a client's account when an action runs, through property reads, `in` checks, and
  // spreads. Each trap reads through to the current account.
  return new Proxy({} as LocalAccount, {
    get(_, key) {
      const target = get()
      if (target) return Reflect.get(target, key)
      // Promise resolution, serialization, and inspection probe these, which must not throw.
      if (typeof key === 'symbol' || key === 'then' || key === 'toJSON')
        return undefined
      throw new SignedOutError()
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
  const passkey = Account.fromWebAuthnP256(own, { rpId: own.rpId })
  return {
    signMessage: (parameters) => passkey.signMessage(parameters),
    signTypedData: (typedData) => passkey.signTypedData(typedData as never),
  }
}

/**
 * Returns signers that read the session's account at the first signature, and then sign as
 * `ownerSigners` does for it. A failed read throws, and the next signature reads again. When no
 * owner signs alone, the access key signs, or a signature throws `Accounts.KeyRequiredError` without one.
 */
function deferred(
  config: Config,
  options: {
    accessKey: LocalAccount | undefined
    accessToken: fromSession.Options['accessToken']
    address: `0x${string}`
    chainId: number
  },
): Signers {
  const { accessKey, accessToken, address, chainId } = options
  let pending: Promise<Signers | undefined> | undefined
  const load = () => {
    pending ??= (async () => {
      const token = await accessToken?.()
      const account = await Actions.account.get(config, {
        ...(token ? { accessToken: token } : {}),
        chainId,
        getFn: config.getFn,
      })
      return ownerSigners(config, { account, address, chainId }) ?? accessKey
    })().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
  const required = () => Promise.reject(new KeyRequiredError())
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
 * Returns signers that sign with `accessKey` once `registered` returns `true`, and with `signers`
 * before that. An access key that expired signs through `signers` without a read. A failed read
 * signs through `signers` too, since the owner's signature verifies whether or not the chain holds
 * the access key. The next signature reads again. If Tempo ID refuses the owner's signature for the
 * app or the chain, the access key signs, and its signature verifies once its first transaction
 * registers it.
 */
function untilRegistered(options: {
  accessKey: Account.AccessKeyAccount
  key: AccessKey.AccessKey
  registered: (accessKey: Account.AccessKeyAccount) => Promise<boolean>
  signers: Signers
}): Signers {
  const { accessKey, key, registered, signers } = options
  const select = async (): Promise<Signers> => {
    if (AccessKey.expired(key)) return signers
    const held = await registered(accessKey).catch(() => false)
    return held ? accessKey : signers
  }
  // Only an app with `tempo-id:sign`, on a chain with configurable accounts, signs through the cloud
  // wallet. Another app still receives the access key's signature.
  const refused = (error: unknown) =>
    error instanceof RequestError &&
    (error.reason === 'configurable_accounts_disabled' ||
      error.reason === 'sign_not_permitted')
  return {
    signMessage: async (parameters) => {
      const selected = await select()
      return selected
        .signMessage(parameters)
        .catch((error: unknown) =>
          selected !== accessKey && refused(error)
            ? accessKey.signMessage(parameters)
            : Promise.reject(error),
        )
    },
    signTypedData: async (typedData) => {
      const selected = await select()
      return selected
        .signTypedData(typedData)
        .catch((error: unknown) =>
          selected !== accessKey && refused(error)
            ? accessKey.signTypedData(typedData as never)
            : Promise.reject(error),
        )
    },
  }
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
      Actions.account
        .signMessage(config, {
          account: address,
          chain: chainId,
          message: parameters.message,
        })
        .catch(refused),
    signTypedData: (typedData) =>
      Actions.account
        .signTypedData(config, { account: address, chain: chainId, typedData })
        .catch(refused),
  }
}
