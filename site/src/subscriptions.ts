import { Store } from 'mppx'
import { Mppx, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

const privateKey =
  process.env.SUBSCRIPTIONS_PRIVATE_KEY ??
  process.env.RELAY_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

/** Local testing plan used by the interactive subscriptions docs demo. */
export const subscriptionPlan = {
  amount: '0.01',
  periodCount: 10,
  periodUnit: 'dev_second',
  subscriptionExpires: '2030-01-01T00:00:00.000Z',
} as const

type SubscriptionResponse =
  | { challenge: Response; status: 402 }
  | { status: 200; withReceipt: (response: Response) => Response }

type Subscriptions = {
  tempo: {
    subscription: ((options: typeof subscriptionPlan) => (
      request: Request,
    ) => Promise<SubscriptionResponse>) & {
      renew: (parameters: { subscriptionId: string }) => Promise<{
        receipt: unknown
      } | null>
    }
  }
}

/** Shared mppx instance for the interactive subscriptions docs demo. */
export const subscriptions: Subscriptions = Mppx.create({
  methods: [
    tempo.subscription({
      account: privateKeyToAccount(privateKey as `0x${string}`),
      currency: '0x20c0000000000000000000000000000000000000',
      feePayer: true,
      resolve({ input }) {
        const subscriber = input.headers.get('X-Subscriber')
        if (!subscriber) return null
        return { key: `articles:${subscriber.toLowerCase()}` }
      },
      store: Store.memory(),
      testnet: true,
    }),
  ],
  realm: 'accounts.tempo.xyz',
  secretKey: 'demo',
})
