import type { Address } from 'viem'

import type * as Kv from '../Kv.js'
import { cached } from './kv.js'

/** Default cache TTL in seconds (10 minutes) for tokenlist responses. */
const defaultCacheTtl = 10 * 60

/** Default base URL for the verified tokenlist service. */
const defaultBaseUrl = 'https://tokenlist.tempo.xyz'

/** A single tokenlist entry. */
export type Token = {
  /** Token address. */
  address: Address
  /** Token decimals. */
  decimals: number
  /** Token logo URI. */
  logoUri?: string | undefined
  /** Token name. */
  name: string
  /** Token symbol. */
  symbol: string
}

/**
 * Fetches the verified tokenlist for `chainId`. Reads through `kv` so
 * concurrent callers in the same scope share a single upstream request,
 * and so independent handlers (e.g. `Handler.relay` + `Handler.exchange`)
 * reuse the same KV cache key.
 *
 * Returns an empty list on any non-OK response — callers should fall back
 * to chain-supplied behavior rather than treating an empty list as fatal.
 *
 * @param chainId - Chain id to fetch the tokenlist for.
 * @param kv - Kv used to cache responses across requests.
 * @param options - Options.
 * @returns Tokens for the chain.
 */
export async function fetch(
  chainId: number,
  kv: Kv.Kv,
  options: fetch.Options = {},
): Promise<readonly Token[]> {
  const { baseUrl = defaultBaseUrl, cacheTtl = defaultCacheTtl, resolver } = options
  return cached(
    kv,
    `tokenlist:${chainId}`,
    async () => (resolver ? resolver(chainId) : fetchUncached(chainId, baseUrl)),
    { ttl: cacheTtl },
  )
}

export declare namespace fetch {
  /** Options for `fetch()`. */
  type Options = {
    /**
     * Base URL of the tokenlist service.
     * @default 'https://tokenlist.tempo.xyz'
     */
    baseUrl?: string | undefined
    /**
     * TTL in seconds for the cached response.
     * @default 600 (10 minutes)
     */
    cacheTtl?: number | undefined
    /**
     * Override resolver. When provided, the cache hit path is unchanged but
     * cache misses route through this function instead of fetching the
     * default `tokenlist.tempo.xyz` URL. Useful for tests or for vendoring
     * a curated list per app.
     */
    resolver?: ((chainId: number) => readonly Token[] | Promise<readonly Token[]>) | undefined
  }
}

/**
 * Default fetcher — resolves the verified tokenlist for `chainId` directly
 * from `tokenlist.tempo.xyz`. Returns an empty list on any non-OK response.
 */
async function fetchUncached(chainId: number, baseUrl: string): Promise<readonly Token[]> {
  const response = await globalThis.fetch(`${baseUrl}/list/${chainId}`)
  if (!response.ok) return []
  const data = (await response.json()) as {
    tokens: readonly (Token & { logoURI?: string })[]
  }
  return data.tokens.map(({ logoURI, ...token }) => ({
    ...token,
    logoUri: token.logoUri ?? logoURI,
  }))
}
