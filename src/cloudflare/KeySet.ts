/**
 * The key set of the verifiers of Tempo ID's tokens on Cloudflare Workers: `cacheApi` returns the
 * `keySet` of a configuration, which keeps the set in the Cache API of the Worker's location, and
 * its background fetches in `waitUntil`.
 * @module
 */
import * as Workers from 'cloudflare:workers'
import * as KeySet from '../internal/KeySet.js'

/**
 * Returns the `keySet` of a configuration on Cloudflare Workers. Each new isolate starts from the
 * copy that the Cache API of `name` holds at the Worker's location, so it verifies without a fetch
 * of the set. Each fetched set replaces the copy, which expires at the set's `maxAge`. Background
 * fetches, and the writes of the copy, run in `waitUntil`, so they end after the response.
 *
 * @example
 * ```ts
 * import { Accounts, KeySet } from 'accounts/cloudflare'
 * import { tokens } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: 'https://app.example',
 *   keySet: KeySet.cacheApi(),
 *   plugins: [tokens()],
 * })
 * ```
 */
export function cacheApi(options: cacheApi.Options = {}): KeySet.Runtime {
  const { name = 'accounts-key-set' } = options

  return KeySet.from({
    cache: {
      async getItem(key) {
        const cache = await caches.open(name)
        const response = await cache.match(key)
        if (!response) return undefined
        return await response.json()
      },
      async setItem(key, value, options) {
        const cache = await caches.open(name)
        // The Cache API keeps a response for its `max-age`, so the copy expires with the set.
        const maxAge = options?.expiresAt
          ? Math.max(0, Math.floor((options.expiresAt - Date.now()) / 1000))
          : 0
        await cache.put(
          key,
          Response.json(value, {
            headers: { 'cache-control': `max-age=${maxAge}` },
          }),
        )
      },
    },
    defer: Workers.waitUntil,
  })
}

export declare namespace cacheApi {
  type Options = {
    /** The name of the Cache API's cache that holds the copy. Defaults to `accounts-key-set`. */
    name?: string | undefined
  }
}
