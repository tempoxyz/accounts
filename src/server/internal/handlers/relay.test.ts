import type { RpcRequest } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { createClient, custom, http, numberToHex, walletActions, type Address } from 'viem'
import { Account, MultisigConfig, Transaction } from 'viem/tempo'
import { tempoDevnet } from 'viem/tempo/chains'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { createServer, type Server } from '../../../../test/utils.js'
import * as Multisig from './multisig.js'
import { relay } from './relay.js'
import * as Sponsorship from './sponsorship.js'

const privateKey_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const privateKey_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const privateKey_3 = '0x7c852118294f7e395961158d39c448445a22a434adcd1d4e9048bcd3d85e9e4d'
const feeToken = '0x20c0000000000000000000000000000000000000' as const

describe('behavior: with multisig', () => {
  const store = memoryStore()
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
              if (method === 'eth_sendRawTransactionSync')
                return { transactionHash: hashRawTransaction(params) }
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

  test('behavior: collects approvals from Viem multisig transactions and resolves operation ids', async () => {
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
    const id = getOperationId(
      await Transaction.serialize({
        ...request,
        signatures: [signature_1],
      } as never),
    )

    const result = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)

    expect(result).toBe(id)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
    await expect(
      client.request({
        method: 'eth_getTransactionReceipt',
        params: [id],
      }),
    ).resolves.toMatchInlineSnapshot(`null`)

    const pending = await store.listPendingByAddress(account.address)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      account: accountAddress,
      chainId: tempoDevnet.id,
      id,
      signatures: [signature_1],
    })

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)
    await expect(store.listPendingByAddress(account.address)).resolves.toMatchInlineSnapshot(`[]`)
    await expect(store.get(id)).resolves.toMatchObject({
      submittedHash: hash,
    })

    const retried = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(retried).toBe(hash)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)

    await expect(
      client.request({
        method: 'eth_getTransactionByHash',
        params: [id],
      }),
    ).resolves.toMatchObject({
      hash,
    })
    await expect(store.get(id)).resolves.toMatchObject({
      submittedHash: hash,
    })

    await expect(
      client.request({
        method: 'eth_getTransactionReceipt',
        params: [id],
      }),
    ).resolves.toMatchObject({
      transactionHash: hash,
    })
    await expect(store.get(id)).resolves.toMatchInlineSnapshot(`undefined`)
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
                return { transactionHash: hashRawTransaction(params) }
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
    const id = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)

    await expect(store.get(id)).resolves.toMatchObject({
      id,
      signatures: [signature_1],
    })

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(broadcasted).toHaveLength(1)
    expect(hash).toBe(hashRawTransaction([broadcasted[0]]))
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)

    const transaction = Transaction.deserialize(broadcasted[0] as never) as Record<string, unknown>
    expect((transaction.signature as { type?: string }).type).toBe('multisig')
    expect(transaction.feePayerSignature).toBeDefined()
    expect((transaction.feeToken as string).toLowerCase()).toBe(feeToken)
  })
})

describe('behavior: with multisig config resolution', () => {
  test('behavior: reuses pending bootstrap config when a later approval omits init', async () => {
    const store = memoryStore()
    const server = await createServer(
      relay({
        chains: [tempoDevnet],
        transports: {
          [tempoDevnet.id]: custom({
            request: async ({ method, params }) => {
              if (method === 'eth_chainId') return numberToHex(tempoDevnet.id)
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
              if (method === 'eth_sendRawTransactionSync')
                return { transactionHash: hashRawTransaction(params) }
              throw new Error(`Unexpected upstream RPC method ${method}.`)
            },
          }),
        },
        multisig: { store },
      }).listener,
    )
    const client = createClient({
      chain: tempoDevnet,
      transport: http(server.url),
    }).extend(walletActions)
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 2,
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
    })

    try {
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
      const id = await client.sendTransaction({
        ...request,
        signatures: [signature_1],
      } as never)
      const serialized = await Transaction.serialize({
        ...request,
        signatures: [signature_2],
      } as never)
      const hash = await client.request({
        method: 'eth_sendRawTransaction',
        params: [withoutInit(serialized)],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
      const entry = await store.get(id)
      expect(entry?.submittedHash).toBe(hash)
      expect(entry?.config).toMatchObject({
        ...account.config,
        owners: account.config.owners.map((owner) => ({
          ...owner,
          owner: owner.owner.toLowerCase(),
        })),
      })
    } finally {
      server.close()
    }
  })

  test('behavior: rejects resolved configs that do not match the multisig account', async () => {
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner_1.address, weight: 1 }],
    })
    const wrong = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner_2.address, weight: 1 }],
    })
    const transaction = {
      calls: [
        {
          to: '0xcafebabecafebabecafebabecafebabecafebabe',
          value: 1n,
        },
      ],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      multisig: account.config,
      nonce: 0n,
    }
    const signature = await owner_1.signTransaction(transaction as never)
    const serialized = await account.signTransaction({
      ...transaction,
      signatures: [signature],
    } as never)

    await expect(
      Multisig.handleRawTransaction({
        getClient: (() => undefined) as never,
        method: 'eth_sendRawTransaction',
        request: { params: [serialized] },
        resolveConfig: () => wrong.config,
        store: memoryStore(),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Resolved multisig config does not match account or genesis config id.]`,
    )
  })
})

describe('behavior: with raw Tempo transaction prefixes', () => {
  test('behavior: treats 0x78 as a fee-payer handoff envelope', async () => {
    const owner = Account.fromSecp256k1(privateKey_1)
    const envelope = TxEnvelopeTempo.from({
      calls: [
        {
          to: '0xcafebabecafebabecafebabecafebabecafebabe',
          value: 1n,
        },
      ],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      nonce: 0n,
    })
    const signature = SignatureEnvelope.from(
      await owner.sign({
        hash: TxEnvelopeTempo.getSignPayload(envelope),
      }),
    )
    const serialized = TxEnvelopeTempo.serialize(envelope, {
      format: 'feePayer',
      sender: owner.address,
      signature,
    })

    expect({
      requestsSponsorship: Sponsorship.requestsRawSponsorship(serialized),
      type: serialized.slice(0, 4),
    }).toMatchInlineSnapshot(`
      {
        "requestsSponsorship": true,
        "type": "0x78",
      }
    `)
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

function getOperationId(serialized: `0x${string}`) {
  const transaction = Transaction.deserialize(serialized as never) as Record<string, unknown>
  const signature = transaction.signature as SignatureEnvelope.Multisig
  const { signature: _, ...unsigned } = transaction
  return MultisigConfig.getSignPayload({
    account: signature.account,
    genesisConfigId: signature.genesisConfigId,
    payload: TxEnvelopeTempo.getSignPayload(TxEnvelopeTempo.from(unsigned as never)),
  })
}

function hashRawTransaction(params: unknown) {
  const serialized = Array.isArray(params) ? params[0] : undefined
  if (typeof serialized !== 'string') throw new Error('Expected raw transaction.')
  return TxEnvelopeTempo.hash(
    TxEnvelopeTempo.deserialize(serialized as TxEnvelopeTempo.Serialized) as TxEnvelopeTempo.Signed,
  )
}

function withoutInit(serialized: `0x${string}`) {
  const transaction = Transaction.deserialize(serialized as never) as Record<string, unknown>
  const signature = transaction.signature as SignatureEnvelope.Multisig
  const { signature: _, ...unsigned } = transaction
  return TxEnvelopeTempo.serialize(TxEnvelopeTempo.from(unsigned as never), {
    signature: SignatureEnvelope.from({
      account: signature.account,
      genesisConfigId: signature.genesisConfigId,
      signatures: signature.signatures,
    }),
  })
}
