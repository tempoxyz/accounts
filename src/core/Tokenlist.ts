import type { Address } from 'ox'

/** Default base URL for the curated tempo tokenlist. */
const defaultBaseUrl = 'https://tokenlist.tempo.xyz'

/** A single tokenlist entry. */
export type Token = {
  /** Token contract address. */
  address: Address.Address
  /** Token decimals. */
  decimals: number
  /** Token logo URI. */
  logoUri?: string | undefined
  /** Token name. */
  name: string
  /** Token symbol. */
  symbol: string
}

/** Cache keyed by `${baseUrl}|${chainId}` so concurrent callers share a single fetch. */
const cache = new Map<string, Promise<readonly Token[]>>()

/**
 * Fetches the curated tokenlist for a given Tempo chain. Concurrent calls
 * for the same chain share a single in-flight request, and successful
 * responses are cached for the lifetime of the process.
 *
 * Returns an empty list on any non-OK response so callers can fall back
 * to chain-supplied behavior rather than treating a fetch failure as fatal.
 */
export async function fetch(options: fetch.Options): Promise<readonly Token[]> {
  const { chainId, baseUrl = defaultBaseUrl } = options
  const key = `${baseUrl}|${chainId}`
  const existing = cache.get(key)
  if (existing) return existing
  const pending = (async () => {
    try {
      const response = await globalThis.fetch(`${baseUrl}/list/${chainId}`)
      if (!response.ok) return []
      const data = (await response.json()) as {
        tokens: readonly (Token & { logoURI?: string })[]
      }
      return data.tokens.map(({ logoURI, ...token }) => ({
        ...token,
        logoUri: token.logoUri ?? logoURI,
      }))
    } catch {
      return []
    }
  })()
  cache.set(key, pending)
  // Drop failed/empty results so the next caller retries.
  pending.then((tokens) => {
    if (tokens.length === 0) cache.delete(key)
  })
  return pending
}

export declare namespace fetch {
  /** Options for {@link fetch}. */
  type Options = {
    /** Chain id to fetch the tokenlist for. */
    chainId: number
    /**
     * Base URL of the tokenlist service.
     * @default 'https://tokenlist.tempo.xyz'
     */
    baseUrl?: string | undefined
  }
}

/**
 * Resolves a token symbol (case-insensitive) against the curated tokenlist
 * for a given chain. Returns the token entry, or `undefined` if no match.
 */
export async function resolveSymbol(
  options: resolveSymbol.Options,
): Promise<Token | undefined> {
  const { symbol, ...rest } = options
  const tokens = await fetch(rest)
  const lowered = symbol.toLowerCase()
  return tokens.find((token) => token.symbol.toLowerCase() === lowered)
}

export declare namespace resolveSymbol {
  /** Options for {@link resolveSymbol}. */
  type Options = fetch.Options & {
    /** Symbol to look up (case-insensitive). */
    symbol: string
  }
}
