/**
 * The plugin of sign-in in a dialog on the page, a frame of Tempo ID's sign-in, or in a popup.
 * @module
 */
/* istanbul ignore file -- Each action needs a browser window, for the dialog or the popup. */
import * as Actions from '../Actions.js'
import type * as Funding from '../Funding.js'
import * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in in a dialog, which adds `dialog.callback` and `dialog.signIn`. A
 * browser page loads the dialog's frame, hidden, as the instance is created, unless `preload` is
 * `false` or `popup` is `true`.
 *
 * @example
 * ```ts
 * const tempoId = Id.create({ plugins: [dialog()] })
 *
 * button.onclick = () => tempoId.dialog.signIn()
 * ```
 */
export function dialog(options: dialog.Options = {}) {
  const { par, popup = false, preload = true } = options
  // One configuration with `par` for each instance, so its actions and its hooks share the state
  // that the actions keep by configuration, such as the preloaded frame.
  const configs = new WeakMap<
    Plugin.Context['config'],
    Plugin.Context['config']
  >()
  /** Returns the instance's configuration, with `par` when the plugin sets it. */
  function configOf(context: Plugin.Context) {
    if (par === undefined) return context.config
    let config = configs.get(context.config)
    if (!config)
      configs.set(context.config, (config = { ...context.config, par }))
    return config
  }

  return Plugin.from({
    actions: (context) => {
      const config = configOf(context)

      return {
        /**
         * Completes a popup's sign-in on the page of the redirect URI, and closes the popup.
         * Returns whether the page was the callback of a popup.
         */
        callback: (): Promise<boolean> => Actions.dialog.callback(config),
        /** Signs the user in, sets the instance's session, and returns it. */
        async signIn(
          parameters: dialog.signIn.Parameters = {},
        ): Promise<Session.Session> {
          const change = context.session.change()
          const accessKey = SignIn.accessKey(context, parameters.accessKey)
          const result = await Actions.dialog
            .signIn(config, {
              accessKey,
              challenge: parameters.challenge,
              funding: parameters.funding,
              mode: parameters.mode ?? (popup ? 'popup' : 'iframe'),
              signal: parameters.signal,
            })
            .catch(change.fail)
          const session = SignIn.toSession(result)
          await change.commit(session)
          return session
        },
      }
    },
    id: 'dialog',
    setup(context) {
      // The instance can be created outside a browser, such as on a server that renders the page.
      if (popup || !preload || typeof document === 'undefined') return
      Actions.dialog.preload(configOf(context))
    },
  })
}

export declare namespace dialog {
  type Options = {
    /** Whether each request goes to `/oauth2/par` first (RFC 9126). Defaults to the instance's. */
    par?: boolean | undefined
    /** Whether to sign in in a popup window in place of a frame. Defaults to `false`. */
    popup?: boolean | undefined
    /** Whether a browser page loads the dialog's frame as the instance is created. Defaults to `true`. */
    preload?: boolean | undefined
  }

  namespace signIn {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /** A message whose EIP-191 hash the key authorization binds as its `witness`. */
      challenge?: string | undefined
      /**
       * The amount that the app needs in the user's account. If the account holds less, a sign-in in
       * the frame then opens the deposit page in a frame, as `funding.open` does, before it resolves.
       */
      funding?: Funding.Funding | undefined
      /**
       * Whether the sign-in shows in a frame or in a popup window. Defaults to the plugin's `popup`.
       * A popup opens only within a click.
       */
      mode?: 'iframe' | 'popup' | undefined
      /** Rejects the sign-in with the signal's reason, such as on a cancel button. */
      signal?: AbortSignal | undefined
    }
  }
}
