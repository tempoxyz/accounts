import { Discovery } from 'wata'

/**
 * Builds a memoizing resolver for a wallet's Wata host discovery document.
 *
 * The document is fetched once and reused for the adapter's lifetime; a
 * wallet rotating its document requires a new adapter instance to pick up.
 * A failed fetch clears the cache so the next request retries.
 */
export function hostResolver(
  host: string | Discovery.HostDocument,
  fetch?: typeof globalThis.fetch | undefined,
): () => Discovery.HostDocument | Promise<Discovery.HostDocument> {
  let document: Promise<Discovery.HostDocument> | undefined
  return () => {
    if (typeof host !== 'string') return host
    document ??= Discovery.fetchHost(host, fetch !== undefined ? { fetch } : {}).catch((error) => {
      document = undefined
      throw error
    })
    return document
  }
}
