import { Provider as core_Provider } from 'ox'
import { tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { local } from '../../test/adapters.js'
import { accounts as core_accounts } from '../../test/config.js'
import * as Provider from './Provider.js'

describe('create', () => {
  test('default: returns an EIP-1193 provider', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })
    expect(provider).toBeDefined()
    expect(typeof provider.request).toMatchInlineSnapshot(`"function"`)
  })
})

describe('eth_chainId', () => {
  test('default: returns configured chain ID as hex', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
  })
})

describe('eth_accounts', () => {
  test('default: returns empty array initially', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: returns accounts after connecting', async () => {
    const provider = await Provider.create({
      adapter: local({ accounts: [core_accounts[0], core_accounts[1]] }),
    })

    await provider.request({ method: 'eth_requestAccounts' })
    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
  })
})

describe('eth_requestAccounts', () => {
  test('default: loads accounts via adapter', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    expect(accounts).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
  })
})

describe('wallet_connect', () => {
  test('default: without capabilities calls loadAccounts', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const accounts = await provider.request({ method: 'wallet_connect' })
    expect(accounts).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
  })

  test('behavior: with register capability calls createAccount', async () => {
    const provider = await Provider.create({
      adapter: local({
        accounts: [core_accounts[0]],
        createAccounts: [core_accounts[1]],
      }),
    })

    const accounts = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    expect(accounts).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
  })
})

describe('wallet_disconnect', () => {
  test('default: disconnects and clears accounts', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'eth_requestAccounts' })
    await provider.request({ method: 'wallet_disconnect' })

    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toMatchInlineSnapshot(`[]`)
  })
})

describe('wallet_switchEthereumChain', () => {
  test('default: switches chain', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0xa5bf"`)
  })

  test('error: throws 4902 for unconfigured chain', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(core_Provider.ProviderRpcError)
      expect((e as core_Provider.ProviderRpcError).code).toMatchInlineSnapshot(`4902`)
    }
  })
})

describe('events', () => {
  test('behavior: emits accountsChanged on connect', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const events: unknown[] = []
    provider.on('accountsChanged', (accounts) => events.push(accounts))

    await provider.request({ method: 'eth_requestAccounts' })

    expect(events).toEqual([[core_accounts[0].address]])
  })

  test('behavior: emits connect on status change', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const events: unknown[] = []
    provider.on('connect', (info) => events.push(info))

    await provider.request({ method: 'eth_requestAccounts' })

    expect(events).toMatchInlineSnapshot(`
      [
        {
          "chainId": "0x1079",
        },
      ]
    `)
  })

  test('behavior: emits disconnect on disconnect', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const events: unknown[] = []
    provider.on('disconnect', (error) => events.push(error))

    await provider.request({ method: 'wallet_disconnect' })

    expect(events.length).toMatchInlineSnapshot(`1`)
    expect(events[0]).toBeInstanceOf(core_Provider.DisconnectedError)
  })

  test('behavior: emits chainChanged on switch', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    const events: unknown[] = []
    provider.on('chainChanged', (chainId) => events.push(chainId))

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
    })

    expect(events).toMatchInlineSnapshot(`
      [
        "0xa5bf",
      ]
    `)
  })
})

describe('rpc proxy', () => {
  test('error: proxies unknown methods to RPC client', async () => {
    const provider = await Provider.create({
      adapter: local(),
    })

    await expect(provider.request({ method: 'eth_blockNumber' } as any)).rejects.toThrow()
  })
})
