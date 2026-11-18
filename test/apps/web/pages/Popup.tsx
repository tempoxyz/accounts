/**
 * The popup pages of the web test app: a sign-in in a popup window of Tempo ID.
 *
 * | Path         | Page                                                                              |
 * | ------------ | --------------------------------------------------------------------------------- |
 * | `/popup/`    | Tempo ID's page in the popup posts the authorization to the page                  |
 * | `/isolated/` | Sends `Cross-Origin-Opener-Policy: same-origin`, and names the policy             |
 * | `/severed/`  | Sends the header, and names no policy, so the first attempt receives no response  |
 *
 * A page with the header is its own redirect URI: the popup returns to it, and `dialog.callback`
 * posts the callback to the page that opened it.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page, or completes the popup's callback. */
export async function start(options: start.Options = {}) {
  const { crossOriginOpenerPolicy, redirectUri } = options
  const accounts = Accounts.create({
    ...(await App.options()),
    plugins: [
      dialog({
        ...(crossOriginOpenerPolicy ? { crossOriginOpenerPolicy } : {}),
        mode: 'popup',
      }),
      ...App.plugins(),
    ],
    ...(redirectUri ? { redirectUri } : {}),
  })

  // The popup's load of the redirect URI closes the popup, so it renders nothing.
  if (redirectUri && (await accounts.dialog.callback())) return

  App.mount(accounts, {
    actions: {
      'Sign a message': () =>
        accounts.dialog.signMessage({ message: App.message() }),
      'Sign in': async () =>
        App.describe(
          await accounts.dialog.signIn({ ...App.request(), ...App.funding() }),
        ),
      'Sign in with a signal': async () =>
        App.describe(await accounts.dialog.signIn({ signal: App.signal() })),
      'Update the access key to a limit of 50': () =>
        accounts.dialog.updateAccessKey({ limits: [App.limit] }),
    },
  })
}

export declare namespace start {
  type Options = {
    /** The policy that the page's header sends, which the plugin then names. Absent, it names none. */
    crossOriginOpenerPolicy?: 'same-origin' | undefined
    /** The page's own URL, where the popup of a page with the header returns. Defaults to the origin. */
    redirectUri?: string | undefined
  }
}
