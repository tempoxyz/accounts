/**
 * Tests the decisions of who sends a payment: the session's access key, or Tempo ID's payment page.
 * @module
 */
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Token from './Token.js'

const owner = Secp256k1.randomPrivateKey()

const account = Address.fromPublicKey(
  Secp256k1.getPublicKey({ privateKey: owner }),
)

const pathUsd = '0x20c0000000000000000000000000000000000000'

const payment = {
  account,
  amount: '5',
  chainId: 4217,
  token: pathUsd,
} as const

/**
 * Returns an access key of `account` on `options.chainId`, which expires after `options.expiry`
 * seconds, with `options.limits`. `options.material` adds its private key.
 */
function key(options: {
  chainId: number
  /** Seconds until the access key expires. Defaults to an hour. */
  expiry?: number | undefined
  limits?: readonly { limit: bigint; token: `0x${string}` }[] | undefined
  material: boolean
}) {
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: BigInt(options.chainId),
    expiry: Math.floor(Date.now() / 1000) + (options.expiry ?? 3600),
    ...(options.limits ? { limits: options.limits } : {}),
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: owner,
  })
  return {
    account,
    chainId: options.chainId,
    keyAuthorization: KeyAuthorization.toRpc(
      KeyAuthorization.from(authorization, { signature }),
    ),
    ...(options.material ? { privateKey } : {}),
  }
}

describe('ownerSends', () => {
  test('returns false without a session', () => {
    expect(Token.ownerSends(undefined, { chainId: 4217 })).toBe(false)
  })

  test('returns false for an access key on the chain that signs here', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(Token.ownerSends(session, { chainId: 4217 })).toBe(false)
  })

  test('returns true for an access key on the chain that signs elsewhere', () => {
    const session = { accessKey: key({ chainId: 4217, material: false }) }

    expect(Token.ownerSends(session, { chainId: 4217 })).toBe(true)
  })

  test('returns false for an expired access key on the chain that signs elsewhere, which a sign-in renews', () => {
    const session = {
      accessKey: key({ chainId: 4217, expiry: -1, material: false }),
    }

    expect(Token.ownerSends(session, { chainId: 4217 })).toBe(false)
  })

  test('returns true for a session without an access key', () => {
    expect(Token.ownerSends({}, { chainId: 4217 })).toBe(true)
  })

  test('returns false for a guest session, whose key pair signs the transfer as the guest account', () => {
    expect(Token.ownerSends({ kind: 'guest' }, { chainId: 4217 })).toBe(false)
  })

  test('returns false for a session whose access keys are on other chains, which a sign-in adds one to', () => {
    const session = { accessKeys: [key({ chainId: 42431, material: true })] }

    expect(Token.ownerSends(session, { chainId: 4217 })).toBe(false)
  })
})

describe('payable', () => {
  test('returns the transfer in base units for an access key without limits', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(Token.payable(session, payment)).toMatchInlineSnapshot(`
      {
        "amount": 5000000n,
        "token": "0x20C0000000000000000000000000000000000000",
      }
    `)
  })

  test("resolves a token's symbol in lowercase, and a decimal amount", () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(
      Token.payable(session, { ...payment, amount: '0.25', token: 'pathusd' }),
    ).toMatchInlineSnapshot(`
      {
        "amount": 250000n,
        "token": "0x20C0000000000000000000000000000000000000",
      }
    `)
  })

  test("returns the transfer for an amount equal to the whole limit of its token, whose fee the relay's fee payer pays", () => {
    const limits = [{ limit: 5_000_000n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, relayed: true })?.amount,
    ).toMatchInlineSnapshot(`5000000n`)
  })

  test('returns undefined for an amount within the fee allowance of the whole limit of a USD token, since the fee spends the limit too', () => {
    const limits = [{ limit: 5_000_000n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, amount: '4.95' }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test('returns the transfer for an amount equal to the whole limit of MACH, which pays no fee', () => {
    const mach = '0x20c000000000000000000000f37de3740adec032'
    const limits = [{ limit: 2_000_000n, token: mach }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, amount: '2', token: 'mach' })
        ?.amount,
    ).toMatchInlineSnapshot(`2000000n`)
  })

  test('returns the transfer for an amount of a USD token that leaves the fee allowance of its limit', () => {
    const limits = [{ limit: 5_000_000n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, amount: '4.9' })?.amount,
    ).toMatchInlineSnapshot(`4900000n`)
  })

  test('returns the transfer for an amount equal to the whole limit of its token, whose fee another `feeToken` pays', () => {
    const limits = [{ limit: 5_000_000n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, {
        ...payment,
        feeToken: '0x20c0000000000000000000006a37DA5C996874BE',
      })?.amount,
    ).toMatchInlineSnapshot(`5000000n`)
  })

  test('returns undefined for an amount within the fee allowance of the whole limit of its token, which is the `feeToken`', () => {
    const limits = [{ limit: 5_000_000n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, feeToken: pathUsd }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test('returns the transfer for an amount equal to the whole limit of a token of another currency, which pays no fee', () => {
    const eurc = '0x20c0000000000000000000001621e21f71cf12fb'
    const limits = [{ limit: 5_000_000n, token: eurc }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, token: eurc })?.amount,
    ).toMatchInlineSnapshot(`5000000n`)
  })

  test('returns undefined for an amount above the whole limit of its token', () => {
    const limits = [{ limit: 4_999_999n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(Token.payable(session, payment)).toBe(undefined)
  })

  test('returns the transfer for an amount above the whole limit of its token with `raises`, whose retry raises the limit', () => {
    const limits = [{ limit: 4_999_999n, token: pathUsd }] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(
      Token.payable(session, { ...payment, raises: true })?.amount,
    ).toMatchInlineSnapshot(`5000000n`)
  })

  test('returns undefined for a token that the limits do not name, also with `raises`', () => {
    const limits = [
      {
        limit: 5_000_000n,
        token: '0x20c0000000000000000000000000000000000001',
      },
    ] as const
    const session = {
      accessKey: key({ chainId: 4217, limits, material: true }),
    }

    expect(Token.payable(session, payment)).toBe(undefined)
    expect(Token.payable(session, { ...payment, raises: true })).toBe(undefined)
  })

  test('returns undefined without a session', () => {
    expect(Token.payable(undefined, payment)).toBe(undefined)
  })

  test('returns undefined for an access key that signs elsewhere', () => {
    const session = { accessKey: key({ chainId: 4217, material: false }) }

    expect(Token.payable(session, payment)).toBe(undefined)
  })

  test('returns undefined for an expired access key', () => {
    const session = {
      accessKey: key({ chainId: 4217, expiry: -1, material: true }),
    }

    expect(Token.payable(session, payment)).toBe(undefined)
  })

  test('returns undefined for an access key on another chain', () => {
    const session = { accessKey: key({ chainId: 42431, material: true }) }

    expect(Token.payable(session, payment)).toBe(undefined)
  })

  test('returns undefined for a payment of another account', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(
      Token.payable(session, {
        ...payment,
        account: '0x7a3f0000000000000000000000000000000000aa',
      }),
    ).toBe(undefined)
  })

  test('returns undefined for an amount of 0', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(Token.payable(session, { ...payment, amount: '0' })).toBe(undefined)
  })

  test('returns undefined for an amount that is no decimal', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(Token.payable(session, { ...payment, amount: 'five' })).toBe(
      undefined,
    )
  })

  test('returns undefined for a symbol that the chain does not list', () => {
    const session = { accessKey: key({ chainId: 4217, material: true }) }

    expect(Token.payable(session, { ...payment, token: 'nope' })).toBe(
      undefined,
    )
  })
})

describe('memo', () => {
  const padded =
    '0x0000000000000000000000000000000000000000000000000000000000000abc'

  test('returns the memo of an even count of hex digits as it is', () => {
    expect(
      Token.memo({ memo: '0x696e762d31303432', padded: undefined }),
    ).toMatchInlineSnapshot(`"0x696e762d31303432"`)
  })

  test("returns Viem's padded memo for an odd count of hex digits", () => {
    expect(Token.memo({ memo: '0xabc', padded })).toMatchInlineSnapshot(
      `"0x0000000000000000000000000000000000000000000000000000000000000abc"`,
    )
  })

  test("returns Viem's padded memo for an empty memo", () => {
    expect(
      Token.memo({
        memo: '0x',
        padded:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
      }),
    ).toMatchInlineSnapshot(
      `"0x0000000000000000000000000000000000000000000000000000000000000000"`,
    )
  })

  test('returns a text memo that starts with 0x as it is', () => {
    expect(
      Token.memo({
        memo: '0xINV-1042',
        padded:
          '0x00000000000000000000000000000000000000000000000000000000INV-1042',
      }),
    ).toMatchInlineSnapshot(`"0xINV-1042"`)
  })

  test('returns undefined without a memo', () => {
    expect(Token.memo({ memo: undefined, padded: undefined })).toBe(undefined)
  })
})
