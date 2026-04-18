import { tempo, tempoModerato } from 'viem/chains'

/** Supported Tempo network. */
export type TempoChain = 'mainnet' | 'testnet'

/** Resolves a numeric chain ID to a `TempoChain`. Throws if the chain is not supported. */
export function fromId(chainId: number): TempoChain {
  if (chainId === tempo.id) return 'mainnet'
  if (chainId === tempoModerato.id) return 'testnet'
  throw new Error(`Unsupported chain ID: ${chainId}`)
}
