import { MultisigConfig, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { fillTransaction } from 'viem/actions'
import { Account } from 'viem/tempo'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import * as Multisig from './multisig.js'
import { relay } from './relay.js'

const owner_1 = accounts[1]!
const owner_2 = accounts[2]!
const feePayer = accounts[0]!
const tag = import.meta.env.VITE_NODE_TAG || 'sha-3da8342'

describe.skipIf(!tag.startsWith('sha-'))('relay multisig', () => {
  const store = Multisig.memoryStore()
  let client: ReturnType<typeof getClient<typeof chain>>
  let server: Server

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [chain],
        feePayer: { account: feePayer },
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
    const { transaction } = await fillTransaction(client, {
      account,
      to: account.address,
      value: 0n,
    } as never)
    const { account: _account, gas, ...filled } = transaction as Record<string, unknown>
    const request = {
      ...filled,
      feePayerSignature: null,
      gas: typeof gas === 'bigint' ? gas + 100_000n : gas,
    }
    const envelope = transactionEnvelope(request)
    const payload = TxEnvelopeTempo.getSignPayload(envelope)
    const genesisConfigId = MultisigConfig.toId(account.config)
    const id = MultisigConfig.getSignPayload({
      account: account.address,
      genesisConfigId,
      payload,
    })
    const signature_1 = await signApproval({ digest: id, signer: owner_1 })
    const signature_2 = await signApproval({ digest: id, signer: owner_2 })

    const pending = await client.request({
      method: 'eth_sendRawTransactionSync',
      params: [serializeTransaction({ account, request, signatures: [signature_1] })],
    } as never)

    expect(pending).toMatchInlineSnapshot(`"${id}"`)
    await expect(
      client.request({ method: 'eth_getTransactionReceipt', params: [id] }),
    ).resolves.toMatchInlineSnapshot(`null`)

    const receipt = (await client.request({
      method: 'eth_sendRawTransactionSync',
      params: [serializeTransaction({ account, request, signatures: [signature_2] })],
    } as never)) as { status?: string | undefined; transactionHash?: `0x${string}` | undefined }
    const hash = receipt.transactionHash
    if (!hash) throw new Error('Expected multisig transaction hash.')

    expect(hash === id).toMatchInlineSnapshot(`false`)
    expect(receipt).toMatchObject({
      status: '0x1',
    })
    await expect(
      client.request({ method: 'eth_getTransactionReceipt', params: [id] }),
    ).resolves.toMatchObject({ transactionHash: hash })
  })
})

async function signApproval(options: { digest: `0x${string}`; signer: typeof owner_1 }) {
  const { digest, signer } = options
  return SignatureEnvelope.serialize(SignatureEnvelope.from(await signer.sign({ hash: digest })))
}

function serializeTransaction(options: {
  account: ReturnType<typeof Account.fromMultisig>
  request: Record<string, unknown>
  signatures: readonly `0x${string}`[]
}) {
  const { account, request } = options
  const envelope = transactionEnvelope(request)
  const payload = TxEnvelopeTempo.getSignPayload(envelope)
  const genesisConfigId = MultisigConfig.toId(account.config)
  const signatures = SignatureEnvelope.sortMultisigApprovals({
    account: account.address,
    genesisConfigId,
    payload,
    signatures: options.signatures.map((signature) => SignatureEnvelope.from(signature)),
  })
  return TxEnvelopeTempo.serialize(envelope, {
    feePayerSignature: undefined,
    signature: SignatureEnvelope.from({
      account: account.address,
      genesisConfigId,
      init: account.config,
      signatures,
    }),
  })
}

function transactionEnvelope(request: Record<string, unknown>) {
  const {
    _capabilities,
    account: _account,
    data,
    from: _from,
    multisig: _multisig,
    signature: _signature,
    signatures: _signatures,
    to,
    value,
    ...transaction
  } = request
  const calls = (() => {
    if ('calls' in transaction) return transaction.calls
    if (typeof to !== 'string') return undefined
    return [
      {
        ...(typeof data === 'string' ? { data } : {}),
        to,
        value: typeof value === 'bigint' ? value : 0n,
      },
    ]
  })()
  return TxEnvelopeTempo.from({ ...transaction, calls } as never)
}
