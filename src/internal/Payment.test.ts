/** The tests of `Payment.memo`, the memo of a payment as the hex that the chain records. @module */
import { describe, expect, test } from 'vite-plus/test'
import * as Payment from './Payment.js'

describe('memo', () => {
  test('returns hex of an even count of digits as its own bytes', () => {
    expect(Payment.memo('0x696e762d31303432')).toMatchInlineSnapshot(
      `"0x696e762d31303432"`,
    )
  })

  test('returns text as its UTF-8 bytes', () => {
    expect(Payment.memo('inv-1042')).toMatchInlineSnapshot(
      `"0x696e762d31303432"`,
    )
  })

  test('returns text that starts with 0x as its UTF-8 bytes', () => {
    expect(Payment.memo('0xINV-1042')).toMatchInlineSnapshot(
      `"0x3078494e562d31303432"`,
    )
  })

  test('returns an odd count of hex digits as the UTF-8 bytes of its text', () => {
    expect(Payment.memo('0xabc')).toMatchInlineSnapshot(`"0x3078616263"`)
  })
})
