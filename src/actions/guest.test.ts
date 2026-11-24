/**
 * Tests `Actions.guest.check`, which accepts only the requested transfer, with the sponsor's
 * marker, from a transaction that Tempo ID's page posts for the guest account to sign.
 * @module
 */
import { TxEnvelopeTempo } from 'ox/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { describe, expect, test } from 'vite-plus/test'
import * as Guest from './guest.js'

/** Tempo mainnet's chain ID. */
const chainId = 4217

/** OUSD, at its mainnet address. */
const ousd = '0x20c0000000000000000000006a37da5c996874be'

/** The recipient of the requested payment. */
const to = '0x1f9090aae28b8a3dceadf281b0f12828e676c326'

/** The requested payment: 12.5 OUSD to `to`. */
const payment = { amount: '12.5', chainId, to, token: 'ousd' } as const

/** The requested transfer's call. */
const transfer = TokenActions.transfer.call({
  amount: 12_500_000n,
  to,
  token: ousd,
})

/** Returns a serialized transaction with the transfer and the sponsor's marker, with `fields`. */
function transaction(fields: Partial<TxEnvelopeTempo.TxEnvelopeTempo> = {}) {
  return TxEnvelopeTempo.serialize(
    TxEnvelopeTempo.from({
      calls: [transfer],
      chainId,
      feePayerSignature: null,
      gas: 100_000n,
      maxFeePerGas: 1n,
      nonce: 0n,
      ...fields,
    }),
  )
}

describe('Actions.guest.check', () => {
  test('accepts the requested transfer with the sponsor marker', () => {
    const envelope = Guest.check(transaction(), payment)

    expect(envelope.calls).toHaveLength(1)
  })

  const refused = [
    ['a value that is no Tempo transaction', '0x02f8'],
    ['a transaction on another chain', transaction({ chainId: 4218 })],
    [
      'another amount',
      transaction({
        calls: [
          TokenActions.transfer.call({ amount: 12_500_001n, to, token: ousd }),
        ],
      }),
    ],
    [
      'another recipient',
      transaction({
        calls: [
          TokenActions.transfer.call({
            amount: 12_500_000n,
            to: '0x000000000000000000000000000000000000dEaD',
            token: ousd,
          }),
        ],
      }),
    ],
    ['a second call', transaction({ calls: [transfer, transfer] })],
    ['no sponsor marker', transaction({ feePayerSignature: undefined })],
  ] as const

  for (const [name, value] of refused)
    test(`refuses ${name}`, () => {
      expect(() => Guest.check(value, payment)).toThrow(
        'Invalid prepared transaction',
      )
    })
})
