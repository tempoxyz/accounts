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
    expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(blockNumber).toMatch(/^0x/)
    expect(cumulativeGasUsed).toMatch(/^0x/)
    expect(effectiveGasPrice).toMatch(/^0x/)
    expect(gasUsed).toMatch(/^0x/)
    expect(logs).toBeInstanceOf(Array)
    expect(logsBloom).toMatch(/^0x/)
    expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(transactionIndex).toMatch(/^0x/)
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
