/**
 * A store in memory, as `Store.memory` returns it.
 * @module
 */
import * as Expiry from '../internal/Expiry.js'
import type * as Store from '../Store.js'

/**
 * Returns a store that holds each value in the process's memory. Each write deletes the expired
 * entries. A restart loses every value, so it serves one process in development or tests.
 *
 * @example
 * ```ts
 * const accounts = Accounts.create({ clientSecret, plugins: [backend({ store: Store.memory() })] })
 * ```
 */
export function create(): Store.Store {
  const entries = new Map<string, Expiry.Entry<unknown>>()
  return {
    getItem(key) {
      const entry = entries.get(key)
      if (!entry || Expiry.expired(entry)) return Promise.resolve(undefined)
      return Promise.resolve(entry.value)
    },
    removeItem(key) {
      entries.delete(key)
      return Promise.resolve()
    },
    setItem(key, value, options = {}) {
      for (const [name, entry] of entries)
        if (Expiry.expired(entry)) entries.delete(name)
      entries.set(key, { expiresAt: options.expiresAt, value })
      return Promise.resolve()
    },
  }
}
