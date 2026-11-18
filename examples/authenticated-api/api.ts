/**
 * The page's sign-in routes and its own API, in the Worker that serves the page, so the page calls
 * both at its own origin. `accounts.handler` serves the sign-in routes under its default `/api`,
 * which the page's dialog calls, and keeps each session in a Durable Object. The browser holds only
 * the session ID, in an `HttpOnly` cookie, so no token reaches the page. The API reads the cookie's
 * session, serves the notes of its user from that user's Durable Object, and pays 1 OUSD with the
 * session's access key.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject as AccountsObject, Sessions } from 'accounts/cloudflare'
import { backend, viem } from 'accounts/plugins'
import { DurableObject, env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { createMiddleware } from 'hono/factory'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The notes of each user ID, one object for each user. */
      NOTES: DurableObjectNamespace<Notes>
      /** The Durable Object of each session ID. */
      SESSIONS: Sessions.durableObject.Namespace
    }
  }
}

/** The variables that `auth` sets for the routes after it. */
type Variables = {
  /** The request's session, with its access key. */
  session: backend.Session.TempoId
}

/**
 * The notes of one user, in the object's SQLite storage. Each call reads and writes synchronously,
 * so two saves of one user never overwrite each other.
 */
export class Notes extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)',
    )
  }

  /** Returns the user's notes, oldest first. */
  list(): string[] {
    return this.ctx.storage.sql
      .exec<{ text: string }>('SELECT text FROM notes ORDER BY id')
      .toArray()
      .map((row) => row.text)
  }

  /** Adds a note, and returns every note of the user in the same call. */
  add(text: string): string[] {
    this.ctx.storage.sql.exec('INSERT INTO notes (text) VALUES (?)', text)
    return this.list()
  }
}

/** The session of each session ID, in the object's storage. */
export const SESSIONS = AccountsObject.sessions(() => ({}))

/**
 * The instance, on Tempo testnet. Without a registration, the page's origin is its client ID. Each
 * sign-in requests an access key that sends up to 100 OUSD for a day.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  clientId: process.env.APP_URL,
  plugins: [
    backend({ sessions: Sessions.durableObject(env.SESSIONS) }),
    viem(),
  ],
})

/** Refuses a request without a session, so the page signs in again. */
const auth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const session = await accounts.session.get(c.req.raw)
  if (session?.method !== 'tempo-id')
    return c.json({ error: 'invalid_token' }, 401)

  c.set('session', session)
  await next()
})

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/api/*` and
// `/v1/*`.
export default new Hono()
  // POST /api/auth/login, POST /api/auth/callback, POST /api/auth/logout, and GET /api/auth/session, which the page's
  // `dialog({ backend: true })` calls.
  .all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
  // The cookie authenticates `/v1/*`, so another site's form post is refused.
  .use('/v1/*', csrf(), auth)
  .get('/v1/me', (c) => c.json({ userId: c.get('session').user.id }))
  .get('/v1/notes', async (c) => {
    const notes = await env.NOTES.getByName(c.get('session').user.id).list()
    return c.json({ notes })
  })
  .post('/v1/notes', async (c) => {
    const body = await c.req.json<{ text?: unknown }>()
    if (typeof body.text !== 'string' || !body.text.trim())
      return c.json({ error: 'invalid_request' }, 400)

    // The session's user, never a field of the body, names whose notes change.
    const notes = await env.NOTES.getByName(c.get('session').user.id).add(
      body.text.trim(),
    )
    return c.json({ notes }, 201)
  })
  .post('/v1/pay', async (c) => {
    // The session's access key signs, so the user approves nothing.
    const { transaction } = await accounts.pay({
      amount: '1',
      session: c.get('session'),
      to: '0x000000000000000000000000000000000000dEaD',
      token: 'ousd',
    })
    return c.json({ transaction })
  })
