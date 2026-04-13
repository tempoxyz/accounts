import type { Chain, Client, Transport } from 'viem'
import { createClient, http } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
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
