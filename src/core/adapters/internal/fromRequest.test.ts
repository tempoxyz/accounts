import { Hex, Provider as ox_Provider } from 'ox'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import { fromRequest } from './fromRequest.js'

const root = accounts[0]!
const accessKey = accounts[1]!

/** Connects a request-based adapter whose wallet rejects every request after connecting. */
async function connect(retryCount?: number | undefined) {
  const requests: { context: unknown; method: string }[] = []
  const provider = Provider.create({
    adapter: fromRequest({
      name: 'Test',
      rdns: 'xyz.tempo.test',
      async request({ context, method }) {
        if (method === 'wallet_connect')
          return { accounts: [{ address: root.address, capabilities: {} }] }
        requests.push({ context, method })
        throw new Error('request rejected')
      },
      ...(retryCount !== undefined ? { retryCount } : {}),
    }),
    chains: [tempo, tempoModerato],
    mpp: false,
    storage: Storage.memory(),
  })
  await provider.request({ method: 'wallet_connect' })
  return { provider, requests }
}

const parameters = {
  accessKeyAddress: accessKey.address,
  address: root.address,
  chainId: Hex.fromNumber(tempoModerato.id),
} as const

describe.each([
  { method: 'wallet_revokeAccessKey', params: [parameters] },
  {
    method: 'wallet_updateAccessKey',
    params: [{ ...parameters, limits: [{ limit: '0x1', token: accessKey.address }] }],
  },
] as const)('$method', (request) => {
  test('behavior: sends a failed request once on the target chain with retryCount 0', async () => {
    const { provider, requests } = await connect(0)

    await expect(provider.request(request)).rejects.toThrowErrorMatchingInlineSnapshot(`
      [RpcResponse.InternalError: An unknown RPC error occurred.

      Details: request rejected
      Version: viem@0.0.0-9348d386a9f62fd6713124e25360d6040e4a34cf]
    `)
    expect(requests.map(({ method }) => method)).toEqual([request.method])
    expect(requests.map(({ context }) => context)).toMatchInlineSnapshot(`
      [
        {
          "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "chainId": 42431,
        },
      ]
    `)
  })

  test('behavior: sends a failed request once by default', async () => {
    const { provider, requests } = await connect()

    await expect(provider.request(request)).rejects.toThrow('request rejected')
    expect(requests.map(({ method }) => method)).toEqual([request.method])
  })

  test('behavior: sends a failed request twice on the target chain with retryCount 1', async () => {
    const { provider, requests } = await connect(1)

    await expect(provider.request(request)).rejects.toThrowErrorMatchingInlineSnapshot(`
      [RpcResponse.InternalError: An unknown RPC error occurred.

      Details: request rejected
      Version: viem@0.0.0-9348d386a9f62fd6713124e25360d6040e4a34cf]
    `)
    expect(requests.map(({ method }) => method)).toEqual([request.method, request.method])
    expect(requests.map(({ context }) => context)).toMatchInlineSnapshot(`
      [
        {
          "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "chainId": 42431,
        },
        {
          "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "chainId": 42431,
        },
      ]
    `)
  })

  test('error: rejects an account that is not connected before sending', async () => {
    const { provider, requests } = await connect(0)

    await expect(
      provider.request({
        ...request,
        params: [{ ...request.params[0], address: accessKey.address }],
      } as never),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650" not found.]`,
    )
    expect(requests).toEqual([])
  })
})

test.each([
  {
    method: 'eth_sendTransactionSync',
    params: [{ calls: [{ to: accessKey.address }] }],
  },
  {
    method: 'wallet_authorizeAccessKey',
    params: [{ expiry: 9999999999, keyType: 'secp256k1' }],
  },
] as const)('$method: sends a failed wallet request once by default', async (request) => {
  const { provider, requests } = await connect()

  await expect(provider.request(request as never)).rejects.toThrow('request rejected')
  expect(requests.map(({ method }) => method)).toEqual([request.method])
})

test.each([
  'eth_signTransaction',
  'eth_sendTransaction',
  'eth_sendTransactionSync',
  'eth_fillTransaction',
] as const)('%s rejects an explicit account absent from the connected wallet', async (method) => {
  const { provider, requests } = await connect(0)
  await provider.store.accessKeys.authorize({
    account: accessKey,
    chainId: tempo.id,
    parameters: {
      expiry: 9999999999,
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000003',
    },
  })
  await expect(
    provider.request({
      method,
      params: [{ from: accessKey.address, to: root.address }],
    }),
  ).rejects.toThrow('not found')
  expect(requests).toMatchInlineSnapshot(`[]`)
})

test.each([
  { method: 'eth_sendTransaction', sync: undefined },
  { method: 'eth_sendTransactionSync', sync: undefined },
  { method: 'wallet_sendCalls', sync: false },
  { method: 'wallet_sendCalls', sync: true },
] as const)("$method (sync: $sync) preserves the wallet's user rejection", async (request) => {
  const { method, sync } = request
  const provider = Provider.create({
    adapter: fromRequest({
      name: 'Test',
      rdns: 'xyz.tempo.test',
      async request({ method }) {
        if (method === 'wallet_connect')
          return { accounts: [{ address: root.address, capabilities: {} }] }
        throw new ox_Provider.UserRejectedRequestError()
      },
    }),
    chains: [tempo, tempoModerato],
    mpp: false,
    storage: Storage.memory(),
  })
  await provider.request({ method: 'wallet_connect' })

  const error = (await provider
    .request({
      method,
      params: [
        {
          calls: [{ to: accessKey.address }],
          ...(sync !== undefined ? { capabilities: { sync } } : {}),
        },
      ],
    } as never)
    .catch((error) => error)) as ox_Provider.ProviderRpcError
  expect({ code: error.code, name: error.name }).toMatchInlineSnapshot(`
    {
      "code": 4001,
      "name": "Provider.UserRejectedRequestError",
    }
  `)
})
