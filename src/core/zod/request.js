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
export function validate(schema, value) {
  const result = z.safeParse(schema, value)
  if (result.error) {
    const issue = result.error.issues.at(0)
    if (issue?.code === 'invalid_union' && issue.note === 'No matching discriminator')
      throw new Provider.UnsupportedMethodError({
        message: `Unsupported method "${value?.method}".`,
      })
    throw new Provider.ProviderRpcError(
      -32602,
      `Invalid params: ${formatIssues(result.error.issues)}`,
    )
  }
  return { ...value, _decoded: result.data }
}
function formatIssues(issues) {
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
 * Encodes a decoded (output) value back to its wire (input) format
 * by running codec `reverseTransform` functions.
 */
export function encode(schema, value) {
  return z.encode(schema, value)
}
//# sourceMappingURL=request.js.map
