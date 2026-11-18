/**
 * A payment that `accounts.pay` requests: its shape for a plugin that sends it, and its memo.
 * @module
 */
import { Hex } from 'ox'
import { RequestError } from '../Accounts.js'
import type * as Session from '../Session.js'

/** A memo that is hex: `0x` and an even count of hex digits. */
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/

/**
 * An amount that is a decimal, as the limits of an access key take it, such as `50`, `.5`, or `5.`.
 * The fraction follows only a point, so no two quantifiers match the same digits.
 */
const amountPattern = /^(\d+(\.\d*)?|\.\d+)$/

/** The decimals of a TIP-20 token, which an amount holds at most, past its trailing zeros. */
const decimals = 6

/** A payment of `accounts.pay`, with its account and its chain resolved, and its memo as hex. */
export type Payment = {
  /** The user's Tempo Account that pays, on the payment's chain. */
  account: `0x${string}`
  /** The amount that the recipient receives, as a decimal string in whole units, such as `50`. */
  amount: string
  /** The payment's chain. */
  chainId: number
  /** The transfer's memo, as hex of 1 to 32 bytes. Absent, the transfer holds no memo. */
  memo?: `0x${string}` | undefined
  /** Rejects the payment with the signal's reason. */
  signal?: AbortSignal | undefined
  /**
   * A fixed session whose access key sends the payment, such as the session of a backend's request.
   * Absent, the instance's session sends it.
   */
  session?:
    | Pick<Session.Session, 'accessKey' | 'accessKeys' | 'account'>
    | undefined
  /** The recipient's address. */
  to: `0x${string}`
  /** The token that the recipient receives: its symbol in any case, such as `ousd`, or its address. */
  token: string
}

/**
 * Returns `value`, the amount of a payment, if it is a decimal string above 0 in whole units, with
 * at most 6 decimal places past its trailing zeros, such as `50`, `0.5`, or `1.50000000`.
 *
 * @example
 * ```ts
 * const amount = Payment.amount('0.5') // '0.5'
 * ```
 *
 * @throws {RequestError} `invalid_request` with the reason `invalid_field` and the field `amount`,
 * for any other value, such as `-5`, `0`, `1e3`, or a number.
 */
export function amount(value: string): string {
  // A caller without types can pass a number or a bigint, which an access key reads as base units.
  const fraction = typeof value === 'string' ? (value.split('.')[1] ?? '') : ''
  if (
    typeof value === 'string' &&
    amountPattern.test(value) &&
    /[1-9]/.test(value) &&
    !/[1-9]/.test(fraction.slice(decimals))
  )
    return value

  throw new RequestError({
    code: 'invalid_request',
    field: 'amount',
    message: `Invalid \`amount\`: "${String(value)}" is not a decimal above 0 with at most 6 decimal places. Pass such a decimal string, such as \`'50'\`.`,
    reason: 'invalid_field',
    status: 0,
  })
}

/**
 * Returns `value`, the memo of a payment, as the hex that the chain records: text as its UTF-8
 * bytes, and hex as its own bytes. Hex is `0x` and an even count of hex digits. Any other value is
 * text, such as `0xINV-1042`.
 *
 * @example
 * ```ts
 * const hex = Payment.memo('inv-1042') // '0x696e762d31303432'
 * ```
 *
 * @throws {RequestError} `invalid_request` with the field `memo`, for a memo that holds no byte, or
 * more than 32 bytes.
 */
export function memo(value: string): `0x${string}` {
  const hex = hexPattern.test(value)
    ? (value as `0x${string}`)
    : Hex.fromString(value)
  if (Hex.size(hex) >= 1 && Hex.size(hex) <= 32) return hex

  throw new RequestError({
    code: 'invalid_request',
    field: 'memo',
    message:
      'Invalid `memo`: it holds no byte, or more than 32 bytes. Pass text or hex of 1 to 32 bytes.',
    status: 0,
  })
}
