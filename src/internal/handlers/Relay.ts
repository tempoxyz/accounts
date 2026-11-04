/**
 * The app's relay route, which pays the fees of its pages' transactions, and which the `relay`
 * plugin serves. The `viem` plugin's `relay` option sends a page's sponsorship requests to it. The
 * entries of the package do not export it.
 * @module
 */
import { Relay } from 'viem/tempo'
import * as Handler from '../Handler.js'

/**
 * Returns the handler of the relay route. With `apiKey`, it forwards each request to the Tempo
 * API's `/rpc/sponsor` of `chainId`, whose sponsor pays the fees. Otherwise it serves Viem's relay
 * of `Relay.create` with the options. The handler checks no caller, so any caller that reaches the
 * route spends the fee payer's balance, within the limits of the API key or of the relay's plugins.
 */
export function create(options: create.Options): Handler.Handler {
  if (options.apiKey !== undefined) return tempoApi(options)
  const { apiKey: _apiKey, chainId, ...relayOptions } = options
  // `Relay.create` takes `client` and `getClient` in separate overloads, and no overload takes
  // their union, which the options hold.
  const relay = Relay.create(
    relayOptions as Extract<Relay.create.Options, { client: unknown }>,
  )
  // Viem's fill names no chain, so each request relays on the route's chain.
  return Handler.from({ fetch: (request) => relay.fetch(request, { chainId }) })
}

export declare namespace create {
  type Options = Options.TempoApi | Options.Viem

  namespace Options {
    /** The options of the Tempo API mode, whose sponsor pays the fees. */
    type TempoApi = {
      /** The app's Tempo API key, with the `rpc-relay:sponsor` scope. Its sponsor pays the fees. */
      apiKey: string
      /** The origin of the Tempo API. Defaults to `https://api.tempo.xyz`. */
      apiUrl?: string | undefined
      /** The chain whose transactions the route relays. */
      chainId: number
    }

    /** The options of the Viem relay mode: those of Viem's `Relay.create`. */
    type Viem = Relay.create.Options & {
      apiKey?: undefined
      /** The chain whose transactions the route relays. */
      chainId: number
    }
  }
}

/** Returns the handler of the Tempo API mode, which forwards each request with the API key. */
function tempoApi(options: create.Options.TempoApi): Handler.Handler {
  const { apiKey, apiUrl = 'https://api.tempo.xyz', chainId } = options

  return Handler.from({
    async fetch(request) {
      if (request.method !== 'POST')
        return new Response(null, { headers: { allow: 'POST' }, status: 405 })
      const response = await fetch(new URL(`/rpc/sponsor/${chainId}`, apiUrl), {
        body: await request.text(),
        headers: {
          'content-type': 'application/json',
          'tempo-api-key': apiKey,
        },
        method: 'POST',
      }).catch(() => undefined)
      if (!response)
        return Response.json(
          {
            error: {
              code: -32002,
              data: { reason: 'temporarily_unavailable' },
              message:
                'Sponsor unavailable: the request to the Tempo API failed. Retry later.',
            },
            id: null,
            jsonrpc: '2.0',
          },
          { status: 503 },
        )
      // A Node `fetch` decodes a compressed body, so the response forwards none of its encoding.
      return new Response(response.body, {
        headers: { 'content-type': 'application/json' },
        status: response.status,
      })
    },
  })
}
