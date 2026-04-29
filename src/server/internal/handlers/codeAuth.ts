import type { Chain, Client, Transport } from 'viem'
import { createClient, http } from 'viem'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import * as z from 'zod/mini'

import * as CliAuth from '../../CliAuth.js'
import { type Handler, from } from '../../Handler.js'

/**
 * Instantiates a generic device-code handler for access-key bootstrap.
 *
 * Exposes 4 endpoints:
 * - `GET /auth/pkce/pending/:code`
 * - `POST /auth/pkce/code`
 * - `POST /auth/pkce/poll/:code`
 * - `POST /auth/pkce`
 *
 * @param {codeAuth.Options} options - Options.
 * @returns {Handler} Request handler.
 */
export function codeAuth(options: codeAuth.Options = {}): Handler {
  const {
    chains = [tempo, tempoModerato, tempoDevnet],
    now,
    path = '/auth/pkce',
    maxBodyBytes = 16_384,
    policy,
    random,
    rateLimit = CliAuth.RateLimit.memory({ max: 120, windowMs: 60_000 }),
    store = CliAuth.Store.memory(),
    transports = {},
    ttlMs,
    ...rest
  } = options

  const [defaultChain] = chains
  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  function getClient(chainId?: bigint | number): Client {
    const id = Number(chainId ?? defaultChain.id)
    const client = clients.get(id)
    if (!client) throw new Error(`Chain ${id} not configured`)
    return client
  }

  const router = from(rest)

  async function checkRateLimit(request: Request) {
    if (rateLimit === false) return undefined
    const { success } = await rateLimit.limit({ key: getRateLimitKey(request), request })
    if (success) return undefined
    return Response.json({ error: 'Rate limit exceeded.' }, { status: 429 })
  }

  router.get(`${path}/pending/:code`, async (c) => {
    const limited = await checkRateLimit(c.req.raw)
    if (limited) return limited
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
    const limited = await checkRateLimit(c.req.raw)
    if (limited) return limited
    try {
      const request = z.decode(CliAuth.createRequest, await readJson(c.req.raw, maxBodyBytes))
      const chainId = request.chainId ?? defaultChain.id
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
    const limited = await checkRateLimit(c.req.raw)
    if (limited) return limited
    try {
      const request = z.decode(CliAuth.pollRequest, await readJson(c.req.raw, maxBodyBytes))
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
    const limited = await checkRateLimit(c.req.raw)
    if (limited) return limited
    try {
      const request = z.decode(CliAuth.authorizeRequest, await readJson(c.req.raw, maxBodyBytes))
      const result = await CliAuth.authorize({
        client: getClient(request.keyAuthorization.chainId),
        ...(now ? { now } : {}),
        ...(policy ? { policy } : {}),
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
     * @default [tempo, tempoModerato, tempoDevnet]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Maximum JSON request body size in bytes. @default 16384 */
    maxBodyBytes?: number | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Path prefix for the code auth endpoints. @default "/auth/pkce" */
    path?: string | undefined
    /** Policy used to validate and default requested CLI auth fields. */
    policy?: CliAuth.Policy | undefined
    /** Random byte generator used for device-code allocation. */
    random?: ((size: number) => Uint8Array) | undefined
    /** Shared rate limiter across all CLI auth endpoints. Pass `false` to disable. */
    rateLimit?: CliAuth.RateLimit | false | undefined
    /** Device-code store. */
    store?: CliAuth.Store | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
    /** Pending entry TTL in milliseconds. @default 600000 */
    ttlMs?: number | undefined
  }
}

async function readJson(request: Request, maxBodyBytes: number) {
  const length = request.headers.get('content-length')
  if (length && Number(length) > maxBodyBytes) throw new Error('Request body is too large.')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes)
    throw new Error('Request body is too large.')
  return JSON.parse(text)
}

function getRateLimitKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    request.headers.get('cf-connecting-ip') ??
    forwarded ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}
