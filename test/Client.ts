/**
 * Creates instances of the package that call a Tempo ID harness as a browser page does.
 * @module
 */
import { Id } from 'accounts'
import { Env, type Harness } from './TempoId.js'

/**
 * Returns a client for `clientId`, its fetch, each request's method and path, and the steps of each
 * path's latest response. The fetch sends `origin` as `Origin`, with `Sec-Fetch-Site: same-site`,
 * and keeps the harness's cookies.
 */
export function create(
  harness: ReturnType<typeof Harness.create>,
  options: create.Options,
) {
  const { clientId, origin } = options
  const cookies = new Map<string, string>()
  const paths: string[] = []
  // The `Server-Timing` step names of each method and path's latest response, in the order that
  // they started.
  const steps = new Map<string, readonly string[]>()
  // The harness's fetch returns Miniflare's `Response`, which the global `fetch` type does not name,
  // though both have the same shape at runtime.
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const path = `${init?.method ?? 'GET'} ${url.pathname}`
    paths.push(path)

    const headers = new Headers(init?.headers)
    headers.set('origin', origin)
    // A first-party app's page shares Tempo ID's site, since the session cookie is `Lax`. A browser
    // sets the header itself, and a page's script cannot change it.
    headers.set('sec-fetch-site', 'same-site')
    if (cookies.size)
      headers.set(
        'cookie',
        [...cookies].map((entry) => entry.join('=')).join('; '),
      )
    const response = await harness.fetch(`${url.pathname}${url.search}`, {
      ...(init as Parameters<typeof harness.fetch>[1]),
      headers: Object.fromEntries(headers),
    })

    steps.set(
      path,
      (response.headers.get('server-timing') ?? '')
        .split(',')
        .map((entry) => entry.trim().split(';')[0] ?? ''),
    )

    for (const entry of response.headers.getSetCookie()) {
      const [pair = ''] = entry.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index)
      if (/max-age=0/i.test(entry)) cookies.delete(name)
      else cookies.set(name, pair.slice(index + 1))
    }
    return response
  }) as unknown as typeof globalThis.fetch
  const auth = Id.from({
    clientId,
    fetch,
    redirectUri: `${origin}/callback`,
    url: Env.origin,
  })
  return { auth, fetch, paths, steps }
}

export declare namespace create {
  type Options = {
    /** The app's client ID. */
    clientId: string
    /** The page's origin, whose `/callback` is the app's redirect URI. */
    origin: string
  }
}
