import { CliAuth, Handler } from 'accounts/server'
import { Address, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, http } from 'viem'
import { tempoModerato as tempoTestnet } from 'viem/chains'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

export const path = '/cli-auth'

const root = TempoAccount.fromSecp256k1(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const client = createClient({
  chain: tempoTestnet,
  transport: http(tempoTestnet.rpcUrls.default.http[0]),
})
const store = CliAuth.Store.memory()

const page = Handler.from()

/** Raw 8-character device code: optional hyphens stripped, uppercased (see protocol in AGENTS.md). */
const authCodeSchema = z.pipe(
  z.string(),
  z.transform((s, ctx) => {
    const normalized = s.replaceAll('-', '').toUpperCase()
    if (/^[A-Z0-9]{8}$/.test(normalized)) return normalized

    ctx.issues.push({
      code: 'custom',
      message: 'Expected 8-character device code',
      input: s,
    })
    return z.NEVER
  }),
)

page.get(path, ({ request }) => {
  const requestUrl = new URL(request.url)
  const url = new URL('/', request.url)
  const code = requestUrl.searchParams.get('code')
  if (code) url.searchParams.set('code', code)
  url.hash = 'cli-auth'
  return Response.redirect(url.toString(), 302)
})

page.get(`${path}/pending/:code`, async ({ params }) => {
  const parsed = z.safeParse(authCodeSchema, params.code)
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 })

  const code = parsed.data
  const current = await store.get(code)
  if (!current) return Response.json({ error: 'Unknown device code.' }, { status: 404 })
  if (current.status !== 'pending')
    return Response.json({ error: 'Device code already completed.' }, { status: 400 })

  return Response.json({
    accessKeyAddress: Address.fromPublicKey(PublicKey.from(current.pubKey)),
    ...(current.account ? { account: current.account } : {}),
    chain_id: current.chainId.toString(),
    code: current.code,
    expiry: current.expiry,
    flow: 'device-code bootstrap',
    key_type: current.keyType,
    ...(current.limits
      ? {
          limits: current.limits.map(({ limit, token }) => ({
            limit: limit.toString(),
            token,
          })),
        }
      : {}),
    pub_key: current.pubKey,
    root_address: root.address,
    status: current.status,
  })
})

page.post(`${path}/approve`, async ({ request }) => {
  try {
    const body = z.safeParse(z.object({ code: authCodeSchema }), await request.json())
    if (!body.success) return Response.json({ error: body.error.message }, { status: 400 })

    const code = body.data.code
    const current = await store.get(code)
    if (!current) return Response.json({ error: 'Unknown device code.' }, { status: 404 })
    if (current.status !== 'pending')
      return Response.json({ error: 'Device code already completed.' }, { status: 400 })

    const signed = await root.signKeyAuthorization(
      {
        accessKeyAddress: Address.fromPublicKey(PublicKey.from(current.pubKey)),
        keyType: current.keyType,
      },
      {
        chainId: current.chainId,
        expiry: current.expiry,
        ...(current.limits ? { limits: current.limits } : {}),
      },
    )
    const keyAuthorization = KeyAuthorization.toRpc(signed)
    const result = await CliAuth.authorize({
      chainId: tempoTestnet.id,
      client,
      request: {
        accountAddress: root.address,
        code,
        keyAuthorization: z.decode(CliAuth.keyAuthorization, {
          ...keyAuthorization,
          address: keyAuthorization.keyId,
        }),
      },
      store,
    })

    return Response.json({
      accountAddress: root.address,
      status: result.status,
    })
  } catch (error) {
    console.error(JSON.stringify({ path, error }, null, 2))
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Encountered an error while authorizing device code.',
      },
      { status: 400 },
    )
  }
})

export const handler = Handler.compose([
  page,
  Handler.codeAuth({
    chains: [tempoTestnet],
    path,
    store,
  }),
])
