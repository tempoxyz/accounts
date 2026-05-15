import { Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.all('/auth/*', (c) => {
  const url = new URL(c.req.url)
  return Handler.webAuthn({
    kv: Kv.cloudflare(c.env.KV),
    origin: url.origin,
    rpId: url.hostname,
    path: '/auth',
  }).fetch(c.req.raw)
})

export default app
