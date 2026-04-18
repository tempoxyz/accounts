import * as z from 'zod/mini'

const address = z.templateLiteral(['0x', z.string()])
const numberish = z.union([z.number(), z.bigint(), z.string().check(z.regex(/^\d+$/))])

/** Base EIP-712 typed message schema. */
export const TypedMessageSchema = z.object({
  domain: z.object({
    chainId: z.optional(numberish),
    name: z.optional(z.string()),
    salt: z.optional(z.string()),
    verifyingContract: z.optional(address),
    version: z.optional(z.string()),
  }),
  message: z.record(z.string(), z.unknown()),
  primaryType: z.string(),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
})

/** ERC-2612 Permit schema — requires `primaryType: 'Permit'` and strongly-typed message fields. */
export const PermitSchema = z.object({
  ...TypedMessageSchema.shape,
  domain: z.object({
    ...TypedMessageSchema.shape.domain.shape,
    chainId: numberish,
    verifyingContract: address,
  }),
  message: z.object({
    deadline: z.string(),
    nonce: z.string(),
    owner: address,
    spender: address,
    value: z.string(),
  }),
  primaryType: z.literal('Permit'),
})

/** Uniswap Permit2 (PermitSingle) schema. */
export const Permit2Schema = z.object({
  ...TypedMessageSchema.shape,
  domain: z.object({
    ...TypedMessageSchema.shape.domain.shape,
    name: z.literal('Permit2'),
  }),
  message: z.object({
    details: z.object({
      amount: numberish,
      expiration: numberish,
      nonce: numberish,
      token: address,
    }),
    sigDeadline: numberish,
    spender: address,
  }),
  primaryType: z.literal('PermitSingle'),
})

/** Check if data is a valid ERC-2612 Permit. */
export function isPermit(data: unknown): boolean {
  return PermitSchema.safeParse(data).success
}

/** Check if data is a Uniswap Permit2 (PermitSingle). */
export function isPermit2(data: unknown): boolean {
  return Permit2Schema.safeParse(data).success
}

/** Check if data is a valid EIP-712 typed message. */
export function isTypedMessage(data: unknown): boolean {
  return TypedMessageSchema.safeParse(data).success
}
