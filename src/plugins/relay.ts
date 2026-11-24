/**
 * The plugin of an app's relay route: `accounts.relay`, the handler on the app's server that pays the
 * fees of its pages' transactions, through the Tempo API's sponsor or the app's own fee payer.
 * @module
 */
import { createClient, type LocalAccount } from 'viem'
import { Relay } from 'viem/tempo'
import type * as Accounts from '../Accounts.js'
import * as AccessToken from '../AccessToken.js'
import type * as Handler from '../internal/Handler.js'
import * as RelayHandler from '../internal/handlers/Relay.js'
import * as Settings from '../internal/viem/Settings.js'
import * as Plugin from '../Plugin.js'
import { viem } from './viem.js'

/**
 * Returns the plugin of the app's relay route, which adds `accounts.relay`: a handler of the Fetch
 * API that the app's server serves at the URL of the page's `viem({ relay })`. The page's `viem`
 * plugin with `relay` sends the sponsorship requests of each transaction to the route. A fee payer
 * then pays the fees, and the page holds no key that pays them.
 *
 * The plugin has two modes:
 *
 * | Options | Fee payer | Request goes to |
 * | --- | --- | --- |
 * | `apiKey` | The sponsor of the app's Tempo API key | The Tempo API's `/rpc/sponsor/<chainId>`, with `tempo-api-key` |
 * | `account`, or Viem's relay `plugins` | `account`, or that of the `Relay.feePayer` in `plugins` | Viem's relay, over the chain and transport of the `viem` plugin |
 *
 * ```mermaid
 * sequenceDiagram
 *   participant Page as Page (viem relay)
 *   participant Route as App route (accounts.relay)
 *   participant Relay as Tempo API or Viem relay
 *   participant RPC as Chain RPC
 *   Page->>Route: eth_fillTransaction
 *   Route->>Relay: eth_fillTransaction
 *   Relay-->>Page: the transaction, with the fee payer's signature
 *   Page->>RPC: eth_sendRawTransactionSync and every other method
 * ```
 *
 * 1. The page's transport sends a fill, or a raw transaction without its fee payer's signature, to
 *    the route. Every other request goes to the chain's RPC.
 * 2. The route relays the request, and the fee payer signs for its fees.
 * 3. The page sends the signed transaction to the chain's RPC.
 *
 * In the Viem relay mode, the plugin builds Viem's relay over the chains and transports of the
 * `viem` plugin, without the `viem` plugin's `relay` route. One instance thus serves the route and
 * sends its own transactions through it, and the route never sends a request to itself. Without a
 * `viem` plugin in `plugins`, it adds the Viem client itself, as `viem()` does, so the instance
 * holds `accounts.viem` too. Viem's fill names no chain, so the route relays `chainId`, or the
 * instance's chain at each request, which follows `switchChain`. An app that relays several chains
 * serves an instance, and a route, for each.
 *
 * `account` is short for `plugins: [Relay.feePayer({ account })]`, so the options hold one of the
 * two. Viem's relay runs `plugins` in order, and `Relay.feePayer` itself answers a raw transaction,
 * and a fill that names its sender, gas, nonce, and fee cap. A plugin after it never receives those
 * requests. A plugin that refuses a request thus goes before `Relay.feePayer`, and a limit on what
 * the fee payer signs is the `validate` of `Relay.feePayer`.
 *
 * `accounts.relay.fetch` runs in any server that serves Fetch requests, such as Hono, a Worker, or
 * Bun. With `handler: { relay: true }`, `accounts.handler` also serves it at `/relay` under its
 * `basePath`, `POST /api/relay` by default, beside the instance's other server routes.
 *
 * Each request of the page's `viem({ relay })` to a route at the app's origin carries the access
 * token of the instance's session, which `accounts.session.accessToken` returns. A route at
 * another origin, such as the app's API, receives it with `credentials: 'include'`. The route
 * verifies it before it relays, and accepts only the tokens of the instance's `clientId`.
 * `authorize` then accepts or refuses the caller. The `examples/sponsored-tempo-api` example does
 * this in the Tempo API mode, and the `examples/sponsored-self-hosted` example in the Viem relay
 * mode.
 *
 * Each signed-in user of the app can spend the fee payer's balance, within the limits of
 * `authorize`, the API key, or the relay's plugins. With `verify: false`, the route checks no
 * caller, so the app guards it itself.
 *
 * @throws {Error} When the options hold `account` and `plugins`. Pass `Relay.feePayer({ account })`
 *   in `plugins`, at its place in the order.
 * @throws {Error} When the options hold `apiKey` and `plugins`. The Tempo API mode runs no plugin,
 *   so remove one of the two.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { relay } from 'accounts/plugins'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * // The Tempo API's sponsor pays the fees.
 * const accounts = Accounts.create({
 *   clientId: 'https://app.example',
 *   plugins: [
 *     relay({
 *       apiKey: env.TEMPO_API_KEY,
 *       // Refuses a caller above the limit on each user's requests.
 *       async authorize(options) {
 *         const { success } = await env.RELAY_LIMIT.limit({
 *           key: options.token.userId,
 *         })
 *         if (!success)
 *           return Response.json({ error: 'slow_down' }, { status: 429 })
 *       },
 *     }),
 *   ],
 * })
 *
 * // The app's own fee payer pays the fees.
 * const selfHosted = Accounts.create({
 *   clientId: 'https://app.example',
 *   plugins: [relay({ account: privateKeyToAccount(env.FEE_PAYER_KEY) })],
 * })
 *
 * app.post('/api/relay', (c) => accounts.relay.fetch(c.req.raw))
 * ```
 */
export function relay(options: relay.Options) {
  // No place of the fee payer among `plugins` suits each plugin: a plugin that refuses a request
  // runs before it, and Viem's fee token selection after it. So the app states the order.
  if (options.account && options.plugins)
    throw new Error(
      'Invalid options: `account` and `plugins` are both set, which states no order of the fee payer among the plugins. Remove `account`, and pass `Relay.feePayer({ account })` in `plugins`, after each plugin that refuses a request.',
    )
  // The Tempo API mode runs no plugin. A plugin that refuses a request would thus refuse none.
  if (options.apiKey !== undefined && options.plugins)
    throw new Error(
      'Invalid options: `apiKey` and `plugins` are both set, and a route with `apiKey` runs no plugin. Remove `apiKey` for a route that runs `plugins`, or remove `plugins`.',
    )

  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      // The instance's `viem` plugin, or one of the plugin's own, whose members the plugin adds.
      const held = (instance as unknown as { viem?: viem.Namespace }).viem
      const added = held ? undefined : viem()
      const client = held ?? (added!.actions!(context) as viem.Namespace)
      const { chain: chainOf, rpc } = client[
        Settings.key as never
      ] as unknown as viem.Settings
      // The instance's chain is read at each request, so the route follows `switchChain`.
      const chainId = () => options.chainId ?? instance.config.chainId
      const guard = {
        authorize: options.authorize,
        url: options.url,
        verifier: (() => {
          if (options.verify === false) return undefined
          // The verifier caches the issuer's key set, so the instance holds one. A resource's
          // audience is never a default, since the resource's API holds each token of it.
          return AccessToken.create(
            instance.config,
            typeof options.verify === 'object' ? options.verify : {},
          )
        })(),
      }

      const route = (() => {
        if (options.apiKey !== undefined)
          return RelayHandler.create({
            ...guard,
            apiKey: options.apiKey,
            chainId,
            ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
          })
        const {
          account,
          authorize: _authorize,
          plugins = [],
          url: _url,
          verify: _verify,
          ...relayOptions
        } = options
        return RelayHandler.create({
          ...relayOptions,
          ...guard,
          chainId,
          getClient: (clientOptions: { chainId: number }) => {
            // Every chain of the `viem` plugin relays, also one that only its options define.
            const chain = chainOf(clientOptions.chainId)
            if (!chain)
              throw new Error(
                `Invalid chain: ${clientOptions.chainId} is not a chain of the viem plugin. Return its definition as \`chain\`.`,
              )
            return createClient({
              chain,
              transport: rpc(clientOptions.chainId),
            })
          },
          plugins: account ? [Relay.feePayer({ account })] : plugins,
        })
      })()

      const members = { relay: route } as relay.Members
      if (!added) return members
      // The viem plugin's members read the client at each use, so they stay getters.
      return Object.defineProperties(
        Object.assign(members, { viem: client }),
        Object.getOwnPropertyDescriptors(
          added.extend!({ viem: client } as never, context),
        ),
      )
    },
    id: 'relay',
  })
}

export declare namespace relay {
  type Options = (Options.TempoApi | Options.Viem) &
    (Options.Verified | Options.Unverified)

  namespace Options {
    /** The options of a route that verifies the access token of each request. */
    type Verified = {
      /**
       * Accepts or refuses the caller of a request whose access token verified, such as by a limit
       * on each user's requests. Returns a response that refuses the request, which the route
       * returns, or `undefined` to relay it. The route refuses a repeated DPoP proof within its
       * process before `authorize` runs. Across processes, `authorize` refuses a repeated
       * `proof.id` of the token in a store that they share. Not with `verify: false`.
       */
      authorize?: RelayHandler.create.Authorize | undefined
      /**
       * The public URL of the route, which each DPoP proof names, or a function of the request
       * that returns it. Set it behind a proxy that terminates TLS, where `request.url` is the
       * internal URL. Not with `verify: false`. Defaults to `request.url`.
       */
      url?: string | ((request: Request) => string) | undefined
      /**
       * Whether the route verifies the access token of each `POST`, or the options of its
       * verifier, as the `tokens` plugin takes them without `url`, such as `issuer` for a
       * server that reaches Tempo ID at an internal `url`. The audience defaults to Tempo ID's
       * origin. An app whose tokens name a registered `resource` sets it as `audience`. The route
       * then also accepts each token that the resource's API holds, so that API can spend the fee
       * payer's balance. Defaults to `true`.
       */
      verify?: true | AccessToken.create.Options | undefined
    }

    /** The options of a route that checks no caller, which the app guards itself. */
    type Unverified = {
      authorize?: undefined
      url?: undefined
      /**
       * The route checks no caller, so any caller that reaches it spends the fee payer's balance.
       * Use it only behind a guard of the app, such as a backend's session.
       */
      verify: false
    }

    /** The options of the Tempo API mode, whose sponsor pays the fees. */
    type TempoApi = {
      account?: undefined
      /**
       * The app's Tempo API key, with the `rpc-relay:sponsor` scope. With it, the plugin runs in
       * the Tempo API mode, and the sponsor of the API key pays the fees.
       */
      apiKey: string
      /** The origin of the Tempo API. Defaults to `https://api.tempo.xyz`. */
      apiUrl?: string | undefined
      /**
       * The chain whose transactions the route relays. A fill names no chain, so a route serves one
       * chain. Defaults to the instance's `chainId`.
       */
      chainId?: number | undefined
      plugins?: undefined
    }

    /**
     * The options of the Viem relay mode: those of Viem's `Relay.handleRequest`, with `account` in
     * place of `plugins`, or with `plugins`. The mode also takes Viem's `resolveTokens` and
     * `timeout`.
     */
    type Viem = Omit<Relay.handleRequest.Options, 'plugins'> &
      (Viem.Account | Viem.Plugins) & {
        apiKey?: undefined
        /**
         * The chain of a request that names none, such as Viem's fill. Defaults to the instance's
         * `chainId`.
         */
        chainId?: number | undefined
      }

    namespace Viem {
      /** The options of a relay whose only plugin is the `Relay.feePayer` of `account`. */
      type Account = {
        /**
         * The fee payer, which signs for the fees of each transaction. Short for
         * `plugins: [Relay.feePayer({ account })]`, so not with `plugins`.
         */
        account?: LocalAccount | undefined
        plugins?: undefined
      }

      /** The options of a relay whose plugins the app orders. */
      type Plugins = {
        account?: undefined
        /**
         * The relay plugins from `viem/tempo`, which run in order, such as
         * `Relay.feePayer({ account, validate })` for a fee payer with a policy. `Relay.feePayer`
         * itself answers a raw transaction, and a fill that names its sender, gas, nonce, and fee
         * cap, so a plugin after it never receives them. A plugin that refuses a request goes before
         * it. Not with `account`. Defaults to an empty list.
         */
        plugins?: readonly Relay.Plugin[] | undefined
      }
    }
  }

  /**
   * The members that the plugin adds to the instance: `relay`, and the `viem` plugin's members when
   * `plugins` holds no `viem` plugin.
   */
  type Members = {
    /**
     * The handler of the app's relay route. Its `fetch` serves a request to the route, and returns
     * its JSON-RPC response. A method other than `POST` returns 405. A `POST` without a valid
     * access token returns 401 with the reason `invalid_token`. A `POST` with a DPoP proof that the
     * route accepted before returns 401 with the reason `invalid_dpop_proof`, since a proof signs
     * no body, as does a proof whose `jti` exceeds 256 characters. The route keeps each proof until
     * it expires, also of a request that `authorize` refuses. While one DPoP key holds 1,000 unexpired proofs, its new one returns 429 with the
     * reason `rate_limited`. While the process holds 100,000, a new one returns 503 with the reason
     * `temporarily_unavailable`. A body above 1 MiB returns 413,
     * with the reason `body_too_large`. Only Viem's relay with `verify: false` reads the body
     * itself, and returns its own 413 for a body above 16 MiB. A body that is not one JSON object,
     * such as a JSON-RPC batch, returns 400 with the reason `invalid_request`, since `authorize`
     * decides once for each request. `authorize` and the relay then receive that object in the
     * route's own encoding, not the bytes of the body. An object that the runtime cannot encode
     * returns 400, and an encoding above 1 MiB returns 413.
     * If the issuer's key set cannot be fetched, it returns 503 with the reason
     * `temporarily_unavailable`.
     * In the Tempo API mode, an unreachable Tempo API also returns 503 with the reason
     * `temporarily_unavailable`, as does a redirect of the Tempo API, which receives no request
     * and no API key. The DPoP proof of a DPoP token verifies against `url`, or `request.url`
     * without it.
     * @throws {Error} When `chainId` is not a chain of the `viem` plugin, in the Viem relay mode.
     *   Return the chain's definition as the `viem` plugin's `chain`.
     */
    relay: Handler.Handler
    /** The Viem client, as the `viem` plugin adds it. */
    viem: viem.Namespace
  } & viem.Actions
}
