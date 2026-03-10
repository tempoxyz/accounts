import { Hex } from 'ox'
import * as z from 'zod/mini'
import type * as zc from 'zod/v4/core'

import type { OneOf } from '../../internal/types.js'

/** EVM address (`0x...`). */
export const address = () => z.templateLiteral(['0x', z.string()], 'Expected address')

/** Hex-encoded bigint. Decodes from `0x...` hex to `bigint`. */
export const bigint = () =>
  z.codec(hex(), z.bigint(), {
    decode: (value) => (value === '0x' ? 0n : Hex.toBigInt(value)),
    encode: (value) => Hex.fromNumber(value),
  })

/** Hex-encoded string (`0x...`). */
export const hex = () => z.templateLiteral(['0x', z.string()], 'Expected hex value')

/** Hex-encoded number. Decodes from `0x...` hex to `number`. */
export const number = () =>
  z.codec(hex(), z.number(), {
    decode: (value) => (value === '0x' ? 0 : Hex.toNumber(value)),
    encode: (value) => Hex.fromNumber(value),
  })

/** `z.union` that narrows the output type so only one branch is active at a time. */
export function oneOf<const type extends readonly zc.SomeType[]>(
  options: type,
): Omit<z.ZodMiniUnion<type>, '_zod'> & {
  _zod: Omit<z.ZodMiniUnion<type>['_zod'], 'output'> & {
    output: z.ZodMiniUnion<type>['_zod']['output'] extends object
      ? OneOf<z.ZodMiniUnion<type>['_zod']['output']>
      : z.ZodMiniUnion<type>['_zod']['output']
  }
} {
  return z.union(options) as never
}
