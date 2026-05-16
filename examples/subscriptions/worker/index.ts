import { Hono } from 'hono'
import { Store } from 'mppx'
import { Mppx, tempo } from 'mppx/hono'
import { privateKeyToAccount } from 'viem/accounts'

const app = new Hono()

// Persisted subscription state. In-memory is fine for the example, but in
// production use a durable store (Cloudflare KV, Durable Objects, Postgres,
// etc.) so subscriptions survive worker restarts.
const store = Store.memory()

const mppx = Mppx.create({
  methods: [
    tempo.subscription({
      account: privateKeyToAccount(process.env.ACCOUNT_PRIVATE_KEY),
      currency: '0x20c0000000000000000000000000000000000000',
      feePayer: true,
      // The lookup key identifies *which* subscription a request belongs to.
      // For this example we scope subscriptions per `X-Subscriber` header
      // (the connected account address). Real apps would derive it from
      // a session cookie, JWT, or API key.
      resolve: ({ input }) => {
        const subscriber = input.headers.get('X-Subscriber')
        if (!subscriber) return null
        return { key: `news:${subscriber.toLowerCase()}` }
      },
      store,
      testnet: true,
    }),
  ],
})

app.get(
  '/api/articles',
  mppx.subscription({
    amount: '0.01',
    periodCount: 1,
    periodUnit: 'day',
    subscriptionExpires: new Date(
      Math.ceil((Date.now() + 365 * 24 * 60 * 60 * 1_000) / 1_000) * 1_000,
    ).toISOString(),
  }),
  (c) =>
    c.json({
      articles: [
        { id: 1, title: 'Tempo ships subscriptions in mppx 0.6.20' },
        { id: 2, title: 'Why recurring access keys beat per-call signatures' },
        { id: 3, title: 'Designing fee-payer flows for global apps' },
      ],
    }),
)

export default app
