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

/**
 * Reads `key` from a two-tier cache (in-memory L1, `kv`-backed L2). If absent
 * or expired in both tiers, calls `fn`, stores the result with a
 * `Date.now() + ttl * 1000` expiry in both tiers, and returns it. Defaults
 * to caching forever (no expiry). Kv read/write failures are swallowed so
 * cache misses never break the caller.
 *
 * Concurrent calls for the same key share a single `fn()` invocation.
 */
export async function cached<value>(
  kv: Kv.Kv,
  key: string,
  fn: () => Promise<value>,
  options: cached.Options = {},
): Promise<value> {
  const { ttl = Infinity } = options

  // L1: in-memory.
  const memory = memoryFor(kv)
  const local = memory.get(key)
  if (local && local.expiresAt > Date.now()) return local.value as value

  // Coalesce concurrent calls for the same key.
  const inflight = inflightFor(kv)
  const pending = inflight.get(key) as Promise<value> | undefined
  if (pending) return pending

  const promise = (async () => {
    // L2: kv.
    const entry = await kv.get<Entry | null>(key).catch(() => null)
    if (entry && entry.expiresAt > Date.now()) {
      memory.set(key, entry)
      return entry.value as value
    }

    const value = await fn()
    const expiresAt = ttl === Infinity ? Infinity : Date.now() + ttl * 1000
    const fresh: Entry = { expiresAt, value }
    memory.set(key, fresh)
    await kv.set(key, fresh).catch(() => {})
    return value
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

function inflightFor(kv: Kv.Kv) {
  let map = inflightStore.get(kv)
  if (!map) {
    map = new Map()
    inflightStore.set(kv, map)
  }
  return map
}