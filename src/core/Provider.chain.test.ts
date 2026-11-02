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
