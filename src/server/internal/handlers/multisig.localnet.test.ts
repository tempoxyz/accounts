import { getTransactionReceipt, prepareTransactionRequest, signTransaction } from 'viem/actions'
import { Account } from 'viem/tempo'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import * as Multisig from './multisig.js'
import { relay } from './relay.js'

const owner_1 = accounts[1]!
const owner_2 = accounts[2]!
const feePayer = accounts[0]!
const feeToken = '0x20c0000000000000000000000000000000000000' as const
// Requires a node build with the config-id-free TIP-1061 wire format
// (tempoxyz/tempo#5178), e.g. VITE_NODE_TAG=sha-8968664.
const tag = import.meta.env.VITE_NODE_TAG || ''

describe.skipIf(!tag.startsWith('sha-'))('relay multisig', () => {
  const store = Multisig.memoryStore()
  let client: ReturnType<typeof getClient<typeof chain>>
  let server: Server

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [chain],
        feePayer: { account: feePayer, feeToken },
        multisig: { store },
        transports: { [chain.id]: http() },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: collects approvals and resolves operation-id receipt aliases on localnet', async () => {
    const account = Account.fromMultisig({
      threshold: 2,
      owners: [
        { owner: owner_1.address, weight: 1 },
        { owner: owner_2.address, weight: 1 },
      ],
    })
    const transaction = await prepareTransactionRequest(client, {
      account,
      feePayer: true,
      to: account.address,
      value: 0n,
    })
    const [signature_1, signature_2] = await Promise.all(
      [owner_1, owner_2].map((owner) =>
        signTransaction(client, { ...transaction, account: owner } as never),
      ),
    )

    // `feePayerSignature: null` requests relay sponsorship at broadcast; the
    // fill-time fee payer signature is stale once the multisig signature is
    // attached.
    const serialize = (signature: unknown) =>
      account.signTransaction({
        ...transaction,
        feePayerSignature: null,
        signatures: [signature],
      } as never)

    // Below-quorum submission stores the approval and returns the operation id.
    const pending = (await client.request({
      method: 'eth_sendRawTransactionSync',
      params: [await serialize(signature_1)],
    } as never)) as `0x${string}`

    expect(pending).toMatch(/^0x[0-9a-f]{64}$/)
    await expect(
      client.request({ method: 'eth_getTransactionReceipt', params: [pending] }),
    ).resolves.toBeNull()

    // Quorum reached: the relay merges the stored approval and broadcasts.
    const receipt = (await client.request({
      method: 'eth_sendRawTransactionSync',
      params: [await serialize(signature_2)],
    } as never)) as { status: string; transactionHash: `0x${string}` }
    const hash = receipt.transactionHash
    if (!hash) throw new Error('Expected multisig transaction hash.')

    expect(hash === pending).toBe(false)
    expect(receipt).toMatchObject({ status: '0x1' })
    await expect(getTransactionReceipt(client, { hash: pending })).resolves.toMatchObject({
      transactionHash: hash,
    })
  })
})
