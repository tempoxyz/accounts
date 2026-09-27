import { Secp256k1 } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import {
  fillTransaction,
  getBlock,
  getTransaction,
  sendTransactionSync,
  waitForTransactionReceipt,
} from 'viem/actions'
import { Account, Actions, Addresses } from 'viem/tempo'
import { beforeAll, describe, expect, test } from 'vp/test'

import { accounts, chain, getClient } from '../../test/config.js'
import { local } from './adapters/local.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const client = getClient()
const payer = accounts[0]
const token = '0x20c0000000000000000000000000000000000001'
const to = '0x0000000000000000000000000000000000000001'
const call = Actions.token.transfer.call({ to, token, amount: 1n })

beforeAll(async () => {
  while ((await getBlock(client)).timestamp === 0n)
    await new Promise((resolve) => setTimeout(resolve, 50))
})

async function setup(keyType: 'secp256k1' | 'webAuthn_headless') {
  const privateKey = Secp256k1.randomPrivateKey()
  const account =
    keyType === 'secp256k1'
      ? Account.fromSecp256k1(privateKey)
      : Account.fromHeadlessWebAuthn(privateKey, {
          rpId: 'example.com',
          origin: 'https://example.com',
        })
  const provider = Provider.create({
    adapter: local({
      loadAccounts: async () => ({
        accounts: [
          {
            address: account.address,
            privateKey,
            ...(keyType === 'secp256k1'
              ? { keyType }
              : { keyType, rpId: 'example.com', origin: 'https://example.com' }),
          },
        ],
      }),
    }),
    chains: [chain],
    feePayer: payer,
    storage: Storage.memory(),
  })
  await provider.request({ method: 'wallet_connect' })
  await Actions.token.transferSync(client, {
    account: payer,
    to: account.address,
    token,
    amount: 100n,
  })
  expect(
    await Actions.token.getBalance(client, { account: account.address, token: Addresses.pathUsd }),
  ).toMatchObject({ amount: 0n })
  return { account, provider }
}

describe.each(['secp256k1', 'webAuthn_headless'] as const)('local fee payer: %s', (keyType) => {
  test.each(['eth_sendTransaction', 'eth_sendTransactionSync', 'eth_signTransaction'] as const)(
    '%s',
    async (method) => {
      const { account, provider } = await setup(keyType)
      const result = await provider.request({
        method,
        params: [{ calls: [call], feePayer: true, feeToken: Addresses.pathUsd }],
      })
      const hash =
        method === 'eth_signTransaction'
          ? await client.request({
              method: 'eth_sendRawTransaction',
              params: [result as `0x${string}`],
            })
          : typeof result === 'string'
            ? result
            : result.transactionHash
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.status).toBe('success')
      expect(receipt.feePayer).toBe(payer.address.toLowerCase())
      expect(receipt.from).toBe(account.address.toLowerCase())
      expect(
        await Actions.token.getBalance(client, {
          account: account.address,
          token: Addresses.pathUsd,
        }),
      ).toMatchObject({ amount: 0n })
      if (method === 'eth_signTransaction')
        expect(
          TxEnvelopeTempo.deserialize(result as TxEnvelopeTempo.Serialized).feePayerSignature,
        ).toBeDefined()
    },
  )

  test('connector-style client uses the configured payer by default', async () => {
    const { account, provider } = await setup(keyType)
    const receipt = await sendTransactionSync(provider.getClient(), {
      account: account.address,
      calls: [call],
      feeToken: Addresses.pathUsd,
    })
    expect(receipt.feePayer).toBe(payer.address.toLowerCase())
    expect(receipt.status).toBe('success')
  })

  test('managed access key uses the configured payer', async () => {
    const { provider } = await setup(keyType)
    await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry: Math.floor(Date.now() / 1000) + 3600 }],
    })
    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [call], feePayer: true, feeToken: Addresses.pathUsd }],
    })
    expect(receipt.feePayer).toBe(payer.address.toLowerCase())
    const transaction = await getTransaction(client, { hash: receipt.transactionHash })
    expect(transaction.signature?.type).toBe('keychain')
  })

  test('local callers fill through the provider without forwarding the signer', async () => {
    const { provider } = await setup(keyType)
    const result = await fillTransaction(provider.getClient({ chainId: chain.id }), {
      account: provider.getAccount({ signable: true }),
      calls: [call],
      feePayer: payer,
      feeToken: Addresses.pathUsd,
    })
    expect(result.transaction.calls).toEqual([{ to: call.to, data: call.data, value: 0n }])
    expect(result.transaction.gas).toBeGreaterThan(0n)
  })

  test('explicit false opts out of the configured payer', async () => {
    const { account, provider } = await setup(keyType)
    await Actions.token.transferSync(client, {
      account: payer,
      to: account.address,
      token: Addresses.pathUsd,
      amount: 1_000_000n,
    })
    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [call], feePayer: false, feeToken: Addresses.pathUsd }],
    })
    expect(receipt.feePayer).toBe(account.address.toLowerCase())
  })
})
