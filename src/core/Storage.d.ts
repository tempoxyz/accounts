import type { MaybePromise } from '../internal/types.js'
/** Pluggable storage adapter for persisting provider state. */
export type Storage = {
  getItem: <value>(name: string) => MaybePromise<value | null>
  setItem: (name: string, value: unknown) => MaybePromise<void>
  removeItem: (name: string) => MaybePromise<void>
}
/** Creates a storage adapter from a custom implementation, optionally scoping all keys under a prefix. */
export declare function from(storage: Storage, options?: from.Options): Storage
export declare namespace from {
  type Options = {
    /** Key prefix for all stored items. @default "tempo" */
    key?: string | undefined
  }
}
/**
 * Combines multiple storage adapters into one. Reads return the first
 * non-null result; writes propagate to all storages (failures are isolated
 * via `Promise.allSettled`).
 */
export declare function combine(...storages: readonly Storage[]): Storage
/** Creates a `document.cookie`-backed storage adapter. Uses `SameSite=None; Secure` with a 1-year expiry. Deep objects are flattened into individual cookies to stay within the 4KB-per-cookie browser limit. */
export declare function cookie(options?: cookie.Options): Storage
export declare namespace cookie {
  type Options = from.Options
}
/** Creates an IndexedDB-backed storage adapter. Stores raw values (no JSON serialization). */
export declare function idb(options?: idb.Options): Storage
export declare namespace idb {
  type Options = from.Options
}
/** Creates a `localStorage`-backed storage adapter. */
export declare function localStorage(options?: localStorage.Options): Storage
export declare namespace localStorage {
  type Options = from.Options
}
/** Creates an in-memory storage adapter. Useful for SSR and tests. */
export declare function memory(options?: memory.Options): Storage
export declare namespace memory {
  type Options = from.Options
}
//# sourceMappingURL=Storage.d.ts.map
