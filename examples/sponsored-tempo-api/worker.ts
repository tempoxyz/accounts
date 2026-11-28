/**
 * The Worker of the page and its relay route. The route relays each sponsorship request of the page
 * to the Tempo API's sponsor endpoint with the app's Tempo API key, so the sponsor of that key pays
 * the fees. The app runs no fee payer account, and the page never holds the API key.
 *
 * The `relay` plugin accepts only a valid Tempo ID access token of this app, which the page's
 * `viem({ relay })` sends. `authorize` then limits each user's requests. The API key's own limits
 * are a backstop.
 * @module
 */
import { Accounts } from 'accounts/lite'
import { relay } from 'accounts/plugins'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The relay requests of each user ID, at most 10 a minute. */
      RELAY_LIMIT: RateLimit
      /** The app's Tempo API key, with the `rpc-relay:sponsor` scope. A secret, never a var. */
      TEMPO_API_KEY: string
    }
  }
}

// Without the API key, the relay plugin serves Viem's relay with no fee payer, so the Worker
// refuses to start.
if (!env.TEMPO_API_KEY)
  throw new Error(
    'Missing `TEMPO_API_KEY`: the relay route has no Tempo API key. Set it in `.dev.vars`, or with `wrangler secret put`.',
  )

/**
 * The instance, on Tempo testnet. Its relay route verifies each access token, then sends the
 * request to the Tempo API's `/rpc/sponsor/<chainId>` of testnet, with the API key.
 */
const accounts = Accounts.create({
  chain: 'testnet',
  clientId: process.env.APP_URL,
  plugins: [
    relay({
      apiKey: env.TEMPO_API_KEY,
      // Refuses each request beyond the user's limit, before it reaches the Tempo API.
      async authorize(options) {
        const { success } = await env.RELAY_LIMIT.limit({
          key: options.token.userId,
        })
        if (!success)
          return Response.json(
            { error: 'slow_down' },
            { headers: { 'retry-after': '60' }, status: 429 },
          )
      },
    }),
  ],
})

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/api/*`.
export default new Hono().post('/api/relay', (c) =>
  accounts.relay.fetch(c.req.raw),
)
