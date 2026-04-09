import { Hex } from 'ox'
import * as z from 'zod/mini'
/** EVM address (`0x...`). */
export const address = () => z.templateLiteral(['0x', z.string()], 'Expected address')
/** Hex-encoded bigint. Decodes from `0x...` hex or raw `bigint` to `bigint`. */
export const bigint = () =>
  z.codec(z.union([hex(), z.bigint()]), z.bigint(), {
    decode: (value) =>
      typeof value === 'bigint' ? value : value === '0x' ? 0n : Hex.toBigInt(value),
    encode: (value) => Hex.fromNumber(value),
  })
/** Hex-encoded string (`0x...`). */
export const hex = () => z.templateLiteral(['0x', z.string()], 'Expected hex value')
/** Hex-encoded number. Decodes from `0x...` hex or raw `number` to `number`. */
export const number = () =>
  z.codec(z.union([hex(), z.number()]), z.number(), {
    decode: (value) =>
      typeof value === 'number' ? value : value === '0x' ? 0 : Hex.toNumber(value),
    encode: (value) => Hex.fromNumber(value),
  })
/** `z.union` that narrows the output type so only one branch is active at a time. */
export function oneOf(options) {
  return z.union(options)
}
//# sourceMappingURL=utils.js.map
