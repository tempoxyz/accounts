import { WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as Storage from './Storage.js'
import * as Store from './Store.js'
import * as u from './zod/utils.js'

const secp256k1Account = z.object({
  address: u.address(),
  keyType: z.literal('secp256k1'),
  privateKey: u.hex(),
})

const account = '0x0000000000000000000000000000000000000001'
const account2 = '0x0000000000000000000000000000000000000002'
const accessKey = '0x0000000000000000000000000000000000000099'
const privateKey = '0x1234'
const privateKey_signer = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

async function setup(options: Omit<Store.Options, 'chainId'> = {}) {
  const storage = options.storage ?? Storage.memory()
  const store = Store.create({ chainId: 123, ...options, storage })
  await Store.waitForHydration(store)
  return { storage, store }
}

async function getPersistedState(storage: Storage.Storage) {
  const persisted = await storage.getItem<{ state: Record<string, unknown> }>('store')
  return persisted?.state
}

function createJsonStorage() {
  const items = new Map<string, unknown>()
  return Storage.from({
    getItem<value>(name: string) {
      return (items.get(name) as value) ?? null
    },
    removeItem(name: string) {
      items.delete(name)
    },
    setItem(name: string, value: unknown) {
      items.set(name, value)
    },
  })
}

function createAuthorization() {
  return KeyAuthorization.from(
    {
      address: accessKey,
      chainId: 123n,
      type: 'secp256k1',
    },
    { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
  )
}

describe('create', () => {
  test('default', () => {
    const store = Store.create({ chainId: 123 })
    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [],
        "activeAccount": 0,
        "chainId": 123,
      }
    `)
  })
})

describe('persistence', () => {
  test('default: persists accounts, activeAccount, and chainId to storage', async () => {
    const { storage, store } = await setup()

    store.setState({
      accounts: [{ address: account }],
      activeAccount: 1,
      chainId: 456,
    })

    expect(await getPersistedState(storage)).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 1,
        "chainId": 456,
      }
    `)
  })

  test('behavior: hydrates from storage', async () => {
    const storage = Storage.memory()

    const { store: store1 } = await setup({ storage })

    store1.setState({
      accounts: [{ address: account }],
      activeAccount: 0,
      chainId: 456,
    })

    const { store: store2 } = await setup({ storage })

    expect(store2.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 456,
      }
    `)
  })

  test('behavior: filters stored accounts with the adapter restore guard', async () => {
    const storage = Storage.memory()
    storage.setItem('store', {
      state: {
        accounts: [
          { address: account },
          {
            address: account2,
            keyType: 'secp256k1',
            privateKey,
          },
        ],
        activeAccount: 1,
        chainId: 456,
      },
      version: 0,
    })

    const { store } = await setup({
      schema: secp256k1Account,
      storage,
    })

    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000002",
            "keyType": "secp256k1",
            "privateKey": "0x1234",
          },
        ],
        "activeAccount": 0,
        "chainId": 456,
      }
    `)
  })

  test('behavior: preserves in-memory account credentials during hydration', async () => {
    let resolve!: () => void
    const hydration = new Promise<void>((r) => (resolve = r))
    const storage = {
      async getItem<value>(name: string) {
        await hydration
        if (name !== 'store') return null
        return {
          state: {
            accounts: [{ address: account }],
            activeAccount: 0,
            chainId: 456,
          },
          version: 0,
        } as value
      },
      removeItem() {},
      setItem() {},
    } satisfies Storage.Storage

    const store = Store.create({ chainId: 123, storage })
    store.setState({
      accounts: [
        {
          address: account,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
    })
    resolve()
    await Store.waitForHydration(store)

    expect(store.getState().accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000001",
          "keyType": "secp256k1",
          "privateKey": "0x1234",
        },
      ]
    `)
  })

  test('behavior: hydrates accessKeys from storage', async () => {
    const storage = Storage.memory()

    const { store: store1 } = await setup({ storage })

    store1.setState({
      accounts: [{ address: account }],
      accessKeys: [
        {
          address: accessKey,
          access: account,
          chainId: 123,
          expiry: 9999999999,
          limits: [{ token: '0x0000000000000000000000000000000000000abc', limit: 500n }],
          keyType: 'secp256k1',
          privateKey,
        },
      ],
    })

    const { store: store2 } = await setup({ storage })

    expect(store2.getState().accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000099",
          "chainId": 123,
          "expiry": 9999999999,
          "keyType": "secp256k1",
          "limits": [
            {
              "limit": 500n,
              "token": "0x0000000000000000000000000000000000000abc",
            },
          ],
          "privateKey": "0x1234",
        },
      ]
    `)
  })

  test('behavior: limits persisted accounts', async () => {
    const { storage, store } = await setup({ maxAccounts: 1 })

    store.setState({
      accounts: [{ address: account }, { address: account2 }],
    })

    expect((await getPersistedState(storage))?.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000001",
        },
      ]
    `)
  })

  test('behavior: skips access keys when credential persistence is disabled', async () => {
    const { storage, store } = await setup({ persistCredentials: false })

    store.setState({
      accounts: [{ address: account }],
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
    })

    expect(await getPersistedState(storage)).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 123,
      }
    `)
  })

  test('behavior: skips access key material storage when credential persistence is disabled', async () => {
    const writes: string[] = []
    const keyMaterialStorage = {
      getItem() {
        return null
      },
      removeItem() {},
      setItem(name: string) {
        writes.push(name)
      },
    } satisfies Storage.Storage
    const { store } = await setup({
      keyMaterialStorage,
      persistCredentials: false,
    })

    await store.accessKeys.add({
      account,
      authorization: createAuthorization(),
      privateKey: privateKey_signer,
    })

    expect(writes).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: strips material when key material storage is split out', async () => {
    const { storage, store } = await setup({
      keyMaterialStorage: Storage.memory(),
    })

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
    })

    expect((await getPersistedState(storage))?.accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000099",
          "chainId": 123,
          "keyType": "secp256k1",
        },
      ]
    `)
  })

  test('behavior: strips WebCrypto key pairs from JSON-backed storage', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const storage = createJsonStorage()
    const { store } = await setup({ storage })

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          keyPair,
          keyType: 'webCrypto',
        },
      ],
    })

    expect((await getPersistedState(storage))?.accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000099",
          "chainId": 123,
          "keyType": "webCrypto",
        },
      ]
    `)
  })

  test('behavior: keeps WebCrypto key pairs in structured-clone storage', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const { storage, store } = await setup()

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          keyPair,
          keyType: 'webCrypto',
        },
      ],
    })

    const accessKeys = (await getPersistedState(storage))?.accessKeys as Record<string, unknown>[]
    expect('keyPair' in accessKeys[0]!).toMatchInlineSnapshot(`true`)
  })

  test('behavior: keeps WebCrypto key pairs inline when key material storage is present', async () => {
    const keyPair = await WebCryptoP256.createKeyPair()
    const { storage, store } = await setup({
      keyMaterialStorage: Storage.memory(),
    })

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          keyPair,
          keyType: 'webCrypto',
        },
      ],
    })

    const accessKeys = (await getPersistedState(storage))?.accessKeys as Record<string, unknown>[]
    expect('keyPair' in accessKeys[0]!).toMatchInlineSnapshot(`true`)
  })

  test('behavior: drops legacy access key without chain context', async () => {
    const storage = Storage.memory()
    storage.setItem('store', {
      state: {
        accessKeys: [
          {
            access: account,
            address: accessKey,
            keyPair: {},
            keyType: 'webCrypto',
          },
        ],
      },
      version: 0,
    })

    const { store } = await setup({ storage })

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: disconnect clears accounts, auth, and access key material', async () => {
    const removed: string[] = []
    const keyMaterialStorage = {
      getItem() {
        return null
      },
      async removeItem(name: string) {
        removed.push(name)
      },
      async setItem() {},
    } satisfies Storage.Storage
    const { store } = await setup({
      keyMaterialStorage,
      storage: Storage.memory(),
    })

    store.setState({
      accounts: [{ address: account }],
      accessKeys: [
        {
          address: accessKey,
          access: account,
          chainId: 123,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
      auth: { logout: 'https://example.com/logout' },
    })

    await store.disconnect()

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
    expect(store.getState().auth).toMatchInlineSnapshot(`undefined`)
    expect(removed).toMatchInlineSnapshot(`
      [
        "accessKeyMaterial.0x0000000000000000000000000000000000000001.123.0x0000000000000000000000000000000000000099",
      ]
    `)
  })

  test('behavior: disconnect clears account state when key material removal fails', async () => {
    const keyMaterialStorage = {
      getItem() {
        return null
      },
      async removeItem() {
        throw new Error('remove failed')
      },
      async setItem() {},
    } satisfies Storage.Storage
    const { store } = await setup({
      keyMaterialStorage,
      storage: Storage.memory(),
    })

    store.setState({
      accounts: [{ address: account }],
      accessKeys: [
        {
          address: accessKey,
          access: account,
          chainId: 123,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
      auth: { logout: 'https://example.com/logout' },
    })

    await store.disconnect()

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
    expect(store.getState().auth).toMatchInlineSnapshot(`undefined`)
  })

  test('behavior: custom storage key', async () => {
    const storage = Storage.memory({ key: 'custom' })
    const { store } = await setup({ storage })

    store.setState({ chainId: 789 })

    expect((await getPersistedState(storage))?.chainId).toMatchInlineSnapshot(`789`)
  })

  test('behavior: custom storage key scopes access key material', async () => {
    const material = Storage.memory()
    const storage = Storage.memory()
    const storageA = Storage.from(material, { key: 'a' })
    const storageB = Storage.from(material, { key: 'b' })
    const { store: storeA } = await setup({
      keyMaterialStorage: storageA,
      storage,
    })

    await storeA.accessKeys.add({
      account,
      authorization: createAuthorization(),
      privateKey: privateKey_signer,
    })

    const { store: storeA2 } = await setup({ keyMaterialStorage: storageA, storage })
    const { store: storeB } = await setup({ keyMaterialStorage: storageB, storage })

    const key = {
      accessKey,
      account,
      chainId: 123,
    } as const
    expect(typeof (await storeA2.accessKeys.get(key))?.sign).toMatchInlineSnapshot(`"function"`)
    expect(await storeB.accessKeys.get(key)).toMatchInlineSnapshot(`undefined`)
  })
})

describe('waitForHydration', () => {
  test('default: resolves after hydration', async () => {
    const storage = Storage.memory()

    storage.setItem('store', {
      state: {
        accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
        activeAccount: 0,
        chainId: 789,
      },
      version: 0,
    })

    const store = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store)

    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 789,
      }
    `)
  })

  test('behavior: resolves multiple times', async () => {
    const store = Store.create({ chainId: 123 })

    await Store.waitForHydration(store)
    await Store.waitForHydration(store)

    expect(store.getState().chainId).toMatchInlineSnapshot(`123`)
  })
})
