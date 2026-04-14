import { createMiddleware } from 'hono/factory'

import * as Session from './session.js'

/** Requires a valid session — returns 401 if missing. Sets `c.var.session`. */
export function requireSession() {
  return createMiddleware<{
    Bindings: Env
    Variables: { session: Session.DecodedPayload }
  }>(async (c, next) => {
    const session = await Session.fromRequest(c, process.env.SESSION_PUBLIC_KEY!)
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    c.set('session', session)
    await next()
  })
}
