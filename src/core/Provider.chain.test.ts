import { Hex } from 'ox'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'
const address_other = '0x0000000000000000000000000000000000000002'
const chain_custom = { ...tempo, id: 12345, name: 'Custom Tempo' }

const fetch_mock = vi.fn(() => {
  throw new Error('Unexpected network request')
})

beforeEach(() => {
  fetch_mock.mockClear()
  vi.stubGlobal('fetch', fetch_mock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(fetch_mock).not.toHaveBeenCalled()
})

describe('wallet_connect chain validation', () => {
  test.each(['login', 'register'] as const)(
    'rejects an unconfigured chain before changing the session or starting %s',
    async (method) => {
      const createAccount = vi.fn(async () => ({ accounts: [{ address }] as const }))
      const loadAccounts = vi.fn(async () => ({ accounts: [{ address }] as const }))
      const authorize = vi.fn(() => undefined)
      const provider = Provider.create({
        adapter: Adapter.define({ name: 'Test', rdns: 'test' }, () => ({
          actions: { createAccount, loadAccounts },
        })),
        authorizeAccessKey: authorize,
        chains: [tempo, tempoModerato],
        storage: Storage.memory(),
      })
      await provider.ready()
      provider.store.setState({
        accounts: [{ address }, { address: address_other }],
        activeAccount: 1,
        chainId: tempoModerato.id,
      })
      const state = provider.store.getState()
      const changed = vi.fn()
      provider.on('chainChanged', changed)
      provider.on('accountsChanged', changed)

      const request = provider.request({
        method: 'wallet_connect',
        params: [{ chainId: '0x1', capabilities: { method } }],
      })
      await expect(request).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedChainIdError: Chain 1 not configured.]`,
      )
      await expect(request).rejects.toHaveProperty('code', 5710)
      expect(provider.store.getState()).toBe(state)
      expect(provider.getAccount()).toMatchInlineSnapshot(`
        {
          "address": "0x0000000000000000000000000000000000000002",
          "type": "json-rpc",
        }
      `)
      expect(createAccount).not.toHaveBeenCalled()
      expect(loadAccounts).not.toHaveBeenCalled()
      expect(authorize).not.toHaveBeenCalled()
      expect(changed).not.toHaveBeenCalled()
    },
  )

  test.each([
    { name: 'current chain', chain: undefined },
    { name: 'Moderato', chain: tempoModerato },
    { name: 'custom chain', chain: chain_custom },
  ])('connects with $name', async ({ chain }) => {
    const loadAccounts = vi.fn(async () => ({ accounts: [{ address }] as const }))
    const provider = Provider.create({
      adapter: Adapter.define({ name: 'Test', rdns: 'test' }, () => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address }] }
          },
          loadAccounts,
        },
      })),
      chains: [tempo, tempoModerato, chain_custom],
      storage: Storage.memory(),
    })
    await provider.ready()
    provider.store.setState({ chainId: tempoModerato.id })
    const changed = vi.fn()
    provider.on('chainChanged', changed)

    const result = await provider.request({
      method: 'wallet_connect',
      ...(chain ? { params: [{ chainId: Hex.fromNumber(chain.id) }] } : {}),
    })
    expect(result).toMatchInlineSnapshot(`
        {
          "accounts": [
            {
              "address": "0x0000000000000000000000000000000000000001",
              "capabilities": {},
            },
          ],
        }
      `)
    expect(provider.store.getState().chainId).toBe(chain?.id ?? tempoModerato.id)
    expect(provider.getAccount()).toMatchInlineSnapshot(`
        {
          "address": "0x0000000000000000000000000000000000000001",
          "type": "json-rpc",
        }
      `)
    expect(loadAccounts).toHaveBeenCalledTimes(1)
    if (chain && chain.id !== tempoModerato.id)
      expect(changed).toHaveBeenCalledWith(Hex.fromNumber(chain.id))
    else expect(changed).not.toHaveBeenCalled()
  })
})

describe('persisted chain validation', () => {
  test.each([
    { name: 'unsupported mainnet selection', chainId: 1, testnet: false, expected: tempo.id },
    {
      name: 'unsupported testnet selection',
      chainId: 1,
      testnet: true,
      expected: tempoModerato.id,
    },
    {
      name: 'supported selection',
      chainId: tempoModerato.id,
      testnet: false,
      expected: tempoModerato.id,
    },
    {
      name: 'custom selection',
      chainId: chain_custom.id,
      testnet: false,
      expected: chain_custom.id,
    },
    { name: 'missing selection', chainId: undefined, testnet: true, expected: tempoModerato.id },
  ])('restores $name', async ({ chainId, expected, testnet }) => {
    const storage = Storage.memory()
    await storage.setItem('store', {
      state: { accounts: [{ address }], activeAccount: 0, chainId },
      version: 0,
    })
    const selected: number[] = []
    const provider = Provider.create({
      adapter: Adapter.define({ name: 'Test', rdns: 'test' }, ({ store }) => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address }] }
          },
          async loadAccounts() {
            selected.push(store.getState().chainId)
            return { accounts: [{ address }] }
          },
        },
      })),
      chains: [tempo, tempoModerato, chain_custom],
      storage,
      testnet,
    })
    await provider.ready()
    expect(provider.store.getState()).toEqual({
      accessKeys: [],
      accounts: [{ address }],
      activeAccount: 0,
      chainId: expected,
    })
    // Connecting without an explicit chain must not forward the old unsupported value.
    await provider.request({ method: 'wallet_connect' })
    expect(selected).toEqual([expected])
    expect((await storage.getItem<{ state: { chainId: number } }>('store'))?.state.chainId).toBe(
      expected,
    )
  })

  test('repairs repeated hydration using the configured default without clearing accounts', async () => {
    const storage = Storage.memory()
    const provider = Provider.create({
      adapter: Adapter.define({ name: 'Test', rdns: 'test' }, () => ({
        actions: {
          async createAccount() {
            return { accounts: [] }
          },
          async loadAccounts() {
            return { accounts: [] }
          },
        },
      })),
      chains: [chain_custom, tempo, tempoModerato],
      storage,
    })
    await provider.ready()
    provider.store.setState({ accounts: [{ address }], chainId: tempoModerato.id })
    // Another tab or an older SDK can write an unsupported selection after initial hydration.
    await storage.setItem('store', {
      state: { accounts: [{ address }, { address: address_other }], activeAccount: 1, chainId: 1 },
      version: 0,
    })
    await provider.store.persist.rehydrate()
    expect(provider.store.getState()).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
          {
            "address": "0x0000000000000000000000000000000000000002",
          },
        ],
        "activeAccount": 1,
        "chainId": 12345,
      }
    `)
  })
})
