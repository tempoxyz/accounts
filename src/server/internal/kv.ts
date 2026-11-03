import type * as Kv from '../Kv.js'

type Entry = { expiresAt: number; value: unknown }

/**
 * Per-`kv`-instance in-memory L1 cache. Lives for the lifetime of the worker
 * (or process) and short-circuits the L2 `kv.get` on hot keys so a request
 * with N callers that share the same `cached()` key only pays for one
 * remote read.
 *
 * `WeakMap` keys mean dropping a `kv` reference releases its L1 entries
 * automatically — no need to thread a lifecycle hook through callers.
 */
const memoryStore = new WeakMap<Kv.Kv, Map<string, Entry>>()

/**
 * Per-`kv`-instance in-flight dedupe table. Multiple concurrent
 * `cached(kv, key, fn)` calls for the same key share a single `fn()`
 * invocation instead of stampeding the upstream.
 */
const inflightStore = new WeakMap<Kv.Kv, Map<string, Promise<unknown>>>()

/** Per-`kv`-instance keys whose stale entry is reloading in the background. */
const revalidatingStore = new WeakMap<Kv.Kv, Set<string>>()

/**
 * Reads `key` from a two-tier cache (in-memory L1, `kv`-backed L2). If absent
 * or expired in both tiers, calls `fn`, stores the result with a
 * `Date.now() + ttl * 1000` expiry in both tiers, and returns it. Defaults
 * to caching forever (no expiry). Kv read/write failures are swallowed so
 * cache misses never break the caller.
 *
 * With `stale`, an entry that expired less than `stale` seconds ago is
 * returned at once while `fn` reloads it in the background.
 *
 * Concurrent calls for the same key share a single `fn()` invocation.
 */
export async function cached<value>(
  kv: Kv.Kv,
  key: string,
  fn: () => Promise<value>,
  options: cached.Options = {},
): Promise<value> {
  const { stale = 0, ttl = Infinity } = options
  const memory = memoryFor(kv)

  async function load() {
    const value = await fn()
    if (ttl <= 0) return value
    const expiresAt = ttl === Infinity ? Infinity : Date.now() + ttl * 1000
    const fresh: Entry = { expiresAt, value }
    memory.set(key, fresh)
    // Cloudflare KV requires integer TTLs of at least 60 seconds. The envelope
    // expiry above still enforces the requested logical cache lifetime; storage
    // keeps the entry through its stale window.
    const storageTtl = ttl + stale
    await kv
      .set(
        key,
        fresh,
        Number.isFinite(storageTtl) ? { ttl: Math.max(60, Math.ceil(storageTtl)) } : undefined,
      )
      .catch(() => {})
    return value
  }

  /** Returns a usable entry's value, reloading a stale one in the background. */
  function serve(entry: Entry | null | undefined) {
    if (!entry) return undefined
    if (entry.expiresAt > Date.now()) return { value: entry.value as value }
    if (entry.expiresAt + stale * 1000 <= Date.now()) return undefined
    const revalidating = revalidatingFor(kv)
    if (!revalidating.has(key)) {
      revalidating.add(key)
      void load()
        .catch(() => {})
        .finally(() => revalidating.delete(key))
    }
    return { value: entry.value as value }
  }

  // L1: in-memory.
  const local = serve(memory.get(key))
  if (local) return local.value

  // Coalesce concurrent calls for the same key.
  const inflight = inflightFor(kv)
  const pending = inflight.get(key) as Promise<value> | undefined
  if (pending) return pending

  const promise = (async () => {
    // L2: kv.
    const entry = await kv.get<Entry | null>(key).catch(() => null)
    const stored = serve(entry)
    if (stored) {
      memory.set(key, entry!)
      return stored.value
    }
    return load()
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

export declare namespace cached {
  /** Options for `cached()`. */
  type Options = {
    /**
     * Seconds past `ttl` during which an expired entry is still returned,
     * while `fn` reloads it in the background.
     * @default 0
     */
    stale?: number | undefined
    /**
     * Cache TTL in seconds. Pass `Infinity` to cache forever.
     * @default Infinity
     */
    ttl?: number | undefined
  }
}

function memoryFor(kv: Kv.Kv) {
  let map = memoryStore.get(kv)
  if (!map) {
    map = new Map()
    memoryStore.set(kv, map)
  }
  return map
}

function revalidatingFor(kv: Kv.Kv) {
  let set = revalidatingStore.get(kv)
  if (!set) {
    set = new Set()
    revalidatingStore.set(kv, set)
  }
  return set
}

function inflightFor(kv: Kv.Kv) {
  let map = inflightStore.get(kv)
  if (!map) {
    map = new Map()
    inflightStore.set(kv, map)
  }
  return map
}
