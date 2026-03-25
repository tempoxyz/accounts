import { WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import * as Store from './Store.js'

function createStore() {
  return Store.create({ chainId: 1 })
}

const rootAddress = accounts[0]!.address

function createKeyAuthorization(
  address: `0x${string}`,
  options: { expiry?: number | undefined; limits?: { token: `0x${string}`; limit: bigint }[] } = {},
) {
  return KeyAuthorization.from(
    {
      address,
      chainId: 1n,
      expiry: options.expiry,
      limits: options.limits,
      type: 'p256',
    },
    { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
  )
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
