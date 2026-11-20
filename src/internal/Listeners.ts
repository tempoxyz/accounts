/**
 * The listeners of the messages that the instances on one store post to each other, for a store
 * whose instances share one process, such as `Store.memory` or a Durable Object's storage.
 * @module
 */
import type * as Store from '../Store.js'

/**
 * Returns a store's `connect`, which delivers each message posted at a key to the other listeners
 * of that key, each in a later microtask. A `WeakRef` holds each listener, so the store holds no
 * instance that the app dropped, such as one that a server creates for each request.
 *
 * @example
 * ```ts
 * const connect = Listeners.create()
 * const post = connect('session', (message) => console.log(message))
 * ```
 */
export function create(): NonNullable<Store.Store['connect']> {
  const listeners = new Map<string, Set<WeakRef<(message: unknown) => void>>>()
  return (key, listener) => {
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
  }
}
