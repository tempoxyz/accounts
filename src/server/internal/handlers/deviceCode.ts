import { type DeviceCode, Store, Wata, deviceCode as core_deviceCode } from 'wata/host'
import * as z from 'zod/mini'

import { type Handler, from } from '../../Handler.js'

const maxVerifyBodyBytes = 65_536

const verifyRequest = z.object({
  action: z.union([z.literal('approve'), z.literal('deny')]),
  results: z.optional(
    z.array(z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() })),
  ),
  user_code: z.string(),
})

type PendingRequest = {
  id: string | number
}

/**
 * Instantiates a Wata device-code handler for wallet RPC requests.
 *
 * The handler implements the OAuth 2.0 Device Authorization Grant endpoints,
 * accepts browser-submitted RPC results, and returns them to the polling
 * consumer. The consuming host is responsible for deciding which methods
 * its approval UI supports.
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function deviceCode(options: deviceCode.Options): Handler {
  const {
    baseUrl,
    expiresIn,
    fetch,
    html,
    maxBodyBytes = maxVerifyBodyBytes,
    path = '/auth/device',
    pollingInterval,
    store = Store.memory(),
    ...rest
  } = options

  const router = from(rest)
  router.all(`${path}/*`, async (c) => {
    const request = c.req.raw
    const origin = typeof baseUrl === 'function' ? baseUrl(request) : baseUrl
    const results = new Map<string | number, unknown>()
    let settle: ((error?: Error) => void) | undefined
    const responded = new Promise<void>((resolve, reject) => {
      settle = (error) => (error ? reject(error) : resolve())
    })

    const wata = Wata.create({
      transports: [
        core_deviceCode({
          ...(origin ? { baseUrl: origin } : {}),
          ...(expiresIn !== undefined ? { expiresIn } : {}),
          ...(fetch !== undefined ? { fetch } : {}),
          html: {
            async authenticate({ actions, request }) {
              const body = await readVerifyBody(request, maxBodyBytes)
              if (!body.ok) return body.response
              const { action, results: submitted, user_code } = body.value

              const userCode = normalizeUserCode(user_code)
              const record = await actions.get(userCode)
              if (!record)
                return Response.json(
                  { error: 'unknown_code', error_description: 'Unknown or expired device code.' },
                  { status: 404 },
                )
              if (record.status !== 'pending')
                return Response.json(
                  { error: 'not_pending', error_description: 'Device code already completed.' },
                  { status: 409 },
                )

              if (action === 'deny') {
                await actions.deny(userCode)
                return Response.json({ status: 'denied' })
              }

              const requests = pendingRequests(record)
              const [pending] = requests
              if (requests.length !== 1 || !pending)
                return Response.json(
                  {
                    error: 'invalid_request',
                    error_description: 'Expected one pending request.',
                  },
                  { status: 400 },
                )

              const submittedResult = submitted?.find((entry) => entry.id === pending.id)?.result
              if (submittedResult === undefined)
                return Response.json(
                  {
                    error: 'invalid_request',
                    error_description: 'Missing result for pending request.',
                  },
                  { status: 400 },
                )

              results.set(pending.id, submittedResult)
              await actions.approve(userCode)
              await responded
              return Response.json({ status: 'approved' })
            },
            render: html.render,
          },
          path,
          ...(pollingInterval !== undefined ? { pollingInterval } : {}),
          store,
        }),
      ],
    })

    const session = wata.start()
    session.onRequest(async (event) => {
      const result = results.get(event.id)
      try {
        if (result === undefined)
          await event.reject({ code: -32603, message: 'No result supplied for request.' })
        else await event.respond(result)
        settle?.()
      } catch (error) {
        settle?.(error as Error)
      }
    })

    return await wata.fetch(request)
  })

  return router
}

export declare namespace deviceCode {
  /** Options for {@link deviceCode}. */
  export type Options = from.Options & {
    /** Public host origin or a request-based origin resolver. */
    baseUrl?: string | ((request: Request) => string) | undefined
    /** Authorization intent lifetime in seconds. @default 600 */
    expiresIn?: number | undefined
    /** Discovery fetch implementation. */
    fetch?: typeof globalThis.fetch | undefined
    /** Approval page hooks. */
    html: {
      /** Renders or redirects the approval page. */
      render: DeviceCode.html.Hooks['render']
    }
    /** Maximum approval request body size in bytes. @default 65536 */
    maxBodyBytes?: number | undefined
    /** Device-code endpoint path. @default "/auth/device" */
    path?: string | undefined
    /** Suggested polling interval in milliseconds. */
    pollingInterval?: number | undefined
    /** Device-code persistence. @default in-memory */
    store?: Store.Store | undefined
  }
}

function pendingRequests(record: DeviceCode.PendingRecord): PendingRequest[] {
  if (record.message.type !== 'rpc-requests') return []
  return record.message.payload.filter(
    (message) => typeof message === 'object' && message !== null && 'id' in message,
  ) as unknown as PendingRequest[]
}

function normalizeUserCode(value: string): string {
  const compact = value.replace(/[\s-]/g, '').toUpperCase()
  if (compact.length !== 8) return value.trim().toUpperCase()
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

async function readVerifyBody(
  request: Request,
  maxBodyBytes: number,
): Promise<
  { ok: true; value: z.output<typeof verifyRequest> } | { ok: false; response: Response }
> {
  const invalid = (description: string) => ({
    ok: false as const,
    response: Response.json(
      { error: 'invalid_request', error_description: description },
      { status: 400 },
    ),
  })

  let json: unknown
  try {
    const body = await readBody(request, maxBodyBytes)
    if (!body.ok) return invalid('Request body is too large.')
    json = JSON.parse(body.text)
  } catch {
    return invalid('Expected a JSON body.')
  }

  const parsed = z.safeParse(verifyRequest, json)
  if (!parsed.success) return invalid('Malformed verify request.')
  return { ok: true, value: parsed.data }
}

async function readBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const length = request.headers.get('content-length')
  if (length && Number(length) > maxBodyBytes) return { ok: false }
  if (!request.body) return { ok: true, text: '' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}
