import { Json } from 'ox'

/**
 * Minimal key-value store interface used by the SDK's server primitives
 * (e.g. SIWE nonce store, session store).
 *
 * Values are JSON-serialized when stored. TTLs are optional; consumers that
 * need expiry pass `{ ttl }` (in seconds) to `set` and the implementation
 * lazily evicts (memory) or relies on the backing store's native expiry
 * (Cloudflare KV).
 */
export type Kv = {
  /** Read a value by key. Returns `undefined` when missing or expired. */
  get: <value = unknown>(key: string) => Promise<value | undefined>
  /** Write a value. When `ttl` is set, the entry expires after the given duration in seconds. */
  set: (key: string, value: unknown, options?: set.Options | undefined) => Promise<void>
  /** Delete a value by key. */
  delete: (key: string) => Promise<void>
}

export declare namespace set {
  type Options = {
    /** Time-to-live in seconds. After this duration, `get` returns `undefined`. */
    ttl?: number | undefined
  }
}

/** Wrap an existing `Kv`-shaped object so the SDK accepts it as a `Kv`. */
export function from<kv extends Kv>(kv: kv): kv {
  return kv
}

/**
 * Adapt a Cloudflare Workers KV namespace (or compatible binding) into a
 * `Kv`. Uses the underlying store's native `expirationTtl` for TTL.
 *
 * Cloudflare KV's minimum TTL is 60 seconds; the platform enforces its own
 * minimum independent of what's passed here.
 */
export function cloudflare(kv: cloudflare.Parameters): Kv {
  return from({
    delete: kv.delete.bind(kv),
    async get(key) {
      return (await kv.get(key, 'json')) ?? undefined
    },
    async set(key, value, options) {
      const expirationTtl = options?.ttl
      await kv.put(key, Json.stringify(value), expirationTtl ? { expirationTtl } : undefined)
    },
  })
}

export declare namespace cloudflare {
  type Parameters = {
    get: <value = unknown>(key: string, format: 'json') => Promise<value | null>
    put: (key: string, value: string, options?: { expirationTtl?: number } | undefined) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

/**
 * In-memory `Kv` for tests and single-process deployments. Lazily evicts
 * expired entries on read/write.
 *
 * Pass `now` to control the clock in tests.
 */
export function memory(options: memory.Options = {}): Kv {
  const now = options.now ?? Date.now
  const store = new Map<string, { value: unknown; expiresAt?: number }>()

  function isExpired(entry: { expiresAt?: number }) {
    return entry.expiresAt !== undefined && now() >= entry.expiresAt
  }

  return from({
    async delete(key) {
      store.delete(key)
    },
    async get(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        store.delete(key)
        return undefined
      }
      return entry.value as never
    },
    async set(key, value, options) {
      const expiresAt = options?.ttl ? now() + options.ttl * 1000 : undefined
      store.set(key, expiresAt !== undefined ? { value, expiresAt } : { value })
    },
  })
}

export declare namespace memory {
  type Options = {
    /** Clock function for TTL accounting. Defaults to `Date.now`. */
    now?: (() => number) | undefined
  }
}
