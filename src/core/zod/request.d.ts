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
export declare function validate<const schema extends z.ZodMiniType>(
  schema: schema,
  value: unknown,
): WithDecoded<schema>
/**
 * A validated request with the decoded (Zod-parsed) output attached.
 *
 * Distributes over the union so that switching on `method` narrows
 * both the input and `_decoded` properties together.
 */
export type WithDecoded<schema extends z.ZodMiniType> =
  z.output<schema> extends infer decoded
    ? decoded extends {
        method: infer m extends string
      }
      ? Extract<
          z.input<schema>,
          {
            method: m
          }
        > & {
          _decoded: decoded
        }
      : never
    : never
/**
 * Encodes a decoded (output) value back to its wire (input) format
 * by running codec `reverseTransform` functions.
 */
export declare function encode<const schema extends z.ZodMiniType>(
  schema: schema,
  value: z.output<schema>,
): z.input<schema>
//# sourceMappingURL=request.d.ts.map
