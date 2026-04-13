import { Hex, RpcRequest, RpcResponse } from 'ox'
import { Transaction as core_Transaction } from 'ox/tempo'
import type { Client } from 'viem'
import * as z from 'zod/mini'

export function resolveChainId(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && Hex.validate(value)) return Hex.toNumber(value)
  return undefined
}

export function formatFillTransactionRequest(client: Client, value: Record<string, unknown>) {
  const format = client.chain?.formatters?.transactionRequest?.format
  if (!format) return value
  return format({ ...value } as never, 'fillTransaction') as Record<string, unknown>
}

export function normalizeFillTransactionRequest(value: Record<string, unknown>) {
  if (typeof value.to !== 'undefined' || typeof value.data !== 'undefined') return value
  if (!Array.isArray(value.calls) || value.calls.length !== 1) return value
  const [call] = value.calls as Array<Record<string, unknown>>
  const { calls: _, ...rest } = value
  return {
    ...rest,
    ...(typeof call?.data !== 'undefined' ? { data: call.data } : {}),
    ...(typeof call?.to !== 'undefined' ? { to: call.to } : {}),
    ...(typeof call?.value !== 'undefined' ? { value: normalizeFillValue(call.value) } : {}),
  }
}

function normalizeFillValue(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return value
  return BigInt(value === '0x' ? '0x0' : value)
}

export function normalizeTempoTransaction(value: Record<string, unknown> | undefined) {
  if (!value) throw new Error('Expected `tx` in eth_fillTransaction response.')
  return core_Transaction.fromRpc({ type: '0x76', ...value } as core_Transaction.Rpc)!
}

export function rpcError(request: RpcRequest.RpcRequest, error: unknown) {
  if (error instanceof RpcResponse.InvalidParamsError)
    return Response.json(RpcResponse.from({ error }, { request }))

  if (error instanceof RpcResponse.MethodNotSupportedError)
    return Response.json(RpcResponse.from({ error }, { request }))

  if ((error as { name?: string | undefined }).name === 'ZodError')
    return Response.json(
      RpcResponse.from(
        {
          error: new RpcResponse.InvalidParamsError({
            message: (error as Error).message,
          }),
        },
        { request },
      ),
    )

  const inner = resolveError(error)
  const message = inner.message ?? (error as Error).message
  const code = inner.code ?? -32603
  const data = inner.data
  return Response.json(
    RpcResponse.from(
      {
        error: { code, message, ...(data ? { data } : {}) },
      },
      { request },
    ),
  )
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
  // Walk to the innermost cause with a numeric code (raw RPC error).
  if (e.cause && typeof e.cause === 'object') {
    const inner = resolveError(e.cause)
    if (inner.message) return inner
  }
  if (typeof e.code === 'number' && typeof e.message === 'string')
    return { message: e.message, code: e.code, data: e.data }
  return {}
}
