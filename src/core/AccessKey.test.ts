import { WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { encodeErrorResult } from 'viem'
import { Abis, Account as TempoAccount, Actions } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
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

describe('save', () => {
  test('default: saves access key to store', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

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

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

    expect(store.getState().accessKeys[0]!.keyPair).toBeUndefined()
  })

  test('behavior: saves with keyPair', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKey.save({ address: rootAddress, keyAuthorization, keyPair, store })

    expect(store.getState().accessKeys[0]!.keyPair).toBe(keyPair)
  })

  test('behavior: appends to existing access keys', async () => {
    const store = createStore()
    const keyPair1 = await WebCryptoP256.createKeyPair()
    const keyPair2 = await WebCryptoP256.createKeyPair()
    const ak1 = TempoAccount.fromWebCryptoP256(keyPair1)
    const ak2 = TempoAccount.fromWebCryptoP256(keyPair2)

    AccessKey.save({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(ak1.address),
      store,
    })
    AccessKey.save({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(ak2.address),
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

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

    expect(store.getState().accessKeys[0]!.expiry).toBe(expiry)
  })

  test('behavior: stores limits from key authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const limits = [{ token: '0x20c0000000000000000000000000000000000001' as const, limit: 1000n }]
    const keyAuthorization = createKeyAuthorization(accessKey.address, { limits })

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

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

describe('getPending', () => {
  test('default: returns key authorization for access key account', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

    const result = AccessKey.getPending(accessKey, { store })
    expect(result).toBe(keyAuthorization)
  })

  test('behavior: returns undefined for root account', () => {
    const store = createStore()
    const result = AccessKey.getPending(accounts[0]!, { store })
    expect(result).toBeUndefined()
  })

  test('behavior: returns undefined when no matching access key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })

    const result = AccessKey.getPending(accessKey, { store })
    expect(result).toBeUndefined()
  })
})

describe('removePending', () => {
  test('default: clears key authorization from access key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKey.save({ address: rootAddress, keyAuthorization, store })
    expect(AccessKey.getPending(accessKey, { store })).toBeDefined()

    AccessKey.removePending(accessKey, { store })

    expect(AccessKey.getPending(accessKey, { store })).toBeUndefined()
  })

  test('behavior: no-op for root account', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    const keyAuthorization = createKeyAuthorization(accessKey.accessKeyAddress)

    AccessKey.save({ address: rootAddress, keyAuthorization, store })

    AccessKey.removePending(accounts[0]!, { store })

    expect(AccessKey.getPending(accessKey, { store })).toBeDefined()
  })

  test('behavior: does not affect other access keys', async () => {
    const store = createStore()
    const keyPair1 = await WebCryptoP256.createKeyPair()
    const keyPair2 = await WebCryptoP256.createKeyPair()
    const ak1 = TempoAccount.fromWebCryptoP256(keyPair1, { access: rootAddress })
    const ak2 = TempoAccount.fromWebCryptoP256(keyPair2, { access: rootAddress })
    const ka1 = createKeyAuthorization(ak1.accessKeyAddress)
    const ka2 = createKeyAuthorization(ak2.accessKeyAddress)

    AccessKey.save({ address: rootAddress, keyAuthorization: ka1, store })
    AccessKey.save({ address: rootAddress, keyAuthorization: ka2, store })

    AccessKey.removePending(ak1, { store })

    expect(AccessKey.getPending(ak1, { store })).toBeUndefined()
    expect(AccessKey.getPending(ak2, { store })).toBe(ka2)
  })
})

describe('invalidate', () => {
  async function setup() {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const account = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    AccessKey.save({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(account.accessKeyAddress),
      keyPair,
      store,
    })
    return { account, store }
  }

  test('default: removes matching access key for stale-key errors', async () => {
    const { account, store } = await setup()
    const keyPair = await WebCryptoP256.createKeyPair()
    const account_other = TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress })
    AccessKey.save({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(account_other.accessKeyAddress),
      keyPair,
      store,
    })

    const result = AccessKey.invalidate(account, createRevert('KeyNotFound'), { store })

    expect(result).toMatchInlineSnapshot(`true`)
    expect(store.getState().accessKeys.map((key) => key.address)).toMatchInlineSnapshot(`
      [
        "${account_other.accessKeyAddress}",
      ]
    `)
  })

  test('behavior: preserves access key for recoverable execution errors', async () => {
    const { account, store } = await setup()

    const result = AccessKey.invalidate(account, createRevert('SpendingLimitExceeded'), {
      store,
    })

    expect(result).toMatchInlineSnapshot(`false`)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })

  test('behavior: preserves access key for unknown errors', async () => {
    const { account, store } = await setup()

    const result = AccessKey.invalidate(account, new Error('network failed'), { store })

    expect(result).toMatchInlineSnapshot(`false`)
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
  })

  test('behavior: no-op for root accounts', () => {
    const store = createStore()

    const result = AccessKey.invalidate(accounts[0]!, createRevert('KeyNotFound'), { store })

    expect(result).toMatchInlineSnapshot(`false`)
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

describe('prepare', () => {
  test('default: prepares generated p256 key authorization', async () => {
    const result = await AccessKey.prepare({ chainId: 1, expiry: 123 })

    expect(result.keyAuthorization.address).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(result.keyAuthorization.chainId).toMatchInlineSnapshot(`1n`)
    expect(result.keyAuthorization.expiry).toMatchInlineSnapshot(`123`)
    expect(result.keyAuthorization.type).toMatchInlineSnapshot(`"p256"`)
    expect(result.keyPair).toBeDefined()
  })

  test('behavior: prepares external key authorization from address', async () => {
    const result = await AccessKey.prepare({
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

    const result = await AccessKey.prepare({
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
    const result = await AccessKey.prepare({
      address: accounts[1]!.address,
      chainId: 1,
      expiry: 123,
    })

    expect(result.keyAuthorization.type).toMatchInlineSnapshot(`"secp256k1"`)
  })
})

describe('hydrate', () => {
  test('default: hydrates webCrypto access key to signable account', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const result = AccessKey.hydrate({
      access: rootAddress,
      address: '0x0000000000000000000000000000000000000099',
      chainId: 1,
      keyPair,
      keyType: 'webCrypto',
    })

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('behavior: hydrates private-key access key to signable account', () => {
    const result = AccessKey.hydrate({
      access: rootAddress,
      address: accounts[1]!.address,
      chainId: 1,
      keyType: 'secp256k1',
      privateKey: privateKeys[1],
    })

    expect(result.type).toMatchInlineSnapshot(`"local"`)
    expect(typeof result.sign).toMatchInlineSnapshot(`"function"`)
    expect(result.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('error: throws for external access key without signer material', () => {
    expect(() =>
      AccessKey.hydrate({
        access: rootAddress,
        address: '0x0000000000000000000000000000000000000099',
        chainId: 1,
        keyType: 'p256',
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: External access key cannot be hydrated for signing.]`,
    )
  })
})

describe('selectAccount', () => {
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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 42_431, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({
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

    const result = AccessKey.selectAccount({ address: rootAddress, chainId: 1, store })

    expect(result).toMatchInlineSnapshot(`undefined`)
  })
})

describe('getStatus', () => {
  test('behavior: returns pending for locally stored key authorization', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKey.save({ address: rootAddress, keyAuthorization, keyPair, store })

    const result = await AccessKey.getStatus({
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

    AccessKey.save({ address: rootAddress, keyAuthorization, keyPair, store })
    AccessKey.removePending(accessKey, { store })

    const result = await AccessKey.getStatus({
      address: rootAddress,
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"published"`)
  })

  test('behavior: returns expired for expired local key', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address, { expiry: 100 })

    AccessKey.save({ address: rootAddress, keyAuthorization, keyPair, store })

    const result = await AccessKey.getStatus({
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

    AccessKey.save({ address: rootAddress, keyAuthorization, keyPair, store })

    const result = await AccessKey.getStatus({
      address: rootAddress,
      calls: [{ to: '0x0000000000000000000000000000000000000def', data: '0xdeadbeef' }],
      chainId: 1,
      store,
    })

    expect(result).toMatchInlineSnapshot(`"missing"`)
  })
})

describe('revoke', () => {
  test('default: removes access keys by root address', async () => {
    const store = createStore()
    const keyPair = await WebCryptoP256.createKeyPair()
    const accessKey = TempoAccount.fromWebCryptoP256(keyPair)
    const keyAuthorization = createKeyAuthorization(accessKey.address)

    AccessKey.save({ address: rootAddress, keyAuthorization, store })
    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)

    AccessKey.revoke({ address: rootAddress, store })

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: only removes keys for matching root address', async () => {
    const store = createStore()
    const otherRoot = accounts[1]!.address
    const keyPair1 = await WebCryptoP256.createKeyPair()
    const keyPair2 = await WebCryptoP256.createKeyPair()
    const ak1 = TempoAccount.fromWebCryptoP256(keyPair1)
    const ak2 = TempoAccount.fromWebCryptoP256(keyPair2)

    AccessKey.save({
      address: rootAddress,
      keyAuthorization: createKeyAuthorization(ak1.address),
      store,
    })
    AccessKey.save({
      address: otherRoot,
      keyAuthorization: createKeyAuthorization(ak2.address),
      store,
    })

    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`2`)

    AccessKey.revoke({ address: rootAddress, store })

    expect(store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
    expect(store.getState().accessKeys[0]!.access).toBe(otherRoot)
  })
})
