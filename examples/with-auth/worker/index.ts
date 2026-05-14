import { Handler, Kv } from 'accounts/server'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'

// Re-export the reference Durable Object class so wrangler can wire it up.
export const NonceStorage = Kv.NonceStorage

// `trustProxy` defaults to `true` on Cloudflare Workers because the runtime
// is always edge-fronted (Cloudflare Tunnel in dev, Cloudflare's edge in
// prod sets `x-forwarded-proto: https`).
//
// `Kv.durableObject(env.NONCE_DO)` gives the auth handler a linearizable
// store for one-time-consume SIWE challenge nonces and issued sessions
// across concurrent worker instances.
const auth = Handler.auth({
  path: '/auth',
  store: Kv.durableObject(env.NONCE_DO),
})

const app = new Hono()

app.all('/auth', (c) => auth.fetch(c.req.raw))
app.all('/auth/*', (c) => auth.fetch(c.req.raw))

// Reads the SIWE-issued session and returns the connected address.
// Demonstrates how an authenticated endpoint consumes Handler.auth.
app.get('/me', async (c) => {
  const session = await auth.getSession(c.req.raw)
  if (!session) return c.json({ error: 'unauthenticated' }, 401)
  return c.json({ address: session.address, chainId: session.chainId })
})

export default app
