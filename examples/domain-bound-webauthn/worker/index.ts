import { Handler, Kv } from 'accounts/server'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'

const app = new Hono()

app.all('/auth/*', (c) => {
  const origin = c.req.raw.headers.get('origin') ?? new URL(c.req.url).origin
  return Handler.webAuthn({
    kv: Kv.cloudflare(env.KV),
    origin,
    rpId: new URL(origin).hostname,
    path: '/auth',
  }).fetch(c.req.raw)
})

// Reads the WebAuthn-issued session and returns the authenticated credential.
// `Handler.webAuthn` auto-provisions a session on successful login, so this
// endpoint demonstrates how an authenticated route consumes that session.
app.get('/me', async (c) => {
  const origin = c.req.raw.headers.get('origin') ?? new URL(c.req.url).origin
  const session = await Handler.webAuthn({
    kv: Kv.cloudflare(env.KV),
    origin,
    rpId: new URL(origin).hostname,
    path: '/auth',
  }).getSession(c.req.raw)
  if (!session) return c.json({ error: 'unauthenticated' }, 401)
  return c.json({
    credentialId: session.credentialId,
    publicKey: session.publicKey,
    userId: session.userId ?? null,
  })
})

export default app
