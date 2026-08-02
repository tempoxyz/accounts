import { type DeviceCode, Store, Wata, deviceCode as core_deviceCode } from 'wata/host'
import * as z from 'zod/mini'

import { type Handler, from } from '../../Handler.js'

const maxVerifyBodyBytes = 65_536

const verifyRequest = z.object({
  action: z.union([z.literal('approve'), z.literal('deny')]),
  results: z.optional(
    z.array(
      z.union([
        z.object({
          error: z.object({
            code: z.number(),
            data: z.optional(z.json()),
            message: z.string(),
          }),
          id: z.union([z.string(), z.number()]),
        }),
        z.object({ id: z.union([z.string(), z.number()]), result: z.json() }),
      ]),
    ),
  ),
  user_code: z.string(),
})

type PendingRequest = {
  context?: { account?: string | undefined; chainId?: number | undefined } | undefined
  id: string | number
  method: string
  params?: unknown
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
    validate,
    ...rest
  } = options

  const router = from(rest)
  router.all(`${path}/*`, async (c) => {
    const request = c.req.raw
    const origin = typeof baseUrl === 'function' ? baseUrl(request) : baseUrl
    const results = new Map<
      string | number,
      { result: unknown } | { error: { code: number; data?: unknown; message: string } }
    >()
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

              const response = submitted?.find((entry) => entry.id === pending.id)
              if (!response)
                return Response.json(
                  {
                    error: 'invalid_request',
                    error_description: 'Missing response for pending request.',
                  },
                  { status: 400 },
                )

              if ('result' in response) {
                const validation = await validate({
                  record,
                  request: pending,
                  result: response.result,
                  userCode,
                })
                if (validation) return validation
              }

              results.set(pending.id, response)
              await actions.approve(userCode)
              await responded
              return Response.json({ status: 'approved' })
            },
            render: html.render,
          },
          path,
          ...(pollingInterval !== undefined ? { pollingInterval } : {}),
          store: normalizeStore(store),
        }),
      ],
    })

    const session = wata.start()
    session.onRequest(async (event) => {
      const response = results.get(event.id)
      try {
        if (!response)
          await event.reject({ code: -32603, message: 'No result supplied for request.' })
        else if ('error' in response) await event.reject(response.error)
        else await event.respond(response.result)
        settle?.()
      } catch (error) {
        settle?.(error as Error)
      }
    })

    return await normalizeRegisterResponse(await wata.fetch(request), request, path)
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
    /** Host policy applied before an approved result is relayed to the consumer. */
    validate: (options: {
      /** Pending device-code record. */
      record: DeviceCode.PendingRecord
      /** Pending JSON-RPC request matched to the submitted result. */
      request: PendingRequest
      /** Browser-submitted result. */
      result: unknown
      /** Normalized raw user code. */
      userCode: string
    }) => Promise<Response | undefined> | Response | undefined
  }
}

function pendingRequests(record: DeviceCode.PendingRecord): PendingRequest[] {
  if (record.message.type !== 'rpc-requests') return []
  return record.message.payload.filter(
    (message) => typeof message === 'object' && message !== null && 'id' in message,
  ) as unknown as PendingRequest[]
}

function normalizeUserCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

function normalizeStore(store: Store.Store): Store.Store {
  function key(value: string) {
    if (!value.startsWith('user:')) return value
    return `user:${normalizeUserCode(value.slice('user:'.length))}`
  }

  return Store.from({
    delete: (value) => store.delete(key(value)),
    get: <value = unknown>(name: string) => store.get<value>(key(name)),
    set: (name, value, options) => store.set(key(name), value, options),
    ...(store.take
      ? { take: <value = unknown>(name: string) => store.take!<value>(key(name)) }
      : {}),
  })
}

async function normalizeRegisterResponse(response: Response, request: Request, path: string) {
  if (!response.ok || new URL(request.url).pathname !== `${path}/register`) return response

  const body = (await response.clone().json()) as {
    user_code?: unknown
    verification_uri_complete?: unknown
  }
  if (typeof body.user_code !== 'string') return response

  const userCode = normalizeUserCode(body.user_code)
  const verificationUriComplete =
    typeof body.verification_uri_complete === 'string'
      ? (() => {
          const url = new URL(body.verification_uri_complete)
          url.searchParams.set('user_code', userCode)
          return url.toString()
        })()
      : body.verification_uri_complete
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    {
      ...body,
      user_code: userCode,
      ...(verificationUriComplete ? { verification_uri_complete: verificationUriComplete } : {}),
    },
    { headers, status: response.status },
  )
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
