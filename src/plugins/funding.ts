/**
 * The plugin of Tempo ID's deposit page, which an app opens for the signed-in user's Tempo Account
 * after the sign-in. Every instance holds it, so an app passes it only to set its options.
 * @module
 */
import * as Actions from '../Actions.js'
import * as Core from '../internal/core.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/** The session holds no user, so the deposit page has no account to fund. */
export class SignedOutError extends Error {
  override readonly name = 'Plugins.funding.SignedOutError'

  constructor() {
    super(
      'The instance holds no session, so the deposit page has no account. Sign the user in before `funding.open`.',
    )
  }
}

/**
 * Returns the plugin of the deposit page, which adds `funding.open` and `funding.complete`. Every
 * instance holds it with the default options.
 *
 * @example
 * ```ts
 * const tempoId = Id.create({ plugins: [funding({ mode: 'redirect' })] })
 *
 * const result = await tempoId.funding.open({ amount: '10' })
 * ```
 */
export function funding(options: funding.Options = {}) {
  return Plugin.from({
    actions: (context) => ({
      /**
       * Returns the result of the deposit page that `open` opened with `mode: 'redirect'`, on the
       * redirect URI's page, or `undefined` for a URL without one.
       */
      complete(
        parameters: funding.complete.Parameters = {},
      ): funding.complete.ReturnType {
        return Actions.funding.complete(context.config, {
          redirectUri: parameters.redirectUri ?? options.redirectUri,
          url: parameters.url,
        })
      },
      /**
       * Opens the deposit page for the session's Tempo Account, or for `address`. Call it in a user
       * gesture, such as a click, since a popup opens only within one.
       */
      open(
        parameters: funding.open.Parameters = {},
      ): Promise<funding.open.ReturnType> {
        const chainId = parameters.chainId ?? context.config.chainId
        // The session's account and key belong to the instance's chain, so another chain reads its
        // own account.
        const own = (session: Session.Session | undefined) =>
          chainId === context.config.chainId
            ? (session?.account?.address ?? session?.key?.account)
            : undefined

        // A known address opens the page at once. Any other resolves after the action's checks pass
        // and the popup opens: the store loads the session, and a sign-in that read no account, such
        // as through a redirect, reads it with a live access token.
        const address =
          parameters.address ??
          own(context.session.get()) ??
          (async () => {
            const session =
              context.session.get() ?? (await context.session.load())
            if (!session) throw new SignedOutError()
            const found = own(session)
            if (found) return found

            const account = await Actions.account.get(context.config, {
              accessToken: await accessToken(context, { session }),
              chainId,
            })
            if (!account) throw new SignedOutError()
            return account.address
          })
        return Actions.funding.open(context.config, {
          address,
          amount: parameters.amount,
          chainId: parameters.chainId,
          currency: parameters.currency,
          mode: parameters.mode ?? options.mode,
          redirectUri: parameters.redirectUri ?? options.redirectUri,
          signal: parameters.signal,
          token: parameters.token,
        })
      },
    }),
    id: 'funding',
  })
}

/** Milliseconds before its expiry at which an access token refreshes before an account read. */
const refreshMargin = 30_000

/**
 * Returns a live access token of `options.session`, refreshed through the instance when it expires
 * within {@link refreshMargin}. A session without a refresh token sends its access token until it
 * expires.
 *
 * @throws {SignedOutError} When the access token expired and cannot refresh, or the refresh returns
 * another user's session, or none.
 */
async function accessToken(
  context: Plugin.Context,
  options: accessToken.Options,
) {
  const { session } = options
  if (session.expiresAt - refreshMargin > Date.now()) return session.accessToken
  if (!session.refreshToken) {
    if (session.expiresAt > Date.now()) return session.accessToken
    throw new SignedOutError()
  }

  const refreshed = await Core.refresh(context)
  if (refreshed?.user.id !== session.user.id) throw new SignedOutError()
  return refreshed.accessToken
}

declare namespace accessToken {
  type Options = {
    /** The session whose access token the read sends. */
    session: Session.Session
  }
}

export declare namespace funding {
  type Options = {
    /** `popup` or `redirect` for every `open`. Defaults to `popup`. */
    mode?: 'popup' | 'redirect' | undefined
    /**
     * The registered redirect URI that the deposit page returns to. Defaults to the instance's
     * `redirectUri`, or the page's origin with `/`.
     */
    redirectUri?: string | undefined
  }

  namespace complete {
    type Parameters = Actions.funding.complete.Options
    type ReturnType = Actions.funding.complete.ReturnType | undefined
  }

  namespace open {
    type Parameters = Omit<Actions.funding.open.Options, 'address'> & {
      /** The Tempo Account that receives the deposit. Defaults to the session's account. */
      address?: `0x${string}` | undefined
    }
    type ReturnType = Actions.funding.open.ReturnType
  }
}
