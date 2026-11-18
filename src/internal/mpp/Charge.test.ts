/**
 * Tests the `push` payment of a charge: which challenge the payment page pays, and its credential.
 * @module
 */
import { Challenge, Credential } from 'mppx'
import { Attribution } from 'mppx/tempo'
import { TempoAddress } from 'ox/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Charge from './Charge.js'

const pathUsd = '0x20c0000000000000000000000000000000000000'

const recipient = '0x70c5d1c2a2d8a1d1cbbd8c4f3f1e2b0a9d8c7b6a'

/** Returns a challenge of the endpoint `mpp.test`, with `request` over a charge of 0.5 of a token. */
function challenge(
  request: Record<string, unknown> = {},
  intent = 'charge',
): Challenge.Challenge {
  return Challenge.from({
    id: 'kM9xPqWvT2nJrHsY4aDfEb',
    intent,
    method: 'tempo',
    realm: 'mpp.test',
    request: { amount: '500000', currency: pathUsd, recipient, ...request },
  })
}

describe('transfer', () => {
  test('returns the transfer of a charge, with the memo of its challenge', () => {
    expect(Charge.transfer(challenge(), { chainId: 4217 }))
      .toMatchInlineSnapshot(`
        {
          "amount": 500000n,
          "memo": "0xef1ed71201cfdea66657edee98cf76000000000000000000001128fb265e760d",
          "to": "0x70c5d1c2a2d8a1d1cbbd8c4f3f1e2b0a9d8c7b6a",
          "token": "0x20c0000000000000000000000000000000000000",
        }
      `)
  })

  test("binds the memo to the challenge and the endpoint, as the endpoint's checks read it", () => {
    const offer = challenge()

    const transfer = Charge.transfer(offer, { chainId: 4217 })

    expect([
      Attribution.verifyChallengeBinding(transfer!.memo, offer.id),
      Attribution.verifyServer(transfer!.memo, offer.realm),
      Attribution.verifyServer(transfer!.memo, 'other.test'),
    ]).toMatchInlineSnapshot(`
      [
        true,
        true,
        false,
      ]
    `)
  })

  test("names the app in the memo with 'clientId'", () => {
    const anonymous = Charge.transfer(challenge(), { chainId: 4217 })

    const named = Charge.transfer(challenge(), {
      chainId: 4217,
      clientId: 'app',
    })

    expect(named?.memo === anonymous?.memo).toBe(false)
  })

  test('resolves a currency and a recipient in the Tempo format', () => {
    const transfer = Charge.transfer(
      challenge({
        currency: TempoAddress.format(pathUsd),
        recipient: TempoAddress.format(recipient),
      }),
      { chainId: 4217 },
    )

    expect([transfer?.to, transfer?.token]).toMatchInlineSnapshot(`
      [
        "0x70c5D1C2a2D8A1D1cbBd8C4F3F1E2B0A9D8C7B6a",
        "0x20C0000000000000000000000000000000000000",
      ]
    `)
  })

  test("returns the transfer of a charge on the payer's chain, and of one that permits `push`", () => {
    const transfer = Charge.transfer(
      challenge({
        methodDetails: { chainId: 4217, supportedModes: ['pull', 'push'] },
      }),
      { chainId: 4217, mode: 'push' },
    )

    expect(transfer?.amount).toBe(500_000n)
  })

  const refused = {
    'a charge of zero': [challenge({ amount: '0' }), {}],
    'a charge on another chain': [
      challenge({ methodDetails: { chainId: 42431 } }),
      {},
    ],
    'a charge that permits only `pull`': [
      challenge({ methodDetails: { supportedModes: ['pull'] } }),
      {},
    ],
    'a charge whose amount is no integer': [challenge({ amount: '0.5' }), {}],
    'a charge whose currency is no address': [
      challenge({ currency: 'usd' }),
      {},
    ],
    'a charge whose recipient is no address': [
      challenge({ recipient: 'merchant' }),
      {},
    ],
    'a charge with splits': [
      challenge({
        methodDetails: { splits: [{ amount: '100000', recipient }] },
      }),
      {},
    ],
    'a charge without an amount': [challenge({ amount: undefined }), {}],
    'a payer of `pull` mode': [challenge(), { mode: 'pull' }],
    'a subscription': [challenge({}, 'subscription'), {}],
  } as const

  for (const [name, [offer, options]] of Object.entries(refused))
    test(`returns undefined for ${name}`, () => {
      expect(Charge.transfer(offer, { chainId: 4217, ...options })).toBe(
        undefined,
      )
    })
})

describe('credential', () => {
  test('returns the credential of the transaction hash, from the Tempo Account on the chain', () => {
    const serialized = Charge.credential(challenge(), {
      account: '0x1f90d4c1b2a3948576a1b2c3d4e5f60718293a4b',
      chainId: 4217,
      hash: '0x8f2a1c0d9e3b4a5f6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3',
    })

    const { payload, source } = Credential.deserialize(serialized)
    expect({ payload, source }).toMatchInlineSnapshot(`
      {
        "payload": {
          "hash": "0x8f2a1c0d9e3b4a5f6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3",
          "type": "hash",
        },
        "source": "did:pkh:eip155:4217:0x1f90d4c1b2a3948576a1b2c3d4e5f60718293a4b",
      }
    `)
  })
})
