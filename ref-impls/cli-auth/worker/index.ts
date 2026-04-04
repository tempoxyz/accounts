import { CliAuth, Handler } from 'accounts/server'
import { Address, type Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, http } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Account } from 'viem/tempo'
import * as z from 'zod/mini'

const path = '/cli-auth'

type Bindings = CloudflareBindings & {
  ASSETS?:
    | {
        fetch: typeof fetch
      }
    | undefined
  PRIVATE_KEY: Hex.Hex
}

const client = createClient({
  chain: tempoModerato,
  transport: http(tempoModerato.rpcUrls.default.http[0]),
})

const store = CliAuth.Store.memory()

const cliAuth = Handler.codeAuth({
  chainId: tempoModerato.id,
  client,
  path,
  store,
})

function parseCode(value: string) {
  const code = value.replaceAll('-', '').toUpperCase()
  if (/^[A-Z0-9]{8}$/.test(code)) return code

  throw new Error('Expected an 8-character device code.')
}

function getRoot(env: Bindings) {
  if (!env.PRIVATE_KEY)
    throw new Error('Missing PRIVATE_KEY. Copy .env.example to .env and set a root wallet key.')

  return Account.fromSecp256k1(env.PRIVATE_KEY)
}

async function approve(request: Request, env: Bindings) {
  const body = z.decode(z.object({ code: z.string() }), await request.json())
  const code = parseCode(body.code)
  const pending = await CliAuth.pending({
    code,
    store,
  })
  const root = getRoot(env)
  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: Address.fromPublicKey(PublicKey.from(pending.pubKey)),
      keyType: pending.keyType,
    },
    {
      chainId: pending.chainId,
      expiry: pending.expiry,
      ...(pending.limits ? { limits: pending.limits } : {}),
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)
  const result = await CliAuth.authorize({
    chainId: pending.chainId,
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
}

/** Minimal Cloudflare Worker reference for CLI device-code approval. */
export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === `${path}/approve`) {
      try {
        return await approve(request, env)
      } catch (error) {
        const status = error instanceof CliAuth.PendingError ? error.status : 400
        return Response.json(
          {
            error: error instanceof Error ? error.message : 'Request failed.',
          },
          { status },
        )
      }
    }

    if (request.method === 'GET' && url.pathname === path) {
      if (env.ASSETS) {
        const assetUrl = new URL('/', request.url)
        assetUrl.search = url.search
        return env.ASSETS.fetch(new Request(assetUrl, request))
      }

      const redirect = new URL('/', request.url)
      redirect.search = url.search
      return Response.redirect(redirect, 302)
    }

    const response = await cliAuth.fetch(request)
    if (response.status === 404 && env.ASSETS) return env.ASSETS.fetch(request)
    return response
  },
} satisfies ExportedHandler<Bindings>
