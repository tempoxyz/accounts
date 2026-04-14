import { Hono } from 'hono'

import * as RequestListener from './internal/requestListener.js'

export { codeAuth } from './internal/handlers/codeAuth.js'
export { relay } from './internal/handlers/relay.js'
export { webAuthn } from './internal/handlers/webAuthn.js'

export type Handler = Hono & {
  listener: (req: any, res: any) => void
}

export function compose(handlers: Array<Handler>, options: compose.Options = {}): Handler {
  const path = options.path ?? '/'

  const app = from(options)

  app.all('*', async (c) => {
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith(path)) return new Response('Not Found', { status: 404 })

    url.pathname = url.pathname.replace(path, '')
    for (const handler of handlers) {
      const request = new Request(url, c.req.raw.clone() as RequestInit)
      const response = await handler.fetch(request)
      if (response.status !== 404) return response
    }
    return new Response('Not Found', { status: 404 })
  })

  return app
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
