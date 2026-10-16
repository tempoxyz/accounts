import { Hex } from 'ox'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import { fromRequest } from './fromRequest.js'

const root = accounts[0]!
const accessKey = accounts[1]!

describe('revokeAccessKey', () => {
  test.each([
    { case: 'once with retryCount 0', retryCount: 0, attempts: 1 },
    { case: 'twice with retryCount 1', retryCount: 1, attempts: 2 },
  ])(
    'behavior: sends a failed revocation on the target chain $case',
    async ({ retryCount, attempts }) => {
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

      await expect(
        provider.request({
          method: 'wallet_revokeAccessKey',
          params: [
            {
              accessKeyAddress: accessKey.address,
              address: root.address,
              chainId: Hex.fromNumber(tempoModerato.id),
            },
          ],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
        [RpcResponse.InternalError: An unknown RPC error occurred.

        Details: revocation rejected
        Version: viem@2.57.1]
      `)
      expect(requests).toEqual(
        Array(attempts).fill({
          context: { account: root.address, chainId: tempoModerato.id },
          method: 'wallet_revokeAccessKey',
        }),
      )
    },
  )
})
