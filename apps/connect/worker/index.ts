import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { auth } from './auth.js'
import { jwks } from './jwks.js'
import { relay } from './relay.js'
import { webauthn } from './webauthn.js'

const api = new Hono<{ Bindings: Env }>()
  .use(async (c, next) => {
    const origin = new URL(c.req.url).origin
    await cors({ origin })(c, next)
    c.res.headers.set('Access-Control-Allow-Origin', origin)
  })
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/auth', auth)
  .route('/relay', relay)
  .route('/webauthn', webauthn)

const app = new Hono<{ Bindings: Env }>().route('/.well-known', jwks).route('/api', api)

export type App = typeof app
export default app
