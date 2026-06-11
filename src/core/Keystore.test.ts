import { Address, Hex, Json, P256, PublicKey } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount, KeyAuthorizationManager } from 'viem/tempo'
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
    const entry = Keystore.webCryptoP256()
    expect(entry.handle).toBe('structured-clone')

    const key = await entry.createKey()
    expect(key.publicKey).toMatch(/^0x[0-9a-f]+$/i)
    const handle = key.handle as { kind: string; keyPair?: { privateKey: CryptoKey } }
    expect(handle.kind).toBe('webcrypto-p256')
    expect(handle.keyPair?.privateKey.extractable).toBe(false)

    const account = await entry.toAccount(
      { handle: key.handle, keyType: 'p256', publicKey: key.publicKey },
      toAccountContext(),
    )
    expect(account.accessKeyAddress).toBe(
      Address.fromPublicKey(PublicKey.fromHex(key.publicKey)).toLowerCase(),
    )
  })

  test('behavior: extractable handles survive JSON and verify against the public key', async () => {
    const entry = Keystore.webCryptoP256({ extractable: true })
    expect(entry.handle).toBe('json')

    const key = await entry.createKey()
    expect(JSON.parse(JSON.stringify(key.handle))).toEqual(key.handle)

    const account = await entry.toAccount(
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
    const entry = Keystore.webCryptoP256()
    const key = await entry.createKey()
    // Simulate a structured-clone handle squeezed through a string-based
    // storage adapter: the CryptoKey degrades to a plain object.
    const mangled = Json.parse(Json.stringify(key.handle))

    await expect(
      entry.toAccount(
        { handle: mangled, keyType: 'p256', publicKey: key.publicKey },
        toAccountContext(),
      ),
    ).rejects.toBeInstanceOf(Keystore.KeyUnavailableError)
  })

  test('error: corrupt key material is permanently unavailable', async () => {
    const entry = Keystore.webCryptoP256({ extractable: true })
    const key = await entry.createKey()
    await expect(
      entry.toAccount(
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
    const entry = Keystore.webCryptoP256()
    const key = await entry.createKey()
    const toAccount = entry.toAccount(
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
    const entry = Keystore.webCryptoP256()
    vi.stubGlobal('crypto', {})
    try {
      await expect(entry.createKey()).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: \`webCryptoP256\` keystore requires WebCrypto (\`crypto.subtle\`) support.]`,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('fallback', () => {
  /** Entry that signs with a noble P256 key, discriminating handles by `kind`. */
  function stubEntry(kind: string, options: { available?: boolean | undefined } = {}) {
    const keys = new Map<string, Hex.Hex>()
    const stats = { createKeyCalls: 0, toAccountCalls: 0 }
    const entry: Keystore.Entry = {
      async createKey() {
        stats.createKeyCalls++
        if (options.available === false) throw new Error(`${kind} unavailable`)
        const privateKey = P256.randomPrivateKey()
        const id = `key-${keys.size}`
        keys.set(id, privateKey)
        return {
          handle: { id, kind },
          publicKey: PublicKey.toHex(P256.getPublicKey({ privateKey })),
        }
      },
      async toAccount(record, context) {
        stats.toAccountCalls++
        const handle = record.handle as { id: string; kind: string }
        if (handle.kind !== kind) throw new Error('not my handle')
        const privateKey = keys.get(handle.id)
        if (!privateKey) throw new Keystore.KeyUnavailableError(`${kind} key deleted`)
        return TempoAccount.fromP256(privateKey, {
          access: context.access,
          keyAuthorizationManager: context.keyAuthorizationManager,
        })
      },
    }
    return Object.assign(entry, { keys, stats })
  }

  test('default: first entry that can provision wins', async () => {
    const primary = stubEntry('primary')
    const secondary = stubEntry('secondary')
    const entry = Keystore.fallback(primary, secondary)

    const key = await entry.createKey()
    expect((key.handle as { kind: string }).kind).toBe('primary')
    expect(secondary.stats.createKeyCalls).toBe(0)
  })

  test('behavior: falls through when an entry cannot provision', async () => {
    const primary = stubEntry('primary', { available: false })
    const secondary = stubEntry('secondary')
    const entry = Keystore.fallback(primary, secondary)

    const key = await entry.createKey()
    expect((key.handle as { kind: string }).kind).toBe('secondary')
  })

  test('error: surfaces all errors when no entry can provision', async () => {
    const entry = Keystore.fallback(
      stubEntry('primary', { available: false }),
      stubEntry('secondary', { available: false }),
    )
    await expect(entry.createKey()).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(Error)],
      message: 'No keystore entry could create key material.',
    })
  })

  test('behavior: hydration routes to the entry that recognizes the handle', async () => {
    const primary = stubEntry('primary')
    const secondary = stubEntry('secondary')
    const entry = Keystore.fallback(primary, secondary)

    const key = await secondary.createKey()
    const account = await entry.toAccount(
      { handle: key.handle, keyType: 'p256', publicKey: key.publicKey },
      toAccountContext(),
    )
    expect(account.accessKeyAddress).toBe(
      Address.fromPublicKey(PublicKey.fromHex(key.publicKey)).toLowerCase(),
    )
  })

  test('behavior: KeyUnavailableError claims the handle', async () => {
    const primary = stubEntry('primary')
    const secondary = stubEntry('secondary')
    const entry = Keystore.fallback(primary, secondary)

    const key = await primary.createKey()
    primary.keys.clear()

    await expect(
      entry.toAccount(
        { handle: key.handle, keyType: 'p256', publicKey: key.publicKey },
        toAccountContext(),
      ),
    ).rejects.toBeInstanceOf(Keystore.KeyUnavailableError)
    // The owning entry's verdict is terminal — later entries are not consulted.
    expect(secondary.stats.toAccountCalls).toBe(0)
  })

  test('behavior: declares structured-clone when any entry does', () => {
    const json = stubEntry('json')
    expect(Keystore.fallback(json).handle).toBe('json')
    expect(Keystore.fallback(json, Keystore.webCryptoP256()).handle).toBe('structured-clone')
  })
})
