import { Hono } from 'hono'

import * as Middleware from './lib/middleware.js'

export const auth = new Hono<{ Bindings: Env }>()
  /** `GET /me` — return the current session's address. */
  .get('/me', Middleware.requireSession(), (c) => {
    return c.json({ address: c.var.session.address })
  })
