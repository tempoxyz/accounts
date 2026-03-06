import { Hex } from 'ox'
import { type Address, parseUnits } from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vitest'

import { webAuthn } from '../../test/adapters.js'
import { accounts, chain, getClient } from '../../test/config.js'
import * as Provider from './Provider.js'

const transferCall = Actions.token.transfer.call({
  to: Addresses.pathUsd,
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

describe('create', () => {
  test('default: returns an EIP-1193 provider', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
    })
    expect(provider).toBeDefined()
    expect(typeof provider.request).toMatchInlineSnapshot(`"function"`)
  })
})

describe('eth_chainId', () => {
  test('default: returns configured chain ID as hex', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
    })

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
  })
})

describe('eth_requestAccounts', () => {
  test('default: loads accounts via adapter', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
    })

    const accts = await provider.request({ method: 'eth_requestAccounts' })
    expect(accts).toHaveLength(1)
    expect(accts[0]).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe('wallet_connect', () => {
  test('default: returns ERC-7846 response', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
    })

    const result = await provider.request({ method: 'wallet_connect' })
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })

  test('behavior: register preserves existing accounts', async () => {
    const provider = Provider.create({
      adapter: webAuthn({ withCreate: true }),
    })

    await provider.request({ method: 'wallet_connect' })
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(result.accounts.length).toMatchInlineSnapshot(`2`)
    // New account is active (first) and differs from the loaded one
    expect(result.accounts[0]!.address).not.toBe(result.accounts[1]!.address)
  })

  test('behavior: login deduplicates and sets active account', async () => {
    const provider = Provider.create({
      adapter: webAuthn({ withCreate: true }),
    })

    // Register then login with same loadAccounts
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_connect' })

    // No duplicates
    expect(provider.store.getState().accounts.length).toMatchInlineSnapshot(`2`)
    // Active is the loaded account (returned first by eth_accounts)
    const { activeAccount } = provider.store.getState()
    const loadedAddress = provider.store.getState().accounts[activeAccount]!.address
    const result = await provider.request({ method: 'eth_accounts' })
    expect(result[0]).toBe(loadedAddress)
  })
})

describe('wallet_disconnect', () => {
  test('default: clears state', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
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
      adapter: webAuthn(),
    })

    await provider.request({ method: 'wallet_connect' })

    const events: unknown[] = []
    provider.on('accountsChanged', (accts) => events.push(accts))

    await provider.request({ method: 'wallet_connect' })

    expect(events).toMatchInlineSnapshot(`[]`)
  })
})

describe('eth_sendTransaction', () => {
  test('default: sends transaction and returns hash', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ calls: [transferCall] }],
    })

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('eth_sendTransactionSync', () => {
  test('default: sends transaction and returns receipt', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })

    const {
      blockHash,
      blockNumber,
      cumulativeGasUsed,
      effectiveGasPrice,
      gasUsed,
      logs,
      logsBloom,
      transactionHash,
      transactionIndex,
      from,
      to,
      feePayer,
      ...rest
    } = receipt
    expect(blockHash).toBeDefined()
    expect(blockNumber).toBeDefined()
    expect(cumulativeGasUsed).toBeDefined()
    expect(effectiveGasPrice).toBeDefined()
    expect(gasUsed).toBeDefined()
    expect(logs).toBeInstanceOf(Array)
    expect(logsBloom).toBeDefined()
    expect(transactionHash).toBeDefined()
    expect(transactionIndex).toBeDefined()
    expect(from).toMatch(/^0x[0-9a-f]{40}$/)
    expect(to).toMatch(/^0x[0-9a-f]{40}$/)
    expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/)
    expect(rest).toMatchInlineSnapshot(`
      {
        "contractAddress": null,
        "feeToken": "0x20c0000000000000000000000000000000000000",
        "status": "success",
        "type": "0x76",
      }
    `)
  })
})

describe('eth_signTransaction', () => {
  test('default: signs transaction and returns serialized', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [transferCall] }],
    })

    expect(signed).toMatch(/^0x/)
  })

  test('behavior: signed transaction can be sent via eth_sendRawTransactionSync', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [transferCall] }],
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
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [transferCall],
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: with sync capability returns id and sync capability', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [transferCall],
          capabilities: { sync: true },
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
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [transferCall],
          capabilities: { sync: false },
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
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, address],
    })

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, address],
    })

    const valid = await verifyMessage(getClient(), {
      address,
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
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const provider = Provider.create({
      adapter: webAuthn(),
      chains: [chain],
    })

    const address = (await provider.request({ method: 'eth_requestAccounts' }))[0]!
    await fundAccount(address)

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })

    const valid = await verifyTypedData(getClient(), {
      address,
      signature,
      ...typedData,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})

/** Funds an account with fee tokens so it can send transactions. */
async function fundAccount(address: Address) {
  const client = getClient()
  await Actions.token.transferSync(client, {
    account: accounts[0]!,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}
