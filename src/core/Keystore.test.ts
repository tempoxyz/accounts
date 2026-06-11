import { Address, Hex, Json, P256, PublicKey } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { KeyAuthorizationManager } from 'viem/tempo'
import { describe, expect, test, vi } from 'vp/test'

import { accounts } from '../../test/config.js'
import * as Keystore from './Keystore.js'

const rootAddress = accounts[0]!.address

function toAccountContext() {
  return {
    access: rootAddress,
    keyAuthorizationManager: KeyAuthorizationManager.memory(),
  }
}

describe('webCryptoP256', () => {
  test('default: creates a non-extractable key with a structured-clone handle', async () => {
    const keystore = Keystore.webCryptoP256()
    expect(keystore.requiresStructuredClone).toBe(true)

    const key = await keystore.createKey()
    expect(key.publicKey).toMatch(/^0x[0-9a-f]+$/i)
    const handle = key.handle as { kind: string; keyPair?: { privateKey: CryptoKey } }
    expect(handle.kind).toBe('webcrypto-p256')
    expect(handle.keyPair?.privateKey.extractable).toBe(false)

    const account = await keystore.toAccount(
      { handle: key.handle, keyType: 'p256', publicKey: key.publicKey },
      toAccountContext(),
    )
    expect(account.accessKeyAddress).toBe(
      Address.fromPublicKey(PublicKey.fromHex(key.publicKey)).toLowerCase(),
    )
  })

  test('behavior: extractable handles survive JSON and verify against the public key', async () => {
    const keystore = Keystore.webCryptoP256({ extractable: true })
    expect(keystore.requiresStructuredClone).toBe(false)

    const key = await keystore.createKey()
    expect(JSON.parse(JSON.stringify(key.handle))).toEqual(key.handle)

    const account = await keystore.toAccount(
      {
        handle: JSON.parse(JSON.stringify(key.handle)),
        keyType: 'p256',
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

  test('behavior: a live handle mangled by JSON storage is permanently unavailable', async () => {
    const keystore = Keystore.webCryptoP256()
    const key = await keystore.createKey()
    // Simulate a structured-clone handle squeezed through a string-based
    // storage adapter: the CryptoKey degrades to a plain object.
    const mangled = Json.parse(Json.stringify(key.handle))

    await expect(
      keystore.toAccount(
        { handle: mangled, keyType: 'p256', publicKey: key.publicKey },
        toAccountContext(),
      ),
    ).rejects.toBeInstanceOf(Keystore.KeyUnavailableError)
  })

  test('error: corrupt key material is permanently unavailable', async () => {
    const keystore = Keystore.webCryptoP256({ extractable: true })
    const key = await keystore.createKey()
    await expect(
      keystore.toAccount(
        {
          handle: { jwk: { kty: 'EC' }, kind: 'webcrypto-p256' },
          keyType: 'p256',
          publicKey: key.publicKey,
        },
        toAccountContext(),
      ),
    ).rejects.toBeInstanceOf(Keystore.KeyUnavailableError)
  })

  test('error: rejects handles written by another keystore', async () => {
    const keystore = Keystore.webCryptoP256()
    const key = await keystore.createKey()
    const toAccount = keystore.toAccount(
      {
        handle: { keyTag: 'app.example.key', kind: 'secure-enclave' },
        keyType: 'p256',
        publicKey: key.publicKey,
      },
      toAccountContext(),
    )
    await expect(toAccount).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Unrecognized \`webCryptoP256\` keystore handle.]`,
    )
    await expect(toAccount).rejects.not.toBeInstanceOf(Keystore.KeyUnavailableError)
  })

  test('error: fails loudly when WebCrypto is unavailable', async () => {
    const keystore = Keystore.webCryptoP256()
    vi.stubGlobal('crypto', {})
    try {
      await expect(keystore.createKey()).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: \`webCryptoP256\` keystore requires WebCrypto (\`crypto.subtle\`) support.]`,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
