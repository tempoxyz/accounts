import { Handler, Kv } from 'accounts/server'
import { privateKeyToAccount } from 'viem/accounts'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const handler = Handler.compose([
      Handler.feePayer({
        account: privateKeyToAccount(env.FEE_PAYER_PRIVATE_KEY),
        path: '/fee-payer',
      }),
      Handler.webAuthn({
        kv: Kv.cloudflare(env.KV),
        origin: url.origin,
        rpId: url.hostname,
        path: '/auth',
      }),
    ])
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
