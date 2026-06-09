import { Provider } from 'ox'
import * as z from 'zod/mini'

import { type ZodIssue, flattenIssues } from './internal/zodIssues.js'
import * as Schema from './Schema.js'
import * as Request from './zod/request.js'
import * as Rpc from './zod/rpc.js'

const metadata = z.object({
  id: z.optional(z.union([z.string(), z.number(), z.null()])),
  jsonrpc: z.optional(z.literal('2.0')),
  origin: z.optional(z.string()),
})

/** Provider RPC request id metadata. */
export type Id = string | number | null

/** Transport metadata attached to a parsed provider request when present. */
export type Metadata = {
  /** Transport or JSON-RPC request id. */
  id?: Id | undefined
  /** JSON-RPC version. */
  jsonrpc?: '2.0' | undefined
  /** Origin that sent the request, when supplied by the transport. */
  origin?: string | undefined
}

/** Parsed provider request with method-correlated decoded params. */
export type ProviderRequest<method extends Schema.Request['method'] = Schema.Request['method']> =
  Extract<Schema.Request, { method: method }> & Metadata

/** Parses an unknown value into a typed provider request envelope. */
export function parse<const method extends Schema.Request['method']>(
  value: unknown,
  options: parse.OptionsWithMethod<method>,
): ProviderRequest<method>
export function parse(value: unknown, options?: parse.Options | undefined): ProviderRequest
export function parse(value: unknown, options: parse.Options = {}): ProviderRequest {
  const request = Request.validate(Schema.Request, value)._decoded
  if (options.method && request.method !== options.method)
    throw new Provider.ProviderRpcError(
      -32602,
      `Method mismatch: expected "${options.method}" but got "${request.method}".`,
    )

  if (options.strict ?? true) validateParameters(request)

  return {
    ...request,
    ...parseMetadata(value),
  } as never
}

export declare namespace parse {
  /** Options for {@link parse}. */
  type Options = {
    /** Expected RPC method. */
    method?: Schema.Request['method'] | undefined
    /** Enforce wallet-only parameter policy, such as access-key limits. */
    strict?: boolean | undefined
  }

  /** Options for {@link parse} when narrowing to a specific method. */
  type OptionsWithMethod<method extends Schema.Request['method']> = Options & {
    /** Expected RPC method. */
    method: method
  }
}

function parseMetadata(value: unknown): Metadata {
  const result = z.safeParse(metadata, value)
  if (result.error)
    throw new Provider.ProviderRpcError(
      -32600,
      `Invalid request: ${formatIssues(result.error.issues)}`,
    )

  return result.data
}

function validateParameters(request: Schema.Request) {
  const schema = Rpc.strictParameters[request.method as keyof typeof Rpc.strictParameters]
  if (!schema || !('params' in request) || request.params?.[0] == null) return

  const result = z.safeParse(schema, request.params[0])
  if (result.error)
    throw new Provider.ProviderRpcError(
      -32602,
      `Invalid params: ${formatIssues(result.error.issues)}`,
    )
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return flattenIssues(issues)
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join(', ')
}
