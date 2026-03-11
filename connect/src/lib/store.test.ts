import { describe, expect, test } from 'vitest'

import * as Store from './store.js'

describe('Store.create', () => {
  test('default: initializes with empty state', () => {
    const store = Store.create()

    expect(store.getState()).toMatchInlineSnapshot(`
      {
        "mode": undefined,
        "referrer": undefined,
        "requests": [],
      }
    `)
  })

  test('behavior: setState merges partial state', () => {
    const store = Store.create()

    store.setState({ mode: 'iframe' })
    expect(store.getState().mode).toMatchInlineSnapshot(`"iframe"`)
    expect(store.getState().requests).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: setState accepts updater function', () => {
    const store = Store.create()

    store.setState({ requests: [{ id: 1, jsonrpc: '2.0', method: 'eth_accounts', status: 'pending' }] })
    store.setState((s) => ({
      requests: s.requests.map((r) => ({ ...r, status: 'responded' as const })),
    }))

    expect(store.getState().requests[0]!.status).toMatchInlineSnapshot(`"responded"`)
  })

  test('behavior: subscribe notifies on state change', () => {
    const store = Store.create()
    const states: Store.State[] = []

    store.subscribe((s) => states.push(s))
    store.setState({ mode: 'popup' })
    store.setState({ referrer: { title: 'My App' } })

    expect(states).toHaveLength(2)
    expect(states[0]!.mode).toMatchInlineSnapshot(`"popup"`)
    expect(states[1]!.referrer).toMatchInlineSnapshot(`
      {
        "title": "My App",
      }
    `)
  })

  test('behavior: unsubscribe stops notifications', () => {
    const store = Store.create()
    const states: Store.State[] = []

    const unsub = store.subscribe((s) => states.push(s))
    store.setState({ mode: 'iframe' })
    unsub()
    store.setState({ mode: 'popup' })

    expect(states).toHaveLength(1)
  })
})
