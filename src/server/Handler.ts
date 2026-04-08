import { Hono } from 'hono'
import { Base64, Bytes, Hex, RpcRequest, RpcResponse } from 'ox'
import { Credential } from 'ox/webauthn'
import { type Chain, type Client, createClient, http, type Transport } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { signTransaction } from 'viem/actions'
import { tempo, tempoModerato } from 'viem/chains'
import { Transaction } from 'viem/tempo'
import {
  Authentication,
  Registration,
  type Registration as Registration_Types,
} from 'webauthx/server'
import * as z from 'zod/mini'

import * as CliAuth from './CliAuth.js'
import * as RequestListener from './internal/requestListener.js'
import type { Kv } from './Kv.js'

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

/**
 * Instantiates a fee payer service request handler that can be used to
 * sponsor the fee for user transactions.
 *
 * @example
 * ### Cloudflare Worker
 *
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * export default {
 *   fetch(request) {
 *     return Handler.feePayer({
 *       account: privateKeyToAccount('0x...'),
 *     }).fetch(request)
 *   }
 * }
 * ```
 *
 * @example
 * ### Next.js
 *
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
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
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
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
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
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
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 * })
 *
 * Bun.serve(handler)
 * ```
 *
 * @example
 * ### Deno
 *
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 * })
 *
 * Deno.serve(handler)
 * ```
 *
 * @example
 * ### Express
 *
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 * })
 *
 * const app = express()
 * app.use(handler.listener)
 * app.listen(3000)
 * ```
 *
 * @example
 * ### Custom chains & transports
 *
 * ```ts
 * import { http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { tempo, tempoModerato } from 'viem/chains'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 *   chains: [tempo, tempoModerato],
 *   transports: {
 *     [tempo.id]: http('https://rpc.tempo.xyz'),
 *     [tempoModerato.id]: http('https://rpc.moderato.tempo.xyz'),
 *   },
 * })
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function feePayer(options: feePayer.Options) {
  const {
    account,
    chains = [tempo, tempoModerato],
    onRequest,
    path = '/',
    transports = {},
  } = options

  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  function getClient(chainId?: number): Client {
    if (chainId) {
      const client = clients.get(chainId)
      if (!client) throw new Error(`Chain ${chainId} not configured`)
      return client
    }
    return clients.get(chains[0]!.id)!
  }

  const router = from(options)

  router.post(path, async (c) => {
    const request = RpcRequest.from((await c.req.raw.json()) as any)

    try {
      await onRequest?.(request)

      const method = request.method as string
      if (
        method !== 'eth_signRawTransaction' &&
        method !== 'eth_sendRawTransaction' &&
        method !== 'eth_sendRawTransactionSync'
      )
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

      const serialized = request.params?.[0] as `0x76${string}`

      if (!serialized?.startsWith('0x76') && !serialized?.startsWith('0x78'))
        throw new RpcResponse.InvalidParamsError({
          message: 'Only Tempo (0x76/0x78) transactions are supported.',
        })

      const transaction = Transaction.deserialize(serialized) as any

      if (!transaction.signature || !transaction.from)
        throw new RpcResponse.InvalidParamsError({
          message: 'Transaction must be signed by the sender before fee payer signing.',
        })

      const client = getClient(transaction.chainId)
      const serializedTransaction = await signTransaction(client, {
        ...transaction,
        account,
        feePayer: account,
      })

      if (method === 'eth_signRawTransaction')
        return Response.json(RpcResponse.from({ result: serializedTransaction }, { request }))

      const result = await (client as any).request({
        method,
        params: [serializedTransaction],
      })

      return Response.json(RpcResponse.from({ result }, { request }))
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
    /**
     * Supported chains. The handler resolves the client based on the
     * `chainId` in the incoming transaction.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Function to call before handling the request. */
    onRequest?: (request: RpcRequest.RpcRequest) => Promise<void>
    /** Path to use for the handler. */
    path?: string | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
  }
}

/**
 * Instantiates a generic device-code handler for access-key bootstrap.
 *
 * Exposes 4 endpoints:
 * - `GET /auth/pkce/pending/:code`
 * - `POST /auth/pkce/code`
 * - `POST /auth/pkce/poll/:code`
 * - `POST /auth/pkce`
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function codeAuth(options: codeAuth.Options = {}): Handler {
  const {
    chains = [tempo, tempoModerato],
    now,
    path = '/auth/pkce',
    policy,
    random,
    store = CliAuth.Store.memory(),
    transports = {},
    ttlMs,
    ...rest
  } = options

  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  function getClient(chainId?: bigint | number): Client {
    if (typeof chainId !== 'undefined') {
      const id = Number(chainId)
      const client = clients.get(id)
      if (!client) throw new Error(`Chain ${id} not configured`)
      return client
    }
    return clients.get(chains[0]!.id)!
  }

  const router = from(rest)

  router.get(`${path}/pending/:code`, async (c) => {
    try {
      const code = c.req.param('code')
      const result = await CliAuth.pending({
        code,
        ...(now ? { now } : {}),
        store,
      })

      return Response.json(z.encode(CliAuth.pendingResponse, result))
    } catch (error) {
      const status = error instanceof CliAuth.PendingError ? error.status : 400
      return Response.json({ error: (error as Error).message }, { status })
    }
  })

  router.post(`${path}/code`, async (c) => {
    try {
      const request = z.decode(CliAuth.createRequest, await c.req.raw.json())
      const chainId = request.chainId ?? chains[0]!.id
      getClient(chainId)
      const result = await CliAuth.createDeviceCode({
        chainId,
        ...(now ? { now } : {}),
        ...(policy ? { policy } : {}),
        ...(random ? { random } : {}),
        request,
        store,
        ...(typeof ttlMs !== 'undefined' ? { ttlMs } : {}),
      })

      return Response.json(z.encode(CliAuth.createResponse, result))
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/poll/:code`, async (c) => {
    try {
      const request = z.decode(CliAuth.pollRequest, await c.req.raw.json())
      const code = c.req.param('code')
      const result = await CliAuth.poll({
        code,
        ...(now ? { now } : {}),
        request,
        store,
      })

      return Response.json(z.encode(CliAuth.pollResponse, result))
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(path, async (c) => {
    try {
      const request = z.decode(CliAuth.authorizeRequest, await c.req.raw.json())
      const result = await CliAuth.authorize({
        client: getClient(request.keyAuthorization.chainId),
        ...(now ? { now } : {}),
        request,
        store,
      })

      return Response.json(z.encode(CliAuth.authorizeResponse, result))
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  return router
}

export declare namespace codeAuth {
  export type Options = from.Options & {
    /**
     * Supported chains. The handler resolves the client based on chain IDs carried
     * by device-code requests and key authorizations.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Path prefix for the code auth endpoints. @default "/auth/pkce" */
    path?: string | undefined
    /** Policy used to validate and default requested CLI auth fields. */
    policy?: CliAuth.Policy | undefined
    /** Random byte generator used for device-code allocation. */
    random?: ((size: number) => Uint8Array) | undefined
    /** Device-code store. */
    store?: CliAuth.Store | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
    /** Pending entry TTL in milliseconds. @default 600000 */
    ttlMs?: number | undefined
  }
}

/**
 * Instantiates a WebAuthn ceremony handler that manages registration and
 * authentication flows server-side.
 *
 * Exposes 4 POST endpoints following the webauthx convention:
 * - `POST /register/options` — generate credential creation options
 * - `POST /register` — verify registration and store credential
 * - `POST /login/options` — generate credential request options
 * - `POST /login` — verify authentication
 *
 * @example
 * ```ts
 * import { Handler, Kv } from 'accounts/server'
 *
 * const handler = Handler.webAuthn({
 *   kv: Kv.memory(),
 *   origin: 'https://example.com',
 *   rpId: 'example.com',
 * })
 *
 * export default handler
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function webAuthn(options: webAuthn.Options): Handler {
  const { challengeTtl = 300, kv, onAuthenticate, onRegister, path = '', rpId, ...rest } = options
  const origin = options.origin as string | string[]

  const router = from(rest)

  router.post(`${path}/register/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const { excludeCredentialIds, name, userId } = body as {
        excludeCredentialIds?: string[]
        name: string
        userId?: string
      }

      const { challenge, options } = Registration.getOptions({
        excludeCredentialIds,
        name,
        rp: { id: rpId, name: rpId },
        ...(userId ? { user: { id: new TextEncoder().encode(userId), name } } : undefined),
      })

      await kv.set(`challenge:${challenge}`, Date.now())

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/register`, async (c) => {
    try {
      const credential = (await c.req.raw.json()) as Registration_Types.Credential
      const deserialized = Credential.deserialize(credential)

      const clientData = JSON.parse(
        Bytes.toString(new Uint8Array(deserialized.clientDataJSON)),
      ) as { challenge: string }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const stored = await kv.get<number>(`challenge:${challenge}`)
      if (!stored || Date.now() - stored > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')
      await kv.delete(`challenge:${challenge}`)

      const result = Registration.verify(credential, {
        challenge,
        origin,
        rpId,
      })

      const { publicKey } = result.credential
      const credentialId = credential.id

      await kv.set(`credential:${credentialId}`, { publicKey })

      const json = { credentialId, publicKey }
      const hook = await onRegister?.({ credentialId, publicKey, request: c.req.raw })
      return mergeResponse(json, hook)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const {
        allowCredentialIds,
        challenge: requestChallenge,
        credentialId,
        mediation,
      } = body as {
        allowCredentialIds?: string[]
        challenge?: Hex.Hex
        credentialId?: string
        mediation?: string
      }

      const { challenge, options: authOptions } = Authentication.getOptions({
        challenge: requestChallenge,
        credentialId: allowCredentialIds ?? credentialId,
        rpId,
      })
      const options = mediation ? { ...authOptions, mediation } : authOptions

      await kv.set(`challenge:${challenge}`, Date.now())

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login`, async (c) => {
    try {
      const response = (await c.req.raw.json()) as Authentication.Response

      const clientData = JSON.parse(response.metadata.clientDataJSON) as {
        challenge: string
      }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const stored = await kv.get<number>(`challenge:${challenge}`)
      if (!stored || Date.now() - stored > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')
      await kv.delete(`challenge:${challenge}`)

      const credentialData = await kv.get<{ publicKey: string }>(`credential:${response.id}`)
      if (!credentialData) throw new Error('Unknown credential')

      const valid = Authentication.verify(response, {
        challenge,
        origin,
        publicKey: credentialData.publicKey as `0x${string}`,
        rpId,
      })
      if (!valid) throw new Error('Authentication failed')

      const rawResponse = response.raw?.response as unknown as Record<string, string> | undefined
      const userHandle = rawResponse?.userHandle

      const json = {
        credentialId: response.id,
        publicKey: credentialData.publicKey,
        ...(userHandle && userHandle.length > 0 ? { userId: userHandle } : undefined),
      }
      const hook = await onAuthenticate?.({ ...json, request: c.req.raw })
      return mergeResponse(json, hook)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  return router
}

export declare namespace webAuthn {
  type Options = from.Options & {
    /** Maximum age of a challenge in seconds before it expires. @default 300 */
    challengeTtl?: number | undefined
    /** Key-value store for challenges and credentials. */
    kv: Kv
    /** Called after a successful registration. The returned response is merged onto the default JSON response. */
    onRegister?: (parameters: {
      credentialId: string
      publicKey: string
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /** Called after a successful authentication. The returned response is merged onto the default JSON response. */
    onAuthenticate?: (parameters: {
      credentialId: string
      publicKey: string
      userId?: string | undefined
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /** Expected origin(s) (e.g. `"https://example.com"` or `["https://a.com", "https://b.com"]`). */
    origin: string | readonly string[]
    /** Path prefix for the WebAuthn endpoints (e.g. `"/webauthn"`). @default "" */
    path?: string | undefined
    /** Relying Party ID (e.g. `"example.com"`). */
    rpId: string
  }
}

/** @internal */
async function mergeResponse(
  json: Record<string, unknown>,
  hook?: Response | void,
): Promise<Response> {
  if (!hook) return Response.json(json)
  const extra = (await hook.json().catch(() => ({}))) as Record<string, unknown>
  const headers = new Headers(hook.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify({ ...json, ...extra }), {
    headers,
    status: hook.status,
  })
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
  if (config.exposeHeaders) headers.set('Access-Control-Expose-Headers', config.exposeHeaders)
  if (config.maxAge !== undefined) headers.set('Access-Control-Max-Age', String(config.maxAge))

  return headers
}
