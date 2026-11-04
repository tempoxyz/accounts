/**
 * A Worker that signs in with Tempo ID through a redirect, keeps each session in a Durable Object,
 * and sends OUSD with the session's access key. The browser holds only the session ID, in an
 * `HttpOnly` cookie. The tokens and the key stay on the server.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject } from 'accounts/cloudflare'
import { backend, viem } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The Durable Object of each session ID. */
      SESSIONS: backend.Namespace
    }
  }
}

/** The session of each session ID, in the object's storage. */
export const SESSIONS = DurableObject.sessions(() => ({
  url: process.env.TEMPO_ID_URL,
}))

/**
 * The instance, on Tempo testnet. Without a registration, the app's origin is its client ID. Each
 * sign-in requests an access key that sends up to 100 OUSD for a day.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  clientId: process.env.APP_URL,
  dev: true,
  plugins: [backend({ namespace: env.SESSIONS }), viem()],
  url: process.env.TEMPO_ID_URL,
})

/**
 * The cookies' attributes. The `__Host-` prefix and `Secure` keep a sibling host from setting a
 * session ID of its own.
 */
const cookie = {
  httpOnly: true,
  path: '/',
  prefix: 'host',
  sameSite: 'Lax',
  secure: true,
} as const

export default new Hono()
  // Another site cannot post the app's forms, such as `/send`.
  .use(csrf())
  .get('/', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    const session = id ? await accounts.backend.get({ id }) : undefined
    if (!session) return c.html(html`<a href="/login">Sign in with Tempo</a>`)
    return c.html(html`
      <p>Signed in as ${session.user.email}</p>
      <p>Tempo Account ${session.key?.account}</p>
      <form action="/send" method="post"><button>Send 0.01 OUSD</button></form>
      <form action="/logout" method="post"><button>Sign out</button></form>
    `)
  })
  .get('/login', async (c) => {
    const { id, url } = await accounts.backend.start({
      redirectUri: new URL('/callback', c.req.url).href,
    })
    // The session ID becomes the session's cookie only once the sign-in completes.
    setCookie(c, 'pending', id, { ...cookie, maxAge: 10 * 60 })
    return c.redirect(url, 302)
  })
  .get('/callback', async (c) => {
    const id = getCookie(c, 'pending', 'host')
    deleteCookie(c, 'pending', cookie)
    if (!id) return c.text('Sign-in failed. Start again.', 400)
    await accounts.backend.complete({ id, url: c.req.url })
    setCookie(c, 'sid', id, cookie)
    return c.redirect('/', 302)
  })
  .post('/send', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    const session = id ? await accounts.backend.get({ id }) : undefined
    if (!session) return c.redirect('/', 302)
    // The client signs with this session's key, which no other request reaches.
    const { receipt } = await accounts.viem({ session }).token.transferSync({
      amount: parseUnits('0.01', 6),
      to: '0x000000000000000000000000000000000000dEaD',
      token: Addresses.ousd,
    })
    return c.text(`Sent in ${receipt.transactionHash}.`)
  })
  .post('/logout', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    deleteCookie(c, 'sid', cookie)
    // Revokes the session's refresh token at Tempo ID, and deletes the session.
    if (id) await accounts.backend.end({ id })
    return c.redirect('/', 302)
  })
