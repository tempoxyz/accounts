import { createStore, del, get, set } from 'idb-keyval'
import { Json } from 'ox'
/** Creates a storage adapter from a custom implementation, optionally scoping all keys under a prefix. */
export function from(storage, options = {}) {
  const key = options.key ?? 'tempo'
  const prefix = `${key}.`
  return {
    getItem: (name) => storage.getItem(`${prefix}${name}`),
    setItem: (name, value) => storage.setItem(`${prefix}${name}`, value),
    removeItem: (name) => storage.removeItem(`${prefix}${name}`),
  }
}
/**
 * Combines multiple storage adapters into one. Reads return the first
 * non-null result; writes propagate to all storages (failures are isolated
 * via `Promise.allSettled`).
 */
export function combine(...storages) {
  return {
    async getItem(name) {
      const results = await Promise.allSettled(storages.map((x) => x.getItem(name)))
      const result = results.find((x) => x.status === 'fulfilled' && x.value !== null)
      if (result?.status !== 'fulfilled') return null
      return result.value
    },
    async removeItem(name) {
      await Promise.allSettled(storages.map((x) => x.removeItem(name)))
    },
    async setItem(name, value) {
      await Promise.allSettled(storages.map((x) => x.setItem(name, value)))
    },
  }
}
/** Creates a `document.cookie`-backed storage adapter. Uses `SameSite=None; Secure` with a 1-year expiry. Deep objects are flattened into individual cookies to stay within the 4KB-per-cookie browser limit. */
export function cookie(options = {}) {
  function getRaw(name) {
    return document.cookie.split('; ').find((x) => x.startsWith(`${name}=`))
  }
  function setRaw(name, value) {
    document.cookie = `${name}=${value};path=/;samesite=None;secure;max-age=31536000`
  }
  function removeRaw(name) {
    document.cookie = `${name}=;max-age=-1;path=/`
  }
  function flatten(prefix, value, result = []) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) flatten(`${prefix}[${i}]`, value[i], result)
      // Store length so we know how many indices to reconstruct.
      result.push([`${prefix}.__length`, Json.stringify(value.length)])
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v, result)
    } else result.push([prefix, Json.stringify(value)])
    return result
  }
  function unflatten(prefix) {
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
      const length = Json.parse(lengthCookie.substring(`${prefix}.__length`.length + 1))
      const result = []
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
    const result = {}
    for (const entry of children) {
      const key = entry.substring(dotPrefix.length, entry.indexOf('='))
      const segment = key.split(/[.[]/)[0]
      if (segment === '__length') continue
      if (!(segment in result)) result[segment] = unflatten(`${dotPrefix}${segment}`)
    }
    return result
  }
  return from(
    {
      getItem(name) {
        return unflatten(name)
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
/** Creates an IndexedDB-backed storage adapter. Stores raw values (no JSON serialization). */
export function idb(options = {}) {
  const store = typeof indexedDB !== 'undefined' ? createStore('tempo', 'store') : undefined
  return from(
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
}
/** Creates a `localStorage`-backed storage adapter. */
export function localStorage(options = {}) {
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
/** Creates an in-memory storage adapter. Useful for SSR and tests. */
export function memory(options = {}) {
  const store = new Map()
  return from(
    {
      getItem(name) {
        return store.get(name) ?? null
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
}
//# sourceMappingURL=Storage.js.map
