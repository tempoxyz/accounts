import { WebCryptoP256 } from 'ox'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { testKeystore } from '../../test/keystore.js'
import { createJsonStorage } from '../../test/utils.js'
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

  test('behavior: persists private key material inline', async () => {
    const { storage, store } = await setup()

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
          "privateKey": "0x1234",
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

  test('behavior: strips structured-clone keystore handles from JSON-backed storage', async () => {
    const storage = createJsonStorage()
    const { store } = await setup({ storage })

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          handle: { kind: 'webcrypto-p256' },
          keyType: 'p256',
          publicKey: '0x1234',
        },
      ],
    })

    const accessKeys = (await getPersistedState(storage))?.accessKeys as Record<string, unknown>[]
    expect('handle' in accessKeys[0]!).toMatchInlineSnapshot(`false`)
  })

  test('behavior: keeps structured-clone keystore handles in structured-clone storage', async () => {
    const { storage, store } = await setup()

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          handle: { kind: 'webcrypto-p256' },
          keyType: 'p256',
          publicKey: '0x1234',
        },
      ],
    })

    const accessKeys = (await getPersistedState(storage))?.accessKeys as Record<string, unknown>[]
    expect('handle' in accessKeys[0]!).toMatchInlineSnapshot(`true`)
  })

  test('behavior: persists json keystore handles inline and rehydrates them', async () => {
    const keystore = testKeystore()
    const keystores = { p256: keystore }
    const key = await keystore.createKey()
    const storage = createJsonStorage()
    const { store } = await setup({ keystores, storage })

    store.setState({
      accessKeys: [
        {
          access: account,
          address: accessKey,
          chainId: 123,
          handle: key.handle,
          keyType: 'p256',
          publicKey: key.publicKey,
        },
      ],
    })

    const persisted = (await getPersistedState(storage))?.accessKeys as Record<string, unknown>[]
    expect(persisted[0]!.handle).toMatchObject({ kind: 'test' })

    const store2 = Store.create({ chainId: 123, keystores, storage })
    await Store.waitForHydration(store2)
    const hydrated = await store2.accessKeys.get({ accessKey, account, chainId: 123 })
    expect(hydrated?.accessKeyAddress).toBeDefined()
    expect(keystore.stats.toAccountCalls).toMatchInlineSnapshot(`1`)
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

  test('behavior: disconnect clears accounts, auth, and access keys', async () => {
    const { store } = await setup({ storage: Storage.memory() })

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

    store.disconnect()

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

  test('behavior: retries changes after a failed transactional update', async () => {
    const memory = Storage.memory()
    let fail = true
    const storage = Storage.withUpdate(
      memory,
      <value>(name: string, update: (value: value | null) => value) => {
        if (fail) {
          fail = false
          throw new Error('write failed')
        }
        const current = memory.getItem<value>(name)
        if (current instanceof Promise) throw new Error('unexpected asynchronous storage')
        memory.setItem(name, update(current))
      },
    )
    const { store } = await setup({ storage })

    expect(() =>
      store.setState({ accounts: [{ address: account }], chainId: 456 }),
    ).toThrowErrorMatchingInlineSnapshot(`[Error: write failed]`)
    store.setState({ chainId: 789 })

    expect(await getPersistedState(storage)).toMatchInlineSnapshot(`
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
