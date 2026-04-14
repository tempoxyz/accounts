import type { RpcRequest } from 'ox'
import { SignatureEnvelope, Transaction as core_Transaction, TxEnvelopeTempo } from 'ox/tempo'
import { parseUnits } from 'viem'
import { sendTransaction, sendTransactionSync, waitForTransactionReceipt } from 'viem/actions'
import { Actions, Transaction, withFeePayer } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, addresses, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import { relay } from './relay.js'

const userAccount = accounts[9]!
const feePayerAccount = accounts[0]!

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

/** Calls the relay's fee-payer-compatible `eth_fillTransaction` shape directly. */
async function fillCompat(url: string, parameters: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_fillTransaction',
      params: [parameters],
    }),
  })
  const body = (await response.json()) as {
    error?: { message?: string | undefined } | undefined
    result?: {
      capabilities?: { sponsor?: unknown | undefined } | undefined
      sponsor?: { address: string; name?: string | undefined; url?: string | undefined } | undefined
      tx: Record<string, unknown>
    } | undefined
  }

  if (body.error) throw new Error(body.error.message ?? 'eth_fillTransaction failed')

  return {
    capabilities: body.result?.capabilities,
    sponsor: body.result?.sponsor,
    transaction: core_Transaction.fromRpc(body.result?.tx as never) as {
      feePayerSignature?: unknown
    },
  }
}

describe('behavior: feePayer compatibility', () => {
  let server: Server
  let requests: RpcRequest.RpcRequest[] = []

  beforeAll(async () => {
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: parseUnits('100', 6),
      to: userAccount.address,
    })
    await Actions.fee.setUserToken(rpc, { account: userAccount, token: addresses.alphaUsd })

    server = await createServer(
      relay({
        account: feePayerAccount,
        chains: [chain],
        name: 'Test Sponsor',
        transports: { [chain.id]: http() },
        url: 'https://test.com',
        onRequest: async (request) => {
          requests.push(request)
        },
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    requests = []
  })

  test('default: returns feePayer-compatible sponsor response', async () => {
    const response = await fillCompat(server.url, {
      chainId: chain.id,
      feePayer: true,
      from: userAccount.address,
      to: '0x0000000000000000000000000000000000000000',
    })
    const signed = await signSponsoredTx(userAccount, response.transaction)
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(response.transaction.feePayerSignature).toBeDefined()
    expect(response.sponsor).toMatchInlineSnapshot(`
      {
        "address": "${feePayerAccount.address}",
        "name": "Test Sponsor",
        "url": "https://test.com",
      }
    `)
    expect(response.capabilities?.sponsor).toMatchInlineSnapshot(`
      {
        "address": "${feePayerAccount.address}",
        "name": "Test Sponsor",
        "url": "https://test.com",
      }
    `)
    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
  })

  test('behavior: skips sponsorship when feePayer is not true', async () => {
    const response = await fillCompat(server.url, {
      chainId: chain.id,
      from: userAccount.address,
      to: '0x0000000000000000000000000000000000000000',
    })

    expect(response.transaction.feePayerSignature).toBeUndefined()
    expect(response.sponsor).toBeUndefined()
    expect(response.capabilities?.sponsor).toBeUndefined()
  })

  test('behavior: supports eth_signRawTransaction', async () => {
    const sponsorClient = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url)),
    })

    const receipt = await sendTransactionSync(sponsorClient, {
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

  test('behavior: supports eth_sendRawTransaction', async () => {
    const sponsorClient = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url), {
        policy: 'sign-and-broadcast',
      }),
    })

    const hash = await sendTransaction(sponsorClient, {
      feePayer: true,
      to: '0x0000000000000000000000000000000000000001',
    })
    const receipt = await waitForTransactionReceipt(getClient(), { hash })

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransaction",
      ]
    `)
  })

  test('behavior: supports eth_sendRawTransactionSync', async () => {
    const sponsorClient = getClient({
      account: userAccount,
      transport: withFeePayer(http(), http(server.url), {
        policy: 'sign-and-broadcast',
      }),
    })

    const receipt = await sendTransactionSync(sponsorClient, {
      feePayer: true,
      to: '0x0000000000000000000000000000000000000002',
    })

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransactionSync",
      ]
    `)
  })

  test('behavior: skips raw sponsorship when transaction did not request feePayer', async () => {
    const plain = await fillCompat(server.url, {
      chainId: chain.id,
      from: userAccount.address,
      to: '0x0000000000000000000000000000000000000004',
    })
    const signed = await signSponsoredTx(userAccount, plain.transaction)

    requests = []

    const receipt = (await getClient({ transport: http(server.url) }).request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransactionSync",
      ]
    `)
  })
})

describe('behavior: feePayer compatibility with validate', () => {
  const rejectedAccount = accounts[3]!
  let server: Server
  let requests: RpcRequest.RpcRequest[] = []

  beforeAll(async () => {
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

    server = await createServer(
      relay({
        account: feePayerAccount,
        chains: [chain],
        transports: { [chain.id]: http() },
        validate: (request) => request.from?.toLowerCase() !== rejectedAccount.address.toLowerCase(),
        onRequest: async (request) => {
          requests.push(request)
        },
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    requests = []
  })

  test('behavior: top-level validate rejects raw sponsorship requests', async () => {
    const sponsorClient = getClient({
      account: rejectedAccount,
      transport: withFeePayer(http(), http(server.url)),
    })

    await expect(
      sendTransactionSync(sponsorClient, {
        feePayer: true,
        to: '0x0000000000000000000000000000000000000003',
      }),
    ).rejects.toThrowError()

    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_signRawTransaction",
      ]
    `)
  })
})
