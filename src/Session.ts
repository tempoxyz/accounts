/**
 * The session of a signed-in user, which an instance holds and saves to its store.
 * @module
 */
import * as AccessKey from './internal/AccessKey.js'
import type * as TempoAccount from './internal/TempoAccount.js'
import type { Tokens } from './internal/Tokens.js'
import type { User } from './internal/User.js'

/**
 * The session of a signed-in user, which an instance holds and saves to its store, and each sign-in
 * of a plugin returns. It holds the {@link Tokens}, the user, the app's access key as data, the
 * user's Tempo Account, and any signature of the sign-in's challenge. {@link expired} reports an
 * access key past its expiry.
 */
export type Session = Tokens & {
  /**
   * The app's access key, with its material: the latest sign-in's, or, after `switchChain`, the one
   * on the instance's chain. The `viem` plugin signs with it. Absent after a sign-in without an
   * access key, and after a switch to a chain where the session holds none.
   */
  accessKey?: AccessKey.AccessKey | undefined
  /**
   * The app's access keys on chains other than the chain of `accessKey`, at most one for each
   * chain. The `viem` plugin's client of each chain signs with the access key on it. A
   * transaction's request for an access key on a new chain adds one. Its sign-in of the same user
   * keeps them, unless it returns an access key on the same chain. Any other new sign-in replaces
   * them. Absent without one.
   */
  accessKeys?: readonly AccessKey.AccessKey[] | undefined
  /**
   * The user's Tempo Account that Tempo ID selects for the app, on the instance's chain: the account
   * that the user selected, else the oldest. Absent where the sign-in read no account, such as a
   * sign-in through a redirect, a dialog, or a device, and after a `switchChain` of a session with
   * access keys. `accounts.account.get` reads it. A read that the session's access token
   * authenticates, on the instance's chain, saves it in the session.
   */
  account?: TempoAccount.TempoAccount | undefined
  /**
   * The Tempo Account that signed the sign-in's `challenge`. Absent without a challenge, and after a
   * sign-in through a redirect, a dialog, or a device, it is the only account address the session
   * holds without an access key.
   */
  address?: `0x${string}` | undefined
  /**
   * The signature of the sign-in's `challenge` by `address`, serialized. Without an access key, it
   * signs the challenge's EIP-191 hash, as `personal_sign` does, on the instance's chain, so Viem's
   * `verifyMessage` verifies it. With one, whose `witness` binds that hash
   * ([TIP-1053](https://tips.sh/1053)), it is the key authorization's signature, which verifies over
   * the key authorization's digest. A passkey registration with an access key signs the same way. A
   * Tempo ID that binds its own witness to a passkey registration returns a signature over the
   * EIP-191 hash instead, whose key authorization's witness is not that hash. A refresh keeps it,
   * and the next sign-in or authorization replaces it.
   */
  challengeSignature?: `0x${string}` | undefined
  /** The signed-in user, from the ID token. */
  user: User
}

/**
 * The status of an instance's session, with the session to show, which `accounts.session.status`
 * and `accounts.useSession()` return. It is the state of `accounts.session.actor`. An authorization
 * of the browser's Tempo ID session, such as `accounts.authorize`, holds it at `pending`, or at
 * `reauthorizing` while it renews a saved session whose access key expired.
 */
export type Status =
  | {
      /** No session to show. */
      session: undefined
      /**
       * The instance reads the saved session, completes a redirect's callback, or authorizes the
       * browser's Tempo ID session with no saved session to show.
       */
      status: 'pending'
    }
  | {
      /**
       * The saved session whose access key expired, which the authorization renews. Its access key
       * signs nothing, so it shows only the user and the account.
       */
      session: Session
      /** An authorization renews the saved session, which expired. */
      status: 'reauthorizing'
    }
  | {
      /** The session. */
      session: Session
      /** The instance holds a session. */
      status: 'signedIn'
    }
  | {
      /** No session. */
      session: undefined
      /** The instance holds no session, and no authorization runs. */
      status: 'signedOut'
    }

/**
 * Instantiates a {@link Session}.
 *
 * @example
 * ```ts
 * const session = Session.from({ ...tokens, accessKey, user })
 * ```
 */
export function from(value: Session): Session {
  return value
}

/**
 * Returns whether the session can no longer act: its access key expired, and no access key on another
 * chain lives, or, without an access key, its access token expired and it holds no refresh token. A
 * session without an access key that holds a refresh token never expires here, since its tokens
 * refresh. `accounts.session.get()` already empties a saved session whose access key expired.
 *
 * @example
 * ```ts
 * import { Session } from 'accounts'
 *
 * const session = await accounts.session.get()
 * // A session can expire while the page stays open.
 * if (session && Session.expired(session)) await accounts.signOut()
 * ```
 */
export function expired(session: Session): boolean {
  if (session.accessKey)
    return (
      AccessKey.expired(session.accessKey) &&
      !session.accessKeys?.some((entry) => !AccessKey.expired(entry))
    )
  if (session.accessKeys?.some((entry) => !AccessKey.expired(entry)))
    return false
  return !session.refreshToken && session.expiresAt <= Date.now()
}
