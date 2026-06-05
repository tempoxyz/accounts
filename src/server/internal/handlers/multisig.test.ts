import { createClient, custom, numberToHex, walletActions, type Address, type Client } from 'viem'
import { Account } from 'viem/tempo'
import { tempoDevnet } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import * as Multisig from './multisig.js'

const privateKey_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const privateKey_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

describe('multisig handler', () => {
  test('behavior: collects approvals and broadcasts when quorum is met', async () => {
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 2,
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
    })
    const accountAddress = account.address.toLowerCase() as Address
    const store = memoryStore()
    const broadcastRequests: unknown[] = []
    const submittedHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const chainId = numberToHex(tempoDevnet.id)
    const upstreamClient = {
      request: async (request: unknown) => {
        broadcastRequests.push(request)
        if (
          request &&
          typeof request === 'object' &&
          'method' in request &&
          request.method === 'eth_getTransactionReceipt'
        )
          return { transactionHash: submittedHash }
        return { transactionHash: submittedHash }
      },
    } as Client
    const client = createClient({
      chain: tempoDevnet,
      transport: custom({
        request: async ({ method, params }) => {
          if (method === 'eth_chainId') return chainId
          if (method === 'eth_fillTransaction') {
            const transaction = params[0] as Record<string, unknown>
            return {
              tx: {
                ...transaction,
                chainId,
                gas: '0x5208',
                maxFeePerGas: '0x1',
                maxPriorityFeePerGas: '0x0',
                nonce: '0x0',
              },
            }
          }
          if (method === 'eth_sendRawTransaction')
            return await Multisig.handleRawTransaction({
              getClient: () => upstreamClient,
              method,
              request: { params },
              store,
            })
          throw new Error(`Unexpected RPC method ${method}.`)
        },
      }),
    }).extend(walletActions)

    const request = await client.prepareTransactionRequest({
      account,
      calls: [
        {
          to: '0xcafebabecafebabecafebabecafebabecafebabe',
          value: 1n,
        },
      ],
    })

    const signature_1 = await client.signTransaction({ ...request, account: owner_1 })
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 })

    const result_1 = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    })

    expect(result_1).toMatch(/^0x[0-9a-f]{64}$/)
    expect(broadcastRequests).toMatchInlineSnapshot(`[]`)
    const status_1 = await Multisig.getStatus({
      id: result_1 as `0x${string}`,
      resolveConfig: () => account.config,
      store,
    })
    expect(status_1).toMatchObject({
      account: accountAddress,
      chainId: tempoDevnet.id,
      signatures: 1,
      status: 'pending',
      threshold: 2,
      weight: 1,
    })
    const pending = await store.get(result_1 as `0x${string}`)
    expect(pending?.signatures.length).toMatchInlineSnapshot(`1`)
    await expect(
      Multisig.handleGetTransaction({
        getClient: () => upstreamClient,
        method: 'eth_getTransactionReceipt',
        request: { params: [result_1] },
        store,
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "result": null,
      }
    `)
    await expect(
      Multisig.listStatuses({
        account: account.address,
        resolveConfig: () => account.config,
        store,
      }),
    ).resolves.toMatchObject([
      {
        account: accountAddress,
        signatures: 1,
        status: 'pending',
      },
    ])

    const result_2 = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    })

    expect(result_2).toMatchInlineSnapshot(
      `"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`,
    )
    expect(broadcastRequests).toHaveLength(1)
    expect(await store.get(result_1 as `0x${string}`)).toMatchObject({
      submittedHash,
    })
    await expect(
      Multisig.handleGetTransaction({
        getClient: () => upstreamClient,
        method: 'eth_getTransactionReceipt',
        request: { params: [result_1] },
        store,
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "result": {
          "transactionHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }
    `)
    expect(broadcastRequests).toHaveLength(2)
    expect(await store.get(result_1 as `0x${string}`)).toMatchInlineSnapshot(`undefined`)
  })
})

function memoryStore(): Multisig.Store {
  const entries = new Map<string, Multisig.Entry>()
  return {
    async delete(id) {
      entries.delete(id)
    },
    async get(id) {
      return entries.get(id)
    },
    async listPendingByAddress(address) {
      return [...entries.values()].filter(
        (entry) => entry.account.toLowerCase() === address.toLowerCase() && !entry.submittedHash,
      )
    },
    async set(entry) {
      entries.set(entry.id, entry)
    },
  }
}
