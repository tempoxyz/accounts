/**
 * The metered API of the page, in the Worker that serves the page. It serves one fortune in three
 * transports, each paid in an MPP session:
 *
 * - `GET /v1/fortune` (HTTP): 0.001 OUSD per call, with one voucher per request.
 * - `GET /v1/stream` (SSE): 0.0001 OUSD per word, with vouchers that the stream requests.
 * - `GET /v1/socket` (WebSocket): 0.0001 OUSD per word, with vouchers in socket frames.
 *
 * The first payment opens a channel with a deposit, and the close credential settles it on chain.
 * One Durable Object holds the state of every channel, so each voucher and close updates it
 * atomically.
 *
 * The payee settles a channel only when the payer closes it through the API. A payee in production
 * also answers each close that a payer requests on chain, with `tempo.session.superviseCloses` on a
 * schedule, since the payer withdraws the whole deposit after the close grace period.
 *
 * Before `pnpm dev`, copy `.env.example` to `.env` and fill in its secrets. The payee
 * sends each close transaction, so fund its address on Tempo testnet first.
 * @module
 */
import { DurableObject, env } from 'cloudflare:workers'
import { Mppx, Store, tempo } from 'mppx/server'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Addresses } from 'viem/tempo'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The origin of the page. Its host is the realm of each challenge. */
      APP_URL: string
      /** The HMAC secret of the challenges, at least 32 bytes. A secret in `.env`. */
      MPP_SECRET_KEY: string
      /** The object that holds the channels of the payee. */
      PAYEE: DurableObjectNamespace<Payee>
      /**
       * The payee's private key. It receives each channel's payments and pays the fee of each close.
       * A secret in `.env`.
       */
      PAYEE_PRIVATE_KEY: Hex
    }
  }
}

/** The fortunes that the API serves. */
const fortunes = [
  'A voucher in time saves nine transactions.',
  'Many small payments make one settlement.',
  'The channel that closes on time keeps its deposit.',
  'Pay for what you use, and use what you pay for.',
] as const

/** The price of each route, in OUSD, and the deposit that its challenge suggests. */
const prices = {
  '/v1/fortune': {
    amount: '0.001',
    suggestedDeposit: '0.05',
    unitType: 'request',
  },
  '/v1/socket': {
    amount: '0.0001',
    suggestedDeposit: '0.05',
    unitType: 'word',
  },
  '/v1/stream': {
    amount: '0.0001',
    suggestedDeposit: '0.05',
    unitType: 'word',
  },
} as const

/** Returns a random fortune. */
function fortune() {
  const [index] = crypto.getRandomValues(new Uint32Array(1))
  return fortunes[index! % fortunes.length]!
}

/** Yields the words of a fortune, one each 200 ms. The session charges each word. */
async function* words() {
  for (const word of fortune().split(' ')) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    yield word
  }
}

/**
 * The payee. Its SQLite storage holds the state of each channel: its deposit, the highest voucher,
 * the amount spent, and its close. Each storage call is synchronous, so no other request of the
 * object runs between the read and the write of an update.
 */
export class Payee extends DurableObject {
  /** The payment handler of the payee, which issues challenges and verifies credentials. */
  readonly mppx
  /** Serves a paid WebSocket, and verifies the escrow before each word. */
  readonly socket

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)

    const kv = ctx.storage.kv
    const store = Store.cloudflare({
      delete: (key) => Promise.resolve(void kv.delete(key)),
      get: (key) => Promise.resolve(kv.get<string>(key) ?? null),
      put: (key, value) => Promise.resolve(kv.put(key, value)),
      update: (key, fn) => {
        const change = fn(kv.get<string>(key) ?? null)
        if (change.op === 'set') kv.put(key, change.value)
        if (change.op === 'delete') kv.delete(key)
        return Promise.resolve(change.result)
      },
    })
    const [session] = tempo.session({
      account: privateKeyToAccount(env.PAYEE_PRIVATE_KEY),
      // Tempo testnet, the chain of the page's access key.
      chainId: tempoModerato.id,
      // The page's access key may spend only OUSD.
      currencies: [Addresses.ousd],
      sse: true,
      store,
    })
    this.mppx = Mppx.create({
      methods: [session],
      realm: new URL(env.APP_URL).host,
      secretKey: env.MPP_SECRET_KEY,
    })
    this.socket = session.extensions.serveWebSocket
  }

  /**
   * Serves one paid request. A request without a credential receives a 402 challenge, which is
   * also the WebSocket's probe. A `close` credential settles the channel, and its response holds
   * no content.
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = this.mppx.session(prices[url.pathname as keyof typeof prices])
    const upgrade =
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'

    if (upgrade && url.pathname === '/v1/socket') {
      const pair = new WebSocketPair()
      pair[1].accept()
      // The socket receives each voucher in a frame, and each word after its charge. The challenge
      // binds the route, so the query string is left out.
      await this.socket({
        generate: words(),
        route,
        socket: pair[1],
        url: new URL(url.pathname, url),
      })
      // A socket closes after a minute, paid or not, so an idle one holds no connection.
      setTimeout(() => {
        try {
          pair[1].close(1008, 'The session timed out.')
        } catch {
          // The stream closed the socket first.
        }
      }, 60_000)
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    const result = await route(request)
    if (result.status === 402) return result.challenge
    if (url.pathname === '/v1/fortune')
      return result.withReceipt(Response.json({ fortune: fortune() }))
    return result.withReceipt(words())
  }
}

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/v1/*`.
export default {
  fetch(request) {
    if (!(new URL(request.url).pathname in prices))
      return Response.json({ error: 'not_found' }, { status: 404 })

    // One object serves every channel, so its requests run one at a time.
    return env.PAYEE.getByName('payee').fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
