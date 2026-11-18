/**
 * The sign-in routes and the API of a page that pays and signs in with one click. `accounts.handler`
 * serves the `siwe` plugin's routes under its default `/api`, in the token mode: the verify route
 * returns the session's token, and the page sends it as `Authorization: Bearer <token>`, as a page
 * on another origin than the API would. Each session lives in a Durable Object.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject as AccountsObject, Sessions } from 'accounts/cloudflare'
import { backend, siwe } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The Durable Object of each session ID. */
      SESSIONS: Sessions.durableObject.Namespace
    }
  }
}

/** The session of each session ID, in the object's storage. */
export const SESSIONS = AccountsObject.sessions(() => ({}))

/** The instance. Without a registration, the page's origin is its client ID. */
const accounts = Accounts.create({
  chain: 'testnet',
  clientId: process.env.APP_URL,
  plugins: [
    backend({ sessions: Sessions.durableObject(env.SESSIONS) }),
    // Each message names the page's origin. The routes return a token in place of a cookie, and
    // answer the page's origin with CORS headers, so the API can move to another origin.
    siwe({
      origin: process.env.APP_URL,
      statement: 'Sign in to the pay example.',
      token: true,
    }),
  ],
})

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/api/*` and
// `/v1/*`.
export default new Hono()
  // POST /api/auth/siwe/challenge → { id, message }, POST /api/auth/siwe → { session, token },
  // GET /api/auth/session, and POST /api/auth/logout.
  .all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
  // The bearer token authenticates the request. The browser never adds it, so no CSRF check applies.
  .get('/v1/account', async (c) => {
    const session = await accounts.session.get(c.req.raw)
    if (session?.method !== 'siwe')
      return c.json({ error: 'invalid_token' }, 401)

    return c.json({ account: session.address, expiresAt: session.expiresAt })
  })
