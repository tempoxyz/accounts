import { RpcSchema } from 'ox'
import { rpcSchema } from 'viem'
import * as z from 'zod/mini'

import * as Rpc from './zod/rpc.js'

export { defineItem, from } from './internal/schema.js'
import { from } from './internal/schema.js'

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

/** Inferred wire-format type for a schema item — raw JSON-RPC `{ method, params, returns }`. */
export type Encoded<item extends Item> = {
  method: z.input<item['method']>
  params: item['params'] extends z.ZodMiniType ? z.input<item['params']> : undefined
  returns: item['returns'] extends z.ZodMiniType ? z.input<item['returns']> : undefined
}

/** Inferred decoded type for a schema item — after codec transforms are applied. */
export type Decoded<item extends Item> = {
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

/** All provider-handled RPC method definitions. */
export const schema = from([
  Rpc.eth_accounts.schema,
  Rpc.eth_chainId.schema,
  Rpc.eth_fillTransaction.schema,
  Rpc.eth_requestAccounts.schema,
  Rpc.eth_sendTransaction.schema,
  Rpc.eth_sendTransactionSync.schema,
  Rpc.eth_signTransaction.schema,
  Rpc.eth_signTypedData_v4.schema,
  Rpc.personal_sign.schema,
  Rpc.wallet_authorizeAccessKey.schema,
  Rpc.wallet_connect.schema,
  Rpc.wallet_deposit.schema,
  Rpc.wallet_disconnect.schema,
  Rpc.wallet_getBalances.schema,
  Rpc.wallet_getCallsStatus.schema,
  Rpc.wallet_getCapabilities.schema,
  Rpc.wallet_revokeAccessKey.schema,
  Rpc.wallet_send.schema,
  Rpc.wallet_sendCalls.schema,
  Rpc.wallet_swap.schema,
  Rpc.wallet_switchEthereumChain.schema,
])

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

/** Derives a union of wire-format request shapes from a {@link Schema}. */
type ToRequestInput<schema extends Schema> = {
  [key in keyof schema]: schema[key]['params'] extends z.ZodMiniType
    ? { method: z.input<schema[key]['method']>; params: z.input<schema[key]['params']> }
    : { method: z.input<schema[key]['method']> }
}[number]

/** Derives a union of decoded request shapes from a {@link Schema}. */
type ToRequestOutput<schema extends Schema> = {
  [key in keyof schema]: schema[key]['params'] extends z.ZodMiniType
    ? { method: z.output<schema[key]['method']>; params: z.output<schema[key]['params']> }
    : { method: z.output<schema[key]['method']> }
}[number]

/** Discriminated union of all provider-handled RPC requests. */
export const Request: z.ZodMiniType<
  ToRequestOutput<typeof schema>,
  ToRequestInput<typeof schema>
> = z.discriminatedUnion('method', schema.map(toRequestSchema) as never)
export type Request = ToRequestOutput<typeof schema>
