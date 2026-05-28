import { Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { BaseError, encodeErrorResult, encodeFunctionResult } from 'viem'
import { Abis, Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import * as AccessKeyTransaction from './internal/AccessKeyTransaction.js'
import * as Store from './Store.js'

function createStore() {
  return Store.create({ chainId: 1 })
}

const rootAddress = accounts[0]!.address

function createKeyAuthorization(
  address: `0x${string}`,
  options: {
    chainId?: bigint | undefined
    expiry?: number | undefined
    limits?: { token: `0x${string}`; limit: bigint }[] | undefined
    scopes?: KeyAuthorization.Scope[] | undefined
  } = {},
) {
  return KeyAuthorization.from(
    {
      address,
      chainId: options.chainId ?? 1n,
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
  options: { isRevoked?: boolean | undefined; keyId?: Hex.Hex | undefined } = {},
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
          keyId: options.keyId ?? accessKey,
          signatureType: 1,
        },
      } as never),
    }),
  }
}

function createMissingClient() {
  return {
    call: async () => {
      throw createRevert('KeyNotFound')
    },
  }
}

function addAuthorization(options: {
  address: `0x${string}`
  keyAuthorization: KeyAuthorization.Signed
  keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
  privateKey?: Hex.Hex | undefined
  store: Store.Store
}) {
  const { address, keyAuthorization, keyPair, privateKey, store } = options
  AccessKey.add({
    account: address,
    authorization: keyAuthorization,
    ...(keyPair ? { keyPair } : {}),
    ...(privateKey ? { privateKey } : {}),
    store,
  })
}

function removeStoredAuthorization(options: {
  accessKey: `0x${string}`
  address?: `0x${string}` | undefined
  chainId?: number | undefined
  store: Store.Store
}) {
  const { accessKey, store } = options
  const account = options.address ?? rootAddress
  const chainId = options.chainId ?? 1
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((key) =>
      key.address.toLowerCase() === accessKey.toLowerCase() &&
      key.access.toLowerCase() === account.toLowerCase() &&
      key.chainId === chainId
        ? { ...key, keyAuthorization: undefined }
        : key,
    ),
  }))
}

describe('add', () => {
  test('default: saves a signed authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const limits = [{ token: '0x20c0000000000000000000000000000000000001' as const, limit: 1000n }]
    const keyAuthorization = createKeyAuthorization(accessKey.address, { expiry, limits })

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      store,
    })

    const { accessKeys } = store.getState()
    expect(accessKeys.length).toMatchInlineSnapshot(`1`)
    expect(accessKeys[0]!.address).toBe(accessKey.address)
    expect(accessKeys[0]!.access).toBe(rootAddress)
    expect(accessKeys[0]!.chainId).toMatchInlineSnapshot(`1`)
    expect(accessKeys[0]!.expiry).toBe(expiry)
    expect(accessKeys[0]!.keyType).toMatchInlineSnapshot(`"p256"`)
    expect(accessKeys[0]!.keyAuthorization).toBe(keyAuthorization)
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

describe('create invalidation', () => {
  async function setup(options: { other?: boolean | undefined } = {}) {
    const store = createStore()
    const keyPair_other = await WebCryptoP256.createKeyPair()
    const account_other = TempoAccount.fromWebCryptoP256(keyPair_other, { access: rootAddress })
    if (options.other)
      addAuthorization({
        address: rootAddress,
        keyAuthorization: createKeyAuthorization(account_other.accessKeyAddress),
        keyPair: keyPair_other,
        store,
      })

    const keyPair = await WebCryptoP256.createKeyPair()
    const account = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    addAuthorization({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(account.accessKeyAddress),
      keyPair,
      store,
    })
    return { account_other, store }
  }

  test('behavior: removes selected access key for stale-key errors', async () => {
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

    await expect(transaction?.fill({ chainId: 1, from: rootAddress })).rejects.toThrowError()
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
    expect(
      store.getState().accessKeys.some((key) => key.address === account_other.accessKeyAddress),
    ).toMatchInlineSnapshot(`true`)
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

    await expect(transaction?.fill({ chainId: 1, from: rootAddress })).rejects.toThrowError()
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

    await expect(transaction?.fill({ chainId: 1, from: rootAddress })).rejects.toThrowError()
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })
})

describe('isUnavailableError', () => {
  test('default: recognizes unavailable key revert errors', () => {
    expect(AccessKey.isUnavailableError(createRevert('KeyNotFound'))).toMatchInlineSnapshot(`true`)
    expect(AccessKey.isUnavailableError(createRevert('KeyAlreadyRevoked'))).toMatchInlineSnapshot(
      `true`,
    )
    expect(
      AccessKey.isUnavailableError(createRevert('SpendingLimitExceeded')),
    ).toMatchInlineSnapshot(`false`)
  })

  test('behavior: recognizes nested viem error data', () => {
    const error = new BaseError('revoke failed', {
      cause: Object.assign(new Error('execution reverted'), {
        data: { errorName: 'KeyAlreadyRevoked' },
      }),
    })

    expect(AccessKey.isUnavailableError(error)).toMatchInlineSnapshot(`true`)
  })
})

describe('generate', () => {
  test('default: returns p256 access key and key pair', async () => {
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

  test('error: rejects secp256k1 authorization without external key material', async () => {
    await expect(
      AccessKey.prepareAuthorization({ chainId: 1, expiry: 123, keyType: 'secp256k1' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`keyType: "secp256k1"\` requires externally generated key material; provide \`publicKey\` or \`address\`.]`,
    )
  })

  test('error: rejects webAuthn authorization without external key material', async () => {
    await expect(
      AccessKey.prepareAuthorization({ chainId: 1, expiry: 123, keyType: 'webAuthn' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`keyType: "webAuthn"\` requires externally generated key material; provide \`publicKey\` or \`address\`.]`,
    )
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

  test('behavior: prepares external secp256k1 authorization from public key', async () => {
    const result = await AccessKey.prepareAuthorization({
      chainId: 123n,
      expiry: 456,
      keyType: 'secp256k1',
      publicKey: accounts[1]!.publicKey,
    })

    expect(result.keyPair).toBeUndefined()
    expect(result.keyAuthorization).toMatchInlineSnapshot(`
      {
        "address": "${accounts[1]!.address.toLowerCase()}",
        "chainId": 123n,
        "expiry": 456,
        "limits": undefined,
        "scopes": undefined,
        "type": "secp256k1",
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

    const result = await AccessKey.authorize({
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

describe('select', () => {
  async function setup() {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })

    return { accessKey, keyAuthorization, store }
  }

  test('behavior: skips access keys for another root address', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: accounts[1]!.address })
    addAuthorization({
      address: accounts[1]!.address,
      keyAuthorization: createKeyAuthorization(accessKey.accessKeyAddress),
      keyPair,
      store,
    })

    const result = await AccessKey.select({
      account: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: skips access keys for another chain', async () => {
    const { store } = await setup()

    const result = await AccessKey.select({
      account: rootAddress,
      chainId: 42_431,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: skips external access keys without signer material', async () => {
    const store = createStore()
    const keyAuthorization = createKeyAuthorization('0x0000000000000000000000000000000000000099')
    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      store,
    })

    const result = await AccessKey.select({
      account: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: matches access key scopes against transaction calls', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const token = '0x0000000000000000000000000000000000000abc' as const
    addAuthorization({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(accessKey.accessKeyAddress, {
        scopes: [{ address: token, selector: 'transfer(address,uint256)' }],
      }),
      keyPair,
      store,
    })

    const match = await AccessKey.select({
      account: rootAddress,
      calls: [{ to: token, data: '0xa9059cbb0000000000000000000000000000000000000001' }],
      chainId: 1,
      store,
    })
    const miss = await AccessKey.select({
      account: rootAddress,
      calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
      chainId: 1,
      store,
    })

    expect({ match: !!match, miss: !!miss }).toMatchInlineSnapshot(`
      {
        "match": true,
        "miss": false,
      }
    `)
  })
})

describe('getStatus', () => {
  test('behavior: returns pending while key authorization is stored', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })

    const result = await AccessKey.getStatus({
      account: rootAddress,
      chainId: 1,
      client: createMissingClient() as never,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"pending"`)
  })

  test('behavior: clears stored authorization when local key is published', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })

    const result = await AccessKey.getStatus({
      account: rootAddress,
      chainId: 1,
      client: createMetadataClient(accessKey.address) as never,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"published"`)
    expect(store.getState().accessKeys[0]!.keyAuthorization).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: returns published for local key without stored authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })
    removeStoredAuthorization({ accessKey: accessKey.accessKeyAddress, store })

    const result = await AccessKey.getStatus({
      account: rootAddress,
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

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })

    const result = await AccessKey.getStatus({
      account: rootAddress,
      chainId: 1,
      client: createMetadataClient(accessKey.address) as never,
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

    addAuthorization({
      address: rootAddress,
      keyAuthorization,
      keyPair,
      store,
    })

    const result = await AccessKey.getStatus({
      account: rootAddress,
      calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
      chainId: 1,
      client: createMissingClient() as never,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"missing"`)
  })
})
