import type { RpcRequest } from 'ox'
import { MultisigConfig, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { createClient, custom, http, numberToHex, walletActions } from 'viem'
import { Account, Transaction } from 'viem/tempo'
import { tempoDevnet } from 'viem/tempo/chains'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vp/test'

import { createServer, type Server } from '../../test/utils.js'
import * as Handler from './Handler.js'
import * as Multisig from './Multisig.js'

const privateKey_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const privateKey_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const privateKey_3 = '0x7c852118294f7e395961158d39c448445a22a434adcd1d4e9048bcd3d85e9e4d'
const feeToken = '0x20c0000000000000000000000000000000000000' as const

describe('memoryStore', () => {
  test('behavior: submission claims are exclusive until TTL expiry', async () => {
    const store = Multisig.memoryStore()
    const operation = createOperation()

    await store.savePending(operation)
    const first = await store.claimSubmission(operation, { ttl: 1_000 })
    const second = await store.claimSubmission(operation, { ttl: 1_000 })

    expect({ first: first.status, second: second.status }).toMatchInlineSnapshot(`
      {
        "first": "claimed",
        "second": "submitting",
      }
    `)
  })

  test('behavior: expired submission claims can be reclaimed', async () => {
    const store = Multisig.memoryStore()
    const operation = createOperation()

    await store.savePending(operation)
    await store.claimSubmission(operation, { ttl: -1 })
    const reclaimed = await store.claimSubmission(operation, { ttl: 1_000 })

    expect(reclaimed.status).toMatchInlineSnapshot(`"claimed"`)
  })

  test('behavior: pending saves merge signatures and submitted operations are not listed as pending', async () => {
    const store = Multisig.memoryStore()
    const operation = createOperation()

    await store.savePending({ ...operation, signatures: [`0x${'11'.repeat(65)}`] })
    const merged = await store.savePending({ ...operation, signatures: [`0x${'22'.repeat(65)}`] })
    await store.claimSubmission(merged, { ttl: 1_000 })
    await store.setSubmitted(operation.id, `0x${'33'.repeat(32)}`)

    expect({
      listed: await store.listPendingByAddress(operation.account),
      signatures: merged.signatures.length,
      status: (await store.get(operation.id))?.status,
    }).toMatchInlineSnapshot(`
      {
        "listed": [],
        "signatures": 2,
        "status": "submitted",
      }
    `)
  })
})

describe('Handler.relay multisig', () => {
  const store = Multisig.memoryStore()
  const upstreamRequests: RpcRequest.RpcRequest[] = []
  let client: ReturnType<typeof createClient> & ReturnType<typeof walletActions>
  let server: Server

  beforeAll(async () => {
    server = await createServer(
      Handler.relay({
        chains: [tempoDevnet],
        multisig: { store },
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

  beforeEach(() => {
    upstreamRequests.length = 0
  })

  test('behavior: collects approvals and keeps operation-id aliases after submission', async () => {
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
    const signature_1 = await client.signTransaction({ ...request, account: owner_1 } as never)
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 } as never)
    const id = getOperationId(
      await Transaction.serialize({
        ...request,
        signatures: [signature_1],
      } as never),
    )

    const pending = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)

    expect(pending).toMatchInlineSnapshot(`"${id}"`)
    await expect(Multisig.getStatus({ id, store })).resolves.toMatchObject({
      signatures: 1,
      status: 'pending',
      threshold: 2,
      weight: 1,
    })
    const statuses = await Multisig.listStatuses({ account: account.address, store })
    expect(
      statuses.map(({ id, signatures, status, threshold, weight }) => ({
        id,
        signatures,
        status,
        threshold,
        weight,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "id": "${id}",
          "signatures": 1,
          "status": "pending",
          "threshold": 2,
          "weight": 1,
        },
      ]
    `)
    await expect(
      client.request({ method: 'eth_getTransactionReceipt', params: [id] }),
    ).resolves.toMatchInlineSnapshot(`null`)

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(hash).toMatchInlineSnapshot(`"${hash}"`)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)
    await expect(Multisig.getStatus({ id, store })).resolves.toMatchObject({
      status: 'submitted',
      submittedHash: hash,
    })

    const retried = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect(retried).toMatchInlineSnapshot(`"${hash}"`)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)

    await expect(
      client.request({ method: 'eth_getTransactionByHash', params: [id] }),
    ).resolves.toMatchObject({ hash })
    await expect(
      client.request({ method: 'eth_getTransactionReceipt', params: [id] }),
    ).resolves.toMatchObject({ transactionHash: hash })
    await expect(Multisig.getStatus({ id, store })).resolves.toMatchObject({
      status: 'submitted',
      submittedHash: hash,
    })
    await expect(Multisig.listStatuses({ account: account.address, store })).resolves
      .toMatchInlineSnapshot(`[]`)
  })

  test('behavior: broadcasts immediately when one approval meets threshold', async () => {
    const owner = Account.fromSecp256k1(privateKey_1)
    const account = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner.address, weight: 1 }],
    })
    const request = await client.prepareTransactionRequest({
      account,
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 2n }],
    } as never)
    const signature = await client.signTransaction({ ...request, account: owner } as never)
    const id = getOperationId(
      await Transaction.serialize({
        ...request,
        signatures: [signature],
      } as never),
    )

    const hash = await client.sendTransaction({
      ...request,
      signatures: [signature],
    } as never)

    expect(hash === id).toMatchInlineSnapshot(`false`)
    expect(upstreamRequests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
        "eth_sendRawTransactionSync",
      ]
    `)
    await expect(Multisig.getStatus({ id, store })).resolves.toMatchObject({
      status: 'submitted',
      submittedHash: hash,
    })
  })

  test('behavior: an active submission claim returns the operation id and does not broadcast again', async () => {
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
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 3n }],
    } as never)
    const signature_1 = await client.signTransaction({ ...request, account: owner_1 } as never)
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 } as never)
    const id = await client.sendTransaction({
      ...request,
      signatures: [signature_1],
    } as never)
    const operation = await store.get(id)
    if (!operation) throw new Error('Expected pending operation.')
    await store.claimSubmission(operation, { ttl: 30_000 })
    upstreamRequests.length = 0

    const result = await client.sendTransaction({
      ...request,
      signatures: [signature_2],
    } as never)

    expect({ methods: upstreamRequests.map(({ method }) => method), result })
      .toMatchInlineSnapshot(`
      {
        "methods": [],
        "result": "${id}",
      }
    `)
  })
})

describe('handleRawTransaction', () => {
  test('behavior: returns null status for unknown operations', async () => {
    await expect(
      Multisig.getStatus({ id: `0x${'ff'.repeat(32)}`, store: Multisig.memoryStore() }),
    ).resolves.toMatchInlineSnapshot(`null`)
  })

  test('behavior: rejects first approvals when no config can be resolved', async () => {
    const owner = Account.fromSecp256k1(privateKey_1)
    const account = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner.address, weight: 1 }],
    })
    const transaction = {
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      multisig: account.config,
      nonce: 0n,
    }
    const signature = await owner.signTransaction(transaction as never)
    const serialized = withoutInit(
      await account.signTransaction({ ...transaction, signatures: [signature] } as never),
    )

    await expect(
      Multisig.handleRawTransaction({
        getClient: (() => undefined) as never,
        method: 'eth_sendRawTransaction',
        request: { params: [serialized] },
        store: Multisig.memoryStore(),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Multisig config is required to collect approvals. Provide it in the bootstrap transaction or configure \`multisig.resolveConfig\`.]`,
    )
  })

  test('behavior: finalize submitted preserves async broadcast method', async () => {
    const owner = Account.fromSecp256k1(privateKey_1)
    const account = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner.address, weight: 1 }],
    })
    const transaction = {
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      multisig: account.config,
      nonce: 0n,
    }
    const signature = await owner.signTransaction(transaction as never)
    const serialized = await account.signTransaction({
      ...transaction,
      signatures: [signature],
    } as never)
    let broadcastMethod: string | undefined

    const hash = await Multisig.handleRawTransaction({
      finalize: 'submitted',
      getClient: (() => ({
        request: async ({ method, params }: { method: string; params: unknown }) => {
          broadcastMethod = method
          return hashRawTransaction(params)
        },
      })) as never,
      method: 'eth_sendRawTransaction',
      request: { params: [serialized] },
      store: Multisig.memoryStore(),
    })

    expect({ broadcastMethod, hash }).toMatchInlineSnapshot(`
      {
        "broadcastMethod": "eth_sendRawTransaction",
        "hash": "${hash}",
      }
    `)
  })
})

describe('config resolution', () => {
  test('behavior: reuses pending bootstrap config when a later approval omits init', async () => {
    const store = Multisig.memoryStore()
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 2,
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
    })
    const transaction = {
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      multisig: account.config,
      nonce: 0n,
    }
    const signature_1 = await owner_1.signTransaction(transaction as never)
    const signature_2 = await owner_2.signTransaction(transaction as never)
    const first = await account.signTransaction({
      ...transaction,
      signatures: [signature_1],
    } as never)
    const second = withoutInit(
      await account.signTransaction({ ...transaction, signatures: [signature_2] } as never),
    )

    const id = (await Multisig.handleRawTransaction({
      getClient: (() => undefined) as never,
      method: 'eth_sendRawTransaction',
      request: { params: [first] },
      store,
    })) as `0x${string}`
    const hash = await Multisig.handleRawTransaction({
      getClient: (() => ({
        request: async ({ params }: { params: unknown }) => hashRawTransaction(params),
      })) as never,
      method: 'eth_sendRawTransaction',
      request: { params: [second] },
      store,
    })

    expect({ hash, status: await Multisig.getStatus({ id, store }) }).toMatchObject({
      hash,
      status: { status: 'submitted', submittedHash: hash },
    })
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
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
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
        store: Multisig.memoryStore(),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Signature from non-owner 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266.]`,
    )
  })

  test('behavior: accepts current configs for updated multisig signer sets', async () => {
    const owner_1 = Account.fromSecp256k1(privateKey_1)
    const owner_2 = Account.fromSecp256k1(privateKey_2)
    const account = Account.fromMultisig({
      threshold: 1,
      owners: [{ owner: owner_1.address, weight: 1 }],
    })
    const current = MultisigConfig.from({
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
      threshold: 1,
    })
    const transaction = {
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
      chainId: tempoDevnet.id,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 0n,
      multisig: account.config,
      nonce: 1n,
    }
    const signature = await owner_2.signTransaction(transaction as never)
    const serialized = withoutInit(
      await account.signTransaction({
        ...transaction,
        signatures: [signature],
      } as never),
    )
    let submitted: `0x${string}` | undefined

    const hash = await Multisig.handleRawTransaction({
      getClient: (() => ({
        request: async ({ params }: { params: unknown }) => {
          submitted = Array.isArray(params) ? (params[0] as `0x${string}`) : undefined
          return hashRawTransaction(params)
        },
      })) as never,
      method: 'eth_sendRawTransaction',
      request: { params: [serialized] },
      resolveConfig: () => current,
      store: Multisig.memoryStore(),
    })

    const transaction_submitted = Transaction.deserialize(submitted! as never) as {
      signature: SignatureEnvelope.Multisig
    }
    expect({
      hash,
      init: transaction_submitted.signature.init,
      genesisConfigId: transaction_submitted.signature.genesisConfigId,
    }).toMatchInlineSnapshot(`
      {
        "genesisConfigId": "${MultisigConfig.toId(account.config)}",
        "hash": "${hash}",
        "init": undefined,
      }
    `)
  })
})

describe('Handler.relay multisig with feePayer', () => {
  const store = Multisig.memoryStore()
  const broadcasted: string[] = []
  let client: ReturnType<typeof createClient> & ReturnType<typeof walletActions>
  let server: Server

  beforeAll(async () => {
    const feePayer = Account.fromSecp256k1(privateKey_3)
    server = await createServer(
      Handler.relay({
        chains: [tempoDevnet],
        feePayer: { account: feePayer as never },
        multisig: { store },
        resolveTokens: async () => [
          { address: feeToken, decimals: 6, name: 'pathUSD', symbol: 'pathUSD' },
        ],
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
    client = createClient({ chain: tempoDevnet, transport: http(server.url) }).extend(walletActions)
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
      calls: [{ to: '0xcafebabecafebabecafebabecafebabecafebabe', value: 1n }],
    } as never)
    const signature_1 = await client.signTransaction({ ...request, account: owner_1 } as never)
    const signature_2 = await client.signTransaction({ ...request, account: owner_2 } as never)

    await client.sendTransaction({ ...request, signatures: [signature_1] } as never)
    const hash = await client.sendTransaction({ ...request, signatures: [signature_2] } as never)

    const transaction = Transaction.deserialize(broadcasted[0] as never) as Record<string, unknown>
    expect({
      feePayerSignature: Boolean(transaction.feePayerSignature),
      feeToken: (transaction.feeToken as string).toLowerCase(),
      hash,
      signature: (transaction.signature as { type?: string }).type,
    }).toMatchInlineSnapshot(`
      {
        "feePayerSignature": true,
        "feeToken": "0x20c0000000000000000000000000000000000000",
        "hash": "${hash}",
        "signature": "multisig",
      }
    `)
  })
})

function createOperation(): Multisig.Operation {
  const now = Date.now()
  return {
    account: '0x0000000000000000000000000000000000000001',
    chainId: tempoDevnet.id,
    createdAt: now,
    genesisConfigId: `0x${'11'.repeat(32)}`,
    id: `0x${'22'.repeat(32)}`,
    payload: `0x${'33'.repeat(32)}`,
    signatures: [],
    status: 'pending',
    transaction: `0x76${'44'.repeat(32)}`,
    updatedAt: now,
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
