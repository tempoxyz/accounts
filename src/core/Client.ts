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
import { Transaction } from 'viem/tempo'

import type * as Store from './Store.js'

const clients = new Map<string, Client>()

/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(
  chainId: number | undefined,
  options: fromChainId.Options,
): Client<Transport, typeof tempo> {
  const { chains, feePayer, provider, store } = options
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${provider ? 'p' : ''}:${feePayer ?? ''}`
  let client = clients.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    const base = http()
    const transport_base = provider ? providerTransport(provider, base) : base
    const transport = feePayer ? feePayerTransport(transport_base, feePayer) : transport_base
    client = createClient({ chain, transport, pollingInterval: 1000 })
    clients.set(key, client)
  }
  return client as never
}

export declare namespace fromChainId {
  type Options = {
    /** Supported chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Sponsor service URL used for sponsor-assisted `eth_fillTransaction` requests. */
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

function feePayerTransport(base: Transport, url: string): Transport {
  return (params) => {
    const baseTransport = base(params)
    const sponsor = http(url)(params)

    return {
      ...baseTransport,
      async request({ method, params: rpcParams }) {
        const args = rpcParams as readonly unknown[] | undefined

        if (method === 'eth_fillTransaction') {
          const request = args?.[0] as
            | (Record<string, unknown> & { feePayer?: unknown })
            | undefined
          if (request && (request.feePayer === true || typeof request.feePayer === 'string'))
            return sponsor.request({
              method,
              params: [{ ...request, feePayer: true }],
            })
        }

        if (method === 'eth_sendRawTransaction' || method === 'eth_sendRawTransactionSync') {
          const serialized = args?.[0]
          if (
            typeof serialized === 'string' &&
            (serialized.startsWith('0x76') || serialized.startsWith('0x78'))
          ) {
            const { feePayerSignature } = Transaction.deserialize(
              serialized as `0x76${string}`,
            ) as { feePayerSignature?: null | unknown }
            if (feePayerSignature === null) {
              const signed = await sponsor.request({
                method: 'eth_signRawTransaction',
                params: [serialized],
              })
              return await baseTransport.request({ method, params: [signed] })
            }
          }
        }

        return await baseTransport.request({ method, params: rpcParams })
      },
    } as ReturnType<Transport>
  }
}
