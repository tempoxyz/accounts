import { RpcSchema } from 'ox'
import { rpcSchema } from 'viem'
import * as z from 'zod/mini'

import * as Rpc from './zod/rpc.js'

/** All provider-handled RPC method definitions. */
export const schema = from([
  Rpc.eth_accounts,
  Rpc.eth_chainId,
  Rpc.eth_requestAccounts,
  Rpc.eth_sendTransaction,
  Rpc.eth_signTransaction,
  Rpc.eth_sendTransactionSync,
  Rpc.eth_signTypedData_v4,
  Rpc.personal_sign,
  Rpc.wallet_sendCalls,
  Rpc.wallet_getBalances,
  Rpc.wallet_connect,
  Rpc.wallet_disconnect,
  Rpc.wallet_switchEthereumChain,
])

/**
 * A single JSON-RPC method definition with Zod schemas for
 * the method name, parameters, and return type.
 */
export type Item = {
  /** Method name as a Zod literal. */
  method: z.ZodMiniLiteral<string>
  /** Parameters schema, or `undefined` if the method takes no params. */
  params: z.ZodMiniType | undefined
  /** Return type schema, or `undefined` if the method returns nothing. */
  returns: z.ZodMiniType | undefined
}

/** An array of JSON-RPC method definitions. */
export type Schema = readonly Item[]

/** Inferred type for a schema item — the decoded output of `{ method, params, returns }`. */
export type DefineItem<item extends Item> = {
  method: z.input<item['method']>
  params: item['params'] extends z.ZodMiniType ? z.output<item['params']> : undefined
  returns: item['returns'] extends z.ZodMiniType ? z.output<item['returns']> : undefined
}

/**
 * Transforms a {@link Schema} into an Ox-compatible `RpcSchema.Generic` union.
 *
 * Uses `z.input` (the wire/encoded form — hex strings) since Ox operates
 * on the raw JSON-RPC wire format.
 */
export type ToOx<schema extends Schema> = {
  [key in keyof schema]: RpcSchema.From<{
    Request: schema[key]['params'] extends z.ZodMiniType
      ? undefined extends z.input<schema[key]['params']>
        ? { method: z.input<schema[key]['method']>; params?: z.input<schema[key]['params']> }
        : { method: z.input<schema[key]['method']>; params: z.input<schema[key]['params']> }
      : { method: z.input<schema[key]['method']> }
    ReturnType: schema[key]['returns'] extends z.ZodMiniType
      ? z.input<schema[key]['returns']>
      : undefined
  }>
}[number]

/**
 * Transforms a {@link Schema} into a Viem-compatible `RpcSchema` tuple.
 *
 * Uses `z.input` (the wire/encoded form — hex strings) since Viem's
 * RPC schema types operate on the raw JSON-RPC wire format.
 */
export type ToViem<schema extends Schema> = {
  [key in keyof schema]: {
    Method: z.input<schema[key]['method']>
    Parameters: schema[key]['params'] extends z.ZodMiniType
      ? z.input<schema[key]['params']>
      : undefined
    ReturnType: schema[key]['returns'] extends z.ZodMiniType
      ? z.input<schema[key]['returns']>
      : undefined
  }
}

/** Ox-compatible RPC schema union for the provider. */
export type Ox = RpcSchema.Eth | ToOx<typeof schema>
export const ox = RpcSchema.from<Ox>()

/** Viem-compatible RPC schema tuple for the provider. */
export type Viem = ToViem<typeof schema>
export const viem = rpcSchema<Viem>()

/** Derives a `z.object({ method, params? })` from an {@link Item}. */
type ToRequestSchema<item extends Item> = item['params'] extends z.ZodMiniType
  ? ReturnType<typeof z.object<{ method: item['method']; params: item['params'] }>>
  : ReturnType<typeof z.object<{ method: item['method'] }>>

/** Builds a request `z.object` from a schema item at runtime. */
function toRequestSchema<const item extends Item>(item: item): ToRequestSchema<item> {
  if (item.params) return z.object({ method: item.method, params: item.params }) as never
  return z.object({ method: item.method }) as never
}

/** Derives a union of request shapes from a {@link Schema}. */
type ToRequest<schema extends Schema> = {
  [key in keyof schema]: schema[key]['params'] extends z.ZodMiniType
    ? { method: z.output<schema[key]['method']>; params: z.output<schema[key]['params']> }
    : { method: z.output<schema[key]['method']> }
}[number]

/** Discriminated union of all provider-handled RPC requests. */
export const Request: z.ZodMiniType<
  ToRequest<typeof schema>,
  ToRequest<typeof schema>
> = z.discriminatedUnion('method', schema.map(toRequestSchema) as never)
export type Request = ToRequest<typeof schema>

/** Defines a JSON-RPC method schema item. */
export function defineItem<const item extends Item>(item: item): item {
  return item
}

/** Creates a {@link Schema}. */
export function from<const schema extends Schema>(schema: schema): schema {
  return schema
}
