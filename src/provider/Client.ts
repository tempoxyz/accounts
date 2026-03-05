import { type Chain, createClient, type Client, http } from 'viem'

import type * as Store from './Store.js'

const clients = new Map<number, Client>()

/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(chainId: number | undefined, options: fromChainId.Options): Client {
  const { chains, store } = options
  const id = chainId ?? store.getState().chainId
  let client = clients.get(id)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    client = createClient({ chain, transport: http() })
    clients.set(id, client)
  }
  return client
}

export declare namespace fromChainId {
  type Options = {
    /** Supported chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Reactive state store. */
    store: Store.Store
  }
}
