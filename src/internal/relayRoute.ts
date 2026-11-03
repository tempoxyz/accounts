/**
 * The app's relay route, which pays the fees of its pages' transactions: its handler on the app's
 * server, which the `relay` plugin serves, and the page's transport, which the `viem` plugin's
 * `relay` option builds. The entries of the package do not export it.
 * @module
 */
import { http, type HttpTransportConfig, type Transport } from 'viem'
import { Relay, withRelay } from 'viem/tempo'

/**
 * Returns the handler of the relay route. With `apiKey`, it forwards each request to the Tempo
 * API's `/rpc/sponsor` of `chainId`, whose sponsor pays the fees. Otherwise it serves Viem's relay
 * of `Relay.create` with the options. The handler checks no caller, so any caller that reaches the
 * route spends the fee payer's balance, within the limits of the API key or of the relay's plugins.
 */
export function handler(options: handler.Options): handler.ReturnType {
  if (options.apiKey !== undefined) return tempoApi(options)
  const { apiKey: _apiKey, chainId, ...relayOptions } = options
  // `Relay.create` takes `client` and `getClient` in separate overloads, and no overload takes
  // their union, which the options hold.
  const relay = Relay.create(
    relayOptions as Extract<Relay.create.Options, { client: unknown }>,
  )
  // Viem's fill names no chain, so each request relays on the route's chain.
  return { fetch: (request) => relay.fetch(request, { chainId }) }
}

export declare namespace handler {
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

  /** The handler: a function of the Fetch API from a request to its response. */
  type ReturnType = {
    /** Serves `request`, and returns its response. */
    fetch: (request: Request) => Promise<Response>
  }
}

/**
 * Returns a transport that sends the sponsorship requests of a transaction to the relay route at
 * `url`, and every other request to `rpc`. Viem's `withRelay` selects the requests: a fill, and a
 * raw transaction without its fee payer's signature.
 */
export function transport(options: transport.Options): Transport {
  const { rpc = http(), url, ...httpOptions } = options
  return withRelay(rpc, http(url, httpOptions))
}

export declare namespace transport {
  type Options = HttpTransportConfig & {
    /** The transport of every request but a sponsorship's. Defaults to `http()`, the chain's own RPC. */
    rpc?: Transport | undefined
    /** The URL of the app's relay route, such as `/api/relay`. */
    url: string
  }
}

/** Returns the handler of the Tempo API mode, which forwards each request with the API key. */
function tempoApi(options: handler.Options.TempoApi): handler.ReturnType {
  const { apiKey, apiUrl = 'https://api.tempo.xyz', chainId } = options

  return {
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
  }
}
