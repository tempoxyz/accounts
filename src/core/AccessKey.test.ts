import { Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { encodeErrorResult, encodeFunctionResult } from 'viem'
import { Abis, Account as TempoAccount, Actions } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import * as AccessKeyStore from './internal/AccessKeyStore.js'
import * as AccessKeyTransaction from './internal/AccessKeyTransaction.js'
import * as Store from './Store.js'

function createStore() {
  return Store.create({ chainId: 1 })
}

const rootAddress = accounts[0]!.address

function createKeyAuthorization(
  address: `0x${string}`,
  options: {
    expiry?: number | undefined
    limits?: { token: `0x${string}`; limit: bigint }[] | undefined
    scopes?: KeyAuthorization.Scope[] | undefined
  } = {},
) {
  return KeyAuthorization.from(
    {
      address,
      chainId: 1n,
      expiry: options.expiry,
      limits: options.limits,
      scopes: options.scopes,
      type: 'p256',
    },
    { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
  )
}

function createRevert(errorName: string) {
  return Object.assign(new Error('reverted'), {
    data: encodeErrorResult({ abi: Abis.abis, errorName, args: [] } as never),
  })
}

function createMetadataClient(
  accessKey: Hex.Hex,
  options: { isRevoked?: boolean | undefined } = {},
) {
  return {
    call: async () => ({
      data: encodeFunctionResult({
        abi: Abis.accountKeychain,
        functionName: 'getKey',
        result: {
          enforceLimits: false,
          expiry: 0n,
          isRevoked: options.isRevoked ?? false,
          keyId: accessKey,
          signatureType: 1,
        },
      } as never),
    }),
  }
}

function createFillClient(accessKey: Hex.Hex, options: { isRevoked?: boolean | undefined } = {}) {
  const requests: unknown[] = []
  return {
    client: {
      ...createMetadataClient(accessKey, options),
      request: async (request: unknown) => {
        requests.push(request)
        return { capabilities: { sponsored: false }, tx: {} }
      },
    },
    requests,
  }
}

function getStored(account: TempoAccount.AccessKeyAccount, store: Store.Store) {
  return store
    .getState()
    .accessKeys.find((key) => key.address.toLowerCase() === account.accessKeyAddress.toLowerCase())
}

describe('saveAuthorization', () => {
  test('default: saves access key to store', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })

    const { accessKeys } = store.getState()
    expect(accessKeys.length).toMatchInlineSnapshot(`1`)
    expect(accessKeys[0]!.address).toBe(accessKey.address)
    expect(accessKeys[0]!.access).toBe(rootAddress)
    expect(accessKeys[0]!.chainId).toMatchInlineSnapshot(`1`)
    expect(accessKeys[0]!.keyType).toMatchInlineSnapshot(`"p256"`)
    expect(accessKeys[0]!.keyAuthorization).toBe(keyAuthorization)
  })

  test('behavior: saves without keyPair', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })

    expect(store.getState().accessKeys[0]!.keyPair).toBeUndefined()
  })

  test('behavior: saves with keyPair', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'signed',
      store,
    })

    expect(store.getState().accessKeys[0]!.keyPair).toBe(keyPair)
  })

  test('behavior: appends to existing access keys', async () => {
    const store = createStore()
    const keyPair1 = await WebCryptoP256.createKeyPair()
    const keyPair2 = await WebCryptoP256.createKeyPair()
    const ak1 = TempoAccount.fromWebCryptoP256(keyPair1)
    const ak2 = TempoAccount.fromWebCryptoP256(keyPair2)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(ak1.address),
      state: 'signed',
      store,
    })
    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(ak2.address),
      state: 'signed',
      store,
    })

    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`2`)
  })

  test('behavior: stores expiry from key authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const keyAuthorization = createKeyAuthorization(accessKey.address, { expiry })

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })

    expect(store.getState().accessKeys[0]!.expiry).toBe(expiry)
  })

  test('behavior: stores limits from key authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const limits = [{ token: '0x20c0000000000000000000000000000000000001' as const, limit: 1000n }]
    const keyAuthorization = createKeyAuthorization(accessKey.address, { limits })

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })

    expect(store.getState().accessKeys[0]!.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": 1000n,
          "token": "0x20c0000000000000000000000000000000000001",
        },
      ]
    `)
  })
})

describe('saveAuthorization authorized', () => {
  test('default: saves access key without pending authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'authorized',
      store,
    })

    const { keyPair: _keyPair, ...stored } = store.getState().accessKeys[0]!
    expect(stored).toMatchInlineSnapshot(`
      {
        "access": "${rootAddress}",
        "address": "${accessKey.address}",
        "chainId": 1,
        "expiry": undefined,
        "keyType": "p256",
        "limits": undefined,
        "scopes": undefined,
      }
    `)
    expect(store.getState().accessKeys[0]!.keyAuthorization).toMatchInlineSnapshot(`undefined`)
  })
})

describe('removePending', () => {
  test('default: clears key authorization from access key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })
    expect(getStored(accessKey, store)?.keyAuthorization).toBeDefined()

    AccessKeyStore.removePending({ accessKey: accessKey.accessKeyAddress, store })

    expect(getStored(accessKey, store)?.keyAuthorization).toBeUndefined()
  })

  test('behavior: no-op for non-matching access key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'signed',
      store,
    })

    AccessKeyStore.removePending({ accessKey: accounts[0]!.address, store })

    expect(getStored(accessKey, store)?.keyAuthorization).toBeDefined()
  })

  test('behavior: does not affect other access keys', async () => {
    const store = createStore()
    const keyPair1 = await WebCryptoP256.createKeyPair()
    const keyPair2 = await WebCryptoP256.createKeyPair()
    const ak1 = TempoAccount.fromWebCryptoP256(keyPair1, { access: rootAddress })
    const ak2 = TempoAccount.fromWebCryptoP256(keyPair2, { access: rootAddress })
    const ka1 = createKeyAuthorization(ak1.accessKeyAddress)
    const ka2 = createKeyAuthorization(ak2.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization: ka1,
      state: 'signed',
      store,
    })
    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization: ka2,
      state: 'signed',
      store,
    })

    AccessKeyStore.removePending({ accessKey: ak1.accessKeyAddress, store })

    expect(getStored(ak1, store)?.keyAuthorization).toBeUndefined()
    expect(getStored(ak2, store)?.keyAuthorization).toBe(ka2)
  })
})

describe('saveAuthorization pending', () => {
  test('behavior: removePending clears pending marker', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      state: 'pending',
      store,
    })
    AccessKeyStore.removePending({ accessKey: accessKey.accessKeyAddress, store })

    expect(store.getState().accessKeys[0]!.keyAuthorizationPending).toMatchInlineSnapshot(
      `undefined`,
    )
  })
})

describe('create invalidation', () => {
  async function setup(options: { other?: boolean | undefined } = {}) {
    const store = createStore()
    const keyPair_other = await WebCryptoP256.createKeyPair()
    const account_other = TempoAccount.fromWebCryptoP256(keyPair_other, { access: rootAddress })
    if (options.other)
      AccessKeyStore.upsertAuthorization({
        address: rootAddress,
        keyAuthorization: createKeyAuthorization(account_other.accessKeyAddress),
        keyPair: keyPair_other,
        state: 'signed',
        store,
      })

    const keyPair = await WebCryptoP256.createKeyPair()
    const account = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(account.accessKeyAddress),
      keyPair,
      state: 'signed',
      store,
    })
    return { account_other, store }
  }

  test('behavior: removes matching access key for stale-key errors', async () => {
    const { account_other, store } = await setup({ other: true })

    const transaction = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: {
        request: async () => {
          throw createRevert('KeyNotFound')
        },
      } as never,
      store,
    })

    await expect(
      transaction?.fill({ chainId: 1, from: rootAddress }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: reverted]`)
    expect(store.getState().accessKeys.map((key) => key.address)).toMatchInlineSnapshot(`
      [
        "${account_other.accessKeyAddress}",
      ]
    `)
  })

  test('behavior: preserves access key for recoverable execution errors', async () => {
    const { store } = await setup()

    const transaction = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: {
        request: async () => {
          throw createRevert('SpendingLimitExceeded')
        },
      } as never,
      store,
    })

    await expect(
      transaction?.fill({ chainId: 1, from: rootAddress }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: reverted]`)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })

  test('behavior: preserves access key for unknown errors', async () => {
    const { store } = await setup()

    const transaction = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: {
        request: async () => {
          throw new Error('network failed')
        },
      } as never,
      store,
    })

    await expect(
      transaction?.fill({ chainId: 1, from: rootAddress }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: network failed]`)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })
})

describe('generate', () => {
  test('default: returns access key and key pair', async () => {
    const result = await AccessKey.generate()

    expect(result.accessKey.address).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(result.keyPair).toBeDefined()
  })

  test('behavior: with account attaches access to root', async () => {
    const result = await AccessKey.generate({ account: accounts[0]! })

    expect(result.accessKey.source).toMatchInlineSnapshot(`"accessKey"`)
    expect(result.accessKey.accessKeyAddress).toMatch(/^0x[0-9a-f]{40}$/i)
  })
})

describe('prepareAuthorization', () => {
  test('default: prepares generated p256 key authorization', async () => {
    const result = await AccessKey.prepareAuthorization({ chainId: 1, expiry: 123 })

    expect(result.keyAuthorization.address).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(result.keyAuthorization.chainId).toMatchInlineSnapshot(`1n`)
    expect(result.keyAuthorization.expiry).toMatchInlineSnapshot(`123`)
    expect(result.keyAuthorization.type).toMatchInlineSnapshot(`"p256"`)
    expect(result.keyPair).toBeDefined()
  })

  test('behavior: prepares external key authorization from address', async () => {
    const result = await AccessKey.prepareAuthorization({
      address: accounts[1]!.address,
      chainId: 123n,
      expiry: 456,
      keyType: 'webAuthn',
      limits: [
        {
          limit: 1000n,
          period: 60,
          token: '0x20c0000000000000000000000000000000000001',
        },
      ],
      scopes: [
        {
          address: '0x0000000000000000000000000000000000000abc',
          recipients: ['0x0000000000000000000000000000000000000def'],
          selector: 'transfer(address,uint256)',
        },
      ],
    })

    expect(result.keyPair).toBeUndefined()
    expect(result.keyAuthorization).toMatchInlineSnapshot(`
      {
        "address": "${accounts[1]!.address}",
        "chainId": 123n,
        "expiry": 456,
        "limits": [
          {
            "limit": 1000n,
            "period": 60,
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "scopes": [
          {
            "address": "0x0000000000000000000000000000000000000abc",
            "recipients": [
              "0x0000000000000000000000000000000000000def",
            ],
            "selector": "0xa9059cbb",
          },
        ],
        "type": "webAuthn",
      }
    `)
  })

  test('behavior: prepares external key authorization from public key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const account = TempoAccount.fromWebCryptoP256(keyPair)

    const result = await AccessKey.prepareAuthorization({
      chainId: 123n,
      expiry: 456,
      keyType: 'p256',
      publicKey: account.publicKey,
    })

    expect(result.keyPair).toBeUndefined()
    expect(result.keyAuthorization).toMatchInlineSnapshot(`
      {
        "address": "${account.address.toLowerCase()}",
        "chainId": 123n,
        "expiry": 456,
        "limits": undefined,
        "scopes": undefined,
        "type": "p256",
      }
    `)
  })

  test('behavior: defaults external key type to secp256k1', async () => {
    const result = await AccessKey.prepareAuthorization({
      address: accounts[1]!.address,
      chainId: 1,
      expiry: 123,
    })

    expect(result.keyAuthorization.type).toMatchInlineSnapshot(`"secp256k1"`)
  })
})

describe('saveAuthorization', () => {
  test('default: saves prepared authorization with provided signature', async () => {
    const store = createStore()
    const prepared = await AccessKey.prepareAuthorization({
      address: accounts[1]!.address,
      chainId: 1,
      expiry: 123,
    })
    const signature = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as const

    const result = AccessKey.saveAuthorization({
      address: rootAddress,
      prepared,
      signature,
      store,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "chainId": "0x1",
        "expiry": "0x7b",
        "keyId": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        "keyType": "secp256k1",
        "limits": undefined,
        "signature": {
          "r": "0x1111111111111111111111111111111111111111111111111111111111111111",
          "s": "0x2222222222222222222222222222222222222222222222222222222222222222",
          "type": "secp256k1",
          "yParity": "0x0",
        },
      }
    `)
    expect(store.getState().accessKeys.map(({ keyAuthorization: _, ...accessKey }) => accessKey))
      .toMatchInlineSnapshot(`
      [
        {
          "access": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
          "chainId": 1,
          "expiry": 123,
          "keyType": "secp256k1",
          "limits": undefined,
          "scopes": undefined,
        },
      ]
    `)
  })
})

describe('authorize', () => {
  test('default: prepares, signs, and saves authorization', async () => {
    const store = createStore()
    const digests: Hex.Hex[] = []
    const signature = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as const
    const account = {
      ...accounts[0]!,
      sign: async (parameters: { hash: Hex.Hex }) => {
        digests.push(parameters.hash)
        return signature
      },
    } as TempoAccount.Account

    await AccessKey.authorize({
      account,
      chainId: 1,
      parameters: {
        address: accounts[1]!.address,
        expiry: 123,
      },
      store,
    })

    expect(digests).toMatchInlineSnapshot(`
      [
        "0xea47721547363fc82a5dca62b4544e4718d861b3df10bfac65d30102594b5c26",
      ]
    `)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })
})

describe('selectAccountSync', () => {
  function setup(accessKeys: readonly Store.AccessKey[] = []) {
    const store = createStore()
    store.setState({ accessKeys })
    return store
  }

  test('default: selects locally-signable access key for root address', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: skips access keys for another root address', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: accounts[1]!.address,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: skips access keys for another chain', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 42_431,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: skips external access keys without signer material', () => {
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyType: 'p256',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: removes expired access key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        expiry: Math.floor(Date.now() / 1000) - 3600,
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: keeps future-expiring access key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })

  test('behavior: preserves limits on selected access key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        limits: [
          {
            token: '0x0000000000000000000000000000000000000abc',
            limit: 1000n,
          },
        ],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
    expect(store.getState().accessKeys[0]?.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": 1000n,
          "token": "0x0000000000000000000000000000000000000abc",
        },
      ]
    `)
  })

  test('behavior: unscoped access key selects with calls', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: '0x0000000000000000000000000000000000000abc', data: '0xa9059cbb' }],
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: scoped access key selects when calls match', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{ address: token, selector: '0xa9059cbb' }],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: token, data: '0xa9059cbb0000000000000000000000000000000000000001' }],
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: scoped access key skips calls that do not match', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{ address: token, selector: '0xa9059cbb' }],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: scoped access key supports human-readable selectors', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{ address: token, selector: 'transfer(address,uint256)' }],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: token, data: '0xa9059cbb0000000000000000000000000000000000000001' }],
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: scoped access key checks recipient allowlist', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const recipient = '0x0000000000000000000000000000000000000def' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [
          { address: token, selector: 'transfer(address,uint256)', recipients: [recipient] },
        ],
      },
    ])
    const call = Actions.token.transfer.call({
      amount: 1n,
      to: recipient,
      token,
    })

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [call],
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: scoped access key skips non-allowlisted recipients', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [
          {
            address: token,
            selector: 'transfer(address,uint256)',
            recipients: ['0x0000000000000000000000000000000000000def'],
          },
        ],
      },
    ])
    const call = Actions.token.transfer.call({
      amount: 1n,
      to: '0x0000000000000000000000000000000000000fed',
      token,
    })

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [call],
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: malformed scopes skip the access key', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{}],
      } as never,
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: '0x0000000000000000000000000000000000000abc', data: '0xa9059cbb' }],
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: scoped access key without selector allows any call to that address', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const token = '0x0000000000000000000000000000000000000abc' as const
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{ address: token }],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
      calls: [{ to: token, data: '0xdeadbeef' }],
    })

    expect(result?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: scoped access key skips when no calls are provided', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const store = setup([
      {
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyPair,
        keyType: 'webCrypto',
        scopes: [{ address: '0x0000000000000000000000000000000000000abc' }],
      },
    ])

    const result = AccessKeyTransaction.selectAccountSync({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })
})

describe('create', () => {
  async function setup(options: { pending?: boolean | undefined } = {}) {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: options.pending ? 'pending' : 'signed',
      store,
    })

    return { accessKey, keyAuthorization, store }
  }

  test('behavior: returns undefined when no matching access key exists', async () => {
    const store = createStore()
    const { client } = createFillClient(accounts[1]!.address)

    const result = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: client as never,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('default: returns selected account with pending key authorization', async () => {
    const { keyAuthorization, store } = await setup()
    const { client, requests } = createFillClient(keyAuthorization.address)

    const result = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: client as never,
      store,
    })
    await result?.fill({ chainId: 1, from: rootAddress })

    expect(!!result).toMatchInlineSnapshot(`true`)
    const request = requests[0] as {
      params: readonly [{ keyAuthorization?: { keyId?: string | undefined } | undefined }]
    }
    expect(request.params[0].keyAuthorization?.keyId).toBe(keyAuthorization.address)
  })

  test('behavior: clears pending authorization when pending key is published on-chain', async () => {
    const { accessKey, store } = await setup({ pending: true })

    const result = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: createMetadataClient(accessKey.accessKeyAddress) as never,
      store,
    })

    expect(!!result).toMatchInlineSnapshot(`true`)
    expect(store.getState().accessKeys[0]!.keyAuthorization).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: reuses pending authorization when direct key check is missing', async () => {
    const { accessKey, keyAuthorization, store } = await setup({ pending: true })
    const { client, requests } = createFillClient(accessKey.accessKeyAddress, { isRevoked: true })

    const result = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: client as never,
      store,
    })
    await result?.fill({ chainId: 1, from: rootAddress })

    const request = requests[0] as {
      params: readonly [{ keyAuthorization?: { keyId?: string | undefined } | undefined }]
    }
    expect(request.params[0].keyAuthorization?.keyId).toBe(keyAuthorization.address)
    expect(store.getState().accessKeys[0]!.keyAuthorization).toBe(keyAuthorization)
  })

  test('behavior: reuses pending authorization when direct key check fails', async () => {
    const { keyAuthorization, store } = await setup({ pending: true })
    const requests: unknown[] = []

    const result = await AccessKeyTransaction.create({
      address: rootAddress,
      chainId: 1,
      client: {
        call: async () => {
          throw new Error('network failed')
        },
        request: async (request: unknown) => {
          requests.push(request)
          return { capabilities: { sponsored: false }, tx: {} }
        },
      } as never,
      store,
    })
    await result?.fill({ chainId: 1, from: rootAddress })

    const request = requests[0] as {
      params: readonly [{ keyAuthorization?: { keyId?: string | undefined } | undefined }]
    }
    expect(request.params[0].keyAuthorization?.keyId).toBe(keyAuthorization.address)
    expect(store.getState().accessKeys[0]!.keyAuthorization).toBe(keyAuthorization)
  })
})

describe('getStatus', () => {
  test('behavior: returns pending for locally stored key authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'signed',
      store,
    })

    const result = await AccessKeyTransaction.getStatus({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"pending"`)
  })

  test('behavior: returns published for local key without pending authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'signed',
      store,
    })
    AccessKeyStore.removePending({ accessKey: accessKey.accessKeyAddress, store })

    const result = await AccessKeyTransaction.getStatus({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"published"`)
  })

  test('behavior: checks pending authorization before returning pending', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'pending',
      store,
    })

    const result = await AccessKeyTransaction.getStatus({
      address: rootAddress,
      chainId: 1,
      client: createMetadataClient(accessKey.accessKeyAddress) as never,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"published"`)
  })

  test('behavior: returns expired for expired local key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address, { expiry: 100 })

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'signed',
      store,
    })

    const result = await AccessKeyTransaction.getStatus({
      address: rootAddress,
      chainId: 1,
      now: 101,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"expired"`)
  })

  test('behavior: returns missing when no local key matches the policy', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address, {
      scopes: [{ address: '0x0000000000000000000000000000000000000abc' }],
    })

    AccessKeyStore.upsertAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      state: 'signed',
      store,
    })

    const result = await AccessKeyTransaction.getStatus({
      address: rootAddress,
      calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"missing"`)
  })
})
