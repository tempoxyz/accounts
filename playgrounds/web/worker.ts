/** Serves the web playground on Cloudflare Workers, and relays its JSON-RPC calls. @module */
import * as Rpc from './Rpc.ts'

/** The Worker's bindings. */
type Env = {
  /** The built page, which `wrangler.jsonc` serves as assets. */
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  /** Tempo ID's `name:chainId=url` list, whose URLs can hold a node's key. */
  RPC_URLS?: string | undefined
}

export default {
  async fetch(request: Request, env: Env) {
    return (await Rpc.relay(request, env.RPC_URLS)) ?? env.ASSETS.fetch(request)
  },
}
