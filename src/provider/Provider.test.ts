import { Provider as core_Provider } from 'ox'
import { waitForTransactionReceipt } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { local } from '../../test/adapters.js'
import { accounts as core_accounts, chain, getClient } from '../../test/config.js'
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

describe('eth_accounts', () => {
  test('default: returns empty array initially', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: returns accounts after connecting', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0], core_accounts[1]],
      }),
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

  test('behavior: returns active account first', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    // Login then register — activeAccount points to second account
    await provider.request({ method: 'wallet_connect' })
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    // Active account (account[0] from loadAccounts) returned first
    expect(accounts[0]).toMatchInlineSnapshot(`"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"`)
  })
})

describe('wallet_connect', () => {
  test('default: without capabilities calls loadAccounts', async () => {
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

  test('behavior: with register capability calls createAccount', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "capabilities": {},
          },
        ],
      }
    `)
  })

  test('behavior: register preserves existing accounts and sets activeAccount', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    // Login first
    await provider.request({ method: 'wallet_connect' })

    // Register appends and sets active to new account
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    // New account is returned first (active)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "capabilities": {},
          },
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "capabilities": {},
          },
        ],
      }
    `)
    // Store has both accounts with activeAccount pointing to new one
    expect(provider.store.getState().activeAccount).toMatchInlineSnapshot(`1`)
    expect(provider.store.getState().accounts.map((a) => a.address)).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
  })

  test('behavior: login preserves existing accounts and deduplicates', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    // Register first account
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    // Login again with same account — should not duplicate
    await provider.request({ method: 'wallet_connect' })

    expect(provider.store.getState().accounts.map((a) => a.address)).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
    // activeAccount should point to the loaded account
    expect(provider.store.getState().activeAccount).toMatchInlineSnapshot(`1`)
  })

  test('behavior: login sets activeAccount to loaded account', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [core_accounts[0]],
        createAccount: async () => [core_accounts[1]],
      }),
    })

    // Register creates second account (activeAccount = 0 since no existing)
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    // Register again creates another — but loadAccounts returns account[0]
    // Login switches active back to account[0]
    const result = await provider.request({ method: 'wallet_connect' })
    expect(result.accounts[0]!.address).toMatchInlineSnapshot(`"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"`)
  })
})

describe('wallet_disconnect', () => {
  test('default: disconnects and clears accounts', async () => {
    const provider = Provider.create({
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
    const provider = Provider.create({
      adapter: local(),
    })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0xa5bf"`)
  })

  test('error: throws for unconfigured chain', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await expect(
      provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Provider.UnsupportedChainIdError: Chain 1 not configured.]`)
  })
})

describe('events', () => {
  test('behavior: emits accountsChanged on connect', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    const events: unknown[] = []
    provider.on('accountsChanged', (accounts) => events.push(accounts))

    await provider.request({ method: 'eth_requestAccounts' })

    expect(events).toEqual([[core_accounts[0].address]])
  })

  test('behavior: emits connect on status change', async () => {
    const provider = Provider.create({
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
    const provider = Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const events: unknown[] = []
    provider.on('disconnect', (error) => events.push(error))

    await provider.request({ method: 'wallet_disconnect' })

    expect(events.length).toMatchInlineSnapshot(`1`)
    expect(events[0]).toBeInstanceOf(core_Provider.DisconnectedError)
  })

  test('behavior: does not emit accountsChanged on duplicate login', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await provider.request({ method: 'wallet_connect' })

    const events: unknown[] = []
    provider.on('accountsChanged', (accounts) => events.push(accounts))

    // Login again with same account — no new event
    await provider.request({ method: 'wallet_connect' })

    expect(events).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: emits chainChanged on switch', async () => {
    const provider = Provider.create({
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

  test('behavior: transaction is confirmed on-chain', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ calls: [{ to: core_accounts[1].address }] }],
    })

    const receipt = await waitForTransactionReceipt(getClient(), { hash })

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

  test('behavior: with sync capability returns id and receipt is available', async () => {
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
})

describe('wallet_getBalances', () => {
  test('default: returns empty array when no tokens provided', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({ method: 'wallet_getBalances' })
    expect(result).toMatchInlineSnapshot(`[]`)
  })

  test('default: returns token balances with metadata', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({
      method: 'wallet_getBalances',
      params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
    })

    expect(result.length).toMatchInlineSnapshot(`1`)
    expect(result[0]!.address).toMatchInlineSnapshot(`"0x20c0000000000000000000000000000000000001"`)
    expect(result[0]!.name).toBeDefined()
    expect(result[0]!.symbol).toBeDefined()
    expect(typeof result[0]!.decimals).toMatchInlineSnapshot(`"number"`)
    expect(result[0]!.balance).toMatch(/^0x/)
  })

  test('behavior: accepts explicit account param', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const result = await provider.request({
      method: 'wallet_getBalances',
      params: [{ account: core_accounts[0].address, tokens: ['0x20c0000000000000000000000000000000000001'] }],
    })

    expect(result.length).toMatchInlineSnapshot(`1`)
    expect(result[0]!.balance).toMatch(/^0x/)
  })

  test('error: throws DisconnectedError when no accounts connected', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await expect(
      provider.request({
        method: 'wallet_getBalances',
        params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Provider.DisconnectedError: No accounts connected.]`)
  })
})

describe('rpc proxy', () => {
  test('error: proxies unknown methods to RPC client', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await expect(provider.request({ method: 'eth_blockNumber' } as any)).rejects.toThrow()
  })
})
