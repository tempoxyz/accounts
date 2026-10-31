import { Handler } from 'accounts/server'
import { Mppx, tempo } from 'mppx/server'
import { pathusd } from 'viem/tokens'

const payment = Mppx.create({
  methods: [
    tempo.charge({
      currency: pathusd(4217).address,
      recipient: '0x0000000000000000000000000000000000000001',
      testnet: true,
    }),
  ],
  secretKey: 'dev-secret-key-change-me-in-production',
})

const handler = Handler.relay({ path: '/relay' })

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
