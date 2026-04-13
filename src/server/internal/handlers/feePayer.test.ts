import type { RpcRequest } from 'ox'
import { SignatureEnvelope, Transaction as core_Transaction, TxEnvelopeTempo } from 'ox/tempo'
import { parseUnits } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { Actions, Transaction, withFeePayer } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, addresses, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import { feePayer } from './feePayer.js'

const userAccount = accounts[9]!
const feePayerAccount = accounts[0]!

let server: Server
let fp: ReturnType<typeof getClient>
let requests: RpcRequest.RpcRequest[] = []

beforeAll(async () => {
  server = await createServer(
    feePayer({
      account: feePayerAccount,
      chains: [chain],
      transports: { [chain.id]: http() },
      onRequest: async (request) => {
        requests.push(request)
      },
    }).listener,
  )
  fp = getClient({ transport: http(server.url) })
})

afterAll(() => {
  server.close()
  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    server.close()
    process.exit(0)
  })
})

afterEach(() => {
  requests = []
})

/** Signs a sponsor-bound Tempo transaction, preserving the feePayerSignature. */
async function signSponsoredTx(account: (typeof accounts)[number], transaction: object) {
  const serialized = (await Transaction.serialize(transaction as never)) as `0x76${string}`
  const envelope = TxEnvelopeTempo.deserialize(serialized)
  const signature = await account.sign({
    hash: TxEnvelopeTempo.getSignPayload(envelope),
  })
  return TxEnvelopeTempo.serialize(envelope, {
    signature: SignatureEnvelope.from(signature),
  })
}

describe('POST /', () => {
  test('default: eth_fillTransaction returns a sponsor-bound transaction the sender can broadcast', async () => {
    const response = (await fp.request({
      method: 'eth_fillTransaction',
      params: [
        {
          chainId: chain.id,
          feePayer: true,
          from: userAccount.address,
          to: '0x0000000000000000000000000000000000000000',
        },
      ],
    })) as {
      sponsor: { address: string }
      tx: Record<string, unknown>
    }
    const prepared = core_Transaction.fromRpc(response.tx as never) as {
      feePayerSignature?: unknown
    }
    const signed = await signSponsoredTx(userAccount, prepared)
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync',
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(response.sponsor.address).toBe(feePayerAccount.address)
    expect(prepared?.feePayerSignature).toBeDefined()
    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
  })

  test('behavior: mutating a sponsor-bound transaction invalidates the fee payer binding', async () => {
    const response = (await fp.request({
      method: 'eth_fillTransaction',
      params: [
        {
          chainId: chain.id,
          feePayer: true,
          from: userAccount.address,
          to: '0x0000000000000000000000000000000000000000',
        },
      ],
    })) as { tx: Record<string, unknown> }
    const prepared = core_Transaction.fromRpc(response.tx as never) as {
      gas?: bigint | undefined
      feePayerSignature?: unknown
    }
    const signed = await signSponsoredTx(userAccount, {
      ...prepared,
      gas: (prepared?.gas ?? 0n) + 1n,
    })

    await expect(
      getClient().request({
        method: 'eth_sendRawTransactionSync',
        params: [signed],
      }),
    ).rejects.toThrowError()
  })

  test('behavior: eth_signRawTransaction', async () => {
    const client = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url)),
    })

    const receipt = await sendTransactionSync(client, {
      feePayer: true,
      to: '0x0000000000000000000000000000000000000000',
    })

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_signRawTransaction",
      ]
    `)
  })

  test('behavior: eth_sendRawTransaction', async () => {
    const client = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url), {
        policy: 'sign-and-broadcast',
      }),
    })

    const receipt = await sendTransactionSync(client, {
      feePayer: true,
      to: '0x0000000000000000000000000000000000000000',
    })

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransactionSync",
      ]
    `)
  })

  test('behavior: eth_sendRawTransactionSync', async () => {
    const client = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url), {
        policy: 'sign-and-broadcast',
      }),
    })

    const receipt = await sendTransactionSync(client, {
      feePayer: true,
      to: '0x0000000000000000000000000000000000000000',
    })

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransactionSync",
      ]
    `)
  })

  test('behavior: unsupported method', async () => {
    await expect(fp.request({ method: 'eth_chainId' })).rejects.toThrowError()
  })

  test('behavior: internal error', async () => {
    await expect(
      fp.request({
        method: 'eth_signRawTransaction' as never,
        params: ['0xinvalid'],
      }),
    ).rejects.toThrowError()
  })
})

describe('behavior: conditional sponsoring', () => {
  const rejectedAccount = accounts[3]!
  let conditionalServer: Server
  let conditionalFp: ReturnType<typeof getClient>

  beforeAll(async () => {
    // Fund accounts with alphaUsd for transfers + fee payment.
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: parseUnits('100', 6),
      to: userAccount.address,
    })
    await Actions.fee.setUserToken(rpc, { account: userAccount, token: addresses.alphaUsd })
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: parseUnits('100', 6),
      to: rejectedAccount.address,
    })
    await Actions.fee.setUserToken(rpc, { account: rejectedAccount, token: addresses.alphaUsd })

    conditionalServer = await createServer(
      feePayer({
        account: feePayerAccount,
        chains: [chain],
        transports: { [chain.id]: http() },
        validate: (request) =>
          request.from?.toLowerCase() !== rejectedAccount.address.toLowerCase(),
      }).listener,
    )
    conditionalFp = getClient({ transport: http(conditionalServer.url) })
  })

  afterAll(() => {
    conditionalServer.close()
  })

  test('behavior: approved tx is sponsored and can be broadcast', async () => {
    const { data, to } = Actions.token.transfer.call({
      token: addresses.alphaUsd,
      to: rejectedAccount.address,
      amount: 1n,
    })
    const response = (await conditionalFp.request({
      method: 'eth_fillTransaction',
      params: [
        {
          chainId: chain.id,
          feePayer: true,
          from: userAccount.address,
          to,
          data,
        },
      ],
    })) as { sponsor?: { address: string }; tx: Record<string, unknown> }

    const prepared = core_Transaction.fromRpc(response.tx as never) as {
      feePayerSignature?: unknown
    }
    expect(prepared.feePayerSignature).toBeDefined()
    expect(response.sponsor?.address).toBe(feePayerAccount.address)

    const signed = await signSponsoredTx(userAccount, prepared)
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync',
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
  })

  test('behavior: rejected tx is not sponsored and can be self-paid', async () => {
    const { data, to } = Actions.token.transfer.call({
      token: addresses.alphaUsd,
      to: userAccount.address,
      amount: 1n,
    })
    const response = (await conditionalFp.request({
      method: 'eth_fillTransaction',
      params: [
        {
          chainId: chain.id,
          feePayer: true,
          from: rejectedAccount.address,
          to,
          data,
        },
      ],
    })) as { sponsor?: { address: string }; tx: Record<string, unknown> }

    const prepared = core_Transaction.fromRpc(response.tx as never) as {
      feePayerSignature?: unknown
    }
    expect(prepared.feePayerSignature).toBeUndefined()
    expect(response.sponsor).toBeUndefined()

    const signed = await signSponsoredTx(rejectedAccount, prepared)
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync',
      params: [signed],
    })) as { feePayer?: string | undefined }

    // Sender pays their own fee — no external fee payer.
    expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
  })

  test('behavior: rejected raw transaction returns error', async () => {
    // First fill without the conditional server to get a signed tx.
    const response = (await fp.request({
      method: 'eth_fillTransaction',
      params: [
        {
          chainId: chain.id,
          feePayer: true,
          from: rejectedAccount.address,
          to: '0x0000000000000000000000000000000000000000',
        },
      ],
    })) as { tx: Record<string, unknown> }
    const prepared = core_Transaction.fromRpc(response.tx as never)
    const signed = await signSponsoredTx(rejectedAccount, prepared)

    // Submit the signed tx to the conditional server — should reject.
    await expect(
      conditionalFp.request({
        method: 'eth_signRawTransaction' as never,
        params: [signed],
      }),
    ).rejects.toThrowError()
  })
})
