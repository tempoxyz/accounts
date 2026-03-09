import { Mppx, tempo } from 'mppx/server'
import { Handler, Kv } from 'zyzz/server'

const webauthn = Handler.webauthn({
  kv: Kv.memory(),
  origin: 'http://localhost:5173',
  path: '/webauthn',
  rpId: 'localhost',
})

const payment = Mppx.create({
  methods: [
    tempo.charge({
      currency: '0x20c0000000000000000000000000000000000000',
      recipient: '0x0000000000000000000000000000000000000001',
      testnet: true,
    }),
  ],
  realm: 'zyzz-playground',
  secretKey: 'playground-secret-key',
})

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

    return webauthn.fetch(request)
  },
} satisfies ExportedHandler
