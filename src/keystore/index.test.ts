import { Address, Hex, P256, PublicKey } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { KeyAuthorizationManager } from 'viem/tempo'
import { describe, expect, test, vi } from 'vp/test'

import { accounts } from '../../test/config.js'
import { KeyUnavailableError, webCryptoP256 } from './index.js'

const rootAddress = accounts[0]!.address

function toAccountContext() {
  return {
    access: rootAddress,
    keyAuthorizationManager: KeyAuthorizationManager.memory(),
  }
}

describe('webCryptoP256', () => {
  test('default: creates a p256 key with a JSON-serializable handle', async () => {
    const keystore = webCryptoP256()
    const key = await keystore.createKey({})

    expect(key.keyType).toBe('p256')
    expect(key.publicKey).toMatch(/^0x[0-9a-f]+$/i)
    expect(key.handle).toMatchObject({ kind: 'webcrypto-p256' })
    // The handle must survive a string-based storage adapter verbatim.
    expect(JSON.parse(JSON.stringify(key.handle))).toEqual(key.handle)
  })

  test('behavior: round-trips a JSON-serialized handle into a signing account', async () => {
    const keystore = webCryptoP256()
    const key = await keystore.createKey({ keyType: 'p256' })

    const account = await keystore.toAccount(
      {
        handle: JSON.parse(JSON.stringify(key.handle)),
        keyType: key.keyType,
        publicKey: key.publicKey,
      },
      toAccountContext(),
    )

    expect(account.accessKeyAddress).toBe(
      Address.fromPublicKey(PublicKey.fromHex(key.publicKey)).toLowerCase(),
    )

    // Signature verifies against the persisted public key.
    const payload = Hex.random(32)
    const signature = await account.sign({ hash: payload, raw: true })
    const envelope = SignatureEnvelope.deserialize(signature)
    if (envelope.type !== 'p256') throw new Error('expected p256 envelope')
    expect(
      P256.verify({
        hash: envelope.prehash,
        payload,
        publicKey: PublicKey.fromHex(key.publicKey),
        signature: envelope.signature,
      }),
    ).toBe(true)
  })

  test('error: rejects unsupported key types at provisioning time', async () => {
    const keystore = webCryptoP256()
    await expect(
      keystore.createKey({ keyType: 'secp256k1' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: \`webCryptoP256\` keystore cannot create "secp256k1" keys.]`,
    )
  })

  test('error: fails loudly when WebCrypto is unavailable', async () => {
    const keystore = webCryptoP256()
    vi.stubGlobal('crypto', {})
    try {
      await expect(keystore.createKey({})).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: \`webCryptoP256\` keystore requires WebCrypto (\`crypto.subtle\`) support.]`,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('error: corrupt key material signals permanent unavailability', async () => {
    const keystore = webCryptoP256()
    const key = await keystore.createKey({})
    await expect(
      keystore.toAccount(
        {
          handle: { jwk: { kty: 'EC' }, kind: 'webcrypto-p256' },
          keyType: 'p256',
          publicKey: key.publicKey,
        },
        toAccountContext(),
      ),
    ).rejects.toBeInstanceOf(KeyUnavailableError)
  })

  test('error: rejects handles written by another keystore', async () => {
    const keystore = webCryptoP256()
    const key = await keystore.createKey({})
    await expect(
      keystore.toAccount(
        {
          handle: { keyTag: 'app.example.key', kind: 'secure-enclave' },
          keyType: 'p256',
          publicKey: key.publicKey,
        },
        toAccountContext(),
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Unrecognized \`webCryptoP256\` keystore handle.]`,
    )
  })
})
