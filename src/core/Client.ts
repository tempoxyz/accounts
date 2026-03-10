import { type Chain, createClient, type Client, http, type Transport } from 'viem'
import type { tempo } from 'viem/chains'
import { withFeePayer } from 'viem/tempo'

import type * as Store from './Store.js'

const clients = new Map<string, Client>()

/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(
  chainId: number | undefined,
  options: fromChainId.Options,
): Client<Transport, typeof tempo> {
  const { chains, feePayer, store } = options
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${feePayer ?? ''}`
  let client = clients.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    const transport = feePayer ? withFeePayer(http(), http(feePayer)) : http()
    client = createClient({ chain, transport, pollingInterval: 1000 })
    clients.set(key, client)
  }
  return client as never
}

export declare namespace fromChainId {
  type Options = {
    /** Supported chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Fee payer service URL. When set, the transport routes fee-payer RPC calls to this URL. */
    feePayer?: string | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}
