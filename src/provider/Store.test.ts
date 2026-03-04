import { describe, expect, test } from 'vitest'

import * as Storage from './Storage.js'
import * as Store from './Store.js'

describe('create', () => {
  test('default', () => {
    const store = Store.create({ chainId: 123 })
    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "accounts": [],
        "activeAccount": 0,
        "chainId": 123,
        "status": "disconnected",
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
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 123,
        "status": "disconnected",
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

    const raw = storage.getItem('tempo.account') as any
    expect(raw.state).toMatchInlineSnapshot(`
      {
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
      status: 'connected',
    })

    const store2 = Store.create({ chainId: 123, storage })
    await Store.waitForHydration(store2)

    expect(store2.getState()).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 456,
        "status": "disconnected",
      }
    `)
  })

  test('behavior: custom storageKey', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 123, storage, storageKey: 'custom.key' })
    await Store.waitForHydration(store)

    store.setState({ chainId: 789 })

    const raw = storage.getItem('custom.key') as any
    expect(raw.state.chainId).toMatchInlineSnapshot(`789`)
    expect(storage.getItem('tempo.account')).toMatchInlineSnapshot(`null`)
  })
})

describe('waitForHydration', () => {
  test('default: resolves after hydration', async () => {
    const storage = Storage.memory()

    storage.setItem('tempo.account', {
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
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "activeAccount": 0,
        "chainId": 789,
        "status": "disconnected",
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
