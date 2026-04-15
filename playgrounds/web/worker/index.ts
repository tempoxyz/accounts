import { Handler, Kv } from 'accounts/server'
import { Mppx, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

import { handler as cliAuth } from './cli-auth.js'

const payment = Mppx.create({
  methods: [
    tempo.charge({
      currency: '0x20c0000000000000000000000000000000000000',
      recipient: '0x0000000000000000000000000000000000000001',
      testnet: process.env.VITE_ENV === 'testnet',
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
})

const handler = Handler.compose([
  cliAuth,
  Handler.webAuthn({
    kv: Kv.memory(),
    origin: process.env.ORIGIN,
    path: '/webauthn',
    rpId: process.env.RP_ID,
  }),
  Handler.relay({
    feePayer: {
      account: privateKeyToAccount(process.env.PRIVATE_KEY),
    },
    path: '/relay',
  }),
])

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/zero-dollar-auth') {
      const result = await payment.charge({
        amount: '0',
      })(request)

      if (result.status === 402) return result.challenge

      return result.withReceipt(Response.json({ authenticated: true }))
    }

    if (url.pathname === '/fortune') {
      const result = await payment.charge({
        amount: '0.01',
      })(request)

      if (result.status === 402) return result.challenge

      return result.withReceipt(
        Response.json({ fortune: 'Your code will compile on the first try.' }),
      )
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
