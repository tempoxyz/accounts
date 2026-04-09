import {} from 'ox'
import { createClient, http } from 'viem'
import { withFeePayer } from 'viem/tempo'
const clients = new Map()
/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(chainId, options) {
  const { chains, feePayer, provider, store } = options
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${feePayer ?? ''}:${provider ? 'p' : ''}`
  let client = clients.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]
    const base = feePayer ? withFeePayer(http(), http(feePayer)) : http()
    const transport = provider ? providerTransport(provider, base) : base
    client = createClient({ chain, transport, pollingInterval: 1000 })
    clients.set(key, client)
  }
  return client
}
/**
 * Creates a transport that routes requests through the provider, falling
 * back to the given base transport for methods the provider proxies to RPC.
 */
function providerTransport(provider, base) {
  return (params) => {
    const baseTransport = base(params)
    return {
      ...baseTransport,
      async request({ method, params: reqParams }) {
        return provider.request({
          method,
          params: reqParams,
        })
      },
    }
  }
}
//# sourceMappingURL=Client.js.map
