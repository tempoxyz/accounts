import {
  createRouter,
  type Middleware,
  type Router,
  type RouterOptions,
} from '@remix-run/fetch-router'
import { RpcRequest, RpcResponse } from 'ox'
import { type Chain, type Client, createClient, type Transport } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { signTransaction } from 'viem/actions'
import { Formatters, Transaction } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import * as RequestListener from './internal/requestListener.js'

export type Handler = Router & {
  listener: (req: any, res: any) => void
}

export function compose(handlers: Handler[], options: compose.Options = {}): Handler {
  const path = options.path ?? '/'

  return from({
    ...options,
    async defaultHandler(context) {
      const url = new URL(context.request.url)
      if (!url.pathname.startsWith(path)) return new Response('Not Found', { status: 404 })

      url.pathname = url.pathname.replace(path, '')
      for (const handler of handlers) {
        const request = new Request(url, context.request.clone())
        const response = await handler.fetch(request)
        if (response.status !== 404) return response
      }
      return new Response('Not Found', { status: 404 })
    },
  })
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

  const router = createRouter({
    ...options,
    middleware: [headers(mergedHeaders), preflight(mergedHeaders)],
  })

  return {
    ...router,
    listener: RequestListener.fromFetchHandler((request) => {
      return router.fetch(request)
    }),
  }
}

export declare namespace from {
  export type Options = RouterOptions & {
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
    /** Max age for preflight cache in seconds. */
    maxAge?: number | undefined
  }
}

/**
 * Instantiates a fee payer service request handler that can be used to
 * sponsor the fee for user transactions.
 *
 * @example
 * ### Cloudflare Worker
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * export default {
 *   fetch(request) {
 *     return Handler.feePayer({
 *       account: privateKeyToAccount('0x...'),
 *       client,
 *     }).fetch(request)
 *   }
 * }
 * ```
 *
 * @example
 * ### Next.js
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * export GET = handler.fetch
 * export POST = handler.fetch
 * ```
 *
 * @example
 * ### Hono
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * const app = new Hono()
 * app.all('*', handler)
 *
 * export default app
 * ```
 *
 * @example
 * ### Node.js
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * const server = createServer(handler.listener)
 * server.listen(3000)
 * ```
 *
 * @example
 * ### Bun
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: tempoTestnet.extend({
 *     feeToken: '0x20c0000000000000000000000000000000000001',
 *   }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * Bun.serve(handler)
 * ```
 *
 * @example
 * ### Deno
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * Deno.serve(handler)
 * ```
 *
 * @example
 * ### Express
 *
 * ```ts
 * import { createClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo } from 'viem/chains'
 * import { Handler } from 'zyzz/server'
 *
 * const client = createClient({
 *   chain: tempoTestnet.extend({ feeToken: '0x20c0000000000000000000000000000000000001' }),
 *   transport: http(),
 * })
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   client,
 * })
 *
 * const app = express()
 * app.use(handler.listener)
 * app.listen(3000)
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function feePayer(options: feePayer.Options) {
  const { account, onRequest, path = '/' } = options

  const client = (() => {
    if ('client' in options) return options.client!
    if ('chain' in options && 'transport' in options)
      return createClient({
        chain: options.chain,
        transport: options.transport,
      })
    throw new Error('No client or chain provided')
  })()

  const router = from(options)

  router.post(path, async ({ request: req }) => {
    const request = RpcRequest.from((await req.json()) as any)

    try {
      await onRequest?.(request)

      if (request.method === 'eth_signTransaction') {
        const transactionRequest = Formatters.formatTransaction(request.params?.[0] as never)

        const serializedTransaction = await signTransaction(client, {
          ...transactionRequest,
          account,
          // @ts-expect-error
          feePayer: account,
        })

        return Response.json(RpcResponse.from({ result: serializedTransaction }, { request }))
      }

      if ((request as any).method === 'eth_signRawTransaction') {
        const serialized = request.params?.[0] as `0x76${string}`
        const transaction = Transaction.deserialize(serialized)

        const serializedTransaction = await signTransaction(client, {
          ...transaction,
          account,
          // @ts-expect-error
          feePayer: account,
        })

        return Response.json(RpcResponse.from({ result: serializedTransaction }, { request }))
      }

      if (
        request.method === 'eth_sendRawTransaction' ||
        request.method === 'eth_sendRawTransactionSync'
      ) {
        const serialized = request.params?.[0] as `0x76${string}`
        const transaction = Transaction.deserialize(serialized)

        const serializedTransaction = await signTransaction(client, {
          ...transaction,
          account,
          // @ts-expect-error
          feePayer: account,
        })

        const result = await client.request({
          method: request.method,
          params: [serializedTransaction],
        })

        return Response.json(RpcResponse.from({ result }, { request }))
      }

      return Response.json(
        RpcResponse.from(
          {
            error: new RpcResponse.MethodNotSupportedError({
              message: `Method not supported: ${request.method}`,
            }),
          },
          { request },
        ),
      )
    } catch (error) {
      return Response.json(
        RpcResponse.from(
          {
            error: new RpcResponse.InternalError({
              message: (error as Error).message,
            }),
          },
          { request },
        ),
      )
    }
  })

  return router
}

export declare namespace feePayer {
  export type Options = from.Options & {
    /** Account to use as the fee payer. */
    account: LocalAccount
    /** Function to call before handling the request. */
    onRequest?: (request: RpcRequest.RpcRequest) => Promise<void>
    /** Path to use for the handler. */
    path?: string | undefined
  } & OneOf<
      | {
          /** Client to use. */
          client: Client
        }
      | {
          /** Chain to use. */
          chain: Chain
          /** Transport to use. */
          transport: Transport
        }
    >
}

/** @internal */
function normalizeHeaders(headers?: Headers | Record<string, string>): Headers {
  if (!headers) return new Headers()
  if (headers instanceof Headers) return headers
  return new Headers(headers)
}

/** @internal */
function corsToHeaders(cors?: boolean | from.Cors): Headers {
  if (cors === false) return new Headers()

  const config = cors === true || cors === undefined ? {} : cors

  const headers = new Headers()
  const origin = Array.isArray(config.origin) ? config.origin.join(', ') : (config.origin ?? '*')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', config.methods ?? 'GET, POST, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', config.headers ?? 'Content-Type')
  if (config.credentials) headers.set('Access-Control-Allow-Credentials', 'true')
  if (config.maxAge !== undefined) headers.set('Access-Control-Max-Age', String(config.maxAge))

  return headers
}

/** @internal */
function headers(headers: Headers): Middleware {
  return async (_, next) => {
    const response = await next()
    const responseHeaders = new Headers(response.headers)
    for (const [key, value] of headers.entries()) responseHeaders.set(key, value)
    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    })
  }
}

/** @internal */
function preflight(headers: Headers): Middleware {
  return async (context) => {
    if (context.request.method === 'OPTIONS') return new Response(null, { headers })
  }
}
