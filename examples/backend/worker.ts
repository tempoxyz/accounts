/**
 * A Worker that signs in with Tempo ID through a redirect, keeps each session in a Durable Object,
 * and pays 1 OUSD with the session's access key. `accounts.handler` serves the sign-in routes. The
 * browser holds only the session ID, in an `HttpOnly` cookie. The tokens and the access key stay on
 * the server.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject, Sessions } from 'accounts/cloudflare'
import { backend, viem } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'

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
export const SESSIONS = DurableObject.sessions(() => ({}))

/**
 * The instance, on Tempo testnet. Without a registration, the app's origin is its client ID. Each
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

export default new Hono()
  // GET /api/auth/login, GET /api/auth/callback, POST /api/auth/logout, and GET /api/auth/session, under the handler's
  // default `/api`. The callback is `/api/auth/callback`.
  .all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
  // Another site cannot post the app's forms, such as `/pay`.
  .use(csrf())
  .get('/', async (c) => {
    const session = await accounts.session.get(c.req.raw)
    if (session?.method !== 'tempo-id')
      return c.html(html`<a href="/api/auth/login">Sign in with Tempo</a>`)
    return c.html(html`
      <p>Signed in as ${session.user.email}</p>
      <p>Tempo Account ${session.accessKey?.account}</p>
      <form action="/pay" method="post"><button>Send 1 OUSD</button></form>
      <button
        onclick="fetch('/api/auth/logout', { method: 'POST' }).then(() => location.reload())"
        type="button"
      >
        Sign out
      </button>
    `)
  })
  .post('/pay', async (c) => {
    const session = await accounts.session.get(c.req.raw)
    if (session?.method !== 'tempo-id') return c.redirect('/', 302)
    // This session's access key signs, which no other request reaches.
    const { transaction } = await accounts.pay({
      amount: '1',
      session,
      to: '0x000000000000000000000000000000000000dEaD',
      token: 'ousd',
    })
    return c.text(`Sent in ${transaction}.`)
  })
