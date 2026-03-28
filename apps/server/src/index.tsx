import cliAuthUrl from '#cli-auth.ts?url'
import { CliAuth, Handler, Kv } from 'accounts/server'
import { Hono } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'
import { prettyJSON } from 'hono/pretty-json'
import { Address as core_Address, PublicKey } from 'ox'
import { KeyAuthorization as TempoKeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { createClient, http } from 'viem'
import { getCode, verifyHash } from 'viem/actions'
import { tempo } from 'viem/chains'
import * as z from 'zod/mini'

const memoryKv = Kv.memory()
const latestPendingCodeKey = 'tempo-server.latest-pending-code'

const app = new Hono<{ Bindings: Cloudflare.Env }>()
app.use('*', prettyJSON({ force: true, space: 2 }))

app.get('/cli-auth/latest', async (context) => {
  try {
    const kv = getKv(context.env)
    const code = await kv.get<string | undefined>(latestPendingCodeKey)

    if (!code) return new Response(null, { status: 204 })

    const pending = await CliAuth.pending({
      code,
      store: CliAuth.Store.kv(kv),
    })

    console.info(JSON.stringify({ route: context.req.path, data: { pending } }, undefined, 2))

    return Response.json(z.encode(CliAuth.pendingResponse, pending))
  } catch {
    return new Response(null, { status: 204 })
  }
})

app.post('/cli-auth/device-code', async (context) => {
  try {
    const kv = getKv(context.env)
    const request = z.decode(CliAuth.createRequest, await context.req.json())
    const created = await CliAuth.createDeviceCode({
      request,
      store: CliAuth.Store.kv(kv),
    })

    console.info(JSON.stringify({ route: context.req.path, data: { created } }, undefined, 2))

    await kv.set(latestPendingCodeKey, created.code)
    return Response.json(z.encode(CliAuth.createResponse, created))
  } catch (error) {
    console.error(JSON.stringify({ route: context.req.path, data: { error } }, undefined, 2))
    return Response.json(
      {
        error: error instanceof Error ? error.message : `Encountered error in ${context.req.path}`,
      },
      { status: 400 },
    )
  }
})

app.post('/reset', async (context) => {
  const kv = context.env.CLI_AUTH_KV
  console.info(JSON.stringify({ route: context.req.path, data: { kv } }, undefined, 2))
  if (!supportsReset(kv))
    return Response.json(
      {
        error: 'Server reset requires a Cloudflare KV binding with list support.',
      },
      { status: 501 },
    )

  let deleted = 0
  for (const prefix of ['challenge:', 'cli-auth:', 'credential:'])
    deleted += await deletePrefix(kv, prefix)
  await kv.delete(latestPendingCodeKey)

  return Response.json({
    deleted,
    status: 'ok',
  })
})

app.post('/debug/authorize-check', async (context) => {
  try {
    const request = z.decode(CliAuth.authorizeRequest, await context.req.json())
    const store = CliAuth.Store.kv(getKv(context.env))
    const code = request.code.replace(/-/g, '').toUpperCase()
    const current = await store.get(code)
    const actual = {
      ...request.keyAuthorization,
      expiry: request.keyAuthorization.expiry ?? undefined,
      limits: request.keyAuthorization.limits ?? undefined,
    }

    console.info(
      JSON.stringify({ route: context.req.path, data: { request, current } }, undefined, 2),
    )

    if (!current)
      return jsonDebug({
        code,
        error: 'Unknown device code.',
      })

    if (current.status !== 'pending')
      return jsonDebug({
        code,
        current,
        error: 'Device code already completed.',
      })

    const expected = TempoKeyAuthorization.from({
      address: core_Address.fromPublicKey(PublicKey.from(current.pubKey)),
      chainId: current.chainId,
      expiry: current.expiry,
      ...(current.limits ? { limits: current.limits } : {}),
      type: current.keyType,
    })
    console.info(JSON.stringify({ route: context.req.path, data: { expected } }, undefined, 2))
    const hash = TempoKeyAuthorization.getSignPayload(expected)
    console.info(JSON.stringify({ route: context.req.path, data: { hash } }, undefined, 2))
    const envelope = SignatureEnvelope.fromRpc(actual.signature)
    console.info(JSON.stringify({ route: context.req.path, data: { envelope } }, undefined, 2))
    const stateless = SignatureEnvelope.verify(envelope, {
      address: request.accountAddress,
      payload: hash,
    })
    console.info(JSON.stringify({ route: context.req.path, data: { stateless } }, undefined, 2))
    const client = createClient({
      chain: {
        ...tempo,
        id: Number(current.chainId),
      },
      transport: http(),
    })
    const onchainCode = await getCode(client, { address: request.accountAddress })
    console.info(JSON.stringify({ route: context.req.path, data: { onchainCode } }, undefined, 2))
    const viaVerifyHash = await verifyHash(client as never, {
      address: request.accountAddress,
      hash,
      signature: SignatureEnvelope.serialize(envelope, {
        magic: actual.signature.type === 'webAuthn',
      }),
    })

    console.info(JSON.stringify({ route: context.req.path, data: { viaVerifyHash } }, undefined, 2))

    return jsonDebug({
      actual,
      code,
      current,
      expected: {
        address: expected.address,
        chainId: expected.chainId.toString(),
        expiry: expected.expiry,
        keyType: expected.type,
        limits: expected.limits,
      },
      hash,
      onchainCode,
      stateless,
      viaVerifyHash,
    })
  } catch (error) {
    console.error(JSON.stringify({ route: context.req.path, data: { error } }, undefined, 2))
    return jsonDebug(
      {
        error: error instanceof Error ? error.message : `Encountered error in ${context.req.path}`,
      },
      400,
    )
  }
})

app.all('/cli-auth/*', async (context) => codeAuth(context.env).fetch(context.req.raw))

app.all('/webauthn/*', async (context) => {
  console.info(
    JSON.stringify({ route: context.req.path, data: { env: context.env } }, undefined, 2),
  )
  console.info(
    JSON.stringify({ route: context.req.path, data: { req: context.req.raw } }, undefined, 2),
  )
  return webauthn(context.req.raw, context.env).fetch(context.req.raw)
})

/**
 * TODO: remove
 */
app.get(
  '/cli-auth',
  jsxRenderer(({ children }) => {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>Tempo CLI Approval</title>
        </head>
        <body style="font-family:monospace;">
          {children}
          <script src={cliAuthUrl} type="module"></script>
        </body>
      </html>
    )
  }),
  (context) => {
    const code = context.req.query('code') ?? ''

    console.info(
      JSON.stringify(
        { route: context.req.path, query: context.req.query(), data: { code } },
        undefined,
        2,
      ),
    )

    return context.render(
      <main>
        <header>
          <p>Authenticate with a Tempo passkey and approve a pending CLI access-key request.</p>
        </header>

        <section aria-labelledby="load-heading">
          <h2 id="load-heading">Device code</h2>
          <form action="/cli-auth" method="get">
            <p>
              <label for="code">Enter the code from your terminal</label>
              <br />
              <input
                autoComplete="one-time-code"
                id="code"
                inputMode="text"
                name="code"
                size={12}
                value={code}
              />
            </p>
            <p>
              <button type="submit">Load request</button>
            </p>
          </form>
          <p id="status" role="status">
            Enter the device code from your terminal to load a pending request.
          </p>
        </section>

        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading">Pending request</h2>
          <div id="pending"></div>
        </section>

        <section aria-labelledby="account-heading">
          <h2 id="account-heading">Passkey account</h2>
          <p id="account">Not signed in.</p>
          <p>
            <button id="register" type="button">
              Create passkey
            </button>{' '}
            <button id="login" type="button">
              Sign in with passkey
            </button>
          </p>
          <p>
            <button id="disconnect" type="button">
              Sign out
            </button>
          </p>
          <p>
            <button id="reset" type="button">
              Reset storage
            </button>
          </p>
        </section>

        <section aria-labelledby="approve-heading">
          <h2 id="approve-heading">Approve</h2>
          <p id="approval">Load a pending request to authenticate and authorize its access key.</p>
          <p>
            <button id="approve" type="button">
              Authenticate and authorize key
            </button>
          </p>
        </section>

        <noscript>This page requires JavaScript for passkey approval.</noscript>
      </main>,
    )
  },
)

app.get('/', (context) => context.text('Tempo CLI auth server'))

app.get('*', (context) => context.env.ASSETS.fetch(context.req.raw))

export default app satisfies ExportedHandler<Cloudflare.Env>

function codeAuth(env: Cloudflare.Env) {
  return Handler.codeAuth({
    path: '/cli-auth',
    store: CliAuth.Store.kv(getKv(env)),
  })
}

function getKv(env: Cloudflare.Env) {
  const kv = env.CLI_AUTH_KV
  if (isKvNamespace(kv)) return Kv.cloudflare(kv)
  return memoryKv
}

function isKvNamespace(value: unknown): value is KVNamespace {
  return Boolean(
    value && typeof value === 'object' && 'delete' in value && 'get' in value && 'put' in value,
  )
}

function webauthn(request: Request, env: Cloudflare.Env) {
  const origin = getOrigin(request)
  const { hostname } = new URL(origin)

  return Handler.webauthn({
    kv: getKv(env),
    origin,
    path: '/webauthn',
    rpId: hostname,
  })
}

function getOrigin(request: Request) {
  const url = new URL(request.url)
  const forwarded = request.headers.get('forwarded')
  const proto =
    forwardedValue(forwarded, 'proto') ??
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    url.protocol.slice(0, -1)
  const host =
    forwardedValue(forwarded, 'host') ??
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    url.host
  return `${proto}://${host}`
}

function forwardedValue(header: string | null, key: string) {
  const match = header?.match(new RegExp(`${key}=([^;,]+)`, 'i'))
  return match?.[1]?.trim().replace(/^"|"$/g, '')
}

function supportsReset(value: unknown): value is KVNamespace & {
  list: (options?: { cursor?: string; prefix?: string }) => Promise<{
    cursor?: string
    keys: { name: string }[]
    list_complete: boolean
  }>
} {
  return Boolean(isKvNamespace(value) && 'list' in value && typeof value.list === 'function')
}

function jsonDebug(value: unknown, status = 200) {
  return new Response(
    JSON.stringify(value, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2),
    {
      headers: { 'content-type': 'application/json' },
      status,
    },
  )
}

async function deletePrefix(
  kv: KVNamespace & {
    list: (options?: { cursor?: string; prefix?: string }) => Promise<{
      cursor?: string
      keys: { name: string }[]
      list_complete: boolean
    }>
  },
  prefix: string,
) {
  let cursor: string | undefined
  let deleted = 0

  do {
    const result = await kv.list({ cursor, prefix })
    await Promise.all(result.keys.map(async ({ name }) => kv.delete(name)))
    deleted += result.keys.length
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor)

  return deleted
}
