import { Handler, Kv } from 'accounts/server'
import { Base64, Hex, type RpcRequest } from 'ox'
import { privateKeyToAccount } from 'viem/accounts'
import { Account } from 'viem/tempo'
import * as z from 'zod/mini'

const localKv = Kv.memory()
const sessionCookie = 'fp_session'
const sessionTtlMs = 15 * 60 * 1_000

type Session = {
  address: `0x${string}`
  expiresAt: number
}

const sessionValue = z.object({
  address: z.string(),
  expiresAt: z.number(),
})

export default {
  fetch: async (request, env) => {
    const url = new URL(request.url)
    const allowedTargets = parseAddressList(env.ALLOWED_FEE_PAYER_TARGETS)
    const secret = env.FEE_PAYER_PRIVATE_KEY

    const handler = Handler.compose(
      [
        Handler.feePayer({
          account: privateKeyToAccount(secret),
          async authorize(parameters) {
            try {
              const session = await requireSession({ request: parameters.request, secret })
              assertAuthorizedSender({
                requestId: parameters.rpcRequest.id,
                session,
                tx: parameters.transaction,
              })
              assertAllowedCalls({
                allowedTargets,
                requestId: parameters.rpcRequest.id,
                tx: parameters.transaction,
              })
              assertNoValueTransfers({
                requestId: parameters.rpcRequest.id,
                tx: parameters.transaction,
              })
            } catch (error) {
              if (isResponse(error)) return error
              throw error
            }
          },
          cors: false,
          path: '/fee-payer',
        }),
        Handler.webAuthn({
          kv: localKv,
          origin: url.origin,
          rpId: url.hostname,
          path: '/auth',
          cors: false,
          onAuthenticate(parameters) {
            return createSessionResponse({
              credentialId: parameters.credentialId,
              publicKey: parameters.publicKey as never,
              rpId: url.hostname,
              secret,
              url,
            })
          },
          onRegister(parameters) {
            return createSessionResponse({
              credentialId: parameters.credentialId,
              publicKey: parameters.publicKey as never,
              rpId: url.hostname,
              secret,
              url,
            })
          },
        }),
      ],
      { cors: false },
    )

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>

async function createSessionResponse(parameters: {
  credentialId: string
  publicKey: `0x${string}`
  rpId: string
  secret: `0x${string}`
  url: URL
}) {
  const { credentialId, publicKey, rpId, secret, url } = parameters
  const account = Account.fromWebAuthnP256({ id: credentialId, publicKey }, { rpId })

  const session: Session = {
    address: account.address,
    expiresAt: Date.now() + sessionTtlMs,
  }
  const value = await signValue(sessionValue, session, secret)

  return new Response(
    JSON.stringify({
      sessionAddress: session.address,
    }),
    {
      headers: {
        'content-type': 'application/json',
        'set-cookie': serializeCookie({
          name: sessionCookie,
          value,
          maxAge: Math.floor(sessionTtlMs / 1_000),
          secure: url.protocol === 'https:',
        }),
      },
    },
  )
}

async function getSession(parameters: { request: Request; secret: `0x${string}` }) {
  const value = parseCookie(parameters.request.headers.get('cookie') ?? '')[sessionCookie]
  if (!value) return undefined

  try {
    return await loadValue(sessionValue, value, parameters.secret)
  } catch {
    return undefined
  }
}

async function requireSession(parameters: { request: Request; secret: `0x${string}` }) {
  const session = await getSession(parameters)
  if (!session)
    throw rpcErrorResponse({
      message: 'Missing fee payer session.',
      status: 401,
    })

  return session as Session
}

function assertAuthorizedSender(parameters: {
  requestId: RpcRequest.RpcRequest['id']
  session: Session
  tx: { from?: `0x${string}` | undefined }
}) {
  const { requestId, session, tx } = parameters
  if (!tx.from || tx.from.toLowerCase() !== session.address.toLowerCase())
    throw rpcErrorResponse({
      id: requestId,
      message: 'Transaction sender is not authorized for this session.',
      status: 403,
    })
}

function assertAllowedCalls(parameters: {
  allowedTargets: ReadonlySet<string>
  requestId: RpcRequest.RpcRequest['id']
  tx: {
    calls?: readonly {
      data?: `0x${string}` | undefined
      to?: `0x${string}` | undefined
    }[]
    data?: `0x${string}` | undefined
    to?: `0x${string}` | undefined
  }
}) {
  const { allowedTargets, requestId, tx } = parameters
  const calls = tx.calls ?? (tx.to ? [{ data: tx.data, to: tx.to }] : undefined)
  if (!calls?.length)
    throw rpcErrorResponse({
      id: requestId,
      message: 'Transaction target is not sponsored by this fee payer.',
      status: 403,
    })

  for (const call of calls)
    if (!call.to || !allowedTargets.has(call.to.toLowerCase()))
      throw rpcErrorResponse({
        id: requestId,
        message: 'Transaction target is not sponsored by this fee payer.',
        status: 403,
      })
}

function assertNoValueTransfers(parameters: {
  requestId: RpcRequest.RpcRequest['id']
  tx: {
    calls?: readonly { value?: bigint | undefined }[]
    value?: bigint | undefined
  }
}) {
  const { requestId, tx } = parameters
  if ((tx.value ?? 0n) > 0n)
    throw rpcErrorResponse({
      id: requestId,
      message: 'Value transfers are not sponsored.',
      status: 403,
    })

  for (const call of tx.calls ?? [])
    if ((call.value ?? 0n) > 0n)
      throw rpcErrorResponse({
        id: requestId,
        message: 'Value transfers are not sponsored.',
        status: 403,
      })
}

function parseAddressList(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
}

function isResponse(error: unknown): error is Response {
  return (
    error instanceof Response ||
    (typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      'headers' in error &&
      'json' in error &&
      typeof (error as Response).json === 'function')
  )
}

function parseCookie(value: string) {
  return Object.fromEntries(
    value
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part.includes('='))
      .map((part) => {
        const index = part.indexOf('=')
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function serializeCookie(parameters: {
  maxAge: number
  name: string
  secure: boolean
  value: string
}) {
  return [
    `${parameters.name}=${encodeURIComponent(parameters.value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${parameters.maxAge}`,
    ...(parameters.secure ? ['Secure'] : []),
  ].join('; ')
}

async function loadValue<schema extends z.ZodMiniType>(
  schema: schema,
  value: string,
  secret: `0x${string}`,
): Promise<z.output<schema>> {
  const [body, signature] = value.split('.')
  if (!body || !signature) throw new Error('Invalid signed value.')

  const bodyBytes = Uint8Array.from(Base64.toBytes(body))
  const signatureBytes = Uint8Array.from(Base64.toBytes(signature))
  const key = await signingKey(secret)

  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, bodyBytes)
  if (!valid) throw new Error('Invalid signature.')

  const parsed = schema.parse(
    JSON.parse(new TextDecoder().decode(bodyBytes)),
  ) as z.output<schema> & {
    expiresAt: number
  }
  if (parsed.expiresAt < Date.now()) throw new Error('Signed value expired.')

  return parsed
}

async function signValue<schema extends z.ZodMiniType>(
  schema: schema,
  value: z.output<schema>,
  secret: `0x${string}`,
) {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(schema.parse(value)))
  const key = await signingKey(secret)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bodyBytes))

  return [
    Base64.fromBytes(bodyBytes, { pad: false, url: true }),
    Base64.fromBytes(signature, { pad: false, url: true }),
  ].join('.')
}

async function signingKey(secret: `0x${string}`) {
  return await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(Hex.toBytes(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function rpcErrorResponse(parameters: {
  id?: RpcRequest.RpcRequest['id'] | undefined
  message: string
  status: number
}) {
  return Response.json(
    {
      error: {
        code: -32603,
        message: parameters.message,
      },
      id: parameters.id ?? null,
      jsonrpc: '2.0',
    },
    {
      headers: { 'content-type': 'application/json' },
      status: parameters.status,
    },
  )
}
