import { Handler } from 'accounts/server'
import { privateKeyToAccount } from 'viem/accounts'

export default {
  async fetch(request, env) {
    const handler = Handler.relay({
      feePayer: {
        account: privateKeyToAccount(env.FEE_PAYER_PRIVATE_KEY),
      },
      path: '/fee-payer',
    })
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
