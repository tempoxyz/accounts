/**
 * Serves the routes of the demos of "Sign-out", under `/api/sign-out`: the sign-in routes of a
 * backend, and a route that only a signed-in request reads.
 * @module
 */
import { Accounts } from 'accounts'
import { backend } from 'accounts/plugins'
import * as Store from './Store.ts'

/** Path that each route of the topic starts with. */
export const path = '/api/sign-out'

/** Creates the backend's instance of the app at `origin`, which is the app's client ID. */
function create(origin: string) {
  return Accounts.create({
    chain: 'testnet',
    clientId: origin,
    handler: { basePath: path },
    plugins: [backend({ store: Store.create({ prefix: 'sign-out:' }) })],
    // Without a registration, Tempo ID returns a deployed origin only to its root. The sign-in
    // runs in the dialog, whose page posts the callback, so no request reaches the root.
    redirectUri: `${origin}/`,
  })
}

/**
 * The instance of each origin that the Worker serves, such as a preview URL. The `backend` plugin
 * holds the refreshes in progress of its sessions, so each origin keeps one instance.
 */
const instances = new Map<string, ReturnType<typeof create>>()

/**
 * Answers a request to a route of the topic.
 *
 * | Route | Result |
 * | --- | --- |
 * | `POST /api/sign-out/auth/login` | Starts a sign-in in the dialog |
 * | `POST /api/sign-out/auth/callback` | Completes the sign-in, and sets the session cookie |
 * | `GET /api/sign-out/auth/session` | Returns the session of the page |
 * | `POST /api/sign-out/auth/logout` | Ends the session, and deletes the session cookie |
 * | `GET /api/sign-out/profile` | Returns the user of the session, or 401 without a session |
 */
export async function fetch(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url)
  const accounts = instances.get(origin) ?? create(origin)
  instances.set(origin, accounts)

  if (pathname.startsWith(`${path}/auth/`))
    return accounts.handler.fetch(request)

  if (pathname === `${path}/profile` && request.method === 'GET') {
    const headers = { 'cache-control': 'no-store' }
    const session = await accounts.session.get(request)
    if (session?.method !== 'tempo-id')
      return Response.json({ error: 'signed_out' }, { headers, status: 401 })
    return Response.json({ email: session.user.email ?? null }, { headers })
  }

  return Response.json({ error: 'not_found' }, { status: 404 })
}
