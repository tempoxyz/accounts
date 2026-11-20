/**
 * The restore page of the web test app, at `/restore/`: an instance without the `react` plugin, which
 * signs in through the dialog. After the store's first read, the page restores its session with
 * `session.get` and a function `reauthorize`, which authorizes the browser's Tempo ID session through
 * `authorize`, as an app whose query starts the restore after its first render does. The page shows
 * the instance's status in `#status`.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog, email, passkey, redirect } from 'accounts/plugins'
import * as App from '../App.js'

/** Creates the page's instance, shows its status, and restores its session. */
export async function start() {
  const accounts = Accounts.create({
    ...(await App.options()),
    plugins: [dialog(), email(), passkey(), redirect()],
  })

  const status = document.createElement('output')
  status.id = 'status'
  document.body.append(status)
  const show = () => {
    status.textContent = accounts.session.status.get().status
  }
  show()
  accounts.session.status.subscribe(show)

  // The store's first read ends before the restore starts, so the page shows `signedOut` first.
  await accounts.session.get()
  await accounts.session.get({
    reauthorize: async () => (await accounts.authorize()) ?? undefined,
  })
}
