import { Address as ox_Address, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { CliAuth, Handler } from 'tempodk/server'
import { createClient, http } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

export const path = '/cli-auth'

const root = TempoAccount.fromSecp256k1(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const client = createClient({
  chain: tempoModerato,
  transport: http(tempoModerato.rpcUrls.default.http[0]),
})
const store = CliAuth.Store.memory()

const page = Handler.from()

page.get(path, ({ request }) => {
  const requestUrl = new URL(request.url)
  const url = new URL('/', request.url)
  const code = requestUrl.searchParams.get('code')
  if (code) url.searchParams.set('code', code)
  url.hash = 'cli-auth'
  return Response.redirect(url.toString(), 302)
})

page.get(`${path}/pending/:code`, async ({ params }) => {
  const code = normalizeCode((params as { code: string }).code)
  const current = await store.get(code)
  if (!current) return Response.json({ error: 'Unknown device code.' }, { status: 404 })
  if (current.status !== 'pending')
    return Response.json({ error: 'Device code already completed.' }, { status: 400 })
  return Response.json({
    access_key_address: ox_Address.fromPublicKey(PublicKey.from(current.pubKey)),
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
    const body = (await request.json()) as { code?: unknown }
    if (typeof body.code !== 'string') throw new Error('Device code is required.')
    const code = normalizeCode(body.code)
    const current = await store.get(code)
    if (!current) throw new Error('Unknown device code.')
    if (current.status !== 'pending') throw new Error('Device code already completed.')

    const signed = await root.signKeyAuthorization(
      {
        accessKeyAddress: ox_Address.fromPublicKey(PublicKey.from(current.pubKey)),
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
      chainId: tempoModerato.id,
      client,
      request: {
        account_address: root.address,
        code,
        key_authorization: z.decode(CliAuth.keyAuthorization, {
          ...keyAuthorization,
          address: keyAuthorization.keyId,
        }),
      },
      store,
    })

    return Response.json({
      account_address: root.address,
      status: result.status,
    })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
})

export const handler = Handler.compose([
  page,
  Handler.cliAuth({
    chainId: tempoModerato.id,
    client,
    path,
    store,
  }),
])

function normalizeCode(code: string) {
  return code.replaceAll('-', '').toUpperCase()
}
