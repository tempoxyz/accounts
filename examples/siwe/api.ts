/**
 * The page's sign-in routes and its own API, in the Worker that serves the page. `accounts.handler`
 * serves the SIWE routes under its default `/api`, and keeps each session in a Durable Object. The
 * browser holds only the session ID, in an `HttpOnly` cookie. The API keeps the notes of each account
 * in that account's Durable Object, and deletes them only after the account signs an approval of the
 * deletion.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject as AccountsObject, Sessions } from 'accounts/cloudflare'
import { backend, siwe } from 'accounts/plugins'
import { DurableObject, env } from 'cloudflare:workers'
import { type Context, Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { createMiddleware } from 'hono/factory'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The notes of each account, one object for each account. */
      NOTES: DurableObjectNamespace<Notes>
      /** The Durable Object of each session ID. */
      SESSIONS: Sessions.durableObject.Namespace
    }
  }
}

/** The variables that `auth` sets for the routes after it. */
type Variables = {
  /** The session of the request's cookie, from a SIWE sign-in. */
  session: backend.Session.Siwe
}

/**
 * The notes of one account, in the object's SQLite storage. Each call reads and writes synchronously,
 * so two saves of one account never overwrite each other.
 */
export class Notes extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)',
    )
  }

  /** Returns the account's notes, oldest first. */
  list(): string[] {
    return this.ctx.storage.sql
      .exec<{ text: string }>('SELECT text FROM notes ORDER BY id')
      .toArray()
      .map((row) => row.text)
  }

  /** Adds a note, and returns every note of the account in the same call. */
  add(text: string): string[] {
    this.ctx.storage.sql.exec('INSERT INTO notes (text) VALUES (?)', text)
    return this.list()
  }

  /** Deletes every note of the account. */
  clear(): string[] {
    this.ctx.storage.sql.exec('DELETE FROM notes')
    return []
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
    // Each message names the app's public origin, whatever the request's `Host`.
    siwe({
      origin: process.env.APP_URL,
      statement: 'Sign in to the notes example.',
    }),
  ],
})

/** Refuses a request without a SIWE session, so the page signs in again. */
const auth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const session = await accounts.session.get(c.req.raw)
  if (session?.method !== 'siwe') return c.json({ error: 'invalid_token' }, 401)

  c.set('session', session)
  await next()
})

/**
 * Returns the deletion of every note of the session's account, as the account reads it. Both the
 * challenge and the approval derive it from the session, so an approval deletes only these notes.
 */
function clearing(c: Context<{ Variables: Variables }>) {
  const { address } = c.get('session')
  return {
    resources: [new URL(`/v1/notes?account=${address}`, c.req.url).href],
    statement: `Delete every note of ${address}.`,
  }
}

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/api/*` and
// `/v1/*`.
export default new Hono<{ Variables: Variables }>()
  // POST /api/auth/siwe/challenge, POST /api/auth/siwe/verify, POST /api/auth/logout, and GET /api/auth/session.
  .all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
  // The cookie authenticates `/v1/*`, so another site's form post is refused.
  .use('/v1/*', csrf(), auth)
  .get('/v1/notes', async (c) => {
    const notes = await env.NOTES.getByName(c.get('session').address).list()
    return c.json({ notes })
  })
  .post('/v1/notes', async (c) => {
    const body = await c.req.json<{ text?: unknown }>()
    if (typeof body.text !== 'string' || !body.text.trim())
      return c.json({ error: 'invalid_request' }, 400)

    // The session's account, never a field of the body, names whose notes change.
    const notes = await env.NOTES.getByName(c.get('session').address).add(
      body.text.trim(),
    )
    return c.json({ notes }, 201)
  })
  // The deletion needs the account's signature of its own message, beside the session cookie.
  .post('/v1/notes/clear/challenge', async (c) => {
    const { message } = await accounts.siwe.challenge({
      ...clearing(c),
      request: c.req.raw,
      session: c.get('session'),
    })
    return c.json({ message })
  })
  .post('/v1/notes/clear', async (c) => {
    const body = await c.req.json<{ message?: unknown; signature?: unknown }>()
    if (typeof body.message !== 'string' || typeof body.signature !== 'string')
      return c.json({ error: 'invalid_request' }, 400)

    const refusal = await accounts.siwe
      .approve({
        ...clearing(c),
        message: body.message,
        request: c.req.raw,
        session: c.get('session'),
        signature: body.signature as `0x${string}`,
      })
      .then(
        () => undefined,
        (error: Error) => {
          // An approval that does not verify, such as a spent one, is the caller's fault.
          if (error.name === 'Plugins.siwe.InvalidError') return error.message
          throw error
        },
      )
    if (refusal)
      return c.json({ error: 'access_denied', error_description: refusal }, 403)

    const notes = await env.NOTES.getByName(c.get('session').address).clear()
    return c.json({ notes })
  })
