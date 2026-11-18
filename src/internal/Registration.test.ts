/**
 * Tests `Registration.challenge`: the proof challenge that the page derives from the
 * `keyAuthorization` of registration options, for the configurable account that a new passkey owns.
 * @module
 */
import { PublicKey } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Registration from './Registration.js'

// A key authorization as Tempo ID's options carry it: unsigned, without an account, with a witness.
const keyAuthorization =
  '0xf843f841827a56019400000000000000000000000000000000000000a18470dbd8808080a02222222222222222222222222222222222222222222222222222222222222222'
// The public key of a new passkey, as the creation ceremony returns it.
const publicKey = PublicKey.fromHex(
  '0x040217e617f0b6443928278f96999e69a23a4f2c152bdf6d6cdf66e5b80282d4ed194a7debcb97712d2dda3ca85aa8765a56f45fc758599652f2897c65306e5794',
)

describe('challenge', () => {
  test('returns the digest that Tempo ID verifies the proof against', () => {
    // Tempo ID derived this digest from the same key authorization and public key.
    expect(
      Registration.challenge(keyAuthorization, { publicKey }),
    ).toMatchInlineSnapshot(
      `"0xd976d0e59306f918a8fd05fe4fc0a66095dcfce1db959f6116592bcd392aa89b"`,
    )
  })

  test('binds the account of the passkey, so another passkey derives another challenge', () => {
    const other = PublicKey.fromHex(
      '0x046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
    )

    expect(
      Registration.challenge(keyAuthorization, { publicKey: other }),
    ).not.toBe(Registration.challenge(keyAuthorization, { publicKey }))
  })
})
