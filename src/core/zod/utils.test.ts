import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as u from './utils.js'

describe('address', () => {
  test('default: accepts valid address', () => {
    const schema = u.address()
    expect(z.parse(schema, '0x0000000000000000000000000000000000000001')).toMatchInlineSnapshot(
      `"0x0000000000000000000000000000000000000001"`,
    )
  })

  test('error: rejects non-0x string', () => {
    const schema = u.address()
    expect(() => z.parse(schema, 'not-an-address')).toThrow()
  })

  test('error: rejects non-string', () => {
    const schema = u.address()
    expect(() => z.parse(schema, 123)).toThrow()
  })
})

describe('hex', () => {
  test('default: accepts valid hex', () => {
    const schema = u.hex()
    expect(z.parse(schema, '0xdeadbeef')).toMatchInlineSnapshot(`"0xdeadbeef"`)
  })

  test('error: rejects non-0x string', () => {
    const schema = u.hex()
    expect(() => z.parse(schema, 'deadbeef')).toThrow()
  })
})

describe('number', () => {
  test('default: decodes hex to number', () => {
    const schema = u.number()
    expect(z.parse(schema, '0xa')).toMatchInlineSnapshot(`10`)
  })

  test('default: decodes 0x0', () => {
    const schema = u.number()
    expect(z.parse(schema, '0x0')).toMatchInlineSnapshot(`0`)
  })

  test('error: rejects non-hex', () => {
    const schema = u.number()
    expect(() => z.parse(schema, 'not-hex')).toThrow()
  })
})

describe('bigint', () => {
  test('default: decodes hex to bigint', () => {
    const schema = u.bigint()
    expect(z.parse(schema, '0xff')).toMatchInlineSnapshot(`255n`)
  })

  test('default: decodes large value', () => {
    const schema = u.bigint()
    expect(z.parse(schema, '0xde0b6b3a7640000')).toMatchInlineSnapshot(`1000000000000000000n`)
  })

  test('error: rejects non-hex', () => {
    const schema = u.bigint()
    expect(() => z.parse(schema, 'not-hex')).toThrow()
  })
})
