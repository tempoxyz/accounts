/**
 * The session of a signed-in user, which an instance holds and saves to its store.
 * @module
 */
import * as AccessKey from './AccessKey.js'
import type * as TempoAccount from './TempoAccount.js'
import type { Tokens } from './Tokens.js'
import type { User } from './User.js'

/** The tokens, the user, the app's access key, and the user's Tempo Account. */
export type Session = Tokens & {
  /**
   * The user's Tempo Account that Tempo ID selects for the app, on the instance's chain: the account
   * that the user selected, else the oldest. Absent where the sign-in read no account, such as a
   * sign-in through a redirect, a dialog, or a device.
   */
  account?: TempoAccount.TempoAccount | undefined
  /** The app's access key, with its material. Absent after a sign-in without a key. */
  key?: AccessKey.AccessKey | undefined
  /** The signed-in user, from the ID token. */
  user: User
}

/**
 * The status of an instance's session, with the session to show, which `tempoId.useSession()`
 * returns. It is the state of `tempoId.session.actor`. An authorization of the browser's Tempo ID
 * session, such as `tempoId.authorize`, holds it at `pending`, or at `reauthorizing` while it renews
 * a saved session whose access key expired.
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
 * const session = Session.from({ ...tokens, key, user })
 * ```
 */
export function from(value: Session): Session {
  return value
}

/**
 * Returns whether the session can no longer act: its access key expired, or, without a key, its
 * access token expired and it holds no refresh token. A session without an access key that holds a refresh
 * token never expires here, since its tokens refresh.
 *
 * @example
 * ```ts
 * if (Session.expired(session)) await tempoId.signOut()
 * ```
 */
export function expired(session: Session): boolean {
  if (session.key) return AccessKey.expired(session.key)
  return !session.refreshToken && session.expiresAt <= Date.now()
}
