import * as z from 'zod/mini'
import type * as zc from 'zod/v4/core'

import type { OneOf } from '../../internal/types.js'
/** EVM address (`0x...`). */
export declare const address: () => z.ZodMiniTemplateLiteral<`0x${string}`>
/** Hex-encoded bigint. Decodes from `0x...` hex or raw `bigint` to `bigint`. */
export declare const bigint: () => z.ZodMiniCodec<
  z.ZodMiniTemplateLiteral<`0x${string}`>,
  z.ZodMiniBigInt<bigint>
>
/** Hex-encoded string (`0x...`). */
export declare const hex: () => z.ZodMiniTemplateLiteral<`0x${string}`>
/** Hex-encoded number. Decodes from `0x...` hex or raw `number` to `number`. */
export declare const number: () => z.ZodMiniCodec<
  z.ZodMiniTemplateLiteral<`0x${string}`>,
  z.ZodMiniNumber<number>
>
/** `z.union` that narrows the output type so only one branch is active at a time. */
export declare function oneOf<const type extends readonly zc.SomeType[]>(
  options: type,
): Omit<z.ZodMiniUnion<type>, '_zod'> & {
  _zod: Omit<z.ZodMiniUnion<type>['_zod'], 'output'> & {
    output: z.ZodMiniUnion<type>['_zod']['output'] extends object
      ? OneOf<z.ZodMiniUnion<type>['_zod']['output']>
      : z.ZodMiniUnion<type>['_zod']['output']
  }
}
//# sourceMappingURL=utils.d.ts.map
