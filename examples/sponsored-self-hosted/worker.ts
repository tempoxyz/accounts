/**
 * The Worker of the page and its relay route, at the page's origin. On the route, the app's own fee
 * payer signs for the fees of the page's OUSD transfers, so the page holds no key that pays fees.
 *
 * Nothing outside the app caps the fee payer's spend, so the route accepts only:
 *
 * - A valid Tempo ID access token of this app, which the page's `viem({ relay })` sends.
 * - A body of at most 16 KiB (the Worker's route).
 * - A fill, at most 10 a minute for each user, whose sender is the Tempo Account of one of the
 *   token's access keys on the instance's chain (`authorize`).
 * - A transaction of OUSD transfers only, within a gas limit and a fee cap (`validate`).
 * @module
 */
import { Accounts } from 'accounts/lite'
import { relay } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { TempoAddress } from 'ox/tempo'
import { decodeFunctionData, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Addresses, Relay } from 'viem/tempo'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The private key of the fee payer. A secret from `.dev.vars` or `wrangler secret put`, never a var. */
      FEE_PAYER_PRIVATE_KEY: `0x${string}`
      /** The relay requests of each user ID, at most 10 a minute. */
      RELAY_LIMIT: RateLimit
    }
  }
}

/** The largest body of a relay request, in bytes. A fill of one transfer takes about 1 KiB. */
const maxBodySize = 16 * 1024

/** The largest gas limit that the fee payer signs for. A transfer with a key authorization takes far less. */
const maxGas = 1_000_000n

/** The largest fee per gas that the fee payer signs for, in attodollars: about 16 times the lowest base fee. */
const maxFeePerGas = 10_000_000_000n

// Without a private key, the route has no fee payer, so the Worker refuses to start. The example
// file's empty `0x` counts as no key.
if (!/^0x[0-9a-fA-F]{64}$/.test(env.FEE_PAYER_PRIVATE_KEY ?? ''))
  throw new Error(
    'Missing `FEE_PAYER_PRIVATE_KEY`: the relay route has no fee payer. Set a 32-byte hex private key in `.dev.vars`, or with `wrangler secret put`.',
  )

/**
 * The instance, on Tempo testnet. Its relay route verifies each access token and runs `authorize`,
 * then the fee payer signs for the fees through Viem's `Relay.feePayer` if `validate` accepts the
 * filled transaction. `accounts.handler` serves the route at `POST /api/relay`.
 */
const accounts = Accounts.create({
  chain: 'testnet',
  clientId: process.env.APP_URL,
  handler: { relay: true },
  plugins: [
    relay({
      async authorize(options) {
        const { success } = await env.RELAY_LIMIT.limit({
          key: options.token.userId,
        })
        if (!success)
          return Response.json(
            { error: 'slow_down' },
            { headers: { 'retry-after': '60' }, status: 429 },
          )

        // The fee payer signs at the fill, so the page's raw transaction carries its signature and
        // goes to the chain's RPC. The route then serves only fills, whose sender the body names.
        // The fee payer's signature covers the sender, so a fill names the sender that it pays for.
        const body = (await options.request.json().catch(() => undefined)) as
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
          // An origin client ID is a third-party app, whose tokens name no `accounts`. The access
          // keys that Tempo ID signed for the app name the Tempo Account of each.
          !options.token.accessKeys.some(
            (accessKey) =>
              accessKey.chainId === accounts.config.chainId &&
              isAddressEqual(accessKey.account, sender),
          )
        )
          return Response.json({ error: 'forbidden' }, { status: 403 })
      },
      plugins: [
        Relay.feePayer({
          account: privateKeyToAccount(env.FEE_PAYER_PRIVATE_KEY),
          // A refused fill falls back to a transaction whose sender pays its own fees.
          validate(request) {
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
                return (
                  functionName === 'transfer' ||
                  functionName === 'transferWithMemo'
                )
              })
            )
          },
        }),
      ],
    }),
  ],
})

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/api/relay`. The
// route parses the whole body before `authorize`, so the Worker refuses a large body, or one without
// a length, before the route reads it.
export default new Hono().all('/api/relay', async (c) => {
  const length = Number(c.req.header('content-length'))
  if (c.req.method === 'POST' && (!length || length > maxBodySize))
    return c.json({ error: 'invalid_request' }, 413)
  return accounts.handler.fetch(c.req.raw)
})
