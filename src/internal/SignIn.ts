/**
 * What the sign-in plugins share: the access key of a sign-in, the session that a sign-in's result
 * becomes, and the read of the account that Tempo ID selects for the app.
 * @module
 */
import { KeyAuthorization } from 'ox/tempo'
import { RequestError } from '../Accounts.js'
import type { Permissions } from '../Permissions.js'
import type * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as AccessKey from './AccessKey.js'
import type * as TempoAccount from './TempoAccount.js'
import type { Tokens } from './Tokens.js'
import type { User } from './User.js'
import * as Api from './Api.js'

/**
 * The `accessKey` of a sign-in: what the access key may do, a function that returns it, or `false`
 * for a sign-in without an access key. Absent, the instance's `accessKey` applies.
 */
export type AccessKeyOption =
  | Permissions
  | (() => Permissions | undefined)
  | false
  | undefined

/**
 * The `accessKey` of a headless sign-in, which also takes {@link External}. A redirect or backend
 * sign-in finishes in another request, which cannot rebuild an access key without its private key.
 */
export type AccessKeyOption_external = AccessKeyOption | External

/**
 * Another app's access key by its public key, whose private key that app holds, such as the access
 * key of an app whose dialog a wallet shows. The session then holds its key authorization, and the
 * account's owner signs for the session, since the session cannot sign with it.
 */
export type External = Permissions & {
  /** The public key of the other app's access key, with or without its `0x04` prefix. */
  publicKey: `0x${string}`
  /** The signature type of the access key of `publicKey`. Defaults to `secp256k1`. */
  type?: 'p256' | 'secp256k1' | undefined
}

/**
 * Returns the access key of a sign-in, or `undefined` for a sign-in without an access key. An
 * access key without `expiry` expires `AccessKey.defaultExpiry` after the sign-in. The default
 * access key of an instance without `accessKey` applies only to a sign-in without a challenge, on a
 * store that can keep it. Throws a `TypeError` on a page whose instance's `store` has `json`, for
 * an access key that the sign-in generates, before any request.
 */
export function accessKey(
  context: Plugin.Context,
  value: AccessKeyOption_external,
  options: accessKey.Options = {},
): Permissions | External | undefined {
  const resolved = (() => {
    const given = (() => {
      if (value === false) return undefined
      if (typeof value === 'function') return value()
      if (value) return value
      const configured = context.accessKey()
      if (configured) return configured
      // With the default access key, the challenge's signature would sign the key authorization,
      // which no EIP-191 verifier accepts. A page's store with `json` cannot keep its key.
      if (options.challenge) return undefined
      if (context.config.store?.json && typeof indexedDB !== 'undefined')
        return undefined
      return context.defaultAccessKey()
    })()
    if (!given || given.expiry !== undefined) return given
    return { ...given, expiry: AccessKey.defaultExpiry }
  })()
  // A page generates a non-extractable access key, which the save of the session would refuse after
  // Tempo ID spent the sign-in's code. An access key of `account` or `publicKey` holds no such key.
  const generated =
    !!resolved &&
    !('account' in resolved && resolved.account) &&
    !('publicKey' in resolved && resolved.publicKey)
  if (
    generated &&
    context.config.store?.json &&
    typeof indexedDB !== 'undefined'
  )
    throw new TypeError(
      'Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.',
    )
  return resolved
}

export declare namespace accessKey {
  type Options = {
    /** Whether the sign-in carries a challenge. Defaults to `false`. */
    challenge?: boolean | undefined
  }
}

/** Returns the session of a sign-in's result: its tokens, its user, its access key, and its account. */
export function toSession(
  result: Tokens & {
    accessKey?: Session.Session['accessKey']
    account?: TempoAccount.TempoAccount | undefined
    address?: Session.Session['address']
    challengeSignature?: Session.Session['challengeSignature']
    user: User
  },
): Session.Session {
  return Session.from({
    accessToken: result.accessToken,
    ...(result.account ? { account: result.account } : {}),
    ...(result.address && result.challengeSignature
      ? {
          address: result.address,
          challengeSignature: result.challengeSignature,
        }
      : {}),
    expiresAt: result.expiresAt,
    ...(result.idToken !== undefined ? { idToken: result.idToken } : {}),
    ...(result.accessKey ? { accessKey: withLifetime(result.accessKey) } : {}),
    ...(result.receivedAt !== undefined
      ? { receivedAt: result.receivedAt }
      : {}),
    ...(result.refreshToken !== undefined
      ? { refreshToken: result.refreshToken }
      : {}),
    user: result.user,
  })
}

/**
 * Returns `accessKey` with the seconds from now to its expiry as `lifetime`, which a renewal requests
 * again. An access key that never expires has no lifetime.
 */
function withLifetime(accessKey: NonNullable<Session.Session['accessKey']>) {
  const { expiry } = KeyAuthorization.fromRpc(accessKey.keyAuthorization)
  if (!expiry) return accessKey
  return { ...accessKey, lifetime: expiry - Math.floor(Date.now() / 1000) }
}

/**
 * Returns the user's Tempo Account that `GET /v1/account` lists first for the app, on the
 * instance's chain: the account that the user selected, else the oldest. Returns `undefined` when
 * Tempo ID lists no such chain, the session belongs to another user than `userId`, or the user has
 * no account. It creates no account. A failed read throws `Accounts.RequestError` marked `signedIn`, since
 * it follows a sign-in.
 */
export async function account(
  config: Plugin.Context['config'],
  options: account.Options,
): Promise<TempoAccount.TempoAccount | undefined> {
  const listed = await (async () => {
    try {
      return await Api.json<{
        id: string
        tempo: readonly Api.TempoAccountResponse[]
      }>(
        await (config.fetch ?? fetch)(
          new URL(
            `/v1/account?${new URLSearchParams({ chain: String(config.chainId), client_id: config.clientId })}`,
            config.url,
          ),
          // A redirect would send the session cookie's request to another origin.
          { credentials: 'include', redirect: 'manual' },
        ),
      )
    } catch (error) {
      // Tempo ID reads a chain ID in `chain` as it reads a name. An unlisted chain has no accounts.
      if (unlisted(error, { field: 'chain' })) return undefined
      return Api.signedIn(error, {
        message:
          'The account read failed after the sign-in, with no response from Tempo ID. The user is signed in, so sign in again.',
      })
    }
  })()
  // A sign-in in another tab can change the session after this one.
  if (!listed || listed.id !== options.userId) return undefined
  const [first] = listed.tempo
  return first && Api.tempoAccount(first, { getFn: options.getFn })
}

export declare namespace account {
  type Options = {
    /** Runs the ceremony of a passkey owner in place of `navigator.credentials.get`. */
    getFn?: Api.tempoAccount.Options['getFn'] | undefined
    /** The ID of the user whom the sign-in signed in. */
    userId: string
  }
}

/** Returns whether Tempo ID refused the request's chain at `field` as one that it does not list. */
export function unlisted(error: unknown, options: { field: string }) {
  return (
    error instanceof RequestError &&
    error.reason === 'invalid_field' &&
    error.field === options.field
  )
}
