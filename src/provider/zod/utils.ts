import { Hex } from 'ox'
import * as z from 'zod/mini'

/** EVM address (`0x...`). */
export const address = () => z.templateLiteral(['0x', z.string()])

/** Hex-encoded bigint. Decodes from `0x...` hex to `bigint`. */
export const bigint = () =>
  z.codec(hex(), z.bigint(), {
    decode: (value) => Hex.toBigInt(value),
    encode: (value) => Hex.fromNumber(value),
  })

/** Hex-encoded string (`0x...`). */
export const hex = () => z.templateLiteral(['0x', z.string()])

/** Hex-encoded number. Decodes from `0x...` hex to `number`. */
export const number = () =>
  z.codec(hex(), z.number(), {
    decode: (value) => Hex.toNumber(value),
    encode: (value) => Hex.fromNumber(value),
  })
