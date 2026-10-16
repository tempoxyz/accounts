import { Hex } from 'ox'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import { fromRequest } from './fromRequest.js'

const root = accounts[0]!
const accessKey = accounts[1]!

/** Connects a request-based adapter whose wallet rejects every revocation. */
async function connect(retryCount: number) {
  const requests: unknown[] = []
  const provider = Provider.create({
    adapter: fromRequest({
      name: 'Test',
      rdns: 'xyz.tempo.test',
      async request({ context, method }) {
        if (method === 'wallet_connect')
          return { accounts: [{ address: root.address, capabilities: {} }] }
        requests.push({ context, method })
        throw new Error('revocation rejected')
      },
      retryCount,
    }),
    chains: [tempo, tempoModerato],
    storage: Storage.memory(),
  })
  await provider.request({ method: 'wallet_connect' })
  return { provider, requests }
}

function revoke(provider: Provider.Provider) {
  return provider.request({
    method: 'wallet_revokeAccessKey',
    params: [
      {
        accessKeyAddress: accessKey.address,
        address: root.address,
        chainId: Hex.fromNumber(tempoModerato.id),
      },
    ],
  })
}

describe('revokeAccessKey', () => {
  test('behavior: sends a failed revocation once on the target chain with retryCount 0', async () => {
    const { provider, requests } = await connect(0)

    await expect(revoke(provider)).rejects.toThrowErrorMatchingInlineSnapshot(`
      [RpcResponse.InternalError: An unknown RPC error occurred.

      Details: revocation rejected
      Version: viem@2.57.1]
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "context": {
            "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "chainId": 42431,
          },
          "method": "wallet_revokeAccessKey",
        },
      ]
    `)
  })

  test('behavior: sends a failed revocation twice on the target chain with retryCount 1', async () => {
    const { provider, requests } = await connect(1)

    await expect(revoke(provider)).rejects.toThrowErrorMatchingInlineSnapshot(`
      [RpcResponse.InternalError: An unknown RPC error occurred.

      Details: revocation rejected
      Version: viem@2.57.1]
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "context": {
            "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "chainId": 42431,
          },
          "method": "wallet_revokeAccessKey",
        },
        {
          "context": {
            "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "chainId": 42431,
          },
          "method": "wallet_revokeAccessKey",
        },
      ]
    `)
  })
})
