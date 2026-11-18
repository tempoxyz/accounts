/**
 * Resolves an access key's permissions without a server: the refusal of a decimal `limit` that
 * holds no plain decimal number, such as one in exponent notation, and the fee allowance of limits
 * that name no stablecoin.
 * @module
 */
import { Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Permissions from './Permissions.js'

const pathUsd = '0x20c0000000000000000000000000000000000000'
const reserve = '0x4d50500000000000000000000000000000000000'
const swapper = '0xF72E5107c32C655ffA7539a3C8e97B7C3cE16A3F'

/** The scopes of an access key that pays merchants with MACH. */
const scopes = [
  {
    address: '0x20c000000000000000000000f37de3740adec032',
    selector: '0x95777d59',
  },
  { address: swapper, selector: '0x34189fed' },
] as const

/** An access key that pays merchants with MACH: its limit names no stablecoin. */
const machine = Permissions.from({
  chainId: 4217,
  expiry: 1_800_000_000,
  limits: [{ limit: '2', token: 'mach' }],
  scopes,
})

describe('Permissions.resolve', () => {
  test('throws InvalidLimitError for a decimal limit in exponent notation', () => {
    // The type of a limit admits exponent notation, as `String(0.0000001)` writes it.
    const limits = ['1e-7', '1e+21'] as const

    const errors = limits.map((limit) => {
      try {
        return Permissions.resolve(
          { expiry: '1d', limits: [{ limit, token: 'ousd' }] },
          { chainId: 42431 },
        )
      } catch (error) {
        return error
      }
    })

    expect(errors).toMatchInlineSnapshot(`
      [
        [Permissions.InvalidLimitError: Invalid limit "1e-7": a decimal limit holds only digits and one ".", such as "10" or "0.5". Pass the limit without an exponent, or in base units as a bigint.],
        [Permissions.InvalidLimitError: Invalid limit "1e+21": a decimal limit holds only digits and one ".", such as "10" or "0.5". Pass the limit without an exponent, or in base units as a bigint.],
      ]
    `)
  })

  test('returns a fee allowance of each stablecoin, apart from the limits, for limits that name none', () => {
    const resolved = Permissions.resolve(machine, { chainId: 4217 })

    expect({ fees: resolved.fees, limits: resolved.limits })
      .toMatchInlineSnapshot(`
        {
          "fees": [
            {
              "limit": 100000n,
              "token": "0x20c0000000000000000000006a37DA5C996874BE",
            },
            {
              "limit": 100000n,
              "token": "0x20C0000000000000000000000000000000000000",
            },
            {
              "limit": 100000n,
              "token": "0x20C000000000000000000000b9537d11c60E8b50",
            },
            {
              "limit": 100000n,
              "token": "0x20C00000000000000000000014f22CA97301EB73",
            },
          ],
          "limits": [
            {
              "limit": 2000000n,
              "token": "0x20c000000000000000000000f37de3740ADec032",
            },
          ],
        }
      `)
  })

  test("returns the fee allowance of the chain's stablecoins on the testnet", () => {
    const resolved = Permissions.resolve(
      { ...machine, chainId: 42431 },
      { chainId: 4217 },
    )

    expect(resolved.fees?.map((entry) => entry.token)).toMatchInlineSnapshot(`
      [
        "0x20C0000000000000000000000000000000000001",
        "0x20C0000000000000000000000000000000000002",
        "0x20c0000000000000000000006a37DA5C996874BE",
        "0x20C0000000000000000000000000000000000000",
        "0x20C0000000000000000000000000000000000003",
        "0x20C0000000000000000000009e8d7eB59B783726",
      ]
    `)
  })

  test('leaves a stablecoin that a scope calls out of the fee allowance', () => {
    const resolved = Permissions.resolve(
      {
        ...machine,
        scopes: [...scopes, { address: pathUsd, selector: '0x95777d59' }],
      },
      { chainId: 4217 },
    )

    expect(resolved.fees?.map((entry) => entry.token)).toMatchInlineSnapshot(`
      [
        "0x20c0000000000000000000006a37DA5C996874BE",
        "0x20C000000000000000000000b9537d11c60E8b50",
        "0x20C00000000000000000000014f22CA97301EB73",
      ]
    `)
  })

  const none = {
    'an access key that another party holds': {
      ...machine,
      address: '0x00000000000000000000000000000000000000cc',
    },
    'an access key that makes any call': { ...machine, scopes: 'any' },
    'an access key without limits': { ...machine, limits: undefined },
    'limits that name a stablecoin': {
      ...machine,
      limits: [
        { limit: '2', token: 'mach' },
        { limit: '1', token: 'pathusd' },
      ],
    },
    'scopes that call the channel reserve': {
      ...machine,
      scopes: [{ address: reserve, selector: '0xedc53b00' }],
    },
    'scopes that call the fee manager': {
      ...machine,
      scopes: [{ address: '0xfeec000000000000000000000000000000000000' }],
    },
    'scopes that call the stablecoin DEX': {
      ...machine,
      scopes: [{ address: '0xdec0000000000000000000000000000000000000' }],
    },
    'the scopes that the limits fill': { ...machine, scopes: undefined },
  } as const satisfies Record<
    string,
    Permissions.Permissions | Permissions.WithAddress
  >

  for (const [name, permissions] of Object.entries(none))
    test(`returns no fee allowance for ${name}`, () => {
      const resolved = Permissions.resolve(permissions, { chainId: 4217 })

      expect(resolved.fees).toMatchInlineSnapshot(`undefined`)
    })
})

describe('Permissions.fromAccessKey', () => {
  test('returns the chain, the limits in base units, and the scopes of a signed authorization', () => {
    const scoped = signed({
      limits: [
        { limit: 2_500_000n, period: 86_400, token: pathUsd },
        { limit: 7n, token: reserve },
      ],
      scopes: [{ address: pathUsd, selector: '0xa9059cbb' }],
    })
    const unscoped = signed({ limits: [{ limit: 1n, token: pathUsd }] })

    const results = [scoped, unscoped].map(Permissions.fromAccessKey)

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "chainId": 42431,
          "limits": [
            {
              "limit": 2500000n,
              "period": 86400,
              "token": "0x20c0000000000000000000000000000000000000",
            },
            {
              "limit": 7n,
              "period": undefined,
              "token": "0x4d50500000000000000000000000000000000000",
            },
          ],
          "scopes": [
            {
              "address": "0x20c0000000000000000000000000000000000000",
              "selector": "0xa9059cbb",
            },
          ],
        },
        {
          "chainId": 42431,
          "limits": [
            {
              "limit": 1n,
              "period": undefined,
              "token": "0x20c0000000000000000000000000000000000000",
            },
          ],
          "scopes": "any",
        },
      ]
    `)
  })
})

/** Returns an access key whose authorization a random owner signs on Tempo testnet. */
function signed(
  options: Pick<KeyAuthorization.KeyAuthorization, 'limits' | 'scopes'>,
) {
  const unsigned = KeyAuthorization.from({
    ...options,
    address: swapper,
    chainId: 42431n,
    expiry: 1_893_456_000,
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(unsigned),
    privateKey: Secp256k1.randomPrivateKey(),
  })
  return {
    keyAuthorization: KeyAuthorization.toRpc(
      KeyAuthorization.from(unsigned, { signature }),
    ),
  }
}
