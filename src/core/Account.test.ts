import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount, WebCryptoP256 } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
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

describe('find', () => {
  function setup(storeAccounts: readonly Account.Store[] = []) {
    const store = Store.create({ chainId: tempoLocalnet.id })
    store.setState({ accounts: storeAccounts, activeAccount: 0 })
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

  test('behavior: falls back to root when no access key exists', () => {
    const store = setup([
      { address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
    ])

    const result = Account.find({ signable: true, store })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(result.type).toMatchInlineSnapshot(`"local"`)
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

describe('createSignerResolver', () => {
  function setup(storeAccounts: readonly Account.Store[] = []) {
    const store = Store.create({ chainId: tempoLocalnet.id })
    store.setState({ accounts: storeAccounts, activeAccount: 0 })
    const resolveSigner = Account.createSignerResolver({
      getFallbackAccount: (options = {}) =>
        Account.find({ address: options.address, signable: true, store }),
      store,
    })
    return { resolveSigner, store }
  }

  function createKeyAuthorization(address: `0x${string}`) {
    return KeyAuthorization.from(
      {
        address,
        chainId: BigInt(tempoLocalnet.id),
        scopes: [
          {
            address: accounts[1].address,
            selector: 'transfer(address,uint256)',
          },
        ],
        type: 'p256',
      },
      { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
    )
  }

  test('default: falls back to the adapter root account', async () => {
    const { resolveSigner } = setup([
      { address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
    ])

    const result = await resolveSigner()

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect('type' in result ? result.type : undefined).toMatchInlineSnapshot(`"local"`)
  })

  test('behavior: fallback can be a JSON-RPC root account', async () => {
    const store = Store.create({ chainId: tempoLocalnet.id })
    store.setState({ accounts: [{ address: accounts[0].address }], activeAccount: 0 })
    const resolveSigner = Account.createSignerResolver({
      getFallbackAccount: (options = {}) => Account.find({ address: options.address, store }),
      store,
    })

    const result = await resolveSigner({
      chainId: tempoLocalnet.id,
      requiredSigner: accounts[1].address,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "address": "${accounts[0].address}",
        "type": "json-rpc",
      }
    `)
  })

  test('behavior: resolves an exact access key signer without transaction calls', async () => {
    const { resolveSigner, store } = setup([
      { address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
    ])
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: accounts[0].address })
    AccessKey.add({
      account: accounts[0].address,
      authorization: createKeyAuthorization(accessKey.accessKeyAddress),
      keyPair,
      store,
    })

    const result = await resolveSigner({
      chainId: tempoLocalnet.id,
      requiredSigner: accessKey.accessKeyAddress,
    })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(
      'accessKeyAddress' in result ? result.accessKeyAddress : undefined,
    ).toMatchInlineSnapshot(`"${accessKey.accessKeyAddress}"`)
  })

  test('behavior: falls through to scoped access key when exact signer is unavailable', async () => {
    const { resolveSigner, store } = setup([
      { address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
    ])
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: accounts[0].address })
    AccessKey.add({
      account: accounts[0].address,
      authorization: createKeyAuthorization(accessKey.accessKeyAddress),
      keyPair,
      store,
    })

    const result = await resolveSigner({
      calls: [{ to: accounts[1].address, data: '0xa9059cbb' }],
      chainId: tempoLocalnet.id,
      requiredSigner: accounts[2].address,
    })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect(
      'accessKeyAddress' in result ? result.accessKeyAddress : undefined,
    ).toMatchInlineSnapshot(`"${accessKey.accessKeyAddress}"`)
  })

  test('behavior: falls back to root when exact signer is unavailable and no scoped key matches', async () => {
    const { resolveSigner } = setup([
      { address: accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
    ])

    const result = await resolveSigner({
      chainId: tempoLocalnet.id,
      requiredSigner: accounts[1].address,
    })

    expect(result.address).toMatchInlineSnapshot(`"${accounts[0].address}"`)
    expect('type' in result ? result.type : undefined).toMatchInlineSnapshot(`"local"`)
  })
})
