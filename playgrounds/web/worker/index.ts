import { Handler, Kv } from 'accounts/server'
import { Mppx, Store as MppStore, tempo } from 'mppx/server'
import { Subscription } from 'mppx/tempo'
import { privateKeyToAccount } from 'viem/accounts'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const testnet = process.env.VITE_ENV !== 'mainnet'
const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const subscriptionAccessAccount = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000002',
)
const subscriptionAccessKey = {
  accessKeyAddress: subscriptionAccessAccount.address,
  keyType: 'secp256k1',
} as const
const store = MppStore.memory()
const subscriptions = Subscription.fromStore(store)
const inspections = new Map<string, unknown>()
let activationCount = 0
let renewalCount = 0

const payment = Mppx.create({
  methods: [
    tempo.charge({
      account,
      currency: pathUsd,
      feePayer: true,
      testnet,
    }),
    tempo.session({
      account,
      currency: pathUsd,
      feePayer: true,
      sse: { poll: true },
      store,
      suggestedDeposit: '0.03',
      testnet,
    }),
    tempo.subscription({
      activate: async ({ request, resolved, source }) => {
        activationCount += 1
        const record = {
          accessKey: subscriptionAccessKey,
          amount: request.amount,
          billingAnchor: secondIso(),
          chainId: request.methodDetails?.chainId,
          currency: request.currency,
          lastChargedPeriod: 0,
          lookupKey: resolved.key,
          payer: source ?? undefined,
          periodCount: request.periodCount,
          periodUnit: request.periodUnit,
          recipient: request.recipient,
          reference: txHash(activationCount),
          subscriptionExpires: request.subscriptionExpires,
          subscriptionId: `playground_${activationCount}`,
          timestamp: secondIso(),
        } satisfies Subscription.SubscriptionRecord
        return {
          receipt: Subscription.createSubscriptionReceipt(record),
          subscription: record,
        }
      },
      amount: '0.01',
      currency: pathUsd,
      periodCount: '1',
      periodUnit: 'day',
      recipient: account.address,
      renew: async ({ periodIndex, subscription }) => {
        renewalCount += 1
        const record = {
          ...subscription,
          lastChargedPeriod: periodIndex,
          reference: txHash(100 + renewalCount),
          timestamp: secondIso(),
        }
        return {
          receipt: Subscription.createSubscriptionReceipt(record),
          subscription: record,
        }
      },
      resolve: ({ input }) => ({ accessKey: subscriptionAccessKey, key: subscriptionKey(input) }),
      store,
      subscriptionExpires: secondIso(Date.now() + 365 * 24 * 60 * 60 * 1_000),
      testnet,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
})

payment.onPaymentSuccess(recordInspection)

const auth = Handler.auth({ origin: process.env.ORIGIN, path: '/auth' })

const handler = Handler.compose([
  Handler.webAuthn({
    kv: Kv.memory(),
    origin: process.env.ORIGIN,
    path: '/webauthn',
    rpId: process.env.RP_ID,
  }),
  Handler.relay({
    feePayer: {
      account,
      name: 'Playground',
      url: 'https://playground.tempo.xyz',
    },
    path: '/relay',
  }),
  auth,
])

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/mpp/inspect') {
      const reference = url.searchParams.get('reference')
      if (!reference) return Response.json({ error: 'reference required' }, { status: 400 })
      return Response.json(inspections.get(reference) ?? null)
    }

    if (url.pathname === '/mpp/subscription/state')
      return Response.json(await getSubscriptionState(request))

    if (url.pathname === '/mpp/subscription/force-renewal') {
      const subscription = await subscriptions.getByKey(subscriptionKey(request))
      if (!subscription) return Response.json({ status: 'missing' })
      await subscriptions.put({
        ...subscription,
        billingAnchor: secondIso(Date.now() - 2 * 24 * 60 * 60 * 1_000),
        lastChargedPeriod: 0,
      })
      return Response.json({ status: 'ready', subscriptionId: subscription.subscriptionId })
    }

    if (url.pathname === '/mpp/subscription/cancel') {
      const subscription = await subscriptions.getByKey(subscriptionKey(request))
      if (!subscription) return Response.json({ status: 'missing' })
      await subscriptions.put({
        ...subscription,
        canceledAt: secondIso(),
      })
      return Response.json({ status: 'canceled', subscriptionId: subscription.subscriptionId })
    }

    if (url.pathname === '/mpp/charge/free')
      return charge(request, { amount: '0', description: 'Free proof' })

    if (url.pathname === '/mpp/charge/paid')
      return charge(request, { amount: '0.01', description: 'Paid fortune' })

    if (url.pathname === '/mpp/session/content') {
      const result = await payment.tempo.session({
        amount: '0.01',
        suggestedDeposit: '0.03',
        unitType: 'request',
      })(request)
      if (result.status === 402) return result.challenge
      return result.withReceipt(
        Response.json({
          message: 'paid session content',
        }),
      )
    }

    if (url.pathname === '/mpp/session/stream') {
      const result = await payment.tempo.session({
        amount: '0.005',
        suggestedDeposit: '0.05',
        unitType: 'chunk',
      })(request)
      if (result.status === 402) return result.challenge
      return result.withReceipt(streamChunks())
    }

    if (url.pathname === '/mpp/subscription/news') {
      const result = await payment.tempo.subscription({})(request)
      if (result.status === 402) return result.challenge
      return result.withReceipt(
        Response.json({
          article: 'The MPP playground now covers recurring access.',
          state: await getSubscriptionState(request),
        }),
      )
    }

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

    // Reads the SIWE-issued session and returns the connected address.
    // Demonstrates how an authenticated endpoint consumes Handler.auth.
    if (url.pathname === '/me') {
      const session = await auth.getSession(request)
      if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })
      return Response.json({ address: session.address, chainId: session.chainId })
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>

async function charge(request: Request, options: Parameters<typeof payment.tempo.charge>[0]) {
  const result = await payment.tempo.charge(options)(request)
  if (result.status === 402) return result.challenge
  return result.withReceipt(
    Response.json({
      amount: options.amount,
      message: 'paid charge content',
      modes: options.supportedModes ?? ['push', 'pull'],
    }),
  )
}

async function getSubscriptionState(request: Request) {
  const subscription = await subscriptions.getByKey(subscriptionKey(request))
  if (!subscription) return { status: 'missing' }
  return {
    billingAnchor: subscription.billingAnchor,
    canceledAt: subscription.canceledAt ?? null,
    lastChargedPeriod: subscription.lastChargedPeriod,
    reference: subscription.reference,
    subscriptionId: subscription.subscriptionId,
  }
}

async function* streamChunks() {
  const chunks = ['session', 'payments', 'meter', 'streaming', 'chunks']
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 80))
    yield chunk
  }
}

function subscriptionKey(input: Request) {
  return `playground:${input.headers.get('X-User-Id') ?? 'default'}:news`
}

function txHash(index: number) {
  return `0x${index.toString(16).padStart(64, '0')}` as const
}

function secondIso(ms = Date.now()) {
  return new Date(Math.ceil(ms / 1_000) * 1_000).toISOString()
}

function recordInspection(
  context: Parameters<typeof payment.onPaymentSuccess>[0] extends (
    context: infer context,
  ) => unknown
    ? context
    : never,
) {
  const receipt = context.receipt as { reference: string; subscriptionId?: string | undefined }
  const payload = context.credential?.payload as Record<string, unknown> | undefined
  const summary = {
    challenge: {
      id: context.challenge.id,
      intent: context.challenge.intent,
      method: context.challenge.method,
      request: context.challenge.request,
    },
    credential: summarizeCredential(payload),
    method: context.method,
    receipt: context.receipt,
  }
  inspections.set(receipt.reference, summary)
  if (receipt.subscriptionId) inspections.set(receipt.subscriptionId, summary)
  inspections.set(context.challenge.id, summary)
}

function summarizeCredential(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined
  if (typeof payload.action === 'string')
    return {
      action: payload.action,
      channelId: payload.channelId,
      type: payload.type ?? 'voucher',
    }
  if (typeof payload.type === 'string') return { type: payload.type }
  return undefined
}
