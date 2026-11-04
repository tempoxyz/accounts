/**
 * Where a redirect keeps its state until Tempo ID redirects back, and where a backend keeps its
 * sessions. `memory`, `durableObject`, `postgres`, and `redis` return a store for a backend.
 * @module
 */
/**
 * Keeps a redirect's state, or a backend's sessions, as structured-clone storage such as IndexedDB or
 * a Durable Object's storage does.
 */
export type Store = {
  /** Reads the value at `key`, or `undefined`. */
  getItem: (key: string) => Promise<unknown>
  /** Deletes the value at `key`. */
  removeItem: (key: string) => Promise<void>
  /**
   * Writes `value` at `key`, without serializing it. A store that expires entries deletes it after
   * `options.expiresAt`, such as with a Durable Object's alarm.
   */
  setItem: (
    key: string,
    value: unknown,
    options?: setItem.Options,
  ) => Promise<void>
}

export declare namespace setItem {
  type Options = {
    /** When the entry may be deleted, in milliseconds. Absent, the entry stays until a deletion. */
    expiresAt?: number | undefined
  }
}

/**
 * Instantiates a {@link Store}.
 *
 * @example
 * ```ts
 * const store = Store.from({
 *   getItem: (key) => idb.get(key),
 *   removeItem: (key) => idb.del(key),
 *   setItem: (key, value) => idb.set(key, value),
 * })
 * ```
 */
export function from(value: Store): Store {
  return value
}

export { create as durableObject } from './stores/DurableObject.js'
export { create as file } from './stores/File.js'
export { create as memory } from './stores/Memory.js'
export { create as postgres } from './stores/Postgres.js'
export { create as redis } from './stores/Redis.js'
