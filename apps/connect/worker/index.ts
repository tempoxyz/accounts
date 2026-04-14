import { Hono } from 'hono'

import { auth } from './auth.js'
import { webauthn } from './webauthn.js'

const app = new Hono<{ Bindings: Env }>()
  .get('/api/health', (c) => c.json({ status: 'ok' }))
  .route('/api/auth', auth)
  .route('/api/webauthn', webauthn)

export type App = typeof app
export default app
