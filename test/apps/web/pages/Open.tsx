/**
 * The open pages of the web test app: a sign-in through `redirect` with `open`, which shows Tempo
 * ID's sign-in outside the page and resolves with the callback URL, as a system browser does for a
 * native app. A window of the browser stands in for the system browser.
 *
 * | Path              | Page                                                                    |
 * | ----------------- | ----------------------------------------------------------------------- |
 * | `/open/`          | Opens the window, and waits for its callback URL, or for `Dismiss`      |
 * | `/open/callback/` | The redirect URI. Sends its URL to the page that waits, then closes     |
 * @module
 */
import { Accounts } from 'accounts'
import { redirect } from 'accounts/plugins'
import * as App from '../App.js'

/** The channel that carries the callback URL from the window to the page that opened it. */
const channel = 'test-app-web:open'

/** The redirect URI: the page that the window returns to. */
const redirectUri = `${window.location.origin}/open/callback/`

/** Sends the callback URL to the page that waits for it, and closes the window. */
export function callback() {
  new BroadcastChannel(channel).postMessage(window.location.href)
  window.close()
  return Promise.resolve()
}

/** Creates the page's instance, and renders the page. */
export async function start() {
  // Ends the wait of the sign-in that runs with no callback URL, as a dismissed browser does.
  let dismiss = () => {}

  /**
   * Shows `url` in a window, and resolves with the callback URL that the window returns to, or with
   * `undefined` at a dismissal. Tempo ID's pages send `Cross-Origin-Opener-Policy`, which severs the
   * handle to the window, so the page cannot tell when the user closes it.
   */
  function open(url: string) {
    return new Promise<string | undefined>((resolve) => {
      if (!window.open(url, '_blank', 'popup,width=480,height=720'))
        return resolve(undefined)

      const messages = new BroadcastChannel(channel)
      /** Ends the wait with the callback URL, or with none. */
      function settle(value: string | undefined) {
        messages.close()
        resolve(value)
      }
      messages.onmessage = (event: MessageEvent<string>) => settle(event.data)
      dismiss = () => settle(undefined)
    })
  }

  const accounts = Accounts.create({
    ...(await App.options()),
    plugins: [redirect({ open }), ...App.plugins()],
    redirectUri,
  })

  App.mount(accounts, {
    actions: {
      Dismiss: () => Promise.resolve(dismiss()),
      'Sign in': async () =>
        App.describe(await accounts.redirect.signIn(App.request())),
    },
  })
}
