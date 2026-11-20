/**
 * The session of a signed-in user, which an instance holds and saves to its store.
 * @module
 */
import * as AccessKey from './internal/AccessKey.js'
import type * as TempoAccount from './internal/TempoAccount.js'
import type { Tokens } from './internal/Tokens.js'
import type { User } from './internal/User.js'

/**
 * The session of a user whom Tempo ID signed in, which an instance holds and saves to its store, and
 * each sign-in of a Tempo ID plugin returns. It holds the {@link Tokens}, the user, the app's access
 * key as data, the user's Tempo Account, and any signature of the sign-in's challenge.
 * {@link expired} reports an access key past its expiry. An instance with the `local` plugin holds
 * {@link Any} instead.
 */
export type Session = TempoIdSession

/** Either session that an instance holds: a Tempo ID sign-in's, or the `local` plugin's. */
export type Any = LocalSession | TempoIdSession

/**
 * The session that an instance of `plugins` holds: {@link Session} for plugins whose ids exclude the
 * `local` plugin's, else {@link Any}, such as for a list of any plugins.
 */
export type Of<plugins extends readonly { id: string }[]> =
  string extends plugins[number]['id']
    ? Any
    : 'local' extends plugins[number]['id']
      ? Any
      : Session

/**
 * The session of an account whose owner key the instance holds, which the `local` plugin signs in.
 * Tempo ID issues it no tokens and names no user: `address` is the owner's account, and the owner
 * signs each access key that it holds. It expires only with its access keys.
 */
export type LocalSession = Omit<
  TempoIdSession,
  keyof Tokens | 'kind' | 'user'
> & {
  accessToken?: undefined
  /** The account of the owner key. */
  address: `0x${string}`
  expiresAt?: undefined
  idToken?: undefined
  /** Marks a session of the `local` plugin. */
  kind: 'local'
  receivedAt?: undefined
  refreshToken?: undefined
  /**
   * When the `local` plugin last signed in, in milliseconds, and greater than each earlier
   * revision. Of two saved copies of one local session, the greater revision is the later one.
   */
  revision: number
  user?: undefined
}

/** The session of a user whom Tempo ID signed in, with its tokens. */
export type TempoIdSession = Tokens & {
  /** Absent for a session of Tempo ID, such as one that an earlier release saved. */
  kind?: 'tempoId' | undefined
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
export type Status<session extends Any = Session> =
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
      session: session
      /** An authorization renews the saved session, which expired. */
      status: 'reauthorizing'
    }
  | {
      /** The session. */
      session: session
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
export function from<const value extends Any>(value: value): value {
  return value
}

/**
 * Returns whether the session is a {@link LocalSession}, which Tempo ID issued no tokens for.
 *
 * @example
 * ```ts
 * import { Session } from 'accounts'
 *
 * const session = await accounts.session.get()
 * if (session && !Session.local(session)) console.log(session.user.email)
 * ```
 */
export function local(session: Any): session is LocalSession {
  return session.kind === 'local'
}

/**
 * Returns who the session belongs to: the user's ID, or `local:` and the lowercase address of a
 * {@link LocalSession}. Two sessions of the same subject belong to the same user.
 *
 * @example
 * ```ts
 * import { Session } from 'accounts'
 *
 * const same = Session.subject(before) === Session.subject(after)
 * ```
 */
export function subject(session: Any): string {
  if (local(session)) return `local:${session.address.toLowerCase()}`
  return session.user.id
}

/**
 * Returns whether `session` belongs to the {@link subject} of `other`. A missing `session` belongs
 * to no one.
 *
 * @example
 * ```ts
 * import { Session } from 'accounts'
 *
 * if (!Session.same(await accounts.session.get(), before)) throw new Error('Signed out.')
 * ```
 */
export function same<session extends Any>(
  session: session | undefined,
  other: Any,
): session is session {
  return !!session && subject(session) === subject(other)
}

/**
 * Returns whether the session can no longer act: its access key expired, and no access key on another
 * chain lives, or, without an access key, its access token expired and it holds no refresh token. A
 * session without an access key that holds a refresh token never expires here, since its tokens
 * refresh. An instance empties its session at the access key's expiry, as `accounts.session.get()`
 * does for a saved session whose access key expired, so its status changes to `signedOut`.
 *
 * @example
 * ```ts
 * import { Session } from 'accounts'
 *
 * const expired = Session.expired(session)
 * ```
 */
export function expired(session: Any): boolean {
  if (session.accessKey)
    return (
      AccessKey.expired(session.accessKey) &&
      !session.accessKeys?.some((entry) => !AccessKey.expired(entry))
    )
  if (session.accessKeys?.some((entry) => !AccessKey.expired(entry)))
    return false
  if (local(session)) return true
  return !session.refreshToken && session.expiresAt <= Date.now()
}
