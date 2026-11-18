/**
 * Serves the routes of the demos of "Fee sponsorship", under `/api/fee-sponsorship`. Each route
 * pays the fee of a payment of a signed-in user of the site, on Tempo testnet.
 *
 * | Route                                    | Demo                  | Fee payer                                    |
 * | ---------------------------------------- | --------------------- | -------------------------------------------- |
 * | `POST /tempo-api/relay`                  | Use Tempo API         | The sponsor of the site's Tempo API key      |
 * | `POST /fee-payer/relay`                  | Host fee payers       | The site's own account                       |
 *
 * The site is public, so each route limits the payments of each user, and pays only for a payment
 * of the Tempo Account that signed in.
 * @module
 */
import { Accounts } from 'accounts'
import { relay } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { TempoAddress } from 'ox/tempo'
import { decodeFunctionData, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Addresses, Relay } from 'viem/tempo'
import * as Store from './Store.ts'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /**
       * The private key of the site's fee payer, an account that holds funds on Tempo testnet. A
       * secret, never a var. Without it, the route of "Host fee payers" answers 503.
       */
      FEE_PAYER_PRIVATE_KEY?: `0x${string}`
      /**
       * The site's Tempo API key, with the `rpc-relay:sponsor` scope. A secret, never a var.
       * Without it, the route of "Use Tempo API" answers 503.
       */
      TEMPO_API_KEY?: string
    }
  }
}

/** Path that each route of the topic starts with. */
export const path = '/api/fee-sponsorship'

/** The chain of the demos, Tempo testnet. */
const chainId = 42431

/** The most payments that the routes sponsor for one user in each {@link period}. */
const limit = 3

/** The length of the window of {@link limit}, in seconds. KV keeps no entry for less. */
const period = 60

/** The largest body of a relay request, in bytes. A fill of one transfer takes about 1 KiB. */
const maxBodySize = 16 * 1024

/**
 * The largest gas limit that the fee payer signs for. The first transfer of an access key carries
 * its key authorization, and takes about 5 million.
 */
const maxGas = 6_000_000n

/** The largest fee per gas that the fee payer signs for, in attodollars: about 16 times the lowest base fee. */
const maxFeePerGas = 10_000_000_000n

// The instance of each demo, for each origin that serves the site, such as a preview deployment's.
// The verifier of a relay route keeps the issuer's key set, so an origin holds one instance of each.
const instances = {
  feePayer: new Map<string, ReturnType<typeof createFeePayer>>(),
  tempoApi: new Map<string, ReturnType<typeof createTempoApi>>(),
}

/**
 * Answers a request to a route of the topic. The page's origin is its client ID, so each route
 * accepts only the sign-ins of the app at the request's own origin. A route without its secret
 * answers 503.
 */
export async function fetch(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url)
  const route = pathname.slice(path.length)
  const apiKey = env.TEMPO_API_KEY
  const privateKey = env.FEE_PAYER_PRIVATE_KEY

  if (route === '/tempo-api/relay') {
    if (!apiKey) return unavailable('TEMPO_API_KEY')
    const accounts = once(instances.tempoApi, origin, () =>
      createTempoApi({ apiKey, origin }),
    )
    return bounded(request) ?? accounts.relay.fetch(request)
  }

  if (route === '/fee-payer/relay') {
    if (!privateKey) return unavailable('FEE_PAYER_PRIVATE_KEY')
    const accounts = once(instances.feePayer, origin, () =>
      createFeePayer({ origin, privateKey }),
    )
    return bounded(request) ?? accounts.relay.fetch(request)
  }

  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * Returns the instance of "Use Tempo API". Its relay route verifies each access token, runs
 * {@link authorize}, then sends the request to the Tempo API's `/rpc/sponsor/<chainId>`.
 */
function createTempoApi(options: createTempoApi.Options) {
  const { apiKey, origin } = options

  return Accounts.create({
    chain: 'testnet',
    clientId: origin,
    plugins: [relay({ apiKey, authorize })],
  })
}

declare namespace createTempoApi {
  /** Options of the instance. */
  type Options = {
    /** The site's Tempo API key. */
    apiKey: string
    /** Origin of the page, which is the app's client ID. */
    origin: string
  }
}

/**
 * Returns the instance of "Host fee payers". Its relay route verifies each access token and runs
 * {@link authorize}. The site's fee payer then signs for the fee through Viem's `Relay.feePayer`,
 * if {@link validate} accepts the filled transaction.
 */
function createFeePayer(options: createFeePayer.Options) {
  const { origin, privateKey } = options

  return Accounts.create({
    chain: 'testnet',
    clientId: origin,
    plugins: [
      relay({
        authorize,
        plugins: [
          Relay.feePayer({
            account: privateKeyToAccount(privateKey),
            validate,
          }),
        ],
      }),
    ],
  })
}

declare namespace createFeePayer {
  /** Options of the instance. */
  type Options = {
    /** Origin of the page, which is the app's client ID. */
    origin: string
    /** The private key of the site's fee payer. */
    privateKey: `0x${string}`
  }
}

/**
 * Accepts or refuses the caller of a relay request, whose access token verified. It refuses a
 * request beyond the user's limit, a request that is no fill, and a fill whose sender is not the
 * Tempo Account of one of the token's access keys on the chain.
 */
async function authorize(
  options: Parameters<NonNullable<relay.Options.Verified['authorize']>>[0],
) {
  const { request, token } = options

  // The fee payer signs at the fill, so the page's raw transaction carries its signature and goes
  // to the chain's RPC. The route thus serves only fills, whose sender the body names.
  const body = (await request.json().catch(() => undefined)) as
    | { method?: unknown; params?: readonly { from?: unknown }[] }
    | undefined
  const sender = (() => {
    const from = body?.params?.[0]?.from
    if (typeof from !== 'string') return undefined
    try {
      return TempoAddress.resolve(from as TempoAddress.Address)
    } catch {
      return undefined
    }
  })()
  if (
    body?.method !== 'eth_fillTransaction' ||
    !sender ||
    // An origin client ID is a third-party app, whose tokens name no `accounts`. The access keys
    // that Tempo ID signed for the app name the Tempo Account of each.
    !token.accessKeys.some(
      (accessKey) =>
        accessKey.chainId === chainId &&
        isAddressEqual(accessKey.account, sender),
    )
  )
    return Response.json({ error: 'forbidden' }, { status: 403 })

  if (await exceeded(request, token.userId)) return slowDown()
}

/**
 * Accepts or refuses a filled transaction for the site's fee payer: OUSD transfers only, within
 * {@link maxGas} and {@link maxFeePerGas}. A refused fill falls back to a transaction whose sender
 * pays its own fee.
 */
function validate(
  request: Parameters<NonNullable<Relay.feePayer.Options['validate']>>[0],
) {
  if (!request.gas || request.gas > maxGas) return false
  if (!request.maxFeePerGas || request.maxFeePerGas > maxFeePerGas)
    return 'tx_fee_limit_exceeded'
  const calls = request.calls ?? [
    { data: request.data, to: request.to, value: request.value },
  ]
  return (
    calls.length > 0 &&
    calls.every((call) => {
      if (
        !call.to ||
        !isAddressEqual(TempoAddress.resolve(call.to), Addresses.ousd)
      )
        return false
      if (call.value) return false
      const { functionName } = (() => {
        try {
          return decodeFunctionData({
            abi: Abis.tip20,
            data: call.data ?? '0x',
          })
        } catch {
          return { functionName: undefined }
        }
      })()
      return functionName === 'transfer' || functionName === 'transferWithMemo'
    })
  )
}

/**
 * Counts a payment of the user `userId` on the route of `request`, and returns whether it exceeds
 * {@link limit} in the current {@link period}. Each route counts its own payments. The count is in
 * the Worker's KV namespace, which is eventually consistent, so the limit is approximate.
 */
async function exceeded(request: Request, userId: string) {
  const store = Store.create({ prefix: 'fee-sponsorship:limit:' })
  const window = Math.floor(Date.now() / (period * 1000))
  const key = `${new URL(request.url).pathname}:${userId}:${window}`

  const count = Number((await store.getItem(key)) ?? 0)
  if (count >= limit) return true
  await store.setItem(key, count + 1, {
    expiresAt: (window + 1) * period * 1000,
  })
  return false
}

/**
 * Refuses a payment beyond the user's limit. The answer names no `retry-after`: Viem waits for
 * that long, then sends the request again, so the page would show no refusal.
 */
function slowDown() {
  return Response.json({ error: 'slow_down' }, { status: 429 })
}

/**
 * Refuses a relay request with a large body, or with no length, before the route parses it. Returns
 * `undefined` for a request that the route serves.
 */
function bounded(request: Request) {
  const length = Number(request.headers.get('content-length'))
  if (request.method === 'POST' && (!length || length > maxBodySize))
    return Response.json({ error: 'invalid_request' }, { status: 413 })
  return undefined
}

/** Refuses a request to a route whose secret `name` the Worker does not hold. */
function unavailable(name: string) {
  return Response.json(
    {
      error: {
        code: -32002,
        data: { reason: 'temporarily_unavailable' },
        message: `Route unavailable: the Worker holds no \`${name}\`. Set the secret.`,
      },
      id: null,
      jsonrpc: '2.0',
    },
    { status: 503 },
  )
}

/** Returns the value of `key` in `map`, which `create` returns at the first read. */
function once<value>(
  map: Map<string, value>,
  key: string,
  create: () => value,
) {
  const value = map.get(key) ?? create()
  map.set(key, value)
  return value
}
