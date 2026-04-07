import { CliAuth, Handler } from 'accounts/server'
import { type Hex } from 'ox'
import { tempoModerato } from 'viem/chains'

import { approve } from './approve.js'
import { store } from './deps.js'

const path = '/cli-auth'

type Bindings = CloudflareBindings & {
  ASSETS?:
    | {
        fetch: typeof fetch
      }
    | undefined
  PRIVATE_KEY: Hex.Hex
}

const cliAuth = Handler.codeAuth({
  chains: [tempoModerato],
  path,
  store,
})

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
