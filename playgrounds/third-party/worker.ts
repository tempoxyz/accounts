/** Serves the third-party playground and its metadata document on Cloudflare Workers, and relays its JSON-RPC calls. @module */
import * as Rpc from '../web/Rpc.ts'
import * as Metadata from './metadata.ts'

/** The Worker's bindings. */
type Env = {
  /** The built page, which `wrangler.jsonc` serves as assets. */
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  /** Tempo ID's `name:chainId=url` list, whose URLs can hold a node's key. */
  RPC_URLS?: string | undefined
}

export default {
  async fetch(request: Request, env: Env) {
    const relayed = await Rpc.relay(request, env.RPC_URLS)
    if (relayed) return relayed
    const url = new URL(request.url)
    if (url.pathname !== Metadata.path) return env.ASSETS.fetch(request)
    return Response.json(Metadata.document({ origin: url.origin }), {
      headers: { 'cache-control': 'max-age=300' },
    })
  },
}
