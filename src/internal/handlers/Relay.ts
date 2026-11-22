/**
 * The app's relay route, which pays the fees of its pages' transactions, and which the `relay`
 * plugin serves. The `viem` plugin's `relay` option sends a page's sponsorship requests to it, with
 * the session's access token. The entries of the package do not export it.
 * @module
 */
import { Base64, Bytes, Hash } from 'ox'
import { Relay } from 'viem/tempo'
import { RequestError } from '../../Accounts.js'
import * as AccessToken from '../../AccessToken.js'
import * as Handler from '../Handler.js'

/**
 * The largest body that the route reads, and the largest that a route with `verifier` relays, in
 * bytes. It is below the 16 MiB of Viem's relay, since a route with `verifier` parses and encodes
 * each body within it before `authorize` runs.
 */
const maxBodySize = 1_024 * 1_024

/** The longest `jti` of a DPoP proof that the route accepts, in characters. */
const maxProofIdSize = 256

/**
 * The most DPoP proofs that the route holds at once. Each entry holds a hash of fixed size, so the
 * map stays near 10 MB, also for a caller that signs proofs without limit.
 */
const maxProofs = 100_000

/**
 * The most unexpired DPoP proofs of one DPoP key that the route holds at once, so one caller cannot
 * use the capacity of {@link maxProofs} that other callers need.
 */
const maxProofsPerKey = 1_000

/**
 * Returns the handler of the relay route. With `apiKey`, it forwards each request to the Tempo
 * API's `/rpc/sponsor` of the chain that `chainId` returns, whose sponsor pays the fees. Otherwise
 * it serves Viem's relay of `Relay.create` with the options.
 *
 * With `verifier`, each `POST` needs a valid access token, and `authorize` then accepts or refuses
 * its caller. Without `verifier`, the handler checks no caller, so any caller that reaches the route
 * spends the fee payer's balance, within the limits of the API key or of the relay's plugins.
 *
 * A DPoP proof signs no body, so the handler accepts each proof once until it stops verifying
 * (RFC 9449 §11.1). It keeps each proof that it accepts until it expires, at most `maxProofsPerKey` for one
 * DPoP key, which answers 429 above it, and `maxProofs` in its process, which answers 503 once
 * full. Across processes, `authorize` refuses a repeated `proof.id` in a store that they
 * share.
 *
 * The route reads at most `maxBodySize` bytes of a body, and answers a larger one with 413. Only
 * Viem's relay without `verifier` reads the body itself, within its own limit of 16 MiB. With
 * `verifier`, the body is one JSON object, or the route answers 400. `authorize` and the relay then
 * receive that object in the route's own encoding, so each reads the request that the route checked.
 * An object that the runtime cannot encode answers 400, and an encoding above `maxBodySize` 413.
 */
export function create(options: create.Options): Handler.Handler {
  const { authorize, url, verifier, ...rest } = options
  const route = (() => {
    if (rest.apiKey !== undefined) return tempoApi(rest)
    const { apiKey: _apiKey, chainId, ...relayOptions } = rest
    // `Relay.create` takes `client` and `getClient` in separate overloads, and no overload takes
    // their union, which the options hold.
    const relay = Relay.create(
      relayOptions as Extract<Relay.create.Options, { client: unknown }>,
    )
    // Viem's fill names no chain, so each request relays on the route's chain at that request.
    return Handler.from({
      fetch: (request) => relay.fetch(request, { chainId: chainId() }),
    })
  })()
  if (!verifier) return route

  // Each accepted DPoP proof, by a hash of its DPoP key and `jti`, with its DPoP key and when it
  // stops verifying in milliseconds. A captured request with its proof otherwise relays any body
  // again within the proof's window.
  const proofs = new Map<string, { boundTo: string; expiresAt: number }>()
  // The count of the entries of `proofs` for each DPoP key.
  const counts = new Map<string, number>()
  // The keys of `proofs` in a binary min-heap by expiry. A client sets each proof's `iat`, so the
  // order of arrival is not the order of expiry.
  const expiries: Expiry[] = []

  /**
   * Deletes the entry `key` of `proofs`, and lowers the count of its DPoP key. Only an expired
   * entry goes, also of a request that the route did not relay, since a copy of its proof could
   * otherwise relay another body.
   */
  function release(key: string) {
    const entry = proofs.get(key)
    if (!entry) return
    proofs.delete(key)
    const count = (counts.get(entry.boundTo) ?? 1) - 1
    if (count > 0) counts.set(entry.boundTo, count)
    else counts.delete(entry.boundTo)
  }

  /**
   * Records the proof of a verified token, and returns the key of its entry. Returns `repeated` for a
   * proof that the route accepted already, that expired, or whose `jti` exceeds `maxProofIdSize`,
   * `limited` while its DPoP key holds `maxProofsPerKey` entries, and `full` while the route holds
   * `maxProofs` entries.
   */
  function admit(token: AccessToken.create.Token) {
    if (!token.proof || token.boundTo === undefined) return { key: undefined }
    const now = Date.now()
    // The verifier and this check read the clock at different times, so a proof that expired
    // since the verification never relays, also after the cleanup deleted its entry.
    if (token.proof.expiresAt <= now) return 'repeated'
    if (token.proof.id.length > maxProofIdSize) return 'repeated'
    // Each expired entry goes before the limits apply, in O(log n) for each entry.
    while (expiries[0] && expiries[0].expiresAt <= now)
      release(pop(expiries).key)
    const key = Base64.fromBytes(
      Hash.sha256(Bytes.fromString(`${token.boundTo}:${token.proof.id}`)),
    )
    if (proofs.has(key)) return 'repeated'
    const count = counts.get(token.boundTo) ?? 0
    if (count >= maxProofsPerKey) return 'limited'
    if (proofs.size >= maxProofs) return 'full'
    proofs.set(key, {
      boundTo: token.boundTo,
      expiresAt: token.proof.expiresAt,
    })
    counts.set(token.boundTo, count + 1)
    push(expiries, { expiresAt: token.proof.expiresAt, key })
    return { key }
  }

  return Handler.from({
    async fetch(request) {
      // Only a `POST` relays, so the route answers every other method, such as a CORS preflight.
      if (request.method !== 'POST') return route.fetch(request)

      const [scheme, accessToken] = (
        request.headers.get('authorization') ?? ''
      ).split(' ')
      if (!accessToken) return unauthorized(scheme)

      const token = await verifier
        .verify({
          accessToken,
          dpop: {
            method: request.method,
            proof: request.headers.get('dpop'),
            scheme,
            // Behind a proxy that terminates TLS, the proof names the public URL, not `request.url`.
            url:
              typeof url === 'function' ? url(request) : (url ?? request.url),
          },
        })
        // `verify` rejects only with errors.
        .catch((error: Error) => error)
      if (token instanceof AccessToken.InvalidError) return unauthorized(scheme)
      // The issuer's key set cannot be fetched, so the token can still be valid.
      if (token instanceof RequestError && token.status === 0)
        return failure({
          message:
            'Relay unavailable: the access token cannot be verified. Retry later.',
          reason: 'temporarily_unavailable',
          status: 503,
        })
      if (token instanceof Error) throw token
      const admitted = admit(token)
      if (admitted === 'limited')
        return failure({
          message:
            'Too many requests: the DPoP key holds too many unexpired proofs of the route. Retry later.',
          reason: 'rate_limited',
          status: 429,
        })
      if (admitted === 'full')
        return failure({
          message:
            'Relay unavailable: the route holds too many DPoP proofs. Retry later.',
          reason: 'temporarily_unavailable',
          status: 503,
        })
      if (admitted === 'repeated')
        return failure({
          headers: { 'www-authenticate': 'DPoP error="invalid_dpop_proof"' },
          message:
            'Invalid DPoP proof: the route accepted this proof already, or it expired or names a `jti` above 256 characters. Send a new proof with each request.',
          reason: 'invalid_dpop_proof',
          status: 401,
        })

      // The route reads the body once, within the limit, before any parse and before `authorize`.
      const bytes = await read(request)
      if (!bytes) return tooLarge()

      // `TextDecoder` removes one byte order mark, where a runtime's body readers remove one or
      // more. A body with more marks thus fails the parse, as does a body that is not UTF-8.
      const body = (() => {
        try {
          return JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          ) as unknown
        } catch {
          return undefined
        }
      })()
      // `authorize` decides once for each request, so a batch would relay many requests for one
      // decision. The page's transport sends no batch.
      if (Array.isArray(body))
        return failure({
          message:
            'Invalid request: the route relays one JSON-RPC request at a time. Send each request alone.',
          reason: 'invalid_request',
          status: 400,
        })
      // A body that fails the parse can still read as a batch to another parser, so it never relays.
      if (typeof body !== 'object' || body === null)
        return failure({
          message:
            'Invalid request: the body is not one JSON object. Send one JSON-RPC request as a JSON object.',
          reason: 'invalid_request',
          status: 400,
        })

      // The parsed object relays in the route's own encoding, so `authorize` and the relay read the
      // request that the guard checked, whatever their parser makes of the original bytes. The
      // encoding of a runtime recurses for each level, so it can fail for an object that parses.
      const text = (() => {
        try {
          return JSON.stringify(body)
        } catch {
          return undefined
        }
      })()
      if (text === undefined)
        return failure({
          message:
            'Invalid request: the body nests too deep to relay. Send a request with less nesting.',
          reason: 'invalid_request',
          status: 400,
        })

      // The encoding writes a number such as `1e20` in full, so it can exceed the limit that the
      // body met. A string holds no more code units than UTF-8 bytes, so its length refuses first.
      if (text.length > maxBodySize) return tooLarge()
      const encoded = new TextEncoder().encode(text)
      if (encoded.byteLength > maxBodySize) return tooLarge()

      const headers = new Headers(request.headers)
      headers.delete('content-length')
      // Workers' types give a generic `Request`, so each copy names the platform's type.
      const copy = () =>
        new Request(request, {
          body: encoded,
          headers,
          method: 'POST',
        }) as Request

      const refused = await authorize?.({ request: copy(), token })
      if (refused) return refused
      return route.fetch(copy())
    },
  })
}

export declare namespace create {
  type Options = (Options.TempoApi | Options.Viem) & {
    /**
     * Accepts or refuses the caller of a request whose access token verified, such as by a limit
     * on each user's requests. Returns a response that refuses the request, or `undefined` to relay
     * it. Only with `verifier`.
     */
    authorize?: Authorize | undefined
    /**
     * The public URL of the route, which each DPoP proof names, or a function of the request that
     * returns it. Set it behind a proxy that terminates TLS. Defaults to `request.url`.
     */
    url?: string | ((request: Request) => string) | undefined
    /** The verifier of the access token of each request. Absent, the handler checks no caller. */
    verifier?: Pick<AccessToken.create.ReturnType, 'verify'> | undefined
  }

  /** The callback that accepts or refuses the caller of a verified request. */
  type Authorize = (options: {
    /**
     * A copy of the request, whose body the callback can read. Its body is the JSON object of the
     * request, as the route relays it.
     */
    request: Request
    /** The claims of the request's verified access token. */
    token: AccessToken.create.Token
  }) => Response | undefined | void | Promise<Response | undefined | void>

  namespace Options {
    /** The options of the Tempo API mode, whose sponsor pays the fees. */
    type TempoApi = {
      /** The app's Tempo API key, with the `rpc-relay:sponsor` scope. Its sponsor pays the fees. */
      apiKey: string
      /** The origin of the Tempo API. Defaults to `https://api.tempo.xyz`. */
      apiUrl?: string | undefined
      /** Returns the chain whose transactions the route relays, at each request. */
      chainId: () => number
    }

    /** The options of the Viem relay mode: those of Viem's `Relay.create`. */
    type Viem = Relay.create.Options & {
      apiKey?: undefined
      /** Returns the chain whose transactions the route relays, at each request. */
      chainId: () => number
    }
  }
}

/** The expiry of an entry of the relay route's DPoP proofs, in its min-heap. */
type Expiry = {
  /** When the proof stops verifying, in milliseconds. */
  expiresAt: number
  /** The key of the proof's entry. */
  key: string
}

/** Adds `entry` to the min-heap `heap` by expiry. */
function push(heap: Expiry[], entry: Expiry) {
  heap.push(entry)
  let index = heap.length - 1
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (heap[parent]!.expiresAt <= heap[index]!.expiresAt) break
    ;[heap[parent], heap[index]] = [heap[index]!, heap[parent]!]
    index = parent
  }
}

/** Removes and returns the entry of the earliest expiry of the min-heap `heap`, which holds one. */
function pop(heap: Expiry[]): Expiry {
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length === 0) return top
  heap[0] = last
  let index = 0
  for (;;) {
    const left = index * 2 + 1
    const right = left + 1
    let next = index
    if (left < heap.length && heap[left]!.expiresAt < heap[next]!.expiresAt)
      next = left
    if (right < heap.length && heap[right]!.expiresAt < heap[next]!.expiresAt)
      next = right
    if (next === index) return top
    ;[heap[next], heap[index]] = [heap[index]!, heap[next]!]
    index = next
  }
}

/**
 * Refuses a request without a valid access token, so the page signs in again. The challenge follows
 * the request's scheme: `DPoP` with the proof algorithms that the route accepts (RFC 9449 §7.1), or
 * `Bearer` (RFC 6750 §3).
 */
function unauthorized(scheme: string | undefined) {
  return failure({
    headers: {
      'www-authenticate':
        scheme?.toLowerCase() === 'dpop'
          ? 'DPoP error="invalid_token", algs="ES256 EdDSA"'
          : 'Bearer error="invalid_token"',
    },
    message:
      'Invalid access token: the request carries no valid access token of the app. Sign in again.',
    reason: 'invalid_token',
    status: 401,
  })
}

/** Returns a JSON-RPC error response of the route, with its `reason` in `data`. */
function failure(options: {
  headers?: Record<string, string> | undefined
  message: string
  reason: string
  status: number
}) {
  const { headers, message, reason, status } = options
  return Response.json(
    {
      error: { code: -32002, data: { reason }, message },
      id: null,
      jsonrpc: '2.0',
    },
    { ...(headers ? { headers } : {}), status },
  )
}

/**
 * Reads the body of `request` once, and returns its bytes. Returns `undefined` once the declared or
 * the streamed size exceeds `maxBodySize`, and cancels the rest of the body, so the route reads at
 * most the limit.
 */
async function read(request: Request) {
  if (Number(request.headers.get('content-length')) > maxBodySize) {
    // The cancel of a cloned request's body settles only once its other copy ends, so the refusal
    // does not wait for it.
    void request.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!request.body) return new Uint8Array()

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBodySize) {
      // As above, the refusal does not wait for the cancel.
      void reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Refuses a request whose body exceeds `maxBodySize`. */
function tooLarge() {
  return failure({
    message: `Request too large: the body exceeds ${maxBodySize / 1_024 / 1_024} MiB. Send a smaller request.`,
    reason: 'body_too_large',
    status: 413,
  })
}

/**
 * Returns the handler of the Tempo API mode, which forwards each request of at most `maxBodySize`
 * bytes with the API key. A redirect of the Tempo API receives no request, and the route answers
 * it with 503.
 */
function tempoApi(options: create.Options.TempoApi): Handler.Handler {
  const { apiKey, apiUrl = 'https://api.tempo.xyz', chainId } = options

  return Handler.from({
    async fetch(request) {
      if (request.method !== 'POST')
        return new Response(null, { headers: { allow: 'POST' }, status: 405 })

      const body = await read(request)
      if (!body) return tooLarge()

      const response = await fetch(
        new URL(`/rpc/sponsor/${chainId()}`, apiUrl),
        {
          body,
          headers: {
            'content-type': 'application/json',
            'tempo-api-key': apiKey,
          },
          method: 'POST',
          // A redirect would send the API key to another origin.
          redirect: 'manual',
        },
      ).catch(() => undefined)
      if (!response)
        return failure({
          message:
            'Sponsor unavailable: the request to the Tempo API failed. Retry later.',
          reason: 'temporarily_unavailable',
          status: 503,
        })
      // A browser's `fetch` reports a redirect as `opaqueredirect` with status 0, and Node's as a 3xx.
      if (
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400)
      ) {
        // An unread body holds the connection to the Tempo API open.
        await response.body?.cancel().catch(() => undefined)
        return failure({
          message:
            'Sponsor unavailable: the API at `apiUrl` answered with a redirect. Set `apiUrl` to the URL that serves the API itself.',
          reason: 'temporarily_unavailable',
          status: 503,
        })
      }
      // A Node `fetch` decodes a compressed body, so the response forwards none of its encoding.
      return new Response(response.body, {
        headers: { 'content-type': 'application/json' },
        status: response.status,
      })
    },
  })
}
