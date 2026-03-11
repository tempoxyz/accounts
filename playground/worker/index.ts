import { Handler, Kv } from '@tempoxyz/accounts/server'
import { Mppx, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

const payment = Mppx.create({
  methods: [
    tempo.charge({
      currency: '0x20c0000000000000000000000000000000000000',
      recipient: '0x0000000000000000000000000000000000000001',
      testnet: true,
    }),
  ],
  realm: 'accounts-playground',
  secretKey: 'playground-secret-key',
})

const handler = Handler.compose([
  Handler.webauthn({
    kv: Kv.memory(),
    origin: 'https://localhost:5173',
    path: '/webauthn',
    rpId: 'localhost',
  }),
  Handler.feePayer({
    account: privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    ),
    path: '/fee-payer',
  }),
])

export default {
  async fetch(request) {
    const url = new URL(request.url)

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
} satisfies ExportedHandler
