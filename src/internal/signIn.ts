/**
 * What the sign-in plugins share: the access key of a sign-in, the session that a sign-in's result
 * becomes, and the read of the account that Tempo ID selects for the app.
 * @module
 */
import { RequestError } from '../Id.js'
import type { Permissions } from '../Permissions.js'
import type * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import type * as TempoAccount from '../TempoAccount.js'
import type { Tokens } from '../Tokens.js'
import type { User } from '../User.js'
import * as Api from './api.js'

/**
 * The `accessKey` of a sign-in: what the access key may do, a function that returns it, or `false`
 * for a sign-in without an access key. Absent, the instance's `accessKey` applies.
 */
export type AccessKeyOption =
  | Permissions
  | (() => Permissions | undefined)
  | false
  | undefined

/** Returns the access key of a sign-in, or `undefined` for a sign-in without an access key. */
export function accessKey(
  context: Plugin.Context,
  value: AccessKeyOption,
): Permissions | undefined {
  if (value === false) return undefined
  if (typeof value === 'function') return value()
  if (value) return value
  return context.accessKey()
}

/** Returns the session of a sign-in's result: its tokens, its user, its access key, and its account. */
export function toSession(
  result: Tokens & {
    account?: TempoAccount.TempoAccount | undefined
    key?: Session.Session['key']
    user: User
  },
): Session.Session {
  return Session.from({
    accessToken: result.accessToken,
    ...(result.account ? { account: result.account } : {}),
    expiresAt: result.expiresAt,
    ...(result.idToken !== undefined ? { idToken: result.idToken } : {}),
    ...(result.key ? { key: result.key } : {}),
    ...(result.refreshToken !== undefined
      ? { refreshToken: result.refreshToken }
      : {}),
    user: result.user,
  })
}

/**
 * Returns the user's Tempo Account that `GET /v1/account` lists first for the app, on the
 * instance's chain: the account that the user selected, else the oldest. Returns `undefined` when
 * Tempo ID lists no such chain, the session belongs to another user than `userId`, or the user has
 * no account. It creates no account. A failed read throws `Id.RequestError` marked `signedIn`, since
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
          { credentials: 'include' },
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
