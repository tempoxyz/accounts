import type { RpcRequest } from 'ox'
import { createClient, custom, http, numberToHex, walletActions, type Address } from 'viem'
import { Account, Transaction } from 'viem/tempo'
import { tempoDevnet } from 'viem/tempo/chains'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { createServer, type Server } from '../../../../test/utils.js'
import * as Multisig from './multisig.js'
import { relay } from './relay.js'

const privateKey_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const privateKey_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const privateKey_3 = '0x7c852118294f7e395961158d39c448445a22a434adcd1d4e9048bcd3d85e9e4d'
const feeToken = '0x20c0000000000000000000000000000000000000' as const

describe('behavior: with multisig', () => {
  const store = memoryStore()
  const submittedHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const upstreamRequests: RpcRequest.RpcRequest[] = []
  const relayRequests: string[] = []
  let client: ReturnType<typeof createClient> & ReturnType<typeof walletActions>
  let server: Server

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [tempoDevnet],
        transports: {
          [tempoDevnet.id]: custom({
            request: async ({ method, params }) => {
              if (method === 'eth_chainId') return numberToHex(tempoDevnet.id)
              upstreamRequests.push({ method, params } as RpcRequest.RpcRequest)
              if (method === 'eth_fillTransaction') {
                const transaction = params[0] as Record<string, unknown>
                return {
                  tx: {
                    ...transaction,
                    chainId: numberToHex(tempoDevnet.id),
                    gas: '0x5208',
                    maxFeePerGas: '0x1',
                    maxPriorityFeePerGas: '0x0',
                    nonce: '0x0',
                  },
                }
              }
              if (method === 'eth_sendRawTransactionSync') return { transactionHash: submittedHash }
              if (method === 'eth_getTransactionByHash') return { hash: params[0] }
              if (method === 'eth_getTransactionReceipt') return { transactionHash: params[0] }
              throw new Error(`Unexpected upstream RPC method ${method}.`)
            },
          }),
        },
        multisig: { store },
        onRequest: async (request) => {
          relayRequests.push(request.method)
        },
      }).listener,
    )
    client = createClient({
      chain: tempoDevnet,
      transport: http(server.url),
    }).extend(walletActions)
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: collects approvals from Viem multisig transactions and resolves fake hashes', async () => {
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

    const request = await client.prepareTransactionRequest({
      account,
      calls: [
        {
          to: '0xcafebabecafebabecafebabecafebabecafebabe',
          value: 1n,
        },
      ],
    } as never)
    const signature_1 = await client.signTransaction({ ...request, account: owner_1 } as never)
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 } as never)

    const fakeHash = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)

    expect(fakeHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
    await expect(
      client.request({
        method: 'eth_getTransactionReceipt',
        params: [fakeHash],
      }),
    ).resolves.toMatchInlineSnapshot(`null`)

    const pending = await store.listPendingByAddress(account.address)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      account: accountAddress,
      chainId: tempoDevnet.id,
      id: fakeHash,
      signatures: [signature_1],
    })

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(hash).toMatchInlineSnapshot(
      `"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`,
    )
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)
    await expect(store.listPendingByAddress(account.address)).resolves.toMatchInlineSnapshot(`[]`)
    await expect(store.get(fakeHash)).resolves.toMatchObject({
      submittedHash,
    })

    await expect(
      client.request({
        method: 'eth_getTransactionByHash',
        params: [fakeHash],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "hash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }
    `)
    await expect(store.get(fakeHash)).resolves.toMatchObject({
      submittedHash,
    })

    await expect(
      client.request({
        method: 'eth_getTransactionReceipt',
        params: [fakeHash],
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "transactionHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }
    `)
    await expect(store.get(fakeHash)).resolves.toMatchInlineSnapshot(`undefined`)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ]
    `)
    expect(relayRequests.filter((method) => method.startsWith('tempo_'))).toMatchInlineSnapshot(
      `[]`,
    )
  })
})

describe('behavior: with multisig and feePayer', () => {
  const store = memoryStore()
  const submittedHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const upstreamRequests: RpcRequest.RpcRequest[] = []
  const broadcasted: string[] = []
  let client: ReturnType<typeof createClient> & ReturnType<typeof walletActions>
  let server: Server

  beforeAll(async () => {
    const feePayer = Account.fromSecp256k1(privateKey_3)
    server = await createServer(
      relay({
        chains: [tempoDevnet],
        feePayer: {
          account: feePayer as never,
        },
        multisig: { store },
        resolveTokens: async () => [
          {
            address: feeToken,
            decimals: 6,
            name: 'pathUSD',
            symbol: 'pathUSD',
          },
        ],
        transports: {
          [tempoDevnet.id]: custom({
            request: async ({ method, params }) => {
              if (method === 'eth_chainId') return numberToHex(tempoDevnet.id)
              upstreamRequests.push({ method, params } as RpcRequest.RpcRequest)
              if (method === 'eth_fillTransaction') {
                const transaction = params[0] as Record<string, unknown>
                return {
                  tx: {
                    ...transaction,
                    chainId: numberToHex(tempoDevnet.id),
                    gas: '0x5208',
                    maxFeePerGas: '0x1',
                    maxPriorityFeePerGas: '0x0',
                    nonce: '0x0',
                  },
                }
              }
              if (method === 'eth_sendRawTransactionSync') {
                broadcasted.push((params as readonly string[])[0]!)
                return { transactionHash: submittedHash }
              }
              throw new Error(`Unexpected upstream RPC method ${method}.`)
            },
          }),
        },
      }).listener,
    )
    client = createClient({
      chain: tempoDevnet,
      transport: http(server.url),
    }).extend(walletActions)
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: broadcasts finalized multisig transactions with feePayerSignature and default feeToken', async () => {
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 2,
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
    })

    const request = await client.prepareTransactionRequest({
      account,
      calls: [
        {
          to: '0xcafebabecafebabecafebabecafebabecafebabe',
          value: 1n,
        },
      ],
    } as never)
    expect((request as { feePayerSignature?: unknown }).feePayerSignature).toBeDefined()

    const signature_1 = await client.signTransaction({ ...request, account: owner_1 } as never)
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 } as never)
    const fakeHash = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)

    await expect(store.get(fakeHash)).resolves.toMatchObject({
      id: fakeHash,
      signatures: [signature_1],
    })

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(hash).toBe(submittedHash)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)
    expect(broadcasted).toHaveLength(1)

    const transaction = Transaction.deserialize(broadcasted[0] as never) as Record<string, unknown>
    expect((transaction.signature as { type?: string }).type).toBe('multisig')
    expect(transaction.feePayerSignature).toBeDefined()
    expect((transaction.feeToken as string).toLowerCase()).toBe(feeToken)
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
