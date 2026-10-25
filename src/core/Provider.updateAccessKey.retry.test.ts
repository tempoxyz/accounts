import { createWalletClient, custom } from 'viem'
import { tempo } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, beforeEach, describe, expect, test } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Schema from './Schema.js'
import * as Storage from './Storage.js'

const address = '0x1111111111111111111111111111111111111111'
const key = '0x2222222222222222222222222222222222222222'
const token = '0x20c0000000000000000000000000000000000001'
const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
const parameters = {
  address,
  accessKeyAddress: key,
  limits: [{ token, limit: '0x0' }],
} as const

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled'))
})

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function setup(receipt: { status: 'pending' | '0x0' | '0x1'; transactionHash: typeof hash }) {
  const sign = vi.fn(async () => '0x' as const)
  const account = { address, type: 'local', signTransaction: sign } as const
  const prepare = vi.fn(async () => ({}))
  const rpc = vi.fn(async ({ method }: { method: string }) => {
    if (method !== 'eth_sendRawTransactionSync') throw new Error(`Unexpected RPC: ${method}`)
    return { ...receipt, logs: [] }
  })
  const provider = Provider.create({
    adapter: Adapter.define(
      { name: 'Synthetic wallet', rdns: 'test.update-access-key-retry' },
      ({ getClient }) => {
        // Keep the real send action and receipt formatter; stub preparation and signing only.
        Object.assign(getClient(), { prepareTransactionRequest: prepare })
        return {
          actions: {
            async createAccount() {
              return { accounts: [{ address }] }
            },
            async loadAccounts() {
              return { accounts: [{ address }] }
            },
          },
          getAccount: () => ({ account }) as never,
        }
      },
    ),
    chains: [tempo],
    mpp: false,
    storage: Storage.memory(),
    transports: { [tempo.id]: custom({ request: rpc }) },
  })
  await provider.ready()
  provider.store.setState({
    accounts: [{ address }],
    activeAccount: 0,
    accessKeys: [
      {
        access: address,
        address: key,
        chainId: tempo.id,
        keyType: 'secp256k1',
        limits: [{ token, limit: 9n }],
        permissionSemantics: 1,
      },
    ],
  })
  const request = vi.spyOn(provider, 'request')
  const client = createWalletClient({
    chain: tempo,
    rpcSchema: Schema.viem,
    transport: custom(provider),
  })
  return { client, prepare, provider, request, rpc, sign }
}

describe('wallet_updateAccessKey through default Viem transport', () => {
  test.each([
    { status: 'pending', encoded: 'pending' },
    { status: 'reverted', encoded: '0x0' },
  ] as const)('does not resubmit after a $status receipt', async ({ status, encoded }) => {
    const fixture = await setup({ status: encoded, transactionHash: hash })
    const before = structuredClone(fixture.provider.store.getState())
    expect(fixture.client.transport.retryCount).toMatchInlineSnapshot('3')

    const request = fixture.client.request({
      method: 'wallet_updateAccessKey',
      params: [parameters],
    })
    await expect(request).rejects.toMatchObject({
      code: -32002,
      details: 'Access-key update is not confirmed',
      cause: {
        data: { chainId: tempo.id, status, transactionHash: hash },
      },
    })
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.prepare).toHaveBeenCalledTimes(1)
    expect(fixture.sign).toHaveBeenCalledTimes(1)
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith(
      { method: 'eth_sendRawTransactionSync', params: ['0x'] },
      undefined,
    )
    expect(fixture.provider.store.getState()).toEqual(before)
  })

  test('preserves successful updates through the default transport', async () => {
    const fixture = await setup({ status: '0x1', transactionHash: hash })
    const before = structuredClone(fixture.provider.store.getState())
    expect(fixture.client.transport.retryCount).toMatchInlineSnapshot('3')

    expect(
      await fixture.client.request({ method: 'wallet_updateAccessKey', params: [parameters] }),
    ).toMatchInlineSnapshot('undefined')
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.prepare).toHaveBeenCalledTimes(1)
    expect(fixture.sign).toHaveBeenCalledTimes(1)
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith(
      { method: 'eth_sendRawTransactionSync', params: ['0x'] },
      undefined,
    )
    expect(fixture.provider.store.getState()).toEqual(before)
  })
})
