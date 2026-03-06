import { Hex } from 'ox'
import { verifyMessage, verifyTypedData } from 'viem/actions'
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
            "address": "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
            "capabilities": {},
          },
        ],
      }
    `)
  })

  test('behavior: register preserves existing accounts', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
      }),
    })

    await provider.request({ method: 'wallet_connect' })
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(result.accounts.length).toMatchInlineSnapshot(`2`)
    // New account is active (first)
    expect(result.accounts[0]!.address).toMatchInlineSnapshot(`"0xB08a557649C30B96c28825748da6a940D6c8972e"`)
  })

  test('behavior: login deduplicates and sets active account', async () => {
    const provider = Provider.create({
      adapter: local({
        loadAccounts: async () => [webAuthnAccounts[0]],
        createAccount: async () => [webAuthnAccounts[1]],
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
    expect(result[0]).toMatchInlineSnapshot(`"0x1ecBa262e4510F333FB5051743e2a53a765deBD0"`)
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
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
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

describe('eth_signTransaction', () => {
  test('default: signs transaction and returns serialized', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
    })

    expect(signed).toMatch(/^0x/)
  })

  test('behavior: signed transaction can be sent via eth_sendRawTransactionSync', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [{ to: webAuthnAccounts[1].address }] }],
    })

    const receipt = await provider.request({
      method: 'eth_sendRawTransactionSync',
      params: [signed],
    })

    expect(receipt.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
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
          calls: [{ to: webAuthnAccounts[1].address }],
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

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
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
})

describe('eth_signTypedData_v4', () => {
  const typedData = {
    domain: { name: 'Test', version: '1', chainId: 1 },
    types: {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    },
    primaryType: 'Person' as const,
    message: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000000' },
  }

  test('default: signs typed data and returns signature', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [webAuthnAccounts[0].address, JSON.stringify(typedData)],
    })

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const provider = Provider.create({
      adapter: local(),
      chains: [chain],
    })

    await provider.request({ method: 'eth_requestAccounts' })

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [webAuthnAccounts[0].address, JSON.stringify(typedData)],
    })

    const valid = await verifyTypedData(getClient(), {
      address: webAuthnAccounts[0].address,
      signature,
      ...typedData,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})
