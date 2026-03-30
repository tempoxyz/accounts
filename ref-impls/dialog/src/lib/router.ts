import { Schema } from 'accounts'

/**
 * Validates an RPC request from TanStack Router search params.
 *
 * Validates using the `Schema.Request` discriminated union, then checks
 * the method matches the expected route. Throws on mismatch or invalid params.
 */
export function validateSearch<const method extends Schema.Request['method']>(
  search: Record<string, unknown>,
  parameters: { method: method },
): validateSearch.ReturnType<method> {
  const { method } = parameters
  const result = Schema.Request.safeParse(search)
  if (!result.success)
    throw new Error(`Invalid request params for "${method}".`, { cause: result.error })
  if (result.data.method !== method)
    throw new Error(`Method mismatch: expected "${method}" but got "${result.data.method}".`)
  return { ...search, _decoded: result.data, id: Number(search.id), jsonrpc: '2.0' } as never
}

export declare namespace validateSearch {
  type ReturnType<method extends Schema.Request['method']> = Extract<
    Schema.Request,
    { method: method }
  > & {
    id: number
    jsonrpc: '2.0'
    _decoded: Extract<Schema.Request, { method: method }>
    _returnType: unknown
  }
}
