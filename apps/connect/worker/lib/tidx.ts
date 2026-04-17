import { QueryBuilder, Tidx } from 'tidx.ts'
import { tempo, tempoModerato } from 'viem/chains'

import type { TempoChain } from './chain.js'

/** Returns a Tidx query builder for the given chain. */
export function getQueryBuilder(chain: TempoChain) {
  const tidxAuth =
    chain === 'testnet'
      ? process.env.TIDX_TESTNET_API_KEY
      : process.env.TIDX_MAINNET_API_KEY
  const chainId = chain === 'testnet' ? tempoModerato.id : tempo.id
  return QueryBuilder.from(Tidx.create({ basicAuth: tidxAuth, chainId }))
}
