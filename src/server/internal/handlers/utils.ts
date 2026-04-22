import { Hex, RpcRequest, RpcResponse } from 'ox'
import { Transaction as core_Transaction } from 'ox/tempo'
import { type Client, BaseError } from 'viem'
import * as z from 'zod/mini'

export function resolveChainId(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    if (Hex.validate(value)) return Hex.toNumber(value)
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function formatFillTransactionRequest(client: Client, value: Record<string, unknown>) {
  const format = client.chain?.formatters?.transactionRequest?.format
  if (!format) return value
  return format({ ...value } as never, 'fillTransaction') as Record<string, unknown>
}

export function normalizeFillTransactionRequest(
  tx: Record<string, unknown>,
): Record<string, unknown> & { calls: unknown[] } {
  const { to, data, value, ...rest } = tx
  if (Array.isArray(tx.calls) && tx.calls.length > 0)
    return {
      ...tx,
      calls: tx.calls.map((call) => ({
        ...call,
        value: normalizeFillValue(call.value),
      })),
    }
  const call = {
    ...(typeof to !== 'undefined' ? { to } : {}),
    ...(typeof data !== 'undefined' ? { data } : {}),
    ...(typeof value !== 'undefined' ? { value: normalizeFillValue(value) } : {}),
  }
  return { ...rest, calls: [call] }
}

function normalizeFillValue(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return value
  return BigInt(value === '0x' ? '0x0' : value)
}

export function normalizeTempoTransaction(value: Record<string, unknown> | undefined) {
  if (!value) throw new Error('Expected `tx` in eth_fillTransaction response.')
  return core_Transaction.fromRpc({ type: '0x76', ...value } as core_Transaction.Rpc)!
}

/** Returns a raw JSON-RPC error response object (not wrapped in a `Response`). */
export function rpcErrorJson(request: RpcRequest.RpcRequest, error: unknown) {
  if (error instanceof RpcResponse.InvalidParamsError)
    return RpcResponse.from({ error }, { request })

  if (error instanceof RpcResponse.MethodNotSupportedError)
    return RpcResponse.from({ error }, { request })

  if ((error as { name?: string | undefined }).name === 'ZodError')
    return RpcResponse.from(
      {
        error: new RpcResponse.InvalidParamsError({
          message: (error as Error).message,
        }),
      },
      { request },
    )

  const inner = resolveError(error)
  const message = inner.message ?? (error as Error).message
  const code = inner.code ?? -32603
  const data = inner.data
  return RpcResponse.from(
    {
      error: { code, message, ...(data ? { data } : {}) },
    },
    { request },
  )
}

export function rpcError(request: RpcRequest.RpcRequest, error: unknown) {
  return Response.json(rpcErrorJson(request, error))
}

export function rpcResult(request: RpcRequest.RpcRequest, result: unknown) {
  return Response.json(RpcResponse.from({ result }, { request }))
}

export const parseParams = z.readonly(z.tuple([z.record(z.string(), z.unknown())]))

function resolveError(error: unknown): {
  message?: string | undefined
  code?: number | undefined
  data?: unknown
} {
  if (!error || typeof error !== 'object') return {}
  const e = error as Record<string, unknown>
  // Use viem's walk() to find the innermost error with a numeric code.
  if (error instanceof BaseError) {
    const inner = error.walk(
      (e) => typeof (e as Record<string, unknown>).code === 'number',
    ) as Record<string, unknown> | null
    if (inner && typeof inner.code === 'number' && typeof inner.message === 'string')
      return { message: inner.message, code: inner.code, data: inner.data }
  }
  if (typeof e.code === 'number' && typeof e.message === 'string')
    return { message: e.message, code: e.code, data: e.data }
  return {}
}
