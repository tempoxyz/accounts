import { Hono } from 'hono'
import type { ExtractSchema, MergeSchemaPath, Schema } from 'hono/types'

import type { UnionToIntersection } from '../internal/types.js'
import * as RequestListener from './internal/requestListener.js'

export { codeAuth } from './internal/handlers/codeAuth.js'
export { exchange } from './internal/handlers/exchange.js'
export { relay } from './internal/handlers/relay.js'
export { webAuthn } from './internal/handlers/webAuthn.js'

/**
 * A request handler. Generic over the underlying Hono app shape so chained
 * route definitions (`.post`, `.get`, …) can flow their type information
 * through to consumers — most notably for Hono's typed RPC client
 * (`hc<typeof handler>`).
 */
export type Handler<app extends Hono<any, any, any> = Hono> = app & {
  listener: (req: any, res: any) => void
}

/**
 * Merges the route schemas of every sub-handler into a single Hono schema,
 * prefixing each route key with `path`. Used by `compose()` to preserve
 * typed routes for Hono's RPC client (`hc`).
 */
export type ComposedSchema<subs extends readonly unknown[], path extends string> =
  UnionToIntersection<
    subs[number] extends infer sub
      ? sub extends unknown
        ? MergeSchemaPath<Extract<ExtractSchema<sub>, Schema>, path>
        : never
      : never
  > extends infer schema extends Schema
    ? schema
    : never

/**
 * Mounts each sub-handler onto a fresh Hono app at `path` (default `/`) and
 * returns a single composed handler. Routes are dispatched by Hono's trie
 * — a deterministic match per path — instead of the older "try each handler
 * in order until one returns non-404" loop.
 *
 * The returned handler preserves each sub-handler's route schema so the
 * composed app stays usable from Hono's typed RPC client:
 *
 * ```ts
 * import { hc } from 'hono/client'
 *
 * const app = Handler.compose(
 *   [Handler.exchange(), Handler.codeAuth({ store })],
 *   { path: '/api' },
 * )
 * type App = typeof app
 *
 * const client = hc<App>('https://wallet.example.com')
 * await client.api.exchange.quote.$post({ json: { ... } }) // typed
 * ```
 */
export function compose<const subs extends readonly Handler[], const path extends string = '/'>(
  handlers: subs,
  options: compose.Options & { path?: path } = {},
): Handler<Hono<{}, ComposedSchema<subs, path>, '/'>> {
  const mountPath = (options.path ?? '/') as path

  const app = from(options) as unknown as Hono
  for (const sub of handlers) app.route(mountPath, sub)
  app.notFound(() => new Response('Not Found', { status: 404 }))

  return app as never
}

export declare namespace compose {
  export type Options = from.Options & {
    /** The path to use for the handler. */
    path?: string | undefined
  }
}

/**
 * Instantiates a new request handler.
 *
 * @param options - constructor options
 * @returns Handler instance
 */
export function from(options: from.Options = {}): Handler {
  const corsHeaders = corsToHeaders(options.cors)
  const mergedHeaders = new Headers(corsHeaders)
  for (const [key, value] of normalizeHeaders(options.headers).entries())
    mergedHeaders.set(key, value)

  const app = new Hono()

  app.use(async (c, next) => {
    if (c.req.method === 'OPTIONS') return new Response(null, { headers: mergedHeaders })
    await next()
    for (const [key, value] of mergedHeaders.entries()) c.res.headers.set(key, value)
  })

  return Object.assign(app, {
    listener: RequestListener.fromFetchHandler((request) => app.fetch(request)),
  }) as never
}

export declare namespace from {
  export type Options = {
    /**
     * CORS configuration.
     * - `true` (default): Allow all origins with default methods/headers
     * - `false`: Disable CORS headers
     * - Object: Custom CORS configuration
     */
    cors?: boolean | Cors | undefined
    /** Headers to add to the response. */
    headers?: Headers | Record<string, string> | undefined
  }

  export type Cors = {
    /** Allowed origins. Defaults to `'*'`. */
    origin?: string | string[] | undefined
    /** Allowed methods. Defaults to `'GET, POST, PUT, DELETE, OPTIONS'`. */
    methods?: string | undefined
    /** Allowed headers. Defaults to `'Content-Type'`. */
    headers?: string | undefined
    /** Whether to allow credentials. */
    credentials?: boolean | undefined
    /** Headers to expose to the browser. */
    exposeHeaders?: string | undefined
    /** Max age for preflight cache in seconds. */
    maxAge?: number | undefined
  }
}

function normalizeHeaders(headers?: Headers | Record<string, string>): Headers {
  if (!headers) return new Headers()
  if (headers instanceof Headers) return headers
  return new Headers(headers)
}

function corsToHeaders(cors?: boolean | from.Cors): Headers {
  if (cors === false) return new Headers()

  const config = cors === true || cors === undefined ? {} : cors

  const headers = new Headers()
  const origin = Array.isArray(config.origin) ? config.origin.join(', ') : (config.origin ?? '*')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', config.methods ?? 'GET, POST, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', config.headers ?? 'Content-Type')
  if (config.credentials) headers.set('Access-Control-Allow-Credentials', 'true')
  if (config.exposeHeaders) headers.set('Access-Control-Expose-Headers', config.exposeHeaders)
  if (config.maxAge !== undefined) headers.set('Access-Control-Max-Age', String(config.maxAge))

  return headers
}
