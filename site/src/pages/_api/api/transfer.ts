import { Mppx, tempo } from 'mppx/server'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

const mppx = Mppx.create({
  methods: [
    tempo.charge({
      testnet: true,
    }),
  ],
  realm: 'accounts.tempo.xyz',
  secretKey: 'demo',
})

export async function GET(request: Request) {
  const result = await mppx.charge({
    amount: '100',
    currency: pathUsd,
    description: 'Server-initiated transfer demo',
    recipient: '0x0000000000000000000000000000000000000001',
  })(request)

  if (result.status === 402) return result.challenge

  return result.withReceipt(
    Response.json({
      success: true,
      message: 'Thanks for your $100.',
    }),
  )
}
