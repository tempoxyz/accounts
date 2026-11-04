/**
 * A Worker that signs in with Tempo ID through a redirect, keeps each session in a Durable Object,
 * and sends OUSD with the session's access key. The browser holds only the session ID, in an
 * `HttpOnly` cookie. The tokens and the key stay on the server.
 * @module
 */
import { Accounts } from 'accounts'
import { DurableObject } from 'accounts/cloudflare'
import { backend, viem } from 'accounts/plugins'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'
import { parseUnits } from 'viem'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

/** The Worker's bindings. */
type Env = {
  /** The app's client ID. */
  CLIENT_ID: string
  /** The app's client secret. */
  CLIENT_SECRET: string
  /** The Durable Object of each session ID. */
  SESSIONS: backend.Namespace
  /** Tempo ID's URL. */
  TEMPO_ID_URL: string
}

/** OUSD, at its mainnet address on every Tempo chain. */
const ousd = Tokens.ousd(tempo.id).address

/** The session of each session ID, in the object's storage. */
export const SESSIONS = DurableObject.sessions((env: Env) => ({
  clientSecret: env.CLIENT_SECRET,
  url: env.TEMPO_ID_URL,
}))

/** Returns the request's instance, on Tempo testnet. Each sign-in requests a key for a day. */
function create(env: Env) {
  return Accounts.create({
    accessKey: () => ({
      expiry: Expiry.days(1),
      limits: [{ limit: parseUnits('100', 6), token: ousd }],
      scopes: [Scopes.tip20(ousd).transfer()],
    }),
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET,
    dev: true,
    plugins: [backend({ namespace: env.SESSIONS }), viem()],
    url: env.TEMPO_ID_URL,
  })
}

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

export default new Hono<{ Bindings: Env }>()
  // Another site cannot post the app's forms, such as `/send`.
  .use(csrf())
  .get('/', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    const session = id ? await create(c.env).backend.get({ id }) : undefined
    if (!session) return c.html(html`<a href="/login">Sign in with Tempo</a>`)
    return c.html(html`
      <p>Signed in as ${session.user.email}</p>
      <p>Tempo Account ${session.key?.account}</p>
      <form action="/send" method="post"><button>Send 0.01 OUSD</button></form>
      <form action="/logout" method="post"><button>Sign out</button></form>
    `)
  })
  .get('/login', async (c) => {
    const { id, url } = await create(c.env).backend.start({
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
    await create(c.env).backend.complete({ id, url: c.req.url })
    setCookie(c, 'sid', id, cookie)
    return c.redirect('/', 302)
  })
  .post('/send', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    const tempoId = create(c.env)
    const session = id ? await tempoId.backend.get({ id }) : undefined
    if (!session) return c.redirect('/', 302)
    // The client signs with this session's key, which no other request reaches.
    const { receipt } = await tempoId.viem({ session }).token.transferSync({
      amount: parseUnits('0.01', 6),
      to: '0x000000000000000000000000000000000000dEaD',
      token: ousd,
    })
    return c.text(`Sent in ${receipt.transactionHash}.`)
  })
  .post('/logout', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    deleteCookie(c, 'sid', cookie)
    // Revokes the session's refresh token at Tempo ID, and deletes the session.
    if (id) await create(c.env).backend.end({ id })
    return c.redirect('/', 302)
  })
