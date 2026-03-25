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
