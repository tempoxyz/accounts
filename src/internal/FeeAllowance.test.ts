/**
 * Finds the limits of a signed key authorization that pay only network fees, without a server.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as FeeAllowance from './FeeAllowance.js'

const mach = '0x20c000000000000000000000f37de3740adec032'
const pathUsd = '0x20c0000000000000000000000000000000000000'
const reserve = '0x4d50500000000000000000000000000000000000'
const usdc = '0x20c000000000000000000000b9537d11c60e8b50'

/** The signed limits of an access key that pays merchants with MACH, with its fee allowance. */
const limits = [
  { limit: '0x1e8480', token: mach },
  { limit: '0x186a0', token: pathUsd },
  { limit: '0x186a0', token: usdc },
] as const

describe('of', () => {
  test('returns the limits whose token no scope calls', () => {
    const fees = FeeAllowance.of({
      allowedCalls: [
        { selectorRules: [{ selector: '0x95777d59' }], target: mach },
      ],
      limits,
    })

    expect(fees).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x186a0",
          "token": "0x20c0000000000000000000000000000000000000",
        },
        {
          "limit": "0x186a0",
          "token": "0x20c000000000000000000000b9537d11c60e8b50",
        },
      ]
    `)
  })

  test('leaves out a limit whose token a scope calls, in another letter case', () => {
    const fees = FeeAllowance.of({
      allowedCalls: [
        { target: mach },
        { target: '0x20C000000000000000000000B9537D11C60E8B50' },
      ],
      limits,
    })

    expect(fees).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x186a0",
          "token": "0x20c0000000000000000000000000000000000000",
        },
      ]
    `)
  })

  const none = {
    'an access key that makes any call': { limits },
    'an access key that makes no call': { allowedCalls: [], limits },
    'an access key without limits': { allowedCalls: [{ target: mach }] },
    'scopes that call the channel reserve': {
      allowedCalls: [{ target: mach }, { target: reserve }],
      limits,
    },
    'scopes that call the fee manager': {
      allowedCalls: [
        { target: mach },
        { target: '0xfeec000000000000000000000000000000000000' },
      ],
      limits,
    },
    'scopes that call the stablecoin DEX': {
      allowedCalls: [
        { target: mach },
        { target: '0xdec0000000000000000000000000000000000000' },
      ],
      limits,
    },
  } as const

  for (const [name, authorization] of Object.entries(none))
    test(`returns no limit for ${name}`, () => {
      expect(FeeAllowance.of(authorization)).toMatchInlineSnapshot(`[]`)
    })
})
