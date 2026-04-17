import { QueryBuilder, Tidx } from 'tidx.ts'
import { tempo, tempoModerato } from 'viem/chains'

import type { TempoChain } from './chain.js'

/** Returns a Tidx query builder for the given chain. */
export function getQueryBuilder(chain: TempoChain) {
  const tidxAuth =
    chain === 'testnet'
      ? process.env.TEMPO_MODERATO_INDEXER_API_KEY
      : process.env.TEMPO_INDEXER_API_KEY
  const chainId = chain === 'testnet' ? tempoModerato.id : tempo.id
  return QueryBuilder.from(Tidx.create({ basicAuth: tidxAuth, chainId }))
}
