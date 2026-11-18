/**
 * Serves the routes of the demo of "Redirect (Backend)", under `/api/backend`: the sign-in routes of
 * the `backend` plugin, and a route that reads the user of a request's session. The session stays
 * in the store, and the page holds only the session cookie.
 * @module
 */
import { Accounts } from 'accounts'
import { backend } from 'accounts/plugins'
import * as Store from './Store.ts'

/** Path that each route of the topic starts with. */
export const path = '/api/backend'

/**
 * Answers a request to a route of the topic.
 *
 * | Route                            | Result                                               |
 * | -------------------------------- | ---------------------------------------------------- |
 * | `GET /api/backend/me`            | The user of the request's session, or 401 without it |
 * | `GET /api/backend/auth/login`    | A redirect to Tempo ID's sign-in                     |
 * | `GET /api/backend/auth/callback` | The session cookie, and a redirect to `returnTo`     |
 * | `GET /api/backend/auth/session`  | The session that the page reads, or `null`           |
 * | `POST /api/backend/auth/logout`  | 204, after the session ends                          |
 */
export async function fetch(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url)

  // The origin of the request is the client ID, and each deployment has its own, so each request
  // creates its instance. The store holds each session, so the instance holds no state between
  // requests but the refreshes in progress, which a demo's few requests rarely share.
  const accounts = Accounts.create({
    chain: 'testnet',
    clientId: origin,
    handler: { basePath: path },
    plugins: [backend({ store: Store.create({ prefix: 'backend:' }) })],
    // Without a web app manifest, the root is the only redirect URI of an origin. The root page
    // forwards the callback to `GET /api/backend/auth/callback`.
    redirectUri: `${origin}/`,
  })

  if (pathname !== `${path}/me`) return accounts.handler.fetch(request)

  const session = await accounts.session.get(request)
  if (session?.method !== 'tempo-id')
    return Response.json({ error: 'invalid_token' }, { status: 401 })
  return Response.json({ user: session.user })
}
