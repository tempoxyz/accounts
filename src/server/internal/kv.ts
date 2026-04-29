import type * as Kv from '../Kv.js'

/**
 * Reads `key` from `kv`. If absent or expired, calls `fn`, stores the result
 * with a `Date.now() + ttl * 1000` expiry, and returns it. Defaults to
 * caching forever (no expiry). Kv read/write failures are swallowed so cache
 * misses never break the caller.
 */
export async function cached<value>(
  kv: Kv.Kv,
  key: string,
  fn: () => Promise<value>,
  options: cached.Options = {},
): Promise<value> {
  const { ttl = Infinity } = options

  const entry = await kv.get<{ expiresAt: number; value: value } | null>(key).catch(() => null)
  if (entry && entry.expiresAt > Date.now()) return entry.value

  const value = await fn()
  const expiresAt = ttl === Infinity ? Infinity : Date.now() + ttl * 1000
  await kv.set(key, { expiresAt, value }).catch(() => {})
  return value
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
