/** Bridge configuration for Relay deposit addresses. */

import { useQuery } from '@tanstack/react-query'

import { api } from './api.js'

/** CAIP-2 namespace. */
type Namespace = 'eip155' | 'solana'

/** A token available for deposit on an origin chain. */
export type Token = {
  address: string
  decimals: number
  symbol: string
}

/** A supported origin chain for cross-chain deposits. */
export type Chain = {
  id: number
  name: string
  namespace: Namespace
  tokens: readonly Token[]
}

/** Fixed destination chain: USDC.e on Tempo mainnet. */
export const destinationChain = {
  id: 4217,
  name: 'Tempo',
  namespace: 'eip155',
  tokens: [
    { address: '0x20c000000000000000000000b9537d11c60e8b50', symbol: 'USDC.e', decimals: 6 },
  ],
} as const satisfies Chain

/** Supported origin chains and their depositable tokens. */
export const sourceChains = [
  {
    id: 8453,
    name: 'Base',
    namespace: 'eip155',
    tokens: [
      { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
      { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
      { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', symbol: 'cbBTC', decimals: 8 },
      { address: '0x311935cd80b76769bf2ecc9d8ab7635b2139cf82', symbol: 'SOL', decimals: 9 },
      { address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', symbol: 'WBTC', decimals: 8 },
    ],
  },
  {
    id: 1,
    name: 'Ethereum',
    namespace: 'eip155',
    tokens: [
      { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
      { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 },
      { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18 },
      { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC', decimals: 8 },
    ],
  },
  {
    id: 42161,
    name: 'Arbitrum',
    namespace: 'eip155',
    tokens: [
      { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
      { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6 },
    ],
  },
  {
    id: 10,
    name: 'Optimism',
    namespace: 'eip155',
    tokens: [
      { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
      { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
      { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', decimals: 6 },
    ],
  },
  {
    id: 130,
    name: 'Unichain',
    namespace: 'eip155',
    tokens: [
      { address: '0x078d782b760474a361dda0af3839290b0ef57ad6', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    ],
  },
  {
    id: 2741,
    name: 'Abstract',
    namespace: 'eip155',
    tokens: [
      { address: '0x84a71ccd554cc1b02749b35d22f684cc8ec987e1', symbol: 'USDC', decimals: 6 },
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    ],
  },
  {
    id: 792703809,
    name: 'Solana',
    namespace: 'solana',
    tokens: [
      { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
      { address: '11111111111111111111111111111111', symbol: 'SOL', decimals: 9 },
    ],
  },
] as const satisfies readonly Chain[]

/** Solana chain ID used by Relay. */
export const solanaChainId = 792703809

/** Get tokens for a given origin chain. */
export function getTokens(chainId: number): readonly Token[] {
  return sourceChains.find((c) => c.id === chainId)?.tokens ?? []
}

/** Get default token (first listed, typically USDC) for a given origin chain. */
export function getDefaultToken(chainId: number): Token | undefined {
  return sourceChains.find((c) => c.id === chainId)?.tokens[0]
}

/** Resolve namespace from Relay chain ID. */
export function getNamespace(chainId: number): 'eip155' | 'solana' {
  if (chainId === solanaChainId) return 'solana'
  return 'eip155'
}

/**
 * Nominal amount for the Relay quote — just needs to clear fee minimums.
 * The deposit address is open and accepts any amount.
 */
export function getNominalAmount(decimals: number): number {
  if (decimals <= 6) return 1
  if (decimals <= 8) return 0.00001
  return 0.01
}

/** Fetches a Relay deposit address for the given origin chain/token. */
export function useDepositAddress(params: useDepositAddress.Options) {
  const { enabled = true, origin } = params

  return useQuery({
    queryKey: ['deposit-address', origin.chainId, origin.token, origin.decimals],
    queryFn: async () => {
      const res = await api.api.bridge.deposit.$post({
        json: { origin },
      })
      if (!res.ok) {
        const body = (await res.json()) as { error: string; code?: string }
        const error = new Error(body.error) as Error & { code?: string }
        if (body.code) error.code = body.code
        throw error
      }
      return (await res.json()) as { address: string; id: string }
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: (failureCount, error) => {
      if ((error as Error & { code?: string }).code === 'UNSUPPORTED_ROUTE') return false
      return failureCount < 1
    },
  })
}

export declare namespace useDepositAddress {
  type Options = {
    /** Origin chain/token to get a deposit address for. */
    origin: { chainId: number; token: string; decimals: number }
    /** Whether the query is enabled. */
    enabled?: boolean | undefined
  }
}
