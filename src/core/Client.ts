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
  const { chains, feePayer: feePayerOption, provider, store } = options
  const feePayerUrl = (() => {
    if (feePayerOption === false) return undefined
    if (typeof feePayerOption === 'string') return feePayerOption
    return feePayerOption?.url
  })()
  const precedence = (() => {
    if (typeof feePayerOption === 'object' && feePayerOption !== null)
      return feePayerOption.precedence ?? 'fee-payer-first'
    return 'fee-payer-first'
  })()
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${provider ? 'p' : ''}:${feePayerOption === false ? 'no-fp' : feePayerUrl ?? ''}:${precedence}`
  let client = clients.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    const base = http()
    const transport_base = provider ? providerTransport(provider, base) : base
    const transport = feePayerUrl
      ? feePayerTransport(transport_base, feePayerUrl, precedence)
      : transport_base
    client = createClient({ chain, transport, pollingInterval: 1000 })
    clients.set(key, client)
  }
  return client as never
}

export declare namespace fromChainId {
  type Options = {
    /** Supported chains. */
    chains: readonly [Chain, ...Chain[]]
    /** Fee payer configuration. A URL string, config object, or `false` to opt out. */
    feePayer?:
      | string
      | false
      | {
          /** Fee payer service URL. */
          url: string
          /** Signing precedence. @default 'fee-payer-first' */
          precedence?: 'fee-payer-first' | 'user-first' | undefined
        }
      | undefined
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

function feePayerTransport(
  base: Transport,
  url: string,
  precedence: 'fee-payer-first' | 'user-first',
): Transport {
  return (params) => {
    const baseTransport = base(params)
    const sponsor = http(url)(params)

    return {
      ...baseTransport,
      async request({ method, params: rpcParams }: { method: string; params?: unknown }) {
        const args = rpcParams as readonly unknown[] | undefined

        if (precedence === 'fee-payer-first' && method === 'eth_fillTransaction') {
          const request = args?.[0]
          if (
            request &&
            typeof request === 'object' &&
            'feePayer' in request &&
            (request.feePayer === true || typeof request.feePayer === 'string')
          )
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
            const deserialized = Transaction.deserialize(serialized as `0x76${string}`)
            if ('feePayerSignature' in deserialized && deserialized.feePayerSignature === null) {
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
