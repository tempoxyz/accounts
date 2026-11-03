import type * as mppx from 'mppx/client'

/** mppx unwraps fetches tagged with this symbol, so its polyfills never stack on this one. */
const wrapper = Symbol.for('mppx.fetch.wrapper')

type Fetch = typeof globalThis.fetch

/**
 * Replaces `globalThis.fetch` with mppx's payment-aware fetch while loading mppx on demand, so apps
 * that never polyfill fetch don't download or evaluate it.
 *
 * The replacement installs synchronously: a `fetch` made right after `Provider.create` waits for
 * mppx and then goes through it. Once mppx loads, its own polyfill takes the global over (so
 * mppx's `Fetch.restore()` restores the original fetch), unless something replaced the global in
 * the meantime. If mppx fails to load, fetch goes on without payment handling.
 */
export function install(getMethods: (client: typeof mppx) => mppx.Mppx.Methods): void {
  const fetch_raw = unwrap(globalThis.fetch)
  const client = import('mppx/client').then(
    (client) => {
      const handoff = globalThis.fetch === fetch_lazy
      if (handoff) globalThis.fetch = fetch_raw
      return client.Mppx.create({
        // What mppx's polyfill sends `Accept-Payment` to: same-origin requests in browsers.
        acceptPaymentPolicy: typeof globalThis.location !== 'undefined' ? 'same-origin' : 'always',
        fetch: fetch_raw,
        methods: getMethods(client),
        polyfill: handoff,
      }).fetch as Fetch
    },
    () => {
      if (globalThis.fetch === fetch_lazy) globalThis.fetch = fetch_raw
      return fetch_raw
    },
  )
  const fetch_lazy: Fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => (await client)(input, init),
    { [wrapper]: fetch_raw },
  )
  globalThis.fetch = fetch_lazy
}

/** Returns the fetch underneath mppx polyfills (including this one). */
function unwrap(fetch: Fetch): Fetch {
  let current = fetch as Fetch & { [wrapper]?: Fetch | undefined }
  while (current[wrapper]) current = current[wrapper] as typeof current
  return current
}
