/** Deduplicates in-flight promises by key. */
export function withDedupe(fn, { enabled = true, id }) {
  if (!enabled || !id) return fn()
  if (withDedupe.cache.get(id)) return withDedupe.cache.get(id)
  const promise = fn().finally(() => withDedupe.cache.delete(id))
  withDedupe.cache.set(id, promise)
  return promise
}
withDedupe.cache = new Map()
//# sourceMappingURL=withDedupe.js.map
