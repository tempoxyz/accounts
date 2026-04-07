import { Handler, Kv } from 'accounts/server'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const handler = Handler.webAuthn({
      kv: Kv.cloudflare(env.KV),
      origin: url.origin,
      rpId: url.hostname,
      path: '/auth',
    })
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
