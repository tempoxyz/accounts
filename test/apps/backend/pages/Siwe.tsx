/**
 * The SIWE page of the backend test app, at `/siwe/`: a sign-in with a message that the Tempo
 * Account signs in the dialog, and that the backend's `siwe` plugin issues and verifies. The page's
 * own app, a public one, requests each signature. The backend holds the session. A second instance
 * names the backend's routes with the `siwe` plugin's `auth`, so its dialog shows at the click, and
 * the page requests the message while the frame loads, for a sign-in and for a payment. It offers
 * a guest, whose key pair signs the message of a sign-in. A third instance offers a guest without
 * the plugin, and signs nothing.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog, siwe } from 'accounts/plugins'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page. */
export function start() {
  const accounts = Accounts.create({
    ...App.options,
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    plugins: [dialog({ backend: true })],
  })
  // The backend's `POST /api/auth/siwe/challenge` and `POST /api/auth/siwe`.
  const plugin = Accounts.create({
    ...App.options,
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    guest: true,
    plugins: [dialog(), siwe({ auth: '/api/auth/siwe' })],
  })
  // A guest offer without a plugin's challenge.
  const plain = Accounts.create({
    ...App.options,
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    guest: true,
    plugins: [dialog()],
  })

  App.mount({
    actions: {
      // The backend issues an approval's message, the account signs it, and the backend approves.
      Approve: async () => {
        const { body } = await App.post('/app/approval/challenge')
        const signed = await accounts.dialog.signMessage({
          message: body.message,
        })
        return App.post('/app/approval/approve', signed)
      },
      // The address of the plugin's guest account, or `null` before a guest session.
      'Guest account': async () => (await plugin.guest.get()) ?? null,
      Me: () => App.call('/app/me'),
      // A payment without `account` signs the user in to the backend beside it.
      'Pay with the plugin': () =>
        plugin.pay({
          amount: '1',
          memo: 'order-42',
          to: '0x000000000000000000000000000000000000dEaD',
          token: 'ousd',
        }),
      Session: () => App.call('/api/auth/session'),
      // Only the kind and the address show, since a guest session holds no tokens.
      'Sign in as a guest without the plugin': async () => {
        const session = await plain.dialog.signIn()
        return { address: session.address ?? null, kind: session.kind ?? null }
      },
      'Sign in': () => accounts.dialog.signIn({ method: 'siwe' }),
      'Sign in in a popup': () =>
        accounts.dialog.signIn({ method: 'siwe', mode: 'popup' }),
      // Only the verify route's result shows, since the session holds the instance's tokens.
      'Sign in with the plugin': async () => {
        const { auth } = await plugin.dialog.signIn({ accessKey: false })
        return { auth }
      },
      // The spec dispatches `test-app-backend:abort` while the message is pending.
      'Sign in with the plugin and a signal': async () => {
        const controller = new AbortController()
        window.addEventListener(
          'test-app-backend:abort',
          () => controller.abort(new Error('The page ended the sign-in.')),
          { once: true },
        )
        const { auth } = await plugin.dialog.signIn({
          accessKey: false,
          signal: controller.signal,
        })
        return { auth }
      },
      'Sign out': () => App.post('/api/auth/logout'),
    },
  })
}
