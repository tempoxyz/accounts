/** Parses `TEMPO_API_URLS` into origins, so no key in it reaches a bundle. @module */

/**
 * Returns the `[chainId, origin]` entries of a comma-separated `chainId=url` list. Throws on an
 * entry that is not an origin, without naming its URL.
 */
export function parse(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [, chainId, url] = entry.match(/^(?:[^:=]*:)?(\d+)=(.+)$/) ?? []
      const parsed = (() => {
        try {
          return new URL(url ?? '')
        } catch {
          return undefined
        }
      })()
      if (!chainId || !parsed)
        throw new Error(
          `Invalid TEMPO_API_URLS entry ${index + 1}. Use \`chainId=url\`.`,
        )
      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      )
        throw new Error(
          `Invalid TEMPO_API_URLS entry ${index + 1} for chain ${chainId}: the page's bundle holds the URL. Use an origin without credentials, a path, or a query.`,
        )
      return [Number(chainId), parsed.origin] as const
    })
}
