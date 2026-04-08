import { Handler, Kv } from 'accounts/server'
import * as Bun from 'bun'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoMainnet, tempoTestnet } from 'viem/chains'
import { Account } from 'viem/tempo'

await Bun.build({
  outdir: './dist',
  entrypoints: ['./src/main.tsx'],
})

const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Private Fee Payer</title></head>
<body><div id="root"></div><script type="module" src="/main.js"></script></body>
</html>`

const localKv = Kv.memory()
const sessionCookie = 'fp_session'
const sessionTtlMs = 15 * 60 * 1_000

type Session = {
  credentialId: string
  publicKey: string
  address: `0x${string}`
  expiresAt: number
}

const server = Bun.serve({
  port: Number.parseInt(Bun.env.PORT ?? 88_88, 10),
  development: true,
  routes: {
    '/': new Response(html, { headers: { 'content-type': 'text/html' } }),
    '/main.js': new Response(Bun.file('./dist/main.js')),
  },
  async fetch(request, _server) {
    const url = new URL(request.url)
    const kv = localKv
    const rpcUrls = {
      [tempoMainnet.id]: tempoMainnet.rpcUrls.default.http[0],
      [tempoTestnet.id]: tempoTestnet.rpcUrls.default.http[0],
    } as const
    const rpcUrl = rpcUrls[tempoTestnet.id]

    if (url.pathname === '/debug/fetch') {
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_chainId',
            params: [],
          }),
        })

        return new Response(await response.text(), {
          status: response.status,
          headers: { 'content-type': 'application/json' },
        })
      } catch (error) {
        const cause =
          error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
        return Response.json(
          {
            cause,
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : 'UnknownError',
            rpcUrl,
            stack: error instanceof Error ? error.stack : undefined,
          },
          { status: 500 },
        )
      }
    }

    const handler = Handler.compose(
      [
        Handler.feePayer({
          account: privateKeyToAccount(Bun.env.FEE_PAYER_PRIVATE_KEY),
          async authorize(parameters) {
            try {
              const session = await requireSession({ kv, request: parameters.request })

              assertAuthorizedSender({
                requestId: parameters.rpcRequest.id,
                session,
                tx: parameters.transaction,
              })
              assertAllowedCalls({
                allowedTargets: parseAddressList(Bun.env.ALLOWED_FEE_PAYER_TARGETS),
                requestId: parameters.rpcRequest.id,
                tx: parameters.transaction,
              })
              assertNoValueTransfers({
                requestId: parameters.rpcRequest.id,
                tx: parameters.transaction,
              })
            } catch (error) {
              if (error instanceof Response) return error
              throw error
            }
          },
          chains: [tempoMainnet, tempoTestnet],
          path: '/fee-payer',
          cors: false,
          transports: {
            [tempoMainnet.id]: http(rpcUrls[tempoMainnet.id]),
            [tempoTestnet.id]: http(rpcUrls[tempoTestnet.id]),
          },
        }),
        Handler.webAuthn({
          kv,
          origin: url.origin,
          rpId: url.hostname,
          path: '/auth',
          cors: false,
          onRegister(parameters) {
            return createSessionResponse({
              credentialId: parameters.credentialId,
              publicKey: parameters.publicKey as never,
              kv,
              rpId: url.hostname,
              url,
            })
          },
          onAuthenticate(parameters) {
            return createSessionResponse({
              credentialId: parameters.credentialId,
              publicKey: parameters.publicKey as never,
              kv,
              rpId: url.hostname,
              url,
            })
          },
        }),
      ],
      { cors: false },
    )

    return handler.fetch(request)
  },
})

if (server.development) console.info(`Server is running on ${server.url}`)

async function createSessionResponse(parameters: {
  credentialId: string
  publicKey: `0x${string}`
  kv: Kv.Kv
  rpId: string
  url: URL
}) {
  const { credentialId, publicKey, kv, rpId, url } = parameters
  const account = Account.fromWebAuthnP256({ id: credentialId, publicKey }, { rpId })

  const id = crypto.randomUUID()
  const session: Session = {
    credentialId,
    publicKey,
    address: account.address,
    expiresAt: Date.now() + sessionTtlMs,
  }

  await kv.set(`session:${id}`, session)

  return new Response(
    JSON.stringify({
      sessionAddress: session.address,
    }),
    {
      headers: {
        'content-type': 'application/json',
        'set-cookie': serializeCookie({
          name: sessionCookie,
          value: id,
          maxAge: Math.floor(sessionTtlMs / 1_000),
          secure: url.protocol === 'https:',
        }),
      },
    },
  )
}

async function requireSession(parameters: { kv: Kv.Kv; request: Request }) {
  const id = parseCookie(parameters.request.headers.get('cookie') ?? '')[sessionCookie]
  if (!id)
    throw rpcErrorResponse({
      message: 'Missing fee payer session.',
      status: 401,
    })

  const session = await parameters.kv.get<Session>(`session:${id}`)
  if (!session || session.expiresAt < Date.now())
    throw rpcErrorResponse({
      message: 'Expired fee payer session.',
      status: 401,
    })

  return session
}

function assertAuthorizedSender(parameters: {
  requestId: number
  session: Session
  tx: { from?: `0x${string}` }
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
  requestId: number
  tx: {
    to?: `0x${string}`
    data?: `0x${string}`
    calls?: readonly {
      to?: `0x${string}`
      data?: `0x${string}`
    }[]
  }
  allowedTargets: ReadonlySet<string>
}) {
  const { allowedTargets, requestId, tx } = parameters
  const calls = tx.calls ?? (tx.to ? [{ to: tx.to, data: tx.data }] : [])

  for (const call of calls)
    if (!call.to || !allowedTargets.has(call.to.toLowerCase()))
      throw rpcErrorResponse({
        id: requestId,
        message: 'Transaction target is not sponsored by this fee payer.',
        status: 403,
      })
}

function assertNoValueTransfers(parameters: {
  requestId: number
  tx: {
    value?: bigint
    calls?: readonly { value?: bigint }[]
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
  name: string
  value: string
  maxAge: number
  secure: boolean
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

function rpcErrorResponse(parameters: {
  id?: number | null | undefined
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
