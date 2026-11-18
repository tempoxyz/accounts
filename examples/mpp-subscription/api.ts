/**
 * The merchant: one Worker that serves the page, signs the user in with Tempo ID, issues an MPP
 * subscription at `/v1/subscription`, and charges each period from a Cron Trigger. One Durable Object
 * runs mppx, so each change of a subscription reads and writes the object's storage with no await
 * between them. Another object holds each user's session, whose ID the browser holds in an
 * `HttpOnly` cookie, so the tokens never reach the page. The subscription takes the session's user
 * as its name.
 * @module
 */
import { Accounts } from 'accounts'
import * as AccountsCloudflare from 'accounts/cloudflare'
import { backend } from 'accounts/plugins'
import { DurableObject, env } from 'cloudflare:workers'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { createMiddleware } from 'hono/factory'
import { Mppx, Store, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'
import { pathusd } from 'viem/tokens'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings and vars, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The merchant, one object for every subscription. */
      MERCHANT: DurableObjectNamespace<Merchant>
      /** The merchant's private key, which pays the fees and receives each charge. A secret. */
      MERCHANT_PRIVATE_KEY: `0x${string}`
      /** The key of the challenges' HMAC, so only this Worker issues them. A secret. */
      MPP_SECRET_KEY: string
      /** The Durable Object of each session ID. */
      SESSIONS: AccountsCloudflare.Sessions.durableObject.Namespace
    }
  }
}

/** A charge that the page lists. */
type Charge = {
  /** The transaction hash of the charge. */
  reference: string
  /** When the charge settled, as an ISO 8601 time. */
  timestamp: string
}

/** The charges of a user, as the merchant lists them. */
type Charges = {
  /** Whether the user's paid subscription has not expired. */
  active: boolean
  /** The charges of every subscription of the user, oldest first. */
  charges: Charge[]
}

/** The variables that `auth` sets for the routes after it. */
type Variables = {
  /** The Tempo Accounts of the session's access keys, the first on the session's chain. */
  accounts: readonly `0x${string}`[]
  /** The session's user ID. */
  userId: string
}

/** The header that names the subscriber's Tempo Accounts for the merchant. Only the Worker sets it. */
const accountsHeader = 'x-user-accounts'

/** The header that names the subscriber for the merchant. Only the Worker sets it. */
const userHeader = 'x-user-id'

/** The subscription: 1 pathUSD each 30 days, on Tempo testnet. */
const plan = {
  amount: '1',
  periodCount: '30',
  periodUnit: 'day',
} as const

/**
 * The merchant's mppx instance, with its subscriptions in `kv`. The charges of each subscription
 * stay beside them, under `charges:`.
 */
function merchant(kv: SyncKvStorage) {
  const account = privateKeyToAccount(env.MERCHANT_PRIVATE_KEY)

  /** Records a charge of `lookupKey`, and the subscription that the Cron Trigger renews. */
  function record(options: {
    receipt: Charge
    subscription: { lookupKey: string; subscriptionId: string }
  }) {
    const { receipt, subscription } = options
    kv.put(`subscriptions:${subscription.subscriptionId}`, true)
    kv.put(`charges:${subscription.lookupKey}:${receipt.timestamp}`, {
      reference: receipt.reference,
      timestamp: receipt.timestamp,
    })
  }

  return Mppx.create({
    methods: [
      tempo.subscription({
        account,
        currency: pathusd(42431).address,
        // The merchant pays the fees of each charge, so the subscriber needs only pathUSD.
        feePayer: true,
        hooks: { activated: record, renewed: record },
        // The Worker names the subscriber from the user's session. The account that signs the
        // credential must be one of that user's, so no one attaches another account's approval.
        resolve({ input, source }) {
          const userId = input.headers.get(userHeader)
          if (!userId) return null
          const accounts = (input.headers.get(accountsHeader) ?? '').split(',')
          if (
            source &&
            !accounts.some(
              (account) =>
                account.toLowerCase() === source.address.toLowerCase(),
            )
          )
            return null
          return { key: `user:${userId}` }
        },
        // The object's storage is synchronous, so each update reads and writes atomically.
        store: Store.cloudflare({
          delete(key) {
            kv.delete(key)
            return Promise.resolve()
          },
          get(key) {
            return Promise.resolve(kv.get(key) ?? null)
          },
          put(key, value) {
            kv.put(key, value)
            return Promise.resolve()
          },
          update(key, fn) {
            const change = fn(kv.get<string>(key) ?? null)
            if (change.op === 'set') kv.put(key, change.value)
            if (change.op === 'delete') kv.delete(key)
            return Promise.resolve(change.result)
          },
        }),
        testnet: true,
      }),
    ],
    secretKey: env.MPP_SECRET_KEY,
  })
}

/** Returns the end of a new subscription: a year from now, in whole seconds. */
function expires() {
  return new Date(
    Math.ceil(Date.now() / 1000) * 1000 + 31_536_000_000,
  ).toISOString()
}

/** The merchant's subscriptions and charges. The Worker forwards each request and each cron to it. */
export class Merchant extends DurableObject {
  readonly mppx = merchant(this.ctx.storage.kv)

  /** Serves `/v1/subscription`: a 402 challenge, or the subscription's receipt and its charges. */
  override async fetch(request: Request) {
    const userId = request.headers.get(userHeader)!
    // mppx reuses a subscription only for the same request, so each user keeps the expiry of their
    // first challenge until it passes.
    const kv = this.ctx.storage.kv
    const stored = kv.get<string>(`expires:${userId}`)
    const subscriptionExpires =
      stored && Date.parse(stored) > Date.now() ? stored : expires()
    kv.put(`expires:${userId}`, subscriptionExpires)

    const result = await this.mppx.tempo.subscription({
      ...plan,
      subscriptionExpires,
    })(request)
    if (result.status === 402) return result.challenge

    // A paid subscription stays active until its expiry, after which the user may subscribe again.
    kv.put(`active:${userId}`, subscriptionExpires)
    return result.withReceipt(Response.json(this.charges(userId)))
  }

  /**
   * Returns the charges of the user with `userId`, oldest first, and whether their subscription is
   * active.
   */
  charges(userId: string): Charges {
    const kv = this.ctx.storage.kv
    const active = kv.get<string>(`active:${userId}`)
    return {
      active: Boolean(active && Date.parse(active) > Date.now()),
      charges: [...kv.list<Charge>({ prefix: `charges:user:${userId}:` })].map(
        ([, charge]) => charge,
      ),
    }
  }

  /** Charges each subscription whose period ended. mppx charges a period at most once. */
  async renew() {
    const ids = [...this.ctx.storage.kv.list({ prefix: 'subscriptions:' })].map(
      ([key]) => key.slice('subscriptions:'.length),
    )
    // One failed charge, such as for a subscriber without funds, leaves the others to settle.
    await Promise.allSettled(
      ids.map((subscriptionId) =>
        this.mppx.tempo.subscription.renew({ subscriptionId }),
      ),
    )
  }
}

/** The session of each session ID, in the object's storage. */
export const SESSIONS = AccountsCloudflare.DurableObject.sessions(() => ({}))

/**
 * The instance of the sessions, on Tempo testnet. Without a registration, the app's origin is its
 * client ID. A sign-in through a redirect reads no Tempo Account, so each sign-in requests an access
 * key, whose key authorization names the account. The Worker never signs with it.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'pathusd' }],
  }),
  chain: 'testnet',
  clientId: process.env.APP_URL,
  plugins: [
    backend({
      sessions: AccountsCloudflare.Sessions.durableObject(env.SESSIONS),
    }),
  ],
})

/**
 * The cookies' attributes. The `__Host-` prefix and `Secure` keep a sibling host from setting a
 * session ID of its own.
 */
const cookie = {
  httpOnly: true,
  path: '/',
  prefix: 'host',
  sameSite: 'Lax',
  secure: true,
} as const

/** Reads the session of the request's cookie, and refuses the request without one. */
const auth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const id = getCookie(c, 'sid', 'host')
  const session = id ? await accounts.backend.get({ id }) : undefined
  if (session?.method !== 'tempo-id' || !session.accessKey)
    return unauthorized(c)

  c.set('accounts', [
    ...new Set(
      [session.accessKey, ...(session.accessKeys ?? [])].map(
        (accessKey) => accessKey.account,
      ),
    ),
  ])
  c.set('userId', session.user.id)
  await next()
})

/** Refuses a request without a session, so the page signs in again. */
function unauthorized(c: Context) {
  return c.json({ error: 'invalid_session' }, 401)
}

// The page's assets never reach the Worker, since `run_worker_first` sends it only these paths.
const app = new Hono()
  // Another site cannot post `/logout`.
  .use(csrf())
  .get('/login', async (c) => {
    const { id, url } = await accounts.backend.start({
      redirectUri: new URL('/callback', c.req.url).href,
    })
    // The session ID becomes the session's cookie only once the sign-in completes.
    setCookie(c, 'pending', id, { ...cookie, maxAge: 10 * 60 })
    return c.redirect(url, 302)
  })
  .get('/callback', async (c) => {
    const id = getCookie(c, 'pending', 'host')
    deleteCookie(c, 'pending', cookie)
    if (!id) return c.text('Sign-in failed. Start again.', 400)
    await accounts.backend.complete({ id, url: c.req.url })
    setCookie(c, 'sid', id, cookie)
    return c.redirect('/', 302)
  })
  .post('/logout', async (c) => {
    const id = getCookie(c, 'sid', 'host')
    deleteCookie(c, 'sid', cookie)
    // Revokes the session's refresh token at Tempo ID, and deletes the session.
    if (id) await accounts.backend.end({ id })
    return c.redirect('/', 302)
  })
  .use('/v1/*', auth)
  .get('/v1/me', (c) =>
    // The page pays a subscription for the account on the session's chain.
    c.json({ account: c.get('accounts')[0] }),
  )
  .get('/v1/charges', async (c) => {
    return c.json(
      await env.MERCHANT.getByName('merchant').charges(c.get('userId')),
    )
  })
  .get('/v1/subscription', async (c) => {
    // The session's user, never a header of the page, names the subscriber.
    const headers = new Headers(c.req.raw.headers)
    headers.delete('cookie')
    headers.set(accountsHeader, c.get('accounts').join(','))
    headers.set(userHeader, c.get('userId'))
    return env.MERCHANT.getByName('merchant').fetch(c.req.url, { headers })
  })

export default {
  fetch: app.fetch,
  // Each run charges the subscriptions whose period ended.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(env.MERCHANT.getByName('merchant').renew())
  },
} satisfies ExportedHandler<Cloudflare.Env>
