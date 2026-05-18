import { Mppx, Store, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const demoPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const account = privateKeyToAccount(
  (process.env.ACCOUNT_PRIVATE_KEY as `0x${string}` | undefined) ?? demoPrivateKey,
)
const store = Store.memory()
const oneYear = 365 * 24 * 60 * 60 * 1_000
const subscriptionExpires = new Date(
  Math.ceil((Date.now() + oneYear) / 1_000) * 1_000,
).toISOString()

const mppx = Mppx.create({
  methods: [
    tempo.subscription({
      account,
      currency: pathUsd,
      feePayer: true,
      feePayerPolicy: {
        maxGas: 6_000_000n,
        maxTotalFee: 1_000_000_000_000_000_000n,
      },
      resolve: ({ input }) => {
        const subscriber = input.headers.get('X-Subscriber')
        if (!subscriber) return null
        return { key: `articles:${subscriber.toLowerCase()}` }
      },
      store,
      testnet: true,
    }),
  ],
  realm: 'accounts.tempo.xyz',
  secretKey: process.env.MPP_SECRET_KEY ?? 'demo',
})

/** Handles the docs subscription demo endpoint. */
export async function GET(request: Request) {
  const result = await mppx.tempo.subscription({
    amount: '0.01',
    description: 'Articles subscription demo',
    periodCount: 1,
    periodUnit: 'day',
    subscriptionExpires,
  })(request)

  if (result.status === 402) return result.challenge

  return result.withReceipt(
    Response.json({
      articles: [
        { id: 1, title: 'Subscriptions are live' },
        { id: 2, title: 'Recurring access keys keep requests quiet' },
      ],
    }),
  )
}
