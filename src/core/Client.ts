import { type Provider as ox_Provider } from 'ox'
import {
  type Chain,
  createClient,
  type Client,
  type EIP1193RequestFn,
  http,
  type Transport,
} from 'viem'
import type { tempo } from 'viem/chains'
import { withFeePayer } from 'viem/tempo'

import type * as Store from './Store.js'

const clients = new Map<string, Client>()

/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(
  chainId: number | undefined,
  options: fromChainId.Options,
): Client<Transport, typeof tempo> {
  const { chains, feePayer, provider, store } = options
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${feePayer ?? ''}:${provider ? 'p' : ''}`
  let client = clients.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    const base = feePayer ? withFeePayer(http(), http(feePayer)) : http()
    const transport = provider ? providerTransport(provider, base) : base
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
    /** Provider instance. When set, the transport routes requests through the provider first, falling back to HTTP for unknown methods. */
    provider?: ox_Provider.Provider | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}

/**
 * Creates a transport that routes requests through the provider, falling
 * back to the given base transport for methods the provider proxies to RPC.
 */
function providerTransport(provider: ox_Provider.Provider, base: Transport): Transport {
  return (params) => {
    const baseTransport = base(params)
    return {
      ...baseTransport,
      async request({ method, params: reqParams }) {
        return (provider as { request: EIP1193RequestFn }).request({
          method,
          params: reqParams,
        } as any)
      },
    } as ReturnType<Transport>
  }
}
