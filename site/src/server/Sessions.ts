/**
 * Serves the routes of the demos of "Sessions", under `/api/sessions`. One payee receives the
 * payments of both demos, and pays the fee of each close.
 *
 * | Route                                | Result                                                    |
 * | ------------------------------------ | --------------------------------------------------------- |
 * | `GET /api/sessions/channel/payee`    | The payee that a channel of "Open payment channels" names |
 * | `POST /api/sessions/channel/fortune` | A fortune, for a voucher that pays its price              |
 * | `POST /api/sessions/channel/close`   | The close of a channel, at its highest voucher            |
 * | `GET /api/sessions/mpp/fortune`      | A fortune, for a voucher of an MPP session                |
 *
 * The routes read `PAYEE_PRIVATE_KEY`, and the MPP route also `MPP_SECRET_KEY`. Without them, each
 * route answers 503. The payee pays the fee of each close in OUSD, so its address holds OUSD on
 * Tempo testnet before the first one.
 *
 * KV has no atomic update. Two vouchers of one channel that arrive together can thus both pass,
 * which a demo accepts. A payee in production keeps its channels in a store with atomic updates,
 * such as a Durable Object, as `examples/mpp-session` does.
 * @module
 */
import { env } from 'cloudflare:workers'
import { Mppx, Store as MppxStore, tempo } from 'mppx/server'
import { Address } from 'ox'
import { Channel, SignatureEnvelope } from 'ox/tempo'
import { createClient, formatUnits, type Hex, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Actions, Addresses } from 'viem/tempo'
import * as Store from './Store.ts'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The HMAC secret of the challenges of the MPP route, at least 32 bytes. A secret. */
      MPP_SECRET_KEY?: string | undefined
      /**
       * The private key of the payee of each channel. It receives the payments, and pays the fee
       * of each close. A secret.
       */
      PAYEE_PRIVATE_KEY: Hex
    }
  }
}

/** Path that each route of the topic starts with. */
export const path = '/api/sessions'

/** Tempo testnet, the chain of the demos, which pays each fee in OUSD. */
const chain = tempoModerato.extend({ feeToken: Addresses.ousd })

/** Time that the store keeps a channel after its last voucher, in milliseconds. */
const lifetime = 24 * 60 * 60 * 1000

/** The price of one fortune, in OUSD, and in its base units. */
const price = { amount: '0.001', units: parseUnits('0.001', 6) } as const

/** The fortunes that the routes serve. */
const fortunes = [
  'A voucher in time saves nine transactions.',
  'Many small payments make one settlement.',
  'The channel that closes on time keeps its deposit.',
  'Pay for what you use, and use what you pay for.',
] as const

/** The highest voucher that the payee holds of a channel, and the deposit that covers it. */
type Entry = {
  /** The channel of the voucher. */
  channel: Channel.Resolved
  /** The total that the voucher pays, in base units. */
  cumulativeAmount: bigint
  /** The deposit of the channel at the last read of the chain, in base units. */
  deposit: bigint
  /** The voucher's signature. */
  signature: Hex
}

/** A voucher, as a request carries it. */
type Voucher = Pick<Entry, 'channel' | 'cumulativeAmount' | 'signature'>

/** Answers a request to a route of the topic. */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)
  const route = `${request.method} ${pathname.slice(path.length)}`

  if (!env.PAYEE_PRIVATE_KEY)
    return refuse(503, 'not_configured', 'The payee holds no private key.')

  if (route === 'GET /channel/payee')
    return Response.json({
      payee: privateKeyToAccount(env.PAYEE_PRIVATE_KEY).address,
    })
  if (route === 'POST /channel/fortune') return pay(request)
  if (route === 'POST /channel/close') return close(request)
  if (pathname === `${path}/mpp/fortune`) return meter(request)
  return refuse(404, 'not_found', 'The topic holds no such route.')
}

/**
 * Serves a fortune for a voucher of a self-managed channel. The voucher pays the price above the
 * highest voucher that the payee holds, within the deposit of the channel. The route reads the
 * chain only for a voucher above the deposit that it knows, such as the first one, or the first
 * after a top-up.
 */
async function pay(request: Request): Promise<Response> {
  const voucher = parse(await request.json().catch(() => undefined))
  if (!voucher)
    return refuse(400, 'invalid_request', 'The body holds no voucher.')
  const { channel, cumulativeAmount } = voucher

  const client = payee()
  if (
    !Address.isEqual(channel.payee, client.account.address) ||
    !Address.isEqual(channel.token, Addresses.ousd)
  )
    return refuse(
      402,
      'invalid_channel',
      'The channel names another payee or token. Open a channel to the payee, in OUSD.',
    )

  const channelId = Channel.computeId(channel, { chainId: chain.id })
  if (!verify(voucher, channelId))
    return refuse(
      402,
      'invalid_voucher',
      'The signer of the channel did not sign the voucher. Sign it with the access key that the channel names.',
    )

  const store = Store.create({ prefix: 'sessions:channel:' })
  const entry = (await store.getItem(channelId)) as Entry | undefined
  const spent = entry?.cumulativeAmount ?? 0n
  if (cumulativeAmount < spent + price.units)
    return refuse(
      402,
      'insufficient_voucher',
      `The voucher pays less than ${price.amount} OUSD above the last one. Sign a voucher for ${formatUnits(spent + price.units, 6)} OUSD.`,
    )

  const deposit = await (async () => {
    if (entry && cumulativeAmount <= entry.deposit) return entry.deposit
    const state = await Actions.channel.getStates(client, {
      channel: channelId,
    })
    // The payer withdraws the deposit after the grace period of a requested close.
    return state.closeRequestedAt === 0 ? state.deposit : 0n
  })()
  if (cumulativeAmount > deposit)
    return refuse(
      402,
      'insufficient_deposit',
      'The voucher exceeds the deposit of the channel. Top up the channel, or open another.',
    )

  await store.setItem(
    channelId,
    { ...voucher, deposit },
    { expiresAt: Date.now() + lifetime },
  )
  return Response.json({
    fortune: fortune(),
    spent: cumulativeAmount.toString(),
  })
}

/**
 * Closes a self-managed channel. The payee captures the highest voucher that it holds, and the
 * chain returns the rest of the deposit to the payer. A channel without a voucher returns its
 * whole deposit.
 */
async function close(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => undefined)) as
    | { channel?: unknown }
    | undefined
  const voucher = parse({
    channel: body?.channel,
    cumulativeAmount: '0',
    signature: '0x',
  })
  if (!voucher)
    return refuse(400, 'invalid_request', 'The body holds no channel.')

  const client = payee()
  if (!Address.isEqual(voucher.channel.payee, client.account.address))
    return refuse(
      402,
      'invalid_channel',
      'The channel names another payee. Close a channel of the payee.',
    )

  const channelId = Channel.computeId(voucher.channel, { chainId: chain.id })
  const store = Store.create({ prefix: 'sessions:channel:' })
  const entry = (await store.getItem(channelId)) as Entry | undefined
  const { channel, cumulativeAmount, signature } = entry ?? voucher

  try {
    const { receipt, refundedToPayer, settledToPayee } =
      await Actions.channel.closeSync(client, {
        captureAmount: cumulativeAmount,
        channel,
        cumulativeAmount,
        signature,
      })
    await store.removeItem(channelId)
    return Response.json({
      refunded: refundedToPayer.toString(),
      settled: settledToPayee.toString(),
      transactionHash: receipt.transactionHash,
    })
  } catch {
    return refuse(
      502,
      'close_failed',
      'The chain refused the close. Check that the channel is open.',
    )
  }
}

/**
 * Serves a fortune in an MPP session. A request without a credential receives a 402 challenge.
 * The first credential opens a channel, each later one holds a voucher, and a `close` credential
 * settles the channel, with a response that holds no fortune.
 */
async function meter(request: Request): Promise<Response> {
  if (!env.PAYEE_PRIVATE_KEY || !env.MPP_SECRET_KEY)
    return refuse(503, 'not_configured', 'The payee holds no HMAC secret.')

  const channels = Store.create({ prefix: 'sessions:mpp:' })
  const get = async (key: string) =>
    ((await channels.getItem(key)) as string | undefined) ?? null
  const put = (key: string, value: string) =>
    Promise.resolve(
      channels.setItem(key, value, { expiresAt: Date.now() + lifetime }),
    )
  const remove = (key: string) => Promise.resolve(channels.removeItem(key))
  const [session] = tempo.session({
    account: privateKeyToAccount(env.PAYEE_PRIVATE_KEY),
    chainId: chain.id,
    // The access key of the demo may spend only OUSD.
    currencies: [Addresses.ousd],
    store: MppxStore.cloudflare({
      delete: remove,
      get,
      put,
      // KV has no atomic update, so the read and the write are two calls.
      update: async (key, fn) => {
        const change = fn(await get(key))
        if (change.op === 'set') await put(key, change.value)
        if (change.op === 'delete') await remove(key)
        return change.result
      },
    }),
  })
  const mppx = Mppx.create({
    methods: [session],
    realm: new URL(request.url).host,
    secretKey: env.MPP_SECRET_KEY,
  })

  const result = await mppx.session({
    amount: price.amount,
    suggestedDeposit: '0.05',
    unitType: 'request',
  })(request)
  if (result.status === 402) return result.challenge
  return result.withReceipt(Response.json({ fortune: fortune() }))
}

/** Returns a client of the payee, which reads the chain and sends each close. */
function payee() {
  return createClient({
    account: privateKeyToAccount(env.PAYEE_PRIVATE_KEY),
    chain,
    transport: http(),
  })
}

/** Returns a random fortune. */
function fortune() {
  const [index] = crypto.getRandomValues(new Uint32Array(1))
  return fortunes[index! % fortunes.length]!
}

/** Returns the voucher of a request's body, or `undefined` for another shape. */
function parse(body: unknown): Voucher | undefined {
  try {
    const { channel, cumulativeAmount, signature } = body as Record<
      string,
      never
    >
    if (typeof signature !== 'string' || !/^0x[0-9a-f]*$/i.test(signature))
      return undefined
    return {
      channel: Channel.from(channel),
      cumulativeAmount: BigInt(cumulativeAmount),
      signature,
    }
  } catch {
    return undefined
  }
}

/** Returns a refusal as JSON, with a `message` that the demo shows. */
function refuse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status })
}

/**
 * Returns whether the access key that the channel names as its `authorizedSigner` signed the
 * voucher. A channel without one fails, since the demo opens none. The chain accepts only a
 * primitive signature, so a keychain envelope fails too.
 */
function verify(voucher: Voucher, channelId: Hex) {
  const { channel, cumulativeAmount } = voucher
  const payload = Channel.getVoucherSignPayload({
    chainId: chain.id,
    channelId,
    cumulativeAmount,
  })

  try {
    // A signature that is no envelope, or a keychain envelope, throws.
    return SignatureEnvelope.verify(SignatureEnvelope.from(voucher.signature), {
      address: channel.authorizedSigner,
      payload,
    })
  } catch {
    return false
  }
}
