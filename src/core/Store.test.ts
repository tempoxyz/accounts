import { describe, expect, test } from 'vp/test'

import * as Storage from './Storage.js'
import * as Store from './Store.js'

describe('create', () => {
  test('default', () => {
    const store = Store.create({ chainId: 123 })
    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [],
        "activeAccount": 0,
        "chainId": 123,
        "requestQueue": [],
      }
    `)
  })

  test('behavior: setState updates state', () => {
    const store = Store.create({ chainId: 123 })

    store.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
    })

    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 123,
        "requestQueue": [],
      }
    `)
  })

  test('behavior: subscribe fires on state change', () => {
    const store = Store.create({ chainId: 123 })
    const events: number[] = []

    store.subscribe((state) => events.push(state.chainId))
    store.setState({ chainId: 456 })

    expect(events).toMatchInlineSnapshot(`
      [
        456,
      ]
    `)
  })

  test('behavior: subscribeWithSelector for granular subscriptions', () => {
    const store = Store.create({ chainId: 123 })
    const chainIds: number[] = []

    store.subscribe(
      (state) => state.chainId,
      (chainId) => chainIds.push(chainId),
    )

    store.setState({ chainId: 456 })
    expect(chainIds).toMatchInlineSnapshot(`
      [
        456,
      ]
    `)

    // Changing accounts does NOT trigger the chainId subscription
    store.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
    })
    expect(chainIds).toMatchInlineSnapshot(`
      [
        456,
      ]
    `)
  })
})

describe('serialize', () => {
  test('default: returns the persisted refresh snapshot', () => {
    const result = Store.serialize({
      accessKeys: [
        {
          access: '0x0000000000000000000000000000000000000001',
          address: '0x0000000000000000000000000000000000000099',
          chainId: 123,
          keyType: 'secp256k1',
          privateKey: '0x1234',
        },
      ],
      accounts: [
        { address: '0x0000000000000000000000000000000000000001' },
        { address: '0x0000000000000000000000000000000000000002' },
      ],
      activeAccount: 1,
      auth: { logout: 'https://example.com/logout' },
      chainId: 123,
      requestQueue: [
        {
          request: { method: 'eth_accounts' } as never,
          status: 'pending',
        },
      ],
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "accessKeys": [
          {
            "access": "0x0000000000000000000000000000000000000001",
            "address": "0x0000000000000000000000000000000000000099",
            "chainId": 123,
            "keyType": "secp256k1",
            "privateKey": "0x1234",
          },
        ],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
          {
            "address": "0x0000000000000000000000000000000000000002",
          },
        ],
        "activeAccount": 1,
        "auth": {
          "logout": "https://example.com/logout",
        },
        "chainId": 123,
      }
    `)
  })

  test('behavior: limits persisted accounts', () => {
    const result = Store.serialize(
      {
        accessKeys: [],
        accounts: [
          { address: '0x0000000000000000000000000000000000000001' },
          { address: '0x0000000000000000000000000000000000000002' },
        ],
        activeAccount: 0,
        chainId: 123,
        requestQueue: [],
      },
      { maxAccounts: 1 },
    )

    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000001",
        },
      ]
    `)
  })

  test('behavior: skips access keys when credential persistence is disabled', () => {
    const result = Store.serialize(
      {
        accessKeys: [
          {
            access: '0x0000000000000000000000000000000000000001',
            address: '0x0000000000000000000000000000000000000099',
            chainId: 123,
            keyType: 'secp256k1',
            privateKey: '0x1234',
          },
        ],
        accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
        activeAccount: 0,
        chainId: 123,
        requestQueue: [],
      },
      { persistCredentials: false },
    )

    expect(result).toMatchInlineSnapshot(`
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
})

describe('hydrate', () => {
  test('behavior: restores persisted state with runtime-only request queue', () => {
    const current: Store.State = {
      accessKeys: [],
      accounts: [],
      activeAccount: 0,
      chainId: 123,
      requestQueue: [
        {
          request: { method: 'eth_accounts' } as never,
          status: 'pending',
        },
      ],
    }

    const result = Store.hydrate(
      {
        accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
        chainId: 456,
      },
      current,
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 456,
        "requestQueue": [
          {
            "request": {
              "method": "eth_accounts",
            },
            "status": "pending",
          },
        ],
      }
    `)
  })

  test('behavior: preserves in-memory account credentials when persisted accounts are redacted', () => {
    const current: Store.State = {
      accessKeys: [],
      accounts: [
        {
          address: '0x0000000000000000000000000000000000000001',
          keyType: 'secp256k1',
          privateKey: '0x1234',
        },
      ],
      activeAccount: 0,
      chainId: 123,
      requestQueue: [],
    }

    const result = Store.hydrate(
      {
        accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
        chainId: 456,
      },
      current,
    )

    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000001",
          "keyType": "secp256k1",
          "privateKey": "0x1234",
        },
      ]
    `)
  })

  test('behavior: drops legacy access key without chain context', () => {
    const current: Store.State = {
      accessKeys: [],
      accounts: [],
      activeAccount: 0,
      chainId: 123,
      requestQueue: [],
    }

    const result = Store.hydrate(
      {
        accessKeys: [
          {
            access: '0x0000000000000000000000000000000000000001',
            address: '0x0000000000000000000000000000000000000099',
            keyType: 'webCrypto',
            keyPair: {} as any,
          },
        ],
      },
      current,
    )

    expect(result.accessKeys).toMatchInlineSnapshot(`[]`)
  })
})

describe('persistence', () => {
  test('default: persists accounts, activeAccount, and chainId to storage', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store)

    store.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      activeAccount: 1,
      chainId: 456,
    })

    const raw = storage.getItem('store') as any
    expect(raw.state).toMatchInlineSnapshot(`
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

    const store1 = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store1)

    store1.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      activeAccount: 0,
      chainId: 456,
    })

    const store2 = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store2)

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
        "requestQueue": [],
      }
    `)
  })

  test('behavior: persists accessKeys to storage', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store)

    store.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      accessKeys: [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: '0x0000000000000000000000000000000000000001',
          chainId: 123,
          keyType: 'webCrypto',
          keyPair: {} as any,
        },
      ],
    })

    const raw = storage.getItem('store') as any
    expect(raw.state.accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000099",
          "chainId": 123,
          "keyPair": {},
          "keyType": "webCrypto",
        },
      ]
    `)
  })

  test('behavior: hydrates accessKeys from storage', async () => {
    const storage = Storage.memory()

    const store1 = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store1)

    store1.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      accessKeys: [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: '0x0000000000000000000000000000000000000001',
          chainId: 123,
          expiry: 9999999999,
          limits: [{ token: '0x0000000000000000000000000000000000000abc', limit: 500n }],
          keyType: 'webCrypto',
          keyPair: {} as any,
        },
      ],
    })

    const store2 = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store2)

    expect(store2.getState().accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x0000000000000000000000000000000000000001",
          "address": "0x0000000000000000000000000000000000000099",
          "chainId": 123,
          "expiry": 9999999999,
          "keyPair": {},
          "keyType": "webCrypto",
          "limits": [
            {
              "limit": 500n,
              "token": "0x0000000000000000000000000000000000000abc",
            },
          ],
        },
      ]
    `)
  })

  test('behavior: disconnect clears accessKeys', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store)

    store.setState({
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      accessKeys: [
        {
          address: '0x0000000000000000000000000000000000000099',
          access: '0x0000000000000000000000000000000000000001',
          chainId: 123,
          keyType: 'webCrypto',
          keyPair: {} as any,
        },
      ],
    })

    store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: custom storage key', async () => {
    const storage = Storage.memory({ key: 'custom' })
    const store = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store)

    store.setState({ chainId: 789 })

    const raw = storage.getItem('store') as any
    expect(raw.state.chainId).toMatchInlineSnapshot(`789`)
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
        "requestQueue": [],
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
