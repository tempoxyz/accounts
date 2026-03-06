import { Hex, Provider as core_Provider } from 'ox'
import { waitForTransactionReceipt } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { local } from '../../test/adapters.js'
import { chain, getClient, webAuthnAccounts } from '../../test/config.js'
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
        loadAccounts: async () => [webAuthnAccounts[0], webAuthnAccounts[1]],
      }),
    })

    await provider.request({ method: 'eth_requestAccounts' })
    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toMatchInlineSnapshot(`
      [
        "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
        "0xB08a557649C30B96c28825748da6a940D6c8972e",
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
        "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
      ]
    `)
  })

  test('behavior: returns active account first', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
    expect(accounts[0]).toMatchInlineSnapshot(`"0x1ecBa262e4510F333FB5051743e2a53a765deBD0"`)
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
            "address": "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
            "capabilities": {},
          },
        ],
      }
    `)
  })

  test('behavior: with register capability calls createAccount', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
            "address": "0xB08a557649C30B96c28825748da6a940D6c8972e",
            "capabilities": {},
          },
        ],
      }
    `)
  })

  test('behavior: register preserves existing accounts and sets activeAccount', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
            "address": "0xB08a557649C30B96c28825748da6a940D6c8972e",
            "capabilities": {},
          },
          {
            "address": "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
            "capabilities": {},
          },
        ],
      }
    `)
    // Store has both accounts with activeAccount pointing to new one
    expect(provider.store.getState().activeAccount).toMatchInlineSnapshot(`1`)
    expect(provider.store.getState().accounts.map((a) => a.address)).toMatchInlineSnapshot(`
      [
        "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
        "0xB08a557649C30B96c28825748da6a940D6c8972e",
      ]
    `)
  })

  test('behavior: login preserves existing accounts and deduplicates', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
        "0xB08a557649C30B96c28825748da6a940D6c8972e",
        "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
      ]
    `)
    // activeAccount should point to the loaded account
    expect(provider.store.getState().activeAccount).toMatchInlineSnapshot(`1`)
  })

  test('behavior: login sets activeAccount to loaded account', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
    expect(result.accounts[0]!.address).toMatchInlineSnapshot(`"0x1ecBa262e4510F333FB5051743e2a53a765deBD0"`)
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

    expect(events).toEqual([[webAuthnAccounts[0].address]])
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
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
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
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
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
        "feePayer": "0x1ecba262e4510f333fb5051743e2a53a765debd0",
        "feeToken": "0x20c0000000000000000000000000000000000000",
        "from": "0x1ecba262e4510f333fb5051743e2a53a765debd0",
        "status": "success",
        "to": "0xb08a557649c30b96c28825748da6a940d6c8972e",
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
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
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
        "feePayer": "0x1ecba262e4510f333fb5051743e2a53a765debd0",
        "feeToken": "0x20c0000000000000000000000000000000000000",
        "from": "0x1ecba262e4510f333fb5051743e2a53a765debd0",
        "status": "success",
        "to": "0xb08a557649c30b96c28825748da6a940d6c8972e",
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
          calls: [{ to: webAuthnAccounts[1].address }],
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
          calls: [{ to: webAuthnAccounts[1].address }],
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
      params: [{ account: webAuthnAccounts[0].address, tokens: ['0x20c0000000000000000000000000000000000001'] }],
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

describe('personal_sign', () => {
  test('default: signs a message and returns signature', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, webAuthnAccounts[0].address],
    })

    expect(signature).toMatchInlineSnapshot(`"0x02a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce194705000000007b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a223265756862744473726b4d72636634416a4a6a4d687975307a43464e4d69436a627a5a544a732d41665767222c226f726967696e223a2268747470733a2f2f6578616d706c652e636f6d222c2263726f73734f726967696e223a66616c73657d4af9635671d8b58c8a807210b53e88a05a5c780890fa092ceabd464f6fcd132e46326db882d495740e55ce8028165caf0a23f149e80218c0d354b1b2ff24985ca43b66d1eaee03f07d64920491f8b3487a90f527f2342c8caccd55d5065084496c57d409d6db06faefd8a0aa1106acd69501134e11cf74b2e95c81b451da34337777777777777777777777777777777777777777777777777777777777777777"`)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const { verifyMessage } = await import('viem/actions')

    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, webAuthnAccounts[0].address],
    })

    const valid = await verifyMessage(getClient(), {
      address: webAuthnAccounts[0].address,
      message: { raw: message },
      signature,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })

  test('error: throws when not connected', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await expect(
      provider.request({
        method: 'personal_sign',
        params: [Hex.fromString('hello'), webAuthnAccounts[0].address],
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
