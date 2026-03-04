import { createStore, del, get, set } from 'idb-keyval'
import { Json } from 'ox'

import type { MaybePromise } from '../internal/types.js'

/** Pluggable storage adapter for persisting provider state. */
export type Storage = {
  getItem: <value>(name: string) => MaybePromise<value | null>
  setItem: (name: string, value: unknown) => MaybePromise<void>
  removeItem: (name: string) => MaybePromise<void>
}

/** Creates a storage adapter from a custom implementation. */
export function from(storage: Storage): Storage {
  return storage
}

/**
 * Combines multiple storage adapters into one. Reads return the first
 * non-null result; writes propagate to all storages (failures are isolated
 * via `Promise.allSettled`).
 */
export function combine(...storages: readonly Storage[]): Storage {
  return from({
    async getItem<value>(name: string) {
      const results = await Promise.allSettled(storages.map((x) => x.getItem<value>(name)))
      const result = results.find((x) => x.status === 'fulfilled' && x.value !== null)
      if (result?.status !== 'fulfilled') return null
      return result.value as value
    },
    async removeItem(name) {
      await Promise.allSettled(storages.map((x) => x.removeItem(name)))
    },
    async setItem(name, value) {
      await Promise.allSettled(storages.map((x) => x.setItem(name, value)))
    },
  })
}

/** Creates a `document.cookie`-backed storage adapter. Uses `SameSite=None; Secure` with a 1-year expiry. */
export function cookie(): Storage {
  return from({
    getItem(name) {
      const value = document.cookie.split('; ').find((x) => x.startsWith(`${name}=`))
      if (!value) return null
      try {
        return Json.parse(value.substring(name.length + 1))
      } catch {
        return null
      }
    },
    setItem(name, value) {
      document.cookie = `${name}=${Json.stringify(value)};path=/;samesite=None;secure;max-age=31536000`
    },
    removeItem(name) {
      document.cookie = `${name}=;max-age=-1;path=/`
    },
  })
}

/** Creates an IndexedDB-backed storage adapter. Stores raw values (no JSON serialization). */
export function idb(): Storage {
  const store = typeof indexedDB !== 'undefined' ? createStore('tempo', 'store') : undefined
  return from({
    async getItem(name) {
      const value = await get(name, store)
      if (value === null) return null
      return value
    },
    async setItem(name, value) {
      await set(name, value, store)
    },
    async removeItem(name) {
      await del(name, store)
    },
  })
}

/** Creates a `localStorage`-backed storage adapter. */
export function localStorage(): Storage {
  return from({
    getItem(name) {
      const value = globalThis.localStorage.getItem(name)
      if (value === null) return null
      try {
        return Json.parse(value)
      } catch {
        return null
      }
    },
    setItem(name, value) {
      globalThis.localStorage.setItem(name, Json.stringify(value))
    },
    removeItem(name) {
      globalThis.localStorage.removeItem(name)
    },
  })
}

/** Creates an in-memory storage adapter. Useful for SSR and tests. */
export function memory(): Storage {
  const store = new Map<string, unknown>()
  return from({
    getItem(name) {
      return (store.get(name) as any) ?? null
    },
    setItem(name, value) {
      store.set(name, value)
    },
    removeItem(name) {
      store.delete(name)
    },
  })
}
