import { tempoLocalnet } from 'viem/chains'
import { WebCryptoP256 } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as Account from './Account.js'
import * as Store from './Store.js'

describe('hydrate', () => {
  test('default: returns json-rpc account when sign is false', () => {
    const result = Account.hydrate({ address: accounts[0].address })

    expect(result).toMatchInlineSnapshot(`
      {
        "address": "${accounts[0].address}",
        "type": "json-rpc",
      }
    `)
  })

  test('behavior: hydrates secp256k1 account', () => {
    const result = Account.hydrate(
      {
        address: accounts[0].address,
        keyType: 'secp256k1',
        privateKey: privateKeys[0],
      },
      { signable: true },
    )

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
  })

  test('behavior: hydrates p256 account', () => {
    const result = Account.hydrate(
      {
        address: accounts[0].address,
        keyType: 'p256',
        privateKey: privateKeys[0],
      },
      { signable: true },
    )

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
  })

  test('behavior: hydrates webCrypto account', async () => {
    const result = Account.hydrate(
      {
        address: accounts[0].address,
        keyType: 'webCrypto',
        keyPair: await WebCryptoP256.createKeyPair(),
      },
      { signable: true },
    )

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
  })

  test('behavior: hydrates webAuthn_headless account', () => {
    const result = Account.hydrate(
      {
        address: accounts[0].address,
        keyType: 'webAuthn_headless',
        privateKey: privateKeys[0],
        rpId: 'example.com',
        origin: 'https://example.com',
      },
      { signable: true },
    )

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
  })

  test('error: throws when sign is true but no sign data', () => {
    expect(() =>
      Account.hydrate({ address: accounts[0].address }, { signable: true }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "${accounts[0].address}" cannot sign.]`,
    )
  })
})

describe('hydrateAccessKey', () => {
  test('default: hydrates access key to signable account', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const result = Account.hydrateAccessKey({
      address: '0x0000000000000000000000000000000000000099',
      access: accounts[0].address,
      keyType: 'webCrypto',
      keyPair,
    })

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
  })
})

describe('find', () => {
  function setup(
    storeAccounts: readonly Account.Store[] = [],
    accessKeys: readonly Account.AccessKey[] = [],
  ) {
    const store = Store.create({ chainId: tempoLocalnet.id })
    store.setState({ accounts: storeAccounts, accessKeys, activeAccount: 0 })
    return store
  }

  test('default: resolves active account', () => {
    const store = setup([
      {
        address: accounts[0].address,
        keyType: 'secp256k1',
        privateKey: privateKeys[0],
      },
    ])

    const result = Account.find({ store })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(result.type).toMatchInlineSnapshot(`"json-rpc"`)
  })

  test('behavior: resolves by address', () => {
    const store = setup([
      {
        address: accounts[0].address,
        keyType: 'secp256k1',
        privateKey: privateKeys[0],
      },
      {
        address: accounts[1].address,
        keyType: 'secp256k1',
        privateKey: privateKeys[1],
      },
    ])

    const result = Account.find({ address: accounts[1].address, store })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[1].address}"`)
  })

  test('behavior: resolves signable account', () => {
    const store = setup([
      {
        address: accounts[0].address,
        keyType: 'secp256k1',
        privateKey: privateKeys[0],
      },
    ])

    const result = Account.find({ signable: true, store })

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
  })

  test('behavior: prefers access key over root account', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: accounts[0].address,
          keyType: 'webCrypto',
          keyPair,
        },
      ],
    )

    const result = Account.find({ store, signable: true })

    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: accessKey false skips access key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: accounts[0].address,
          keyType: 'webCrypto',
          keyPair,
        },
      ],
    )

    const result = Account.find({ accessKey: false, signable: true, store })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(result.source).not.toBe('accessKey')
  })

  test('behavior: falls back to root when no access key exists', () => {
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [],
    )

    const result = Account.find({ signable: true, store })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(result.type).toMatchInlineSnapshot(`"local"`)
  })

  test('behavior: removes expired access key and falls back to root', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: accounts[0].address,
          expiry: expiredTimestamp,
          keyType: 'webCrypto',
          keyPair,
        },
      ],
    )

    const result = Account.find({ signable: true, store })

    // Falls back to root account.
    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    // Expired access key is removed from the store.
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: access key with limits is resolved', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const limits = [{ token: '0x0000000000000000000000000000000000000abc' as const, limit: 1000n }]
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: accounts[0].address,
          limits,
          keyType: 'webCrypto',
          keyPair,
        },
      ],
    )

    const result = Account.find({ signable: true, store })

    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
    // Limits are stored on the access key entry.
    expect(store.getState().accessKeys[0]!.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": 1000n,
          "token": "0x0000000000000000000000000000000000000abc",
        },
      ]
    `)
  })

  test('behavior: access key with future expiry is used', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600
    const store = setup(
      [{ address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] }],
      [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: accounts[0].address,
          expiry: futureExpiry,
          keyType: 'webCrypto',
          keyPair,
        },
      ],
    )

    const result = Account.find({ signable: true, store })

    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
    // Access key is still in the store (not removed).
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })

  test('error: throws when address not found', () => {
    const store = setup([])

    expect(() =>
      Account.find({ address: accounts[0].address, store }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "${accounts[0].address}" not found.]`,
    )
  })

  test('error: throws when no active account', () => {
    const store = setup([])

    expect(() => Account.find({ store })).toThrowErrorMatchingInlineSnapshot(
      `[Provider.DisconnectedError: No active account.]`,
    )
  })
})
