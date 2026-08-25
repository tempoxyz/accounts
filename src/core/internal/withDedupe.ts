/** Deduplicates in-flight promises by key. */
export function withDedupe<data>(
  fn: () => Promise<data>,
  { cache = withDedupe.cache, enabled = true, id }: withDedupe.Options,
): Promise<data> {
  if (!enabled || !id) return fn()
  const cached = cache.get(id)
  if (cached) return cached as Promise<data>
  const promise = fn().finally(() => cache.delete(id))
  cache.set(id, promise)
  return promise
}

export declare namespace withDedupe {
  type Options = {
    cache?: Map<string, Promise<unknown>> | undefined
    enabled?: boolean | undefined
    id?: string | undefined
  }
}

withDedupe.cache = new Map<string, Promise<unknown>>()
