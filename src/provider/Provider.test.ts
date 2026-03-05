import { Provider as core_Provider } from 'ox'
import { waitForTransactionReceipt } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { local } from '../../test/adapters.js'
import { accounts as core_accounts, chain, getClient, privateKeys } from '../../test/config.js'
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
        accounts: [
          { address: core_accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
          { address: core_accounts[1].address, keyType: 'secp256k1', privateKey: privateKeys[1] },
        ],
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
})

describe('wallet_connect', () => {
  test('default: without capabilities calls loadAccounts', async () => {
    const provider = Provider.create({
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
    const provider = Provider.create({
      adapter: local({
        accounts: [
          { address: core_accounts[0].address, keyType: 'secp256k1', privateKey: privateKeys[0] },
        ],
        createAccounts: [
          { address: core_accounts[1].address, keyType: 'secp256k1', privateKey: privateKeys[1] },
        ],
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

  test('error: throws 4902 for unconfigured chain', async () => {
    const provider = Provider.create({
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

describe('rpc proxy', () => {
  test('error: proxies unknown methods to RPC client', async () => {
    const provider = Provider.create({
      adapter: local(),
    })

    await expect(provider.request({ method: 'eth_blockNumber' } as any)).rejects.toThrow()
  })
})
