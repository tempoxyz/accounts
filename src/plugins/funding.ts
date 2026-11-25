/**
 * The plugin of Tempo ID's deposit page, which an app opens for the signed-in user's Tempo Account
 * after the sign-in. Every instance holds it, so an app passes it only to set its options.
 * @module
 */
import * as AccountActions from '../actions/account.js'
import * as FundingActions from '../actions/funding.js'
import { LocalSessionError } from '../Accounts.js'
import * as ClientId from '../internal/ClientId.js'
import * as Core from '../internal/Core.js'
import * as Popup from '../internal/Popup.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'

/**
 * The session holds no user, so the deposit page has no account to fund. `funding.open` throws it
 * when the instance holds no session, or the read of the session's account returns none. The fix is
 * a sign-in before the call.
 */
export class SignedOutError extends Error {
  override readonly name = 'Plugins.funding.SignedOutError'

  constructor() {
    super(
      'The instance holds no session, so the deposit page has no account. Sign the user in before `funding.open`.',
    )
  }
}

/**
 * Returns the plugin of Tempo ID's deposit page, which adds `funding.open`, `funding.preload`, and
 * `funding.complete`. Every instance holds it with the default options, so an app passes it only to
 * set them. `open` opens the deposit page for the session's Tempo Account, in a frame, in a popup,
 * or through a redirect. `preload` loads the frame ahead of `open`, so the dialog shows the page at
 * once. The page returns to one of the app's registered redirect URIs, as
 * [Deposit page of an app](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-page-of-an-app)
 * describes.
 *
 * The plugin needs a browser page, for the popup or the redirect.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { funding } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   plugins: [funding({ redirectUri: 'https://app.example/wallet' })],
 * })
 *
 * button.addEventListener('click', async () => {
 *   const result = await accounts.funding.open({ amount: '10', currency: 'USD' })
 *   if (result?.status === 'received') await refreshBalance()
 * })
 * ```
 */
export function funding(options: funding.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      // The last account that `resolve` read, so a `preload` and its `open` read it once. A new
      // session, such as after a refresh or a sign-out, reads it again.
      let read:
        | {
            address: `0x${string}`
            chainId: number
            session: Session.Any
          }
        | undefined
      /**
       * Returns the session's Tempo Account on `chainId`, or the read that returns it. The
       * session's account belongs to the instance's chain, and each access key to its own chain, so
       * a chain without either reads its own account. A third-party app reads none, and the read
       * returns `undefined`, so the deposit page chooses the account.
       */
      const resolve = (chainId: number) => {
        const own = (session: Session.Any | undefined) => {
          const held =
            (chainId === context.config.chainId
              ? session?.account?.address
              : undefined) ??
            [session?.accessKey, ...(session?.accessKeys ?? [])].find(
              (entry) => entry && Number(entry.chainId) === chainId,
            )?.account
          if (held) return held
          if (session && read?.session === session && read.chainId === chainId)
            return read.address
          return undefined
        }

        // The store loads the session, and a sign-in that read no account, such as through a
        // redirect, reads it with a live access token.
        return (
          own(context.session.get()) ??
          (async () => {
            const session =
              context.session.get() ?? (await context.session.load())
            if (!session) throw new SignedOutError()
            const found = own(session)
            if (found) return found
            // Tempo ID refuses a third-party app's access token on the account read, and grants its
            // page no CORS for the read. The deposit page holds the user's session, so it chooses.
            if (ClientId.thirdParty(context.config.clientId)) return undefined

            const account = await AccountActions.get(context.config, {
              accessToken: await accessToken(context, { session }),
              chain: chainId,
            })
            if (!account) throw new SignedOutError()
            read = { address: account.address, chainId, session }
            return account.address
          })
        )
      }

      return {
        /**
         * Returns the result of the deposit page that `open` opened with `mode: 'redirect'`, on the
         * redirect URI's page, or `undefined` for a URL without one. Without `url`, it reads the
         * page's URL, and removes the result from the address bar. Outside a browser page, such as
         * in a server render or a React Native app, a call without `url` returns `undefined`.
         *
         * @example
         * ```ts
         * const result = accounts.funding.complete()
         * ```
         */
        complete(
          parameters: funding.complete.Parameters = {},
        ): funding.complete.ReturnType {
          return FundingActions.complete(context.config, {
            redirectUri: parameters.redirectUri ?? options.redirectUri,
            url: parameters.url,
          })
        },
        /**
         * Opens the deposit page for the session's Tempo Account, or for `address`, and returns its
         * result, or `undefined` in `redirect` mode. Call it in a user gesture, such as a click,
         * since a popup opens only within one.
         *
         * `address` defaults to the session's account on the instance's chain, else to the account
         * of the session's access key on the call's chain, from `accessKey` or `accessKeys`.
         * Otherwise, after the popup opens, `open` loads the stored session and reads the account
         * on the call's chain with a live access token. It refreshes a token that expires within 30
         * seconds. A third-party app, such as one whose client ID is its origin, reads no account,
         * since Tempo ID returns accounts only to a first-party app. Its deposit page then funds the
         * user's oldest account that receives deposits. A popup that the user closes before the
         * address loads returns `closed`.
         * @throws {SignedOutError} When the instance holds no session, or the read of the session's
         *   account returns none. Sign the user in first.
         * @throws {Actions.funding.BlockedError} When the browser blocks the popup, such as for a
         *   call outside a user gesture, or after an `await` in the click handler.
         * @throws {Actions.funding.OriginError} In `frame` or `popup` mode, before the page opens,
         *   when the redirect URI is not on the page's origin.
         * @throws {Actions.funding.PageRequiredError} Outside a browser page, such as on a server,
         *   in a CLI, or in a React Native app, before it reads the account.
         *
         * @example
         * ```ts
         * const result = await accounts.funding.open({ amount: '10', token: 'USDC.e' })
         * ```
         */
        open(
          parameters: funding.open.Parameters = {},
        ): Promise<funding.open.ReturnType> {
          // A known address opens the page at once. Any other resolves after the action's checks pass
          // and the popup opens.
          return FundingActions.open(context.config, {
            address:
              parameters.address ??
              resolve(parameters.chainId ?? context.config.chainId),
            amount: parameters.amount,
            chainId: parameters.chainId,
            currency: parameters.currency,
            mode: parameters.mode ?? options.mode,
            redirectUri: parameters.redirectUri ?? options.redirectUri,
            signal: parameters.signal,
            token: parameters.token,
          })
        },
        /**
         * Loads the deposit page of a later `open` in `frame` mode, in a hidden dialog, for the
         * session's Tempo Account, or for `address`. So `open` shows the page at once, without a
         * skeleton. Call it once the user signs in, or when the pointer enters the deposit button.
         * It takes the parameters of `open`, except `mode` and `signal`, and resolves once the
         * frame starts to load.
         *
         * The next `open` of the same deposit page takes the frame: the same address, `amount`,
         * `currency`, `token`, chain, and redirect URI. Each frame serves one `open`. An `open` of
         * another page or in another mode, a `preload` of another page, and a sign-out close the
         * frame. It loads nothing without a session, outside a browser page, and with the plugin's
         * `mode` set to `popup` or `redirect`. It also loads nothing on a page that is not on the
         * redirect URI's origin, and where `open` opens a popup in place of the frame.
         *
         * The frame loads the page as `open` does. So it reads the account, and on Tempo mainnet
         * the universal deposit address, which Tempo ID creates on its first read.
         *
         * @example
         * ```ts
         * await accounts.funding.preload({ amount: '10' })
         *
         * button.addEventListener('click', () => accounts.funding.open({ amount: '10' }))
         * ```
         */
        async preload(
          parameters: funding.preload.Parameters = {},
        ): Promise<void> {
          if (typeof document === 'undefined') return
          if ((options.mode ?? 'frame') !== 'frame') return
          // Where the action loads no frame, the preload reads no account either: a redirect URI
          // of another origin, and Buy MACH that opens in a popup.
          const chainId = parameters.chainId ?? context.config.chainId
          const redirectUri =
            parameters.redirectUri ??
            options.redirectUri ??
            context.config.redirectUri ??
            `${window.location.origin}/`
          if (new URL(redirectUri).origin !== window.location.origin) return
          if (
            Popup.coinflow({
              amount: parameters.amount,
              chainId,
              token: parameters.token,
            })
          )
            return
          // The deposit page shows only the signed-in user's accounts, so without a session the
          // preload loads nothing, also for an explicit address.
          if (!(await context.session.load().catch(() => undefined))) return
          const found = parameters.address ?? resolve(chainId)
          // A preload is an optimization, so a failed read of the account loads nothing, and `open`
          // reports the failure.
          const address =
            typeof found === 'string' ? found : await found().catch(() => null)
          if (address === null) return
          // A sign-out that runs, or ran during the reads, discards before this frame exists, so the
          // preload loads nothing. A later sign-out finds the action's entry, which it sets at once.
          if (await context.session.ended()) return
          if (!context.session.get()) return
          await FundingActions.preload(context.config, {
            address,
            amount: parameters.amount,
            chainId: parameters.chainId,
            currency: parameters.currency,
            redirectUri,
            token: parameters.token,
          })
        },
      }
    },
    // The preloaded frame shows the page of the session that loaded it, so a sign-out closes it: at
    // its start here, which runs also when the sign-out rejects, and after one in another tab.
    hooks: {
      afterSignOut(context) {
        FundingActions.discard(context.config)
      },
      beforeSignOut(context) {
        FundingActions.discard(context.config)
      },
    },
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
  if (Session.local(session)) throw new LocalSessionError()
  if (session.expiresAt - refreshMargin > Date.now()) return session.accessToken
  if (!session.refreshToken) {
    if (session.expiresAt > Date.now()) return session.accessToken
    throw new SignedOutError()
  }

  const refreshed = await Core.refresh(context, { margin: refreshMargin })
  if (!Session.same(refreshed, session)) throw new SignedOutError()
  return refreshed.accessToken
}

declare namespace accessToken {
  type Options = {
    /** The session whose access token the read sends. */
    session: Session.Any
  }
}

export declare namespace funding {
  type Options = {
    /**
     * `frame`, `popup`, or `redirect` for every `open`, as `Actions.funding.open` takes it, unless
     * the call passes `mode`. Defaults to `frame`.
     */
    mode?: 'frame' | 'popup' | 'redirect' | undefined
    /**
     * The registered redirect URI that the deposit page returns to, unless the call passes
     * `redirectUri`. Defaults to the instance's `redirectUri`, or the page's origin with `/`.
     */
    redirectUri?: string | undefined
  }

  namespace complete {
    type Parameters = FundingActions.complete.Options
    type ReturnType = FundingActions.complete.ReturnType | undefined
  }

  namespace open {
    type Parameters = Omit<FundingActions.open.Options, 'address'> & {
      /**
       * The Tempo Account that receives the deposit. It must be one of the signed-in user's
       * accounts in the `default` realm, or the page shows that it found no wallet. Defaults to the
       * session's account, else the account of the access key on the deposit's chain. For a
       * third-party app without either, the page funds the user's oldest account that receives
       * deposits.
       */
      address?: `0x${string}` | undefined
    }
    type ReturnType = FundingActions.open.ReturnType
  }

  namespace preload {
    type Parameters = Omit<FundingActions.preload.Options, 'address'> & {
      /** The Tempo Account that receives the deposit. Defaults as the `address` of `open` does. */
      address?: `0x${string}` | undefined
    }
  }
}
