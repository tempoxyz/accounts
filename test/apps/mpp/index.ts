/**
 * The MPP test app: a merchant in Node, whose routes answer a request without a payment with a 402
 * challenge of mppx, and a request with a valid credential with the content and its
 * `Payment-Receipt`. Each route takes OUSD on the suite's node, for the merchant's payee. The
 * process holds each spent transaction, each channel, and each subscription in its memory.
 *
 * The program reads the amount of each route from `MPP_AMOUNTS`, as the JSON of `Apps.mpp.amounts`,
 * the payee's private key from `MPP_PRIVATE_KEY`, the key that binds each challenge to it from
 * `MPP_SECRET_KEY`, its port from `PORT`, and the node's RPC URL from `TEMPO_RPC_URL`, which
 * `test/Apps.ts` sets. The amounts below are those of the suite.
 *
 * | Route                      | Effect                                                             |
 * | -------------------------- | ------------------------------------------------------------------ |
 * | `/`                        | Responds with 200, so a run reads that the merchant listens        |
 * | `/charge`                  | Charges 0.01 OUSD for one request                                  |
 * | `/charge/large`            | Charges 150 OUSD, above the limit of each access key of the suite  |
 * | `/charge/medium`           | Charges 2 OUSD, which a spent limit of 5 OUSD refuses              |
 * | `/proof`                   | Takes a proof of the account, which moves nothing                  |
 * | `/session`                 | Charges 0.01 OUSD for each request, with a voucher of a channel    |
 * | `/subscription`            | Charges 0.01 OUSD every five seconds, after one approval           |
 * | `POST /subscription/renew` | Charges the current period of `subscriptionId`, as a cron does     |
 *
 * ```sh
 * node --import tsx index.ts
 * ```
 * @module
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Mppx, Request as MppxRequest, Store, tempo } from 'mppx/server'
import * as Http from 'node:http'
import { createClient, http } from 'viem'
import { Account, Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

/** The OUSD that each route charges, as decimal strings. */
type Amounts = {
  /** The amount of `/charge`. */
  charge: string
  /** The amount of `/charge/large`. */
  chargeLarge: string
  /** The amount of `/charge/medium`. */
  chargeMedium: string
  /** The amount of each request of `/session`. */
  session: string
  /** The deposit that `/session` suggests for a channel. */
  sessionDeposit: string
  /** The amount of each period of `/subscription`. */
  subscription: string
}

/** The amount of each route, which the suite's specs read from the same source. */
const amounts: Amounts = JSON.parse(process.env.MPP_AMOUNTS!)

/** The node's client, which reads each payment and sends each transaction of the payee. */
const client = createClient({
  chain: tempoLocalnet,
  transport: http(process.env.TEMPO_RPC_URL!),
})

/** The token of each charge: OUSD. */
const currency = Addresses.ousd

/** The account that receives each payment, closes each session, and pays each subscription's fee. */
const payee = Account.fromSecp256k1(
  process.env.MPP_PRIVATE_KEY! as `0x${string}`,
)

/** The subscription's period: a charge every five seconds, so a test meets the next one. */
const period = { periodCount: '5', periodUnit: 'dev_second' } as const

/** The spent transactions, the channels, and the subscriptions, in the memory of the process. */
const store = Store.memory()

const [session] = tempo.session({
  account: payee,
  chainId: tempoLocalnet.id,
  currency,
  getClient: () => client,
  store,
})

/** The payment handler of each route. */
const payment = Mppx.create({
  methods: [
    tempo.charge({
      chainId: tempoLocalnet.id,
      currency,
      getClient: () => client,
      recipient: payee.address,
      // The store records each spent transaction, so a credential pays one request.
      store,
    }),
    tempo.subscription({
      account: payee,
      chainId: tempoLocalnet.id,
      currency,
      // The payee pays each charge's fee, so the payer needs only OUSD.
      feePayer: true,
      getClient: () => client,
      // The payer's own signature names the subscription, so the route trusts no header for it.
      requireCredential: true,
      resolve: (parameters) =>
        parameters.source
          ? { key: `account:${parameters.source.address.toLowerCase()}` }
          : null,
      store,
      ...period,
    }),
    session,
  ],
  secretKey: process.env.MPP_SECRET_KEY!,
})

/** The merchant's routes. Any origin reads the challenge and the receipt, as a public API allows. */
const app = new Hono()
  .use(cors({ exposeHeaders: ['Payment-Receipt', 'WWW-Authenticate'] }))
  .get('/', (c) => c.text('The merchant listens.'))
  .all('/charge', (c) => charge(c.req.raw, { amount: amounts.charge }))
  .all('/charge/large', (c) =>
    charge(c.req.raw, { amount: amounts.chargeLarge }),
  )
  .all('/charge/medium', (c) =>
    charge(c.req.raw, { amount: amounts.chargeMedium }),
  )
  .all('/proof', async (c) => {
    const result = await payment.tempo.charge({
      amount: '0',
      description: 'A proof of the account',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(Response.json({ proven: true }))
  })
  .all('/session', async (c) => {
    const result = await payment.tempo.session({
      amount: amounts.session,
      suggestedDeposit: amounts.sessionDeposit,
      unitType: 'request',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(
      Response.json({ content: 'Paid with a voucher.' }),
    )
  })
  .get('/subscription', async (c) => {
    // mppx checks one request once, so each check below receives a request of its own.
    const subscribe = (days: number) =>
      payment.tempo.subscription({
        ...period,
        amount: amounts.subscription,
        description: 'A fortune every five seconds',
        subscriptionExpires: expires({ days }),
      })(new Request(c.req.raw))
    const current = await subscribe(2)
    // A credential names its challenge's expiry, which the day before set for an approval across
    // midnight UTC, so a refused credential is checked against that day's expiry too.
    const result =
      current.status === 402 && c.req.header('authorization')
        ? await subscribe(1)
        : current
    if (result.status === 402)
      return current.status === 402 ? current.challenge : result.challenge
    return result.withReceipt(
      Response.json({ fortune: 'Your next build is green.' }),
    )
  })
  .post('/subscription/renew', async (c) => {
    const body = await c.req.json<{ subscriptionId?: unknown }>()
    if (typeof body.subscriptionId !== 'string')
      return c.json({ error: '`subscriptionId` is absent. Send one.' }, 400)

    // A period that has not ended charges nothing, and mppx charges each period once.
    const renewed = await payment.tempo.subscription.renew({
      subscriptionId: body.subscriptionId,
    })
    return c.json({ receipt: renewed?.receipt ?? null })
  })

/** Charges `options.amount` OUSD for `request`, and responds with the challenge or the content. */
async function charge(request: Request, options: charge.Options) {
  const { amount } = options
  const result = await payment.tempo.charge({
    amount,
    description: `A fortune for ${amount} OUSD`,
  })(request)
  if (result.status === 402) return result.challenge
  return result.withReceipt(
    Response.json({ fortune: 'Your code compiles on the first try.' }),
  )
}

declare namespace charge {
  type Options = {
    /** The OUSD that the route charges, as a decimal string. */
    amount: string
  }
}

/**
 * Returns the end of a subscription: `days` after the last midnight UTC, the same for every request
 * of a day, so a challenge and its credential name the same request.
 */
function expires(options: expires.Options) {
  const day = 86_400_000
  return new Date(
    Math.floor(Date.now() / day) * day + options.days * day,
  ).toISOString()
}

declare namespace expires {
  type Options = {
    /** The days after the last midnight UTC. */
    days: number
  }
}

Http.createServer(
  MppxRequest.toNodeListener((request) => app.fetch(request)),
).listen(Number(process.env.PORT))
