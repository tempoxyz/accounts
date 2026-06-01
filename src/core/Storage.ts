import { createStore, del, get, set } from 'idb-keyval'
import { Json } from 'ox'

import type { MaybePromise } from '../internal/types.js'

const supportsStructuredClone = Symbol.for('accounts.storage.supportsStructuredClone')

/** Pluggable storage adapter. */
export type Storage = {
  /** Loads a stored value. */
  getItem: <value>(name: string) => MaybePromise<value | null>
  /** Saves a stored value. */
  setItem: (name: string, value: unknown) => MaybePromise<void>
  /** Removes a stored value. */
  removeItem: (name: string) => MaybePromise<void>
}

type StructuredStorage = Storage & { [supportsStructuredClone]?: true | undefined }

/** Creates a storage adapter from a custom implementation, optionally scoping all keys under a prefix. */
export function from(storage: Storage, options: from.Options = {}): Storage {
  const key = options.key ?? 'tempo'
  const prefix = `${key}.`
  const scoped = {
    getItem: <value>(name: string) => storage.getItem<value>(`${prefix}${name}`),
    setItem: (name: string, value: unknown) => storage.setItem(`${prefix}${name}`, value),
    removeItem: (name: string) => storage.removeItem(`${prefix}${name}`),
  }
  if (canStructuredClone(storage)) return markStructuredClone(scoped)
  return scoped
}

export declare namespace from {
  /** Options for {@link from}. */
  type Options = {
    /** Key prefix for all stored items. @default "tempo" */
    key?: string | undefined
  }
}

function canStructuredClone(storage: Storage): boolean {
  return (storage as StructuredStorage)[supportsStructuredClone] === true
}

function markStructuredClone(storage: Storage): Storage {
  return Object.assign(storage, { [supportsStructuredClone]: true as const })
}

/**
 * Combines multiple storage adapters into one. Reads return the first
 * non-null result; writes propagate to all storages (failures are isolated
 * via `Promise.allSettled`).
 */
export function combine(...storages: readonly Storage[]): Storage {
  const storage = {
    async getItem<value>(name: string) {
      const results = await Promise.allSettled(storages.map((x) => x.getItem<value>(name)))
      const result = results.find((x) => x.status === 'fulfilled' && x.value != null)
      if (result?.status !== 'fulfilled') return null
      return result.value as value
    },
    async removeItem(name: string) {
      await Promise.allSettled(storages.map((x) => x.removeItem(name)))
    },
    async setItem(name: string, value: unknown) {
      await Promise.allSettled(storages.map((x) => x.setItem(name, value)))
    },
  }
  if (storages.length > 0 && storages.every(canStructuredClone)) return markStructuredClone(storage)
  return storage
}

/** Creates a `document.cookie`-backed storage adapter. Uses `SameSite=None; Secure` with a 1-year expiry. Deep objects are flattened into individual cookies to stay within the 4KB-per-cookie browser limit. */
export function cookie(options: cookie.Options = {}): Storage {
  function getRaw(name: string): string | undefined {
    return document.cookie.split('; ').find((x) => x.startsWith(`${name}=`))
  }

  function setRaw(name: string, value: string) {
    document.cookie = `${name}=${value};path=/;samesite=None;secure;max-age=31536000`
  }

  function removeRaw(name: string) {
    document.cookie = `${name}=;max-age=-1;path=/`
  }

  function flatten(prefix: string, value: unknown, result: [string, string][] = []) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) flatten(`${prefix}[${i}]`, value[i], result)
      // Store length so we know how many indices to reconstruct.
      result.push([`${prefix}.__length`, Json.stringify(value.length)])
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        flatten(`${prefix}.${k}`, v, result)
    } else result.push([prefix, Json.stringify(value)])
    return result
  }

  function unflatten(prefix: string): unknown {
    // Check for a direct (leaf) cookie first.
    const direct = getRaw(prefix)
    if (direct) {
      try {
        return Json.parse(direct.substring(prefix.length + 1))
      } catch {
        return null
      }
    }
    // Check if this is an array (has a __length cookie).
    const lengthCookie = getRaw(`${prefix}.__length`)
    if (lengthCookie) {
      const length = Json.parse(lengthCookie.substring(`${prefix}.__length`.length + 1)) as number
      const result: unknown[] = []
      for (let i = 0; i < length; i++) result.push(unflatten(`${prefix}[${i}]`))
      return result
    }
    // Collect all sub-keys (object children use `.`, array children use `[`).
    const dotPrefix = `${prefix}.`
    const bracketPrefix = `${prefix}[`
    const children = document.cookie
      .split('; ')
      .filter((x) => x.startsWith(dotPrefix) || x.startsWith(bracketPrefix))
    if (children.length === 0) return null
    const result: Record<string, unknown> = {}
    for (const entry of children) {
      const key = entry.substring(dotPrefix.length, entry.indexOf('='))
      const segment = key.split(/[.[]/)[0]!
      if (segment === '__length') continue
      if (!(segment in result)) result[segment] = unflatten(`${dotPrefix}${segment}`)
    }
    return result
  }

  return from(
    {
      getItem(name) {
        return unflatten(name) as any
      },
      setItem(name, value) {
        // Remove existing keys before writing.
        this.removeItem(name)
        for (const [k, v] of flatten(name, value)) setRaw(k, v)
      },
      removeItem(name) {
        removeRaw(name)
        for (const entry of document.cookie.split('; '))
          if (entry.startsWith(`${name}.`) || entry.startsWith(`${name}[`))
            removeRaw(entry.substring(0, entry.indexOf('=')))
      },
    },
    options,
  )
}

export declare namespace cookie {
  type Options = from.Options
}

/** Creates an IndexedDB-backed storage adapter. Stores raw values (no JSON serialization). */
export function idb(options: idb.Options = {}): Storage {
  const store = typeof indexedDB !== 'undefined' ? createStore('tempo', 'store') : undefined
  const storage = from(
    {
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
    },
    options,
  )
  return markStructuredClone(storage)
}

export declare namespace idb {
  type Options = from.Options
}

/** Creates a `localStorage`-backed storage adapter. */
export function localStorage(options: localStorage.Options = {}): Storage {
  return from(
    {
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
    },
    options,
  )
}

export declare namespace localStorage {
  type Options = from.Options
}

/** Creates an in-memory storage adapter. Useful for SSR and tests. */
export function memory(options: memory.Options = {}): Storage {
  const store = new Map<string, unknown>()
  const storage = from(
    {
      getItem(name) {
        return (store.get(name) as any) ?? null
      },
      setItem(name, value) {
        store.set(name, value)
      },
      removeItem(name) {
        store.delete(name)
      },
    },
    options,
  )
  return markStructuredClone(storage)
}

export declare namespace memory {
  type Options = from.Options
}
