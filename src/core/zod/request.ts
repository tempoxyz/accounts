import { Provider } from 'ox'
import * as z from 'zod/mini'

/**
 * Validates an incoming JSON-RPC request against the provider schema.
 *
 * Returns the original request augmented with a `_decoded` property
 * containing the Zod-parsed output (with codec transforms applied).
 *
 * Throws EIP-1193 errors on validation failure:
 * - `4200` if the method is not in the discriminated union
 * - `-32602` if params fail validation
 */
export function validate<const schema extends z.ZodMiniType>(
  schema: schema,
  value: unknown,
): WithDecoded<schema> {
  const result = z.safeParse(schema, value)
  if (result.error) {
    const issue = result.error.issues.at(0)
    if (issue?.code === 'invalid_union' && (issue as any).note === 'No matching discriminator')
      throw new Provider.UnsupportedMethodError({
        message: `Unsupported method "${(value as any)?.method}".`,
      })
    throw new Provider.ProviderRpcError(
      -32602,
      `Invalid params: ${formatIssues(result.error.issues)}`,
    )
  }
  return { ...(value as any), _decoded: result.data } as never
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .flatMap((issue) => {
      if (issue.code === 'invalid_union' && issue.errors.length > 0)
        return issue.errors.flatMap((branch) =>
          branch.map(
            (i) =>
              `${[...issue.path, ...i.path].join('.')}: ${i.code === 'invalid_union' && i.errors.length > 0 ? formatIssues([i]) : i.message}`,
          ),
        )
      return [`${issue.path.join('.')}: ${issue.message}`]
    })
    .join(', ')
}

/**
 * A validated request with the decoded (Zod-parsed) output attached.
 *
 * Distributes over the union so that switching on `method` narrows
 * both the input and `_decoded` properties together.
 */
export type WithDecoded<schema extends z.ZodMiniType> =
  z.output<schema> extends infer decoded
    ? decoded extends { method: infer m extends string }
      ? Extract<z.input<schema>, { method: m }> & { _decoded: decoded }
      : never
    : never

/**
 * Encodes a decoded (output) value back to its wire (input) format
 * by running codec `reverseTransform` functions.
 */
export function encode<const schema extends z.ZodMiniType>(
  schema: schema,
  value: z.output<schema>,
): z.input<schema> {
  return (z as never as { encode: typeof encode }).encode(schema, value)
}
