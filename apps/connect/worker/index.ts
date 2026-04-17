import { withSentry } from '@sentry/cloudflare'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { auth } from './auth.js'
import { bridge } from './bridge.js'
import { email } from './email.js'
import { jwks } from './jwks.js'
import { handleGeoBlock } from './lib/geo-block.js'
import * as PostHogProxy from './lib/posthog-proxy.js'
import * as SentryTunnel from './lib/sentry-tunnel.js'
import { relay } from './relay.js'
import { webauthn } from './webauthn.js'

type RuntimeEnv = Env & {
  ASSETS: {
    fetch: typeof fetch
  }
  SENTRY_DSN?: string | undefined
}

const api = new Hono<{ Bindings: Env }>()
  .use(async (c, next) => {
    const origin = new URL(c.req.url).origin
    await cors({ origin })(c, next)
    c.res.headers.set('Access-Control-Allow-Origin', origin)
  })
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/auth', auth)
  .route('/bridge', bridge)
  .route('/email', email)
  .route('/relay', relay)
  .route('/webauthn', webauthn)

/** Top-level connect Worker app. */
export const app = new Hono<{ Bindings: Env }>()
  .all('/pho', (c) => PostHogProxy.handle(c.req.raw))
  .all('/pho/*', (c) => PostHogProxy.handle(c.req.raw))
  .all('/sentry-tunnel', (c) => SentryTunnel.handle(c.req.raw))
  .use(async (c, next) => {
    const blocked = handleGeoBlock(c.req.raw)
    if (blocked) return blocked
    await next()
  })
  .route('/.well-known', jwks)
  .route('/api', api)
  .notFound((c) => {
    const request = c.req.raw
    if (isViewPath(new URL(request.url).pathname))
      return (c.env as RuntimeEnv).ASSETS.fetch(request)
    return c.text('Not Found', 404)
  })

export type App = typeof app
export { app }

const handler: ExportedHandler<RuntimeEnv> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
}

function isViewPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/design' ||
    pathname === '/rpc' ||
    pathname.startsWith('/design/') ||
    pathname.startsWith('/rpc/')
  )
}

export default withSentry(
  (env: RuntimeEnv) => ({
    dsn: env.SENTRY_DSN,
    enabled: !!env.SENTRY_DSN,
    initialScope: {
      tags: {
        tempo_app_id: 'connect',
        tempo_runtime: 'worker',
      },
    },
    tracesSampleRate: 0.1,
  }),
  handler,
) as ExportedHandler<RuntimeEnv>
