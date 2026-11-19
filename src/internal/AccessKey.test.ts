/**
 * Tests the material check, the conversion of a stored access key to a Viem account, and the
 * modules that a browser bundle of the app's own access key keeps.
 * @module
 */
import * as Path from 'node:path'
import { Address, Hex, Secp256k1 } from 'ox'
import { AccountConfig, KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { rolldown } from 'vite/rolldown'
import { describe, expect, test } from 'vite-plus/test'
import * as AccessKey from './AccessKey.js'

const ownerKey =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

const owner = Account.fromSecp256k1(ownerKey)

const supplied = Account.fromP256(
  '0x0123456789012345678901234567890123456789012345678901234567890124',
)

describe('held', () => {
  test('holds a private key', () => {
    expect(AccessKey.held({ privateKey: ownerKey })).toMatchInlineSnapshot(
      `true`,
    )
  })

  test("holds no material for the app's own access key", () => {
    expect(AccessKey.held({})).toMatchInlineSnapshot(`false`)
  })

  test('holds no material without an access key', () => {
    expect(AccessKey.held(undefined)).toMatchInlineSnapshot(`false`)
  })
})

describe('own', () => {
  test("keeps no mnemonic or HD key derivation in a browser bundle that checks the app's own public key", async () => {
    const build = await rolldown({
      input: 'entry',
      onLog: () => undefined,
      platform: 'browser',
      plugins: [
        {
          name: 'entry',
          resolveId: (id) => (id === 'entry' ? id : undefined),
          load: (id) =>
            id === 'entry'
              ? `export { own } from ${JSON.stringify(Path.join(import.meta.dirname, 'AccessKey.ts'))}`
              : undefined,
        },
      ],
    })
    const output = await build.generate({ format: 'esm' })
    await build.close()

    const kept = output.output
      .flatMap((chunk) =>
        chunk.type === 'chunk'
          ? Object.entries(chunk.modules).filter(
              ([, module]) => module.renderedLength > 0,
            )
          : [],
      )
      .map(([path]) => path.replace(/^.*node_modules\//, ''))
      .filter((path) =>
        /@scure\/bip(32|39)\/|ox\/_esm\/core\/(HdKey|Mnemonic|internal\/mnemonic)\.js$/.test(
          path,
        ),
      )
    expect(kept).toMatchInlineSnapshot(`[]`)
  })
})

describe('toAccount', () => {
  test("returns an account of the authorization's key type for a supplied access key", async () => {
    const keyAuthorization = await owner.signKeyAuthorization(
      { address: supplied.address, type: 'p256' },
      { chainId: 4217n },
    )
    const accessKey = AccessKey.from({
      account: owner.address,
      chainId: 4217,
      keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
    })

    const account = AccessKey.toAccount(accessKey, { signer: supplied })

    expect({
      accessKeyAddress: Address.isEqual(
        account.accessKeyAddress,
        supplied.address,
      ),
      keyType: account.keyType,
      source: account.source,
    }).toMatchInlineSnapshot(`
      {
        "accessKeyAddress": true,
        "keyType": "p256",
        "source": "accessKey",
      }
    `)
  })

  test('signs a hash, a message, and typed data in a keychain envelope without the key authorization, before the chain registers the access key', async () => {
    const privateKey =
      '0x0123456789012345678901234567890123456789012345678901234567890125'
    const keyAuthorization = await owner.signKeyAuthorization(
      {
        address: Account.fromSecp256k1(privateKey).address,
        type: 'secp256k1',
      },
      { chainId: 4217n },
    )
    const account = AccessKey.toAccount(
      AccessKey.from({
        account: owner.address,
        chainId: 4217,
        keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
        privateKey,
      }),
    )
    const hash = `0x${'11'.repeat(32)}` as const

    // The account holds the authorization, which Viem attaches to the first transaction.
    const pending = await account.keyAuthorizationManager?.get({
      accessKey: account.accessKeyAddress,
      address: account.address,
      chainId: 4217,
    })
    const signatures = {
      hash: await account.sign({ hash }),
      message: await account.signMessage({ message: 'hello' }),
      typedData: await account.signTypedData({
        domain: { chainId: 4217, name: 'App' },
        message: { contents: 'hello' },
        primaryType: 'Mail',
        types: { Mail: [{ name: 'contents', type: 'string' }] },
      }),
    }
    const raw = await account.sign({ hash, raw: true })

    // A signature that carries the authorization is no envelope, so its parse throws.
    expect({
      hash: SignatureEnvelope.deserialize(signatures.hash).type,
      message: SignatureEnvelope.deserialize(signatures.message).type,
      pending: pending !== undefined,
      raw: Hex.size(raw),
      typedData: SignatureEnvelope.deserialize(signatures.typedData).type,
    }).toMatchInlineSnapshot(`
      {
        "hash": "keychain",
        "message": "keychain",
        "pending": true,
        "raw": 65,
        "typedData": "keychain",
      }
    `)
  })

  test('signs a message in a keychain envelope without the key authorization for a supplied access key', async () => {
    const keyAuthorization = await owner.signKeyAuthorization(
      { address: supplied.address, type: 'p256' },
      { chainId: 4217n },
    )
    const account = AccessKey.toAccount(
      AccessKey.from({
        account: owner.address,
        chainId: 4217,
        keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
      }),
      { signer: supplied },
    )

    const signature = await account.signMessage({ message: 'hello' })

    expect(SignatureEnvelope.deserialize(signature).type).toMatchInlineSnapshot(
      `"keychain"`,
    )
  })

  test("throws AccessKey.KeyTypeError for a configurable account's authorization", () => {
    const config = AccountConfig.from({
      owners: [{ owner: owner.address, weight: 1 }],
      threshold: 1,
    })
    const address = AccountConfig.getAddress(config)
    const unsigned = KeyAuthorization.from({
      address,
      chainId: 4217n,
      type: 'configurable',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(unsigned),
      privateKey: ownerKey,
    })
    const keyAuthorization = KeyAuthorization.from(unsigned, {
      signature: {
        account: address,
        config,
        signatures: [{ signature, type: 'secp256k1' }],
        type: 'configurable',
      },
    })
    const accessKey = AccessKey.from({
      account: owner.address,
      chainId: 4217,
      keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
    })

    const error = (() => {
      try {
        AccessKey.toAccount(accessKey, { signer: supplied })
      } catch (error) {
        return error as Error
      }
      return undefined
    })()

    expect(error?.name).toMatchInlineSnapshot(`"AccessKey.KeyTypeError"`)
  })
})
