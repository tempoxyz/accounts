import { Handler } from 'accounts/server'
import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'

export const relay = new Hono<{ Bindings: Env }>().all('/*', (c) =>
  Handler.relay({
    cors: false,
    feePayer: {
      account: privateKeyToAccount(process.env.RELAY_PRIVATE_KEY as `0x${string}`),
    },
    features: 'all',
    path: '/api/relay',
  }).fetch(c.req.raw),
)
