import { Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.all('/relay/*', (c) =>
  Handler.relay({
    feePayer: {
      account: privateKeyToAccount(c.env.FEE_PAYER_PRIVATE_KEY),
    },
    path: '/relay',
  }).fetch(c.req.raw),
)

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
