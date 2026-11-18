/**
 * The backend page of the backend test app, at `/`: a sign-in whose session the app's backend holds.
 * The page holds no token. It reads the session through the backend's routes, with the cookie that
 * the sign-in sets. With the query `short=1`, the page signs in to the app whose access tokens are
 * short, under `/short`.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import * as App from '../App.js'

/** The path of the handler's routes, and of the app's own routes. */
const paths = App.query.has('short')
  ? { api: '/short/api', app: '/short/app' }
  : { api: '/api', app: '/app' }

/** Creates the page's instance, and renders the page. */
export function start() {
  const accounts = Accounts.create({
    ...App.options,
    clientId: App.query.has('short')
      ? import.meta.env.VITE_CLIENT_ID_SHORT
      : import.meta.env.VITE_CLIENT_ID,
    plugins: [dialog({ backend: paths.api })],
  })

  App.mount({
    actions: {
      Introspect: () => App.call(`${paths.app}/introspect`),
      'Introspect a forged token': () =>
        App.call(`${paths.app}/introspect?forged=1`),
      'Key set': () => App.call(`${paths.app}/jwks`),
      Me: () => App.call(`${paths.app}/me`),
      // The backend pays with `accounts.pay` and the cookie's session.
      'Pay 2 OUSD': (fields) =>
        App.post(`${paths.app}/pay`, { amount: '2', to: fields['Payee'] }),
      // The session that the page restores on load: the read of the dialog's preload.
      Restore: () => accounts.dialog.session(),
      Session: () => App.call(`${paths.api}/auth/session`),
      'Sign in': () => accounts.dialog.signIn(),
      'Sign in in a popup': () => accounts.dialog.signIn({ mode: 'popup' }),
      // The backend's route starts the sign-in, and its callback returns to this page.
      'Sign in with a redirect': () => {
        const returnTo = `${window.location.pathname}${window.location.search}`
        window.location.assign(
          `${paths.api}/auth/login?${new URLSearchParams({ returnTo })}`,
        )
        return new Promise(() => {})
      },
      'Sign out': () => App.post(`${paths.api}/auth/logout`),
      // No script of the page reads a token, so no value of the page's storage holds one.
      Storage: () => App.storage(),
      // The backend names the access key, since the page holds no session.
      'Update the limit to 50': async () => {
        const [{ body }, { body: me }] = await Promise.all([
          App.call(`${paths.api}/auth/session`),
          App.call(`${paths.app}/me`),
        ])
        return accounts.dialog.updateAccessKey({
          accessKey: me.key,
          account: body.session.account,
          chainId: App.options.chain,
          limits: [{ limit: parseUnits('50', 6), token: Addresses.ousd }],
        })
      },
      'User info': () => App.call(`${paths.app}/userinfo`),
    },
    fields: ['Payee'],
    send: (transfer) => App.post(`${paths.app}/send`, transfer),
  })
}
