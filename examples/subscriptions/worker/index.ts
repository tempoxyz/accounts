import { Hono } from 'hono'
import { Store } from 'mppx'
import { Mppx, tempo } from 'mppx/hono'
import { privateKeyToAccount } from 'viem/accounts'

const app = new Hono()
const devSubscriptionPeriodSeconds = 10
const periodUnitSeconds = {
  dev_second: 1,
  day: 86_400,
  week: 604_800,
} as const
const account = privateKeyToAccount(process.env.ACCOUNT_PRIVATE_KEY)
const feePayerPolicy = {
  maxGas: 6_000_000n,
  maxTotalFee: 1_000_000_000_000_000_000n,
}
const subscriptionIds = new Set<string>()
const subscriptionHooks = {
  activated: ({ subscription }) => {
    subscriptionIds.add(subscription.subscriptionId)
  },
  renewed: ({ subscription }) => {
    subscriptionIds.add(subscription.subscriptionId)
  },
} satisfies NonNullable<Parameters<typeof tempo.subscription>[0]['hooks']>

// Persisted subscription state. In-memory is fine for the example, but in
// production use a durable store (Cloudflare KV, Durable Objects, Postgres,
// etc.) so subscriptions survive worker restarts.
const store = Store.memory()

async function fastForwardSubscription(subscriptionId: string) {
  return store.update(`tempo:subscription:record:${subscriptionId}`, (current) => {
    const record = current as Record<string, unknown> | null
    if (!record) return { op: 'noop', result: false }
    const periodCount = typeof record.periodCount === 'string' ? Number(record.periodCount) : NaN
    const periodUnit =
      typeof record.periodUnit === 'string'
        ? periodUnitSeconds[record.periodUnit as keyof typeof periodUnitSeconds]
        : undefined
    const periodSeconds =
      Number.isFinite(periodCount) && periodUnit
        ? periodCount * periodUnit
        : devSubscriptionPeriodSeconds
    const lastChargedPeriod =
      typeof record.lastChargedPeriod === 'number' && Number.isFinite(record.lastChargedPeriod)
        ? record.lastChargedPeriod
        : 0
    const targetPeriodIndex = lastChargedPeriod + 1
    const billingAnchor = new Date(
      Date.now() - (targetPeriodIndex * periodSeconds + 1) * 1_000,
    ).toISOString()
    return {
      op: 'set',
      value: {
        ...record,
        billingAnchor,
      },
      result: true,
    }
  })
}

async function renewSubscriptions() {
  await Promise.all(
    [...subscriptionIds].map((subscriptionId) =>
      tempo.renewSubscription({ store, subscriptionId }),
    ),
  )
}

function toErrorDetails(error: unknown) {
  const value = error as {
    details?: unknown
    message?: unknown
    name?: unknown
    shortMessage?: unknown
  }
  const message =
    typeof value.shortMessage === 'string'
      ? value.shortMessage
      : typeof value.message === 'string'
        ? value.message
        : 'Subscription renewal failed.'
  return {
    details: typeof value.details === 'string' ? value.details : undefined,
    message,
    name: typeof value.name === 'string' ? value.name : 'Error',
  }
}

const mppx = Mppx.create({
  methods: [
    tempo.subscription({
      account,
      currency: '0x20c0000000000000000000000000000000000000',
      feePayer: true,
      feePayerPolicy,
      hooks: subscriptionHooks,
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
    periodCount: devSubscriptionPeriodSeconds,
    periodUnit: 'dev_second',
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

app.post('/api/dev/subscriptions/renew', async (c) => {
  const results = await Promise.all(
    [...subscriptionIds].map(async (subscriptionId) => {
      let fastForwarded: unknown
      try {
        fastForwarded = await fastForwardSubscription(subscriptionId)
        const renewal = await tempo.renewSubscription({ store, subscriptionId })
        return {
          fastForwarded,
          receipt: renewal?.receipt ?? null,
          renewed: renewal !== null,
          subscriptionId,
        }
      } catch (error) {
        const details = toErrorDetails(error)
        console.warn('Subscription renewal failed.', { error: details, subscriptionId })
        return {
          error: {
            ...details,
            hint: details.message.includes('SpendingLimitExceeded')
              ? 'Wait for one real dev billing period after activation; local fast-forwarding cannot move the on-chain spending window.'
              : undefined,
          },
          fastForwarded,
          receipt: null,
          renewed: false,
          subscriptionId,
        }
      }
    }),
  )
  return c.json({ results })
})

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(renewSubscriptions())
  },
}
