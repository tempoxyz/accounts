/**
 * A store in memory, as `Store.memory` returns it.
 * @module
 */
import * as Expiry from '../internal/Expiry.js'
import * as Lock from '../internal/Lock.js'
import type * as Store from '../Store.js'

/**
 * Returns a store that holds each value in the process's memory. The store keeps a structured clone
 * of each value, as IndexedDB does, and each read returns a new clone. A change to a value after its
 * write, or to a value that a read returned, thus changes no stored value until the next write. A
 * `CryptoKey` stays the same key. A value that a structured clone refuses, such as a function,
 * rejects the write. A runtime without `structuredClone`, such as React Native on Hermes, keeps
 * each value as it is. A read skips an expired entry, and each write deletes the expired entries. A
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
  // The listeners of each key. A `WeakRef` holds no instance that the app dropped, such as one
  // that a server creates for each request.
  const listeners = new Map<string, Set<WeakRef<(message: unknown) => void>>>()
  // Hermes has no `structuredClone`, so a store there keeps each value as it is, and every write
  // still succeeds.
  const clone: <value>(value: value) => value =
    typeof structuredClone === 'function'
      ? (value) => structuredClone(value)
      : (value) => value
  return {
    connect(key, listener) {
      const set =
        listeners.get(key) ?? new Set<WeakRef<(message: unknown) => void>>()
      listeners.set(key, set)
      // Each connection and each post drops the references of collected listeners, so the set
      // holds about as many references as live instances, also where no instance posts.
      for (const ref of set) if (!ref.deref()) set.delete(ref)
      set.add(new WeakRef(listener))
      // The function holds `listener`, so the instance that holds the function keeps its listener.
      return (message) => {
        for (const ref of set) {
          const peer = ref.deref()
          if (!peer) set.delete(ref)
          // A page's channel delivers to every tab but the sender, in a later task.
          else if (peer !== listener) queueMicrotask(() => peer(message))
        }
      }
    },
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
      for (const [name, entry] of entries)
        if (Expiry.expired(entry)) entries.delete(name)
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
