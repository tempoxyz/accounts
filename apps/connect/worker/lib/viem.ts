import { type Client, createClient, http } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'

import type { TempoChain } from './chain.js'

function getRpcUrl(chain: TempoChain) {
  const chainId = chain === 'testnet' ? tempoModerato.id : tempo.id
  const url = new URL(`https://proxy.tempo.xyz/rpc/${chainId}`)
  if (process.env.TEMPO_RPC_KEY) url.searchParams.set('key', process.env.TEMPO_RPC_KEY)
  return url.toString()
}

function getFetchOptions(chain: TempoChain): RequestInit | undefined {
  if (chain === 'testnet' || !process.env.PRESTO_RPC_AUTH) return undefined
  return {
    headers: {
      Authorization: `Basic ${btoa(process.env.PRESTO_RPC_AUTH)}`,
    },
  }
}

/** Returns a viem client for the given chain. */
export function getClient(chain: TempoChain): Client {
  return createClient({
    chain: chain === 'testnet' ? tempoModerato : tempo,
    transport: http(getRpcUrl(chain), { fetchOptions: getFetchOptions(chain) }),
  })
}
