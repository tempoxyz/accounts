/**
 * The API's MPP routes, served with mppx: a one-time charge, a zero-amount proof, and a session
 * that pays each request or each streamed chunk with a voucher. Each pays OUSD to the API's payee,
 * on the local node at `TEMPO_RPC_URL`, or on Tempo testnet. Outside a local run, the routes refuse
 * every request until `MPP_PRIVATE_KEY` and `MPP_SECRET_KEY` are set.
 * @module
 */
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { Mppx, Store, tempo } from 'mppx/server'
import { Secp256k1 } from 'ox'
import { createClient, http, parseUnits } from 'viem'
import { Account, Actions } from 'viem/tempo'
import {
  tempo as mainnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

/** The routes' configuration, each value with a default. */
export type Env = {
  /**
   * `true` in a local run, such as the Node entry's. Only then do `MPP_PRIVATE_KEY` and
   * `MPP_SECRET_KEY` default to keys that each process generates. Without it, the routes respond
   * with 500 to every request until both keys are set, since each Worker isolate would otherwise
   * issue challenges that no other isolate verifies.
   */
  MPP_LOCAL?: string | undefined
  /**
   * The payee's secp256k1 private key, whose account receives each payment and closes each session.
   * In a local run, defaults to a key that each process generates.
   */
  MPP_PRIVATE_KEY?: string | undefined
  /**
   * The key that binds each challenge to the API, of 32 bytes or more. In a local run, defaults to a
   * key that each process generates.
   */
  MPP_SECRET_KEY?: string | undefined
  /**
   * The Durable Object namespace that serves every MPP route on Workers, so a session's channel and
   * a charge's spent transaction outlive the isolate that saw them. Absent on Node, where the process
   * holds them.
   */
  MPP_SESSIONS?:
    | {
        getByName: (name: string) => {
          fetch: (request: Request) => Promise<Response>
        }
      }
    | undefined
  /**
   * The store of the sessions' channels and the charges' spent transactions, such as the Durable
   * Object's storage. Defaults to a store in the memory of the process.
   */
  MPP_STORE?: Store.AtomicStore | undefined
  /** A local Tempo node's RPC URL. Defaults to Tempo testnet. */
  TEMPO_RPC_URL?: string | undefined
}

/**
 * The OUSD that the payee holds before a session, which pays the fees of many closes. A payee below
 * it asks the faucet again.
 */
const feeReserve = parseUnits('1', 6)

/** OUSD, at its mainnet address on every Tempo chain. */
const ousd = Tokens.ousd(mainnet.id).address

/** One payment handler for each configuration whose state the process's memory holds. */
const instances = new Map<string, ReturnType<typeof create>>()

/** One payment handler for each store of a Durable Object. */
const stored = new WeakMap<Store.AtomicStore, ReturnType<typeof create>>()

/**
 * Forwards each MPP request to the one Durable Object of `MPP_SESSIONS`, whose storage holds every
 * channel and spent transaction, so no other isolate accepts a credential twice. Without the binding,
 * the request continues in this process.
 */
const forward = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!c.env?.MPP_SESSIONS) return next()
  const response = await c.env.MPP_SESSIONS.getByName('sessions').fetch(
    c.req.raw,
  )
  // A fetched response has immutable headers, and the API's CORS middleware sets its own.
  return new Response(response.body, response)
})

/**
 * Responds to `/charge`, `/proof`, `/session`, and `/stream` with a 402 challenge, or, with a
 * valid credential, with the content and its `Payment-Receipt`.
 */
export const app = new Hono<{ Bindings: Env }>()
  .use(async (c, next) => {
    if (keys(c.env)) return next()
    return c.json(
      {
        error:
          'MPP_PRIVATE_KEY and MPP_SECRET_KEY are not set. Set both outside a local run.',
      },
      500,
    )
  })
  .use(forward)
  .all('/charge', async (c) => {
    const result = await instance(c.env).payment.tempo.charge({
      amount: '0.01',
      description: 'A fortune',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(
      Response.json({ fortune: 'Your code compiles on the first try.' }),
    )
  })
  .all('/proof', async (c) => {
    const result = await instance(c.env).payment.tempo.charge({
      amount: '0',
      description: 'A proof of the account',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(Response.json({ proven: true }))
  })
  .all('/session', async (c) => {
    const mpp = instance(c.env)
    await mpp.funded()
    const result = await mpp.payment.tempo.session({
      amount: '0.01',
      suggestedDeposit: '0.03',
      unitType: 'request',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(
      Response.json({ content: 'Paid with a voucher.' }),
    )
  })
  .all('/stream', async (c) => {
    const mpp = instance(c.env)
    await mpp.funded()
    const result = await mpp.payment.tempo.session({
      amount: '0.005',
      suggestedDeposit: '0.05',
      unitType: 'chunk',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(chunks())
  })

/**
 * Returns whether the routes hold the payee's key and the challenges' key: both set, or a local run,
 * which generates each one that is absent.
 */
function keys(env: Env | undefined) {
  if (env?.MPP_LOCAL === 'true') return true
  return Boolean(env?.MPP_PRIVATE_KEY && env.MPP_SECRET_KEY)
}

/** Returns the payment handler of `env`, which the first request of each configuration creates. */
function instance(env: Env | undefined) {
  const store = env?.MPP_STORE
  if (store) {
    const existing = stored.get(store)
    if (existing) return existing
    const created = create(env)
    stored.set(store, created)
    return created
  }

  const key = [
    env?.TEMPO_RPC_URL,
    env?.MPP_PRIVATE_KEY,
    env?.MPP_SECRET_KEY,
  ].join('\n')
  const existing = instances.get(key)
  if (existing) return existing
  const created = create(env)
  instances.set(key, created)
  return created
}

/** Creates the payment handler, its payee, and its chain's client. */
function create(env: Env | undefined) {
  const chain = env?.TEMPO_RPC_URL ? tempoLocalnet : tempoTestnet
  const client = createClient({ chain, transport: http(env?.TEMPO_RPC_URL) })
  const payee = Account.fromSecp256k1(
    (env?.MPP_PRIVATE_KEY as `0x${string}` | undefined) ??
      Secp256k1.randomPrivateKey(),
  )
  const store = env?.MPP_STORE ?? Store.memory()
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        chainId: chain.id,
        currency: ousd,
        getClient: () => client,
        recipient: payee.address,
        // The store records each spent transaction, so a credential pays one request.
        store,
      }),
      tempo.session({
        account: payee,
        chainId: chain.id,
        currency: ousd,
        getClient: () => client,
        // A streamed response carries its receipts as events, which the client polls for.
        sse: { poll: true },
        store,
      }),
    ],
    realm: 'id-playground-api',
    secretKey: env?.MPP_SECRET_KEY || crypto.randomUUID(),
  })

  // The payee sends the transaction that closes a session, so it holds OUSD for its fees. A payee
  // below the fee reserve asks the chain's faucet. Concurrent session requests await the same attempt, so it
  // settles within 15 seconds, also when the request that started it is canceled. A refusal or a
  // timeout still serves the challenge, since only a close needs the fee. Each later session request
  // reads the balance again, since closes spend it.
  let funding: Promise<void> | undefined
  function funded() {
    funding ??= Promise.race([
      (async () => {
        const { amount } = await Actions.token.getBalance(client, {
          account: payee.address,
          token: ousd,
        })
        if (amount >= feeReserve) return
        await Actions.faucet.fundSync(client, { account: payee.address })
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('The faucet did not respond in 15 seconds.')),
          15_000,
        ),
      ),
    ])
      .catch((error: unknown) => {
        console.warn('The faucet did not fund the MPP payee.', error)
      })
      .finally(() => {
        funding = undefined
      })
    return funding
  }

  return { funded, payment }
}

/**
 * Yields the streamed response's chunks, a voucher paying for each. The delay between chunks keeps
 * each one visible on the pages that show the stream as it arrives.
 */
async function* chunks() {
  for (const chunk of ['Each', 'chunk', 'is', 'paid', 'for.']) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    yield chunk
  }
}
