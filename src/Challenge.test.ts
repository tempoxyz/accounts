/**
 * Tests what `Challenge.verify` decides with no node: a malformed proof, the witness, the chain, the
 * app's access token, and the owner's signature of a challenge's proof. A root key's signature that
 * verifies needs the chain, which holds the account's configuration, so `test/e2e/challenges.e2e.ts`
 * tests it on a node.
 * @module
 */
import { Address, P256, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, hashMessage, http } from 'viem'
import { tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vite-plus/test'
import * as Challenge from './Challenge.js'

const challenge = 'Sign in to app.example\nNonce: 7f3a9c2e'
// No node listens at the URL. A proof that fails before its signature verifies sends no request, and
// the read of a root key's account fails at once, with no retry.
const client = createClient({
  chain: tempoModerato,
  transport: http('http://127.0.0.1:9', { retryCount: 0 }),
})
const token = '0x20c0000000000000000000000000000000000001'

/**
 * Returns a key authorization that `owner` signs, with `witness`, on `chainId`. It holds one limit
 * and one scope with a recipient, so a proof that verifies holds each address that the proof can.
 */
function signed(options: {
  chainId?: number | undefined
  owner?: `0x${string}` | undefined
  witness: `0x${string}`
}) {
  const owner = options.owner ?? Secp256k1.randomPrivateKey()
  const accessKey = Address.fromPublicKey(
    Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
  )
  const unsigned = KeyAuthorization.from({
    address: accessKey,
    chainId: BigInt(options.chainId ?? tempoModerato.id),
    expiry: 1_893_456_000,
    limits: [{ limit: 1_000_000n, token }],
    scopes: [
      {
        address: token,
        recipients: [accessKey],
        selector: 'transfer(address,uint256)',
      },
    ],
    type: 'secp256k1',
    witness: options.witness,
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(unsigned),
    privateKey: owner,
  })
  return {
    accessKey,
    account: Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: owner }),
    ),
    rpc: KeyAuthorization.toRpc(KeyAuthorization.from(unsigned, { signature })),
  }
}

/**
 * Returns a key authorization that a P256 owner signs, with `witness`, or, with `forged`, one whose
 * envelope carries the owner's public key over a signature of another payload.
 */
function signedP256(options: {
  forged?: boolean | undefined
  witness: `0x${string}`
}) {
  const owner = P256.randomPrivateKey()
  const publicKey = P256.getPublicKey({ privateKey: owner })
  const accessKey = Address.fromPublicKey(
    Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
  )
  const unsigned = KeyAuthorization.from({
    address: accessKey,
    chainId: BigInt(tempoModerato.id),
    expiry: 1_893_456_000,
    type: 'secp256k1',
    witness: options.witness,
  })
  const payload = options.forged
    ? hashMessage('another payload')
    : KeyAuthorization.getSignPayload(unsigned)
  const signature = {
    prehash: false,
    publicKey,
    signature: P256.sign({ payload, privateKey: owner }),
    type: 'p256',
  } as const
  return {
    accessKey,
    account: Address.fromPublicKey(publicKey),
    rpc: KeyAuthorization.toRpc(KeyAuthorization.from(unsigned, { signature })),
  }
}

describe('verify', () => {
  const owners = [
    { name: 'secp256k1', sign: signed },
    { name: 'P256', sign: signedP256 },
  ] as const

  for (const row of owners)
    test(`rejects with the failure of the read, not a refusal or the account, for a ${row.name} root key's signature and no node`, async () => {
      const { accessKey, account, rpc } = row.sign({
        witness: hashMessage(challenge),
      })

      const result = await Challenge.verify(client, {
        accessToken: {
          accessKeys: [
            { account, address: accessKey, chainId: tempoModerato.id },
          ],
        },
        challenge,
        keyAuthorization: rpc,
      }).then(
        () => 'returned',
        (error: Error) => error.name,
      )

      expect(result).toBe('ContractFunctionExecutionError')
    })

  test('refuses a malformed key authorization', async () => {
    const { accessKey, account, rpc } = signed({
      witness: hashMessage(challenge),
    })

    const result = Challenge.verify(client, {
      accessToken: {
        accessKeys: [
          { account, address: accessKey, chainId: tempoModerato.id },
        ],
      },
      challenge,
      keyAuthorization: { ...rpc, signature: { type: 'unknown' } } as never,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the key authorization is malformed. Sign in again with a new challenge.]`,
    )
  })

  // Each field that the parser does not check, and whose later read threw the reader's own error.
  const malformed = [
    { change: { keyId: '0x1234' }, name: 'a key ID that is no address' },
    {
      change: { keyId: ['0xbe95c3f554e9fc85ec51be69a3d807a0d55bcf2c'] },
      name: 'a key ID that is an array of one address',
    },
    { change: { expiry: '0xzz' }, name: 'an expiry that is no number' },
    { change: { expiry: 1.5 }, name: 'an expiry that is no integer' },
    {
      change: { witness: Array.from({ length: 66 }, () => 'a') },
      name: 'a witness that is an array of 66 entries',
    },
    { change: { keyType: 'unknown' }, name: 'an unknown key type' },
    {
      change: { limits: [{ limit: '0x1', token: 5 }] },
      name: 'a limit whose token is a number',
    },
    {
      change: { allowedCalls: [{ selectorRules: [{ selector: 5 }] }] },
      name: 'a scope whose selector is a number',
    },
    // The payload encodes an object with a `length` as that many bytes, so the encoder threw no
    // error for these, and did work in proportion to the `length`, not to the proof's size.
    {
      change: { account: { length: 20 } },
      name: 'an account that is an object with a length',
    },
    {
      change: { limits: [{ limit: '0x1', token: { length: 20 } }] },
      name: 'a limit whose token is an object with a length',
    },
    {
      change: { allowedCalls: [{ target: { length: 20 } }] },
      name: 'a scope whose target is an object with a length',
    },
    {
      change: {
        allowedCalls: [
          {
            selectorRules: [
              { recipients: [{ length: 20 }], selector: '0xa9059cbb' },
            ],
            target: token,
          },
        ],
      },
      name: 'a scope whose recipient is an object with a length',
    },
    {
      change: {
        allowedCalls: [
          {
            selectorRules: [
              { recipients: { length: 20 }, selector: '0xa9059cbb' },
            ],
            target: token,
          },
        ],
      },
      name: 'a scope whose recipients are an object with a length',
    },
  ] as const

  for (const row of malformed)
    test(`refuses ${row.name} as a malformed key authorization`, async () => {
      const { accessKey, account, rpc } = signed({
        witness: hashMessage(challenge),
      })

      const result = Challenge.verify(client, {
        accessToken: {
          accessKeys: [
            { account, address: accessKey, chainId: tempoModerato.id },
          ],
        },
        challenge,
        keyAuthorization: { ...rpc, ...row.change } as never,
      })

      await expect(result).rejects.toThrow(
        new Challenge.InvalidError({
          reason: 'the key authorization is malformed',
        }),
      )
    })

  test('refuses a witness that does not bind the challenge', async () => {
    const { accessKey, account, rpc } = signed({
      witness: hashMessage('another challenge'),
    })

    const result = Challenge.verify(client, {
      accessToken: {
        accessKeys: [
          { account, address: accessKey, chainId: tempoModerato.id },
        ],
      },
      challenge,
      keyAuthorization: rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the witness does not bind the challenge. Sign in again with a new challenge.]`,
    )
  })

  test('refuses an access key on another chain', async () => {
    const { accessKey, account, rpc } = signed({
      chainId: 4217,
      witness: hashMessage(challenge),
    })

    const result = Challenge.verify(client, {
      accessToken: {
        accessKeys: [{ account, address: accessKey, chainId: 4217 }],
      },
      challenge,
      keyAuthorization: rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the access key acts on chain 4217, not 42431. Sign in again with a new challenge.]`,
    )
  })

  test("refuses an access key that the app's token does not name, as one that another app requested", async () => {
    const { rpc } = signed({ witness: hashMessage(challenge) })

    const result = Challenge.verify(client, {
      accessToken: { accessKeys: [] },
      challenge,
      keyAuthorization: rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the app's access token does not name the access key. Sign in again with a new challenge.]`,
    )
  })

  test("refuses a key authorization that another account's owner signed", async () => {
    const { accessKey, rpc } = signed({ witness: hashMessage(challenge) })
    const other = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )

    const result = Challenge.verify(client, {
      accessToken: {
        accessKeys: [
          { account: other, address: accessKey, chainId: tempoModerato.id },
        ],
      },
      challenge,
      keyAuthorization: rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the account's owner did not sign the key authorization. Sign in again with a new challenge.]`,
    )
  })

  test("refuses a P256 envelope that carries the owner's public key over another payload", async () => {
    const { accessKey, account, rpc } = signedP256({
      forged: true,
      witness: hashMessage(challenge),
    })

    const result = Challenge.verify(client, {
      accessToken: {
        accessKeys: [
          { account, address: accessKey, chainId: tempoModerato.id },
        ],
      },
      challenge,
      keyAuthorization: rpc,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Challenge.InvalidError: Invalid challenge proof: the account's owner did not sign the key authorization. Sign in again with a new challenge.]`,
    )
  })
})
