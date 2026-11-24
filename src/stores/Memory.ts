/**
 * A store in memory, as `Store.memory` returns it.
 * @module
 */
import * as Broadcast from '../internal/Broadcast.js'
import * as Expiry from '../internal/Expiry.js'
import * as Lock from '../internal/Lock.js'
import type * as Store from '../Store.js'

/**
 * Returns a store that holds each value in the process's memory. The store keeps a structured clone
 * of each value, as IndexedDB does, and each read returns a new clone. A change to a value after its
 * write, or to a value that a read returned, thus changes no stored value until the next write. A
 * `CryptoKey` stays the same key. A value that a structured clone refuses, such as a function,
 * rejects the write. A runtime without `structuredClone`, such as React Native on Hermes, keeps
 * each value as it is. A read skips an expired entry. A write deletes the expired entries once the
 * store doubles its size since the last such sweep, so each write costs constant time on average. A
 * restart loses every value, so it serves one process, such as in development or tests. A page
 * load also loses every value, so `redirect.signIn` without `open` refuses the store with
 * `invalid_request` before any request. The store sets `local`, so where a lock spans the process, such as in Node or a
 * browser, an instance's `session.refresh` that Tempo ID refuses throws after one request. The
 * `backend` plugin's refresh still sends a refused token again, since backends can share a store.
 * On a page, another tab's `signOut` with `everywhere` empties the tab's session and its store at
 * once, since that logout revoked the tokens of the browser's Tempo ID session.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { backend } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: process.env.CLIENT_ID!,
 *   clientSecret: process.env.CLIENT_SECRET!,
 *   plugins: [backend({ store: Store.memory() })],
 * })
 * ```
 */
export function create(): Store.Store {
  const entries = new Map<string, Expiry.Entry<unknown>>()
  // The size at which a write deletes the expired entries. A sweep reads every entry, so the size
  // doubles after each sweep, and the writes between two sweeps pay for it.
  let sweepAt = 64
  // Hermes has no `structuredClone`, so a store there keeps each value as it is, and every write
  // still succeeds.
  const clone: <value>(value: value) => value =
    typeof structuredClone === 'function'
      ? (value) => structuredClone(value)
      : (value) => value
  return {
    // The instances on the store hear the saved changes of each other through it.
    connect: Broadcast.create(),
    getItem(key) {
      const entry = entries.get(key)
      if (!entry || Expiry.expired(entry)) return Promise.resolve(undefined)
      return Promise.resolve(clone(entry.value))
    },
    // No other process reads the process's memory, so a refusal of a refresh token is final.
    local: true,
    // The instances on the store order their refreshes and `sid` index writes through it.
    lock: Lock.create(),
    removeItem(key) {
      entries.delete(key)
      return Promise.resolve()
    },
    setItem(key, value, options = {}) {
      // A refused clone rejects the write, and keeps the entry as it was.
      const copy = (() => {
        try {
          return { value: clone(value) }
        } catch (error) {
          return { error }
        }
      })()
      if ('error' in copy) return Promise.reject(copy.error)
      if (entries.size >= sweepAt) {
        for (const [name, entry] of entries)
          if (Expiry.expired(entry)) entries.delete(name)
        sweepAt = Math.max(64, entries.size * 2)
      }
      entries.set(key, { expiresAt: options.expiresAt, value: copy.value })
      return Promise.resolve()
    },
    takeItem(key) {
      const entry = entries.get(key)
      entries.delete(key)
      if (!entry || Expiry.expired(entry)) return Promise.resolve(undefined)
      // The entry leaves the store, so its own value needs no clone.
      return Promise.resolve(entry.value)
    },
  }
}
