import { Handler } from 'accounts/server'
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

export default app
