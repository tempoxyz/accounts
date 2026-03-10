import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Handler, Kv } from '@tempoxyz/accounts/server'

export default {
  async fetch(request, env) {
    const handler = Handler.compose([
      Handler.webauthn({
        kv: Kv.cloudflare(env.KEYS_KV),
        origin: env.ORIGIN,
        path: '/auth',
        rpId: env.RP_ID,
      }),
      Handler.feePayer({
        account: privateKeyToAccount(env.FEE_PAYER_PRIVATE_KEY as Hex),
        path: '/fee-payer',
      }),
    ])
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
