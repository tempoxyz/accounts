/**
 * The connected page of the backend test app, at `/connected/`: an app that opens a connection to
 * an API of the Worker. A sign-in with `resource` leaves the page for Tempo ID's approval of what
 * the API may do, and returns with an access token for the API alone. The page holds no access key.
 * It sends the token to the API's routes, at `/apis/<name>/*`, and the API acts with its own access
 * key of the connection.
 *
 * The page is its own redirect URI, which Tempo ID matches exactly, so the page keeps the name of
 * the API of its last sign-in in the session storage.
 * @module
 */
import { Accounts } from 'accounts'
import { redirect } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as App from '../App.js'

/** The registered resource of each API, by the name of its routes. */
const resources = {
  deferred: import.meta.env.VITE_RESOURCE_DEFERRED as string,
  prepared: import.meta.env.VITE_RESOURCE_PREPARED as string,
} as const

/** The key of the session storage that holds the name of the API of the last sign-in. */
const storageKey = 'test-app-backend:api'

/** Creates the page's instance, and renders the page. */
export function start() {
  // The API holds the connection's access key, so the page requests none of its own.
  const accounts = Accounts.create({
    ...App.options,
    accessKey: false,
    clientId: import.meta.env.VITE_CLIENT_ID_PAGE,
    plugins: [redirect(), react()],
    redirectUri: `${window.location.origin}/connected/`,
  })

  /**
   * Sends a request to the API of the last sign-in with the session's access token, and returns the
   * response's status and JSON body.
   */
  async function api(path: string, init: RequestInit = {}) {
    const response = await accounts.session.fetch({
      init,
      url: new URL(
        `/apis/${sessionStorage.getItem(storageKey)}${path}`,
        window.location.origin,
      ),
    })
    const text = await response.text()
    return { body: text ? JSON.parse(text) : null, status: response.status }
  }

  /** Sends a JSON body to the API, as {@link api} does. */
  function post(path: string, body: unknown = {}) {
    return api(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  }

  /** Leaves the page for a sign-in whose tokens are for the API `name`. */
  function signIn(name: keyof typeof resources) {
    sessionStorage.setItem(storageKey, name)
    return accounts.redirect.signIn({ resource: resources[name] })
  }

  App.mount({
    actions: {
      // The API redeems the connection's allowance, or claims its prepared access key.
      Connect: () => api('/connection'),
      // The app's own connection to the user, which Tempo ID returns for a token of its own.
      Connection: () => accounts.connection.get(),
      Disconnect: () => accounts.connection.disconnect(),
      'Replay the access key request': () => post('/replay'),
      'Revoke the access key': (fields) =>
        post('/revoke-access-key', { accessKey: fields['Access key'] ?? '' }),
      'Revoke the connection': () => post('/revoke'),
      Session: async () => {
        const session = await accounts.session.get()
        if (!session) return null
        return { email: session.user.email, key: session.accessKey ?? null }
      },
      // The tokens of a sign-in without `resource` are for Tempo ID's own routes.
      'Sign in': () => {
        sessionStorage.removeItem(storageKey)
        return accounts.redirect.signIn()
      },
      'Sign in for the deferred API': () => signIn('deferred'),
      'Sign in for the prepared API': () => signIn('prepared'),
      // The API reads the connection that it holds, and redeems nothing.
      Stored: () => api('/stored'),
    },
    fields: ['Access key'],
    send: (transfer) => post('/send', transfer),
    useStatus() {
      const { session, status } = accounts.useSession()
      return { email: session?.user.email, status }
    },
  })
}
