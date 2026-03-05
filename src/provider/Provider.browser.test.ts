import { describe, expect, test } from 'vitest'

import { local } from '../../test/adapters.js'
import { accounts as core_accounts, chain } from '../../test/config.js'
import * as Provider from './Provider.js'

describe('create', () => {
  test('default: returns an EIP-1193 provider', async () => {
    const provider = Provider.create({
      adapter: local(),
    })
    expect(provider).toBeDefined()
    expect(typeof provider.request).toMatchInlineSnapshot(`"function"`)
  })
})

describe('eth_chainId', () => {
  test('default: returns configured chain ID as hex', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
  })
})

describe('eth_requestAccounts', () => {
  test('default: loads accounts via adapter', async () => {
    const provider = Provider.create({
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
  test('default: returns ERC-7846 response', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    const result = await provider.request({ method: 'wallet_connect' })
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "capabilities": {},
          },
        ],
      }
    `)
  })

  test('behavior: register preserves existing accounts', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    await provider.request({ method: 'wallet_connect' })
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(result.accounts.length).toMatchInlineSnapshot(`2`)
    // New account is active (first)
    expect(result.accounts[0]!.address).toMatchInlineSnapshot(`"0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650"`)
  })

  test('behavior: login deduplicates and sets active account', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    // Register then login with same loadAccounts
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_connect' })

    // No duplicates
    expect(provider.store.getState().accounts.length).toMatchInlineSnapshot(`2`)
    // Active is the loaded account
    const result = await provider.request({ method: 'eth_accounts' })
    expect(result[0]).toMatchInlineSnapshot(`"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"`)
  })
})

describe('wallet_disconnect', () => {
  test('default: clears state', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'wallet_connect' })
    await provider.request({ method: 'wallet_disconnect' })

    expect(provider.store.getState().status).toMatchInlineSnapshot(`"disconnected"`)
    expect(provider.store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })
})

describe('events', () => {
  test('behavior: does not emit accountsChanged on duplicate login', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'wallet_connect' })

    const events: unknown[] = []
    provider.on('accountsChanged', (accounts) => events.push(accounts))

    await provider.request({ method: 'wallet_connect' })

    expect(events).toMatchInlineSnapshot(`[]`)
  })
})

describe('eth_sendTransaction', () => {
  test('default: sends transaction and returns hash', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ calls: [{ to: core_accounts[1].address }] }],
    })

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('eth_sendTransactionSync', () => {
  test('default: sends transaction and returns receipt', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [{ to: core_accounts[1].address }] }],
    })

    const { blockHash, blockNumber, cumulativeGasUsed, effectiveGasPrice, gasUsed, logs, logsBloom, transactionHash, transactionIndex, ...rest } = receipt
    expect(blockHash).toBeDefined()
    expect(blockNumber).toBeDefined()
    expect(cumulativeGasUsed).toBeDefined()
    expect(effectiveGasPrice).toBeDefined()
    expect(gasUsed).toBeDefined()
    expect(logs).toBeInstanceOf(Array)
    expect(logsBloom).toBeDefined()
    expect(transactionHash).toBeDefined()
    expect(transactionIndex).toBeDefined()
    expect(rest).toMatchInlineSnapshot(`
      {
        "contractAddress": null,
        "feePayer": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "feeToken": "0x20c0000000000000000000000000000000000001",
        "from": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "status": "success",
        "to": "0x8c8d35429f74ec245f8ef2f4fd1e551cff97d650",
        "type": "0x76",
      }
    `)
  })
})

describe('wallet_sendCalls', () => {
  test('default: sends calls and returns id', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [{ to: core_accounts[1].address }],
          chainId: `0x${chain.id.toString(16)}`,
          version: '2.0.0',
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: with sync capability returns id and sync capability', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [{ to: core_accounts[1].address }],
          capabilities: { sync: true },
          chainId: `0x${chain.id.toString(16)}`,
          version: '2.0.0',
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
    expect(result.capabilities).toMatchInlineSnapshot(`
      {
        "sync": true,
      }
    `)
  })

  test('behavior: sync false uses async path', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [{ to: core_accounts[1].address }],
          capabilities: { sync: false },
          chainId: `0x${chain.id.toString(16)}`,
          version: '2.0.0',
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
    expect(result.capabilities).toMatchInlineSnapshot(`
      {
        "sync": false,
      }
    `)
  })
})
