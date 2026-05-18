import { Store } from 'mppx'
import { Mppx, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

const privateKey =
  process.env.SUBSCRIPTIONS_PRIVATE_KEY ??
  process.env.RELAY_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(privateKey as `0x${string}`)
const currency = '0x20c0000000000000000000000000000000000000'
const store = Store.memory()

/** Shared mppx instance for the interactive subscriptions docs demo. */
export const subscriptions = Mppx.create({
  methods: [
    tempo.subscription({
      account,
      currency,
      feePayer: true,
      resolve({ input }) {
        const subscriber = input.headers.get('X-Subscriber')
        if (!subscriber) return null
        return { key: `articles:${subscriber.toLowerCase()}` }
      },
      store,
      testnet: true,
    }),
  ],
  realm: 'accounts.tempo.xyz',
  secretKey: 'demo',
})

export function renewSubscription(subscriptionId: string) {
  return tempo.renewSubscription({
    store,
    subscriptionId,
  })
}

/** Local testing plan used by the interactive subscriptions docs demo. */
export const subscriptionPlan = {
  amount: '0.01',
  periodCount: 1,
  periodUnit: 'day',
  subscriptionExpires: '2030-01-01T00:00:00.000Z',
} as const
