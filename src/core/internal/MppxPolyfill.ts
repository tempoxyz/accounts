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
  const client = import('mppx/client')
    .then((client) => {
      // Another mppx polyfill (e.g. the app's, or a later provider's) replaced this one, as a
      // second `Mppx.create` would have; it handles payments, and requests that still reach this
      // placeholder (e.g. after `Fetch.restore()`) go out unpaid.
      if (isWrapper(globalThis.fetch) && globalThis.fetch !== fetch_lazy) return fetch_raw
      const handoff = globalThis.fetch === fetch_lazy
      if (handoff) globalThis.fetch = fetch_raw
      return client.Mppx.create({
        // What mppx's polyfill sends `Accept-Payment` to: same-origin requests in browsers.
        acceptPaymentPolicy: typeof globalThis.location !== 'undefined' ? 'same-origin' : 'always',
        fetch: fetch_raw,
        methods: getMethods(client),
        polyfill: handoff,
      }).fetch as Fetch
    })
    .catch(() => {
      if (globalThis.fetch === fetch_lazy) globalThis.fetch = fetch_raw
      return fetch_raw
    })
  const fetch_lazy: Fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      // Native fetch rejects as soon as its signal aborts, even while mppx is still loading.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const fetch = signal ? await abortable(client, signal) : await client
      return fetch(input, init)
    },
    { [wrapper]: fetch_raw },
  )
  globalThis.fetch = fetch_lazy
}

/** Resolves with `promise`, or rejects like fetch once the signal aborts. */
async function abortable<value>(promise: Promise<value>, signal: AbortSignal): Promise<value> {
  const reason = () =>
    signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
  if (signal.aborted) throw reason()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(reason())
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

function isWrapper(fetch: Fetch): boolean {
  return Boolean((fetch as Fetch & { [wrapper]?: Fetch | undefined })[wrapper])
}

/** Returns the fetch underneath mppx polyfills (including this one). */
function unwrap(fetch: Fetch): Fetch {
  let current = fetch as Fetch & { [wrapper]?: Fetch | undefined }
  while (current[wrapper]) current = current[wrapper] as typeof current
  return current
}
