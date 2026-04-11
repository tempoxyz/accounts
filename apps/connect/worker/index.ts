import { Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.all('/webauthn/*', (c) => {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const origin = `${proto}://${url.hostname}`
  const handler = Handler.webAuthn({
    kv: Kv.cloudflare(c.env.KV),
    origin,
    path: '/webauthn',
    rpId: url.hostname.split('.').slice(-2).join('.'),
  })
  return handler.fetch(c.req.raw)
})

export default app
