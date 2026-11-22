/**
 * Serves the routes of the demos of "Subscriptions", under `/api/subscriptions`. One merchant
 * account receives each charge, and pays its fees.
 *
 * | Route | Demo | Answer |
 * | --- | --- | --- |
 * | `/auth/*` | Charge each period | The sign-in routes of the `backend` plugin |
 * | `POST /charge` | Charge each period | A charge of the period, or its refusal |
 * | `GET /plan?account=0x…` | Pay MPP subscriptions | A 402 challenge, or the plan and its charges |
 *
 * @module
 */
import { Accounts } from 'accounts'
import { backend, viem } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Credential } from 'mppx'
import { Mppx, Store as MppStore, tempo } from 'mppx/server'
import { isAddress, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Actions, Addresses, ExecutionError, Scopes } from 'viem/tempo'
import * as Store from './Store.ts'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** Private key of the merchant, which receives each charge and pays its fees. A secret. */
      MERCHANT_PRIVATE_KEY?: `0x${string}`
      /** Key of the HMAC of the MPP challenges, so only this Worker issues them. A secret. */
      MPP_SECRET_KEY?: string | undefined
    }
  }
}

/** A charge of a subscription, as a demo shows it. */
export type Charge = {
  /** Transaction hash of the charge. */
  reference: string
  /** When the charge settled, as an ISO 8601 time. */
  timestamp: string
}

/** Answer of `GET /plan` for a subscriber. */
export type Plan = {
  /** Charges of the subscription, oldest first. */
  charges: readonly Charge[]
  /** When the subscription ends, as an ISO 8601 time. */
  expires: string
}

/** Answer of `POST /charge`: the charge, or why the route refused it. */
export type ChargeResult =
  | {
      /** The route holds no session with an access key, such as after its expiry. */
      error: 'invalid_session'
    }
  | {
      /** The access key spent its limit of the period. */
      error: 'limit_exceeded'
      /** When the next period starts, as an ISO 8601 time. Absent when the node names none. */
      periodEnd?: string | undefined
    }
  | Charge

/** Path that each route of the topic starts with. */
export const path = '/api/subscriptions'

/** Amount of each charge, in OUSD. */
const amount = '1'

/** Length of a period of both demos, in seconds. A short one shows a second period in a minute. */
const period = 60

/** Time that the MPP subscription lasts, in milliseconds. */
const lifetime = 10 * 60_000

/** Answers a request to a route of the topic. */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)
  const { MERCHANT_PRIVATE_KEY, MPP_SECRET_KEY } = env

  if (!MERCHANT_PRIVATE_KEY || !MPP_SECRET_KEY)
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503 })
  const merchant = privateKeyToAccount(MERCHANT_PRIVATE_KEY)

  if (pathname.startsWith(`${path}/auth/`))
    return instance(request, { merchant }).handler.fetch(request)
  if (pathname === `${path}/charge` && request.method === 'POST')
    return charge(request, { merchant })
  if (pathname === `${path}/plan` && request.method === 'GET')
    return plan(request, { merchant, secretKey: MPP_SECRET_KEY })
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * Returns the backend's instance for the origin of `request`, which is its client ID. Each sign-in
 * requests an access key that sends 1 OUSD each period, only to the merchant, for an hour.
 *
 * The Worker creates the instance in each request, since one deployment serves several origins. An
 * app with one origin creates it once, so concurrent requests of a session share one refresh.
 */
function instance(request: Request, options: instance.Options) {
  const { merchant } = options
  const { origin } = new URL(request.url)

  return Accounts.create({
    accessKey: () => ({
      expiry: '1h',
      limits: [{ limit: amount, period, token: 'ousd' }],
      scopes: [
        Scopes.tip20(Addresses.ousd).transfer({
          recipients: [merchant.address],
        }),
      ],
    }),
    chain: 'testnet',
    clientId: origin,
    handler: { basePath: path },
    plugins: [
      backend({ store: Store.create({ prefix: 'subscriptions:backend:' }) }),
      viem(),
    ],
    // Without a registration, Tempo ID returns only to the root of the origin.
    redirectUri: `${origin}/`,
  })
}

declare namespace instance {
  type Options = {
    /** The merchant, the only recipient of the access key. */
    merchant: ReturnType<typeof privateKeyToAccount>
  }
}

/**
 * Charges the period of the request's session: the session's access key sends 1 OUSD to the
 * merchant, which pays the fee. A second charge in one period answers 409 `limit_exceeded`, with
 * the start of the next period. A request without a session, or after the access key's expiry,
 * answers 401 `invalid_session`.
 */
async function charge(request: Request, options: instance.Options) {
  const { merchant } = options

  // Another site cannot post a charge with the session's cookie.
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'forbidden' }, { status: 403 })

  const accounts = instance(request, options)
  const session = await accounts.session.get(request)
  if (session?.method !== 'tempo-id' || !session.accessKey)
    return Response.json({ error: 'invalid_session' } satisfies ChargeResult, {
      status: 401,
    })
  const client = accounts.viem({ session })
  const send = () =>
    client.token.transferSync({
      amount: parseUnits(amount, 6),
      // The access key's limit holds only the charge, so the merchant pays the fee.
      feePayer: merchant,
      to: merchant.address,
      token: Addresses.ousd,
    })

  try {
    const { receipt } = await send().catch(async (error: unknown) => {
      if (
        ExecutionError.from(error as Error).errorName !== 'InsufficientBalance'
      )
        throw error
      // Only the demo: an app's user adds funds on Tempo ID's deposit page.
      await Actions.faucet.fundSync(client, {
        account: session.accessKey!.account,
      })
      return send()
    })
    return Response.json({
      reference: receipt.transactionHash,
      timestamp: new Date().toISOString(),
    } satisfies ChargeResult)
  } catch (error) {
    const refusal = spent(error)
    if (!refusal) throw error
    return Response.json(
      {
        error: 'limit_exceeded',
        periodEnd: refusal.periodEnd
          ? new Date(Number(refusal.periodEnd) * 1000).toISOString()
          : undefined,
      } satisfies ChargeResult,
      { status: 409 },
    )
  }
}

/**
 * Returns Viem's `AccessKeySpendingLimitExceededError` among `error` and its causes, or
 * `undefined` for another failure. Several copies of Viem can load, so the name identifies it.
 */
function spent(error: unknown) {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const entry = current as {
      cause?: unknown
      name?: unknown
      periodEnd?: bigint | undefined
    }
    if (entry.name === 'AccessKeySpendingLimitExceededError') return entry
    current = entry.cause
  }
  return undefined
}

/**
 * Serves the MPP subscription of the Tempo Account of the `account` query parameter: 1 OUSD each
 * period, for ten minutes. Without an active subscription, it answers a 402 challenge. With one, it
 * answers the charges, and first charges a period that ended.
 */
async function plan(request: Request, options: plan.Options) {
  const { merchant, secretKey } = options
  const account = new URL(request.url).searchParams.get('account')

  if (!account || !isAddress(account))
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  const subscriber = account.toLowerCase()

  const plans = Store.create({ prefix: 'subscriptions:plan:' })
  const subscriptions = Store.create({ prefix: 'subscriptions:mpp:' })
  // mppx reuses a subscription only for the same request, so a paid subscription keeps the expiry of
  // its challenge, and so does the request that pays a challenge. mppx refuses a challenge that
  // this Worker did not issue, so a subscriber cannot choose an expiry.
  const now = Date.now()
  // The latest expiry of a subscription that starts now. Each challenge that this Worker issued
  // names one no later, so a later one is a credential that mppx has not verified yet.
  const latest = Math.ceil(now / 1000) * 1000 + lifetime
  const paid = await plans.getItem(`paid:${subscriber}`)
  const expires = (() => {
    if (typeof paid === 'string' && Date.parse(paid) > now) return paid

    const offered = offer(request)
    if (offered && Date.parse(offered) > now && Date.parse(offered) <= latest)
      return offered

    return new Date(latest).toISOString()
  })()
  // No entry of the subscription is read after its expiry, when a request starts another one. An
  // anonymous request makes mppx write its access key before any credential, so each entry expires
  // with the subscription, and no request leaves a permanent entry in KV. The server's own bound
  // caps the expiry, so no request leaves a long-lived entry either.
  const expiresAt = Math.min(Date.parse(expires), latest) + lifetime

  /** Returns the stored charges of the subscription, oldest first. */
  const read = async () =>
    ((await plans.getItem(`charges:${subscriber}:${expires}`)) ??
      []) as readonly Charge[]

  // The charges after each charge of this request. A read of KV can miss a write of the request.
  let charges: readonly Charge[] | undefined
  /** Adds the charge of `parameters.receipt` to the charges of the paid subscription. */
  async function record(parameters: { receipt: Charge }) {
    const { reference, timestamp } = parameters.receipt
    charges = [...(await read()), { reference, timestamp }]
    await Promise.all([
      plans.setItem(`charges:${subscriber}:${expires}`, charges, { expiresAt }),
      plans.setItem(`paid:${subscriber}`, expires, { expiresAt }),
    ])
  }

  const mppx = Mppx.create({
    methods: [
      tempo.subscription({
        account: merchant,
        currency: Addresses.ousd,
        // The merchant pays the fee of each charge, so the subscriber needs only OUSD.
        feePayer: true,
        hooks: { activated: record, renewed: record },
        // The account that signs the credential is the subscriber, so no one attaches the
        // approval of another account.
        resolve(parameters) {
          const { source } = parameters
          if (source && source.address.toLowerCase() !== subscriber) return null
          // mppx keeps one access key for each key, and Tempo refuses a second approval of an
          // access key. The expiry in the key gives each subscription its own.
          return { key: `account:${subscriber}:${expires}` }
        },
        // KV has no atomic update, so two concurrent requests of one subscriber can both charge.
        // An app keeps its subscriptions in a store with one, such as a Durable Object.
        store: MppStore.cloudflare({
          delete: (key) => subscriptions.removeItem(key),
          get: async (key) => (await subscriptions.getItem(key)) ?? null,
          put: (key, value) => subscriptions.setItem(key, value, { expiresAt }),
          async update(key, fn) {
            const current = await subscriptions.getItem(key)
            const change = fn(typeof current === 'string' ? current : null)
            if (change.op === 'set')
              await subscriptions.setItem(key, change.value, { expiresAt })
            if (change.op === 'delete') await subscriptions.removeItem(key)
            return change.result
          },
        }),
        testnet: true,
      }),
    ],
    secretKey,
  })

  const result = await mppx.tempo.subscription({
    amount,
    // mppx refuses a subscription that ends before its challenge.
    expires: new Date(now + lifetime / 2).toISOString(),
    periodCount: String(period),
    periodUnit: 'dev_second',
    subscriptionExpires: expires,
  })(request)
  if (result.status === 402) return result.challenge

  charges ??= await read()
  return result.withReceipt(
    Response.json({ charges, expires } satisfies Plan, {
      headers: { 'cache-control': 'no-store' },
    }),
  )
}

declare namespace plan {
  type Options = instance.Options & {
    /** Key of the HMAC of the challenges. */
    secretKey: string
  }
}

/**
 * Returns the expiry of the subscription of the challenge that `request` pays, or `undefined` for a
 * request with no payment.
 */
function offer(request: Request) {
  try {
    const { subscriptionExpires } =
      Credential.fromRequest(request).challenge.request
    if (typeof subscriptionExpires === 'string') return subscriptionExpires
  } catch {
    // A request with no credential, or a malformed one, pays no challenge.
  }
  return undefined
}
