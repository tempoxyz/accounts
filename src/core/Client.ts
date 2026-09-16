import { type Provider as ox_Provider } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import {
  type Chain,
  createClient,
  type Client,
  type EIP1193RequestFn,
  http,
  type Transport,
} from 'viem'
import { Transaction } from 'viem/tempo'
import type { tempo } from 'viem/tempo/chains'

import type * as Store from './Store.js'

const defaultClients = new Map<string, Client>()
const clients = new WeakMap<object, Map<string, Client>>()

/** Resolves a viem Client for a given chain ID (cached). */
export function fromChainId(
  chainId: number | undefined,
  options: fromChainId.Options,
): Client<Transport, typeof tempo> {
  const { chains, feePayer: feePayerOption, provider, store, transports } = options
  const feePayerUrl = (() => {
    if (feePayerOption === false) return undefined
    if (typeof feePayerOption === 'string') return normalizeFeePayerUrl(feePayerOption)
    if (feePayerOption?.url) return normalizeFeePayerUrl(feePayerOption.url)
    return undefined
  })()
  const precedence = (() => {
    if (typeof feePayerOption === 'object' && feePayerOption !== null)
      return feePayerOption.precedence ?? 'fee-payer-first'
    return 'fee-payer-first'
  })()
  const id = chainId ?? store.getState().chainId
  const key = `${id}:${provider ? 'p' : ''}:${feePayerOption === false ? 'no-fp' : (feePayerUrl ?? '')}:${precedence}`
  const scope = provider ?? transports
  const cache = (() => {
    if (!scope) return defaultClients
    let map = clients.get(scope)
    if (!map) {
      map = new Map()
      clients.set(scope, map)
    }
    return map
  })()
  let client = cache.get(key)
  if (!client) {
    const chain = chains.find((c) => c.id === id) ?? chains[0]!
    const base = transports?.[id] ?? http()
    const transport_base = provider
      ? providerTransport(provider, base, chainId === undefined ? undefined : chain.id)
      : base
    const transport = feePayerUrl
      ? feePayerTransport(transport_base, feePayerUrl, precedence)
      : transport_base
    client = createClient({ chain, transport, pollingInterval: 1000 })
    cache.set(key, client)
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
    /** Provider for account operations and active-chain requests. Explicit-chain RPCs use the matching transport. */
    provider?: ox_Provider.Provider | undefined
    /** Reactive state store. */
    store: Store.Store
    /** Per-chain transports keyed by chain ID. When omitted, defaults to `http()` (uses the chain's default RPC URL). */
    transports?: Record<number, Transport> | undefined
  }
}

/**
 * Routes account operations through the provider and explicit-chain RPCs
 * through the requested chain's transport.
 */
function providerTransport(
  provider: ox_Provider.Provider,
  base: Transport,
  chainId: number | undefined,
): Transport {
  return (params) => {
    const baseTransport = base(params)
    return {
      ...baseTransport,
      async request({ method, params: reqParams }) {
        if (chainId !== undefined && !usesProvider(method))
          return baseTransport.request({ method, params: reqParams } as never)
        const params = (() => {
          if (method !== 'eth_fillTransaction' || chainId === undefined) return reqParams
          const request = (reqParams as readonly unknown[] | undefined)?.[0]
          if (!request || typeof request !== 'object') return reqParams
          return [{ ...request, chainId }]
        })()
        return (provider as { request: EIP1193RequestFn }).request({
          method,
          params,
        } as any)
      },
    } as ReturnType<Transport>
  }
}

function usesProvider(method: string) {
  return (
    method.startsWith('wallet_') ||
    [
      'eth_accounts',
      'eth_fillTransaction',
      'eth_requestAccounts',
      'eth_sendTransaction',
      'eth_sendTransactionSync',
      'eth_signTransaction',
      'eth_signTypedData_v4',
      'personal_sign',
    ].includes(method)
  )
}

/**
 * Resolves a fee payer URL to an absolute URL string. Relative paths (e.g.
 * `/relay`) are resolved against `window.location.origin` when running in a
 * browser; on the server, relative paths are returned as-is.
 */
function normalizeFeePayerUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (typeof window !== 'undefined') return new URL(url, window.location.origin).href
  return url
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
          ) {
            const response = await sponsor.request({
              method,
              params: [{ ...request, feePayer: true }],
            })
            assertFilledTransactionIntent(request, response)
            return response
          }
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
              assertSignedTransactionIntent(serialized, signed)
              return await baseTransport.request({ method, params: [signed] })
            }
          }
        }

        return await baseTransport.request({ method, params: rpcParams })
      },
    } as ReturnType<Transport>
  }
}

function assertFilledTransactionIntent(request: Record<string, unknown>, response: unknown) {
  if (!isObject(response) || !isObject(response.tx))
    throw new Error('Fee payer returned an invalid filled transaction.')

  const transaction = response.tx
  if (
    (request.from !== undefined && !sameAddress(request.from, transaction.from)) ||
    (request.chainId !== undefined && !sameQuantity(request.chainId, transaction.chainId)) ||
    (request.calls !== undefined && !sameCalls(request.calls, transaction.calls))
  )
    throw new Error('Fee payer changed the requested transaction intent.')
}

function assertSignedTransactionIntent(serialized: string, signed: unknown) {
  if (typeof signed !== 'string' || (!signed.startsWith('0x76') && !signed.startsWith('0x78')))
    throw new Error('Fee payer returned an invalid signed transaction.')

  const requested = TxEnvelopeTempo.deserialize(serialized as TxEnvelopeTempo.Serialized)
  const transaction = TxEnvelopeTempo.deserialize(signed as TxEnvelopeTempo.Serialized)
  if (
    !transaction.feePayerSignature ||
    !sameAddress(requested.from, transaction.from) ||
    TxEnvelopeTempo.getSignPayload(requested) !== TxEnvelopeTempo.getSignPayload(transaction)
  )
    throw new Error('Fee payer changed the requested transaction intent.')
}

function sameCalls(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((call, index) => {
    const other = b[index]
    return (
      isObject(call) &&
      isObject(other) &&
      sameAddress(call.to, other.to) &&
      sameQuantity(call.value, other.value) &&
      sameHex(call.data, other.data)
    )
  })
}

function sameAddress(a: unknown, b: unknown) {
  if (a === undefined && b === undefined) return true
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

function sameHex(a: unknown, b: unknown) {
  const normalize = (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : value === undefined ? '0x' : undefined
  return normalize(a) === normalize(b)
}

function sameQuantity(a: unknown, b: unknown) {
  const normalize = (value: unknown) => {
    if (value === undefined || value === null || value === '0x') return 0n
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' || typeof value === 'string') return BigInt(value)
    return undefined
  }
  return normalize(a) === normalize(b)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
