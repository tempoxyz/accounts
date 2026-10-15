import { custom } from 'viem'
import { describe, expect, test } from 'vp/test'

import { accounts, chain } from '../../test/config.js'
import { createDeviceCodeHost, submitVerify } from '../../test/deviceCode.js'
import { createServer } from '../../test/utils.js'
import * as Adapter from '../core/Adapter.js'
import * as CoreProvider from '../core/Provider.js'
import * as Storage from '../core/Storage.js'
import { cli } from './adapter.js'

const root = accounts[0]!
const accessKey = accounts[1]!

describe('cli', () => {
  test.each([
    { retryCount: undefined, attempts: 1 },
    { retryCount: 1, attempts: 2 },
  ])(
    'behavior: sends a failed wallet request $attempts time(s) (retryCount: $retryCount)',
    async ({ retryCount, attempts }) => {
      const host = createDeviceCodeHost({ pollingInterval: 10 })
      const server = await createServer(host.listener)

      try {
        const provider = CoreProvider.create({
          adapter: cli({
            host: `${server.url}/auth/device`,
            open: (_url, prompt) => void submitVerify(prompt),
            pollingInterval: 10,
            ...(retryCount !== undefined ? { retryCount } : {}),
          }),
          chains: [chain],
          storage: Storage.memory(),
        })
        await provider.request({ method: 'wallet_connect' })

        host.setProviderOptions({
          adapter: Adapter.define({}, () => ({
            actions: {
              createAccount: async () => ({ accounts: [root] }),
              loadAccounts: async () => ({ accounts: [root] }),
              async revokeAccessKey() {
                throw new Error('revocation rejected')
              },
            },
          })),
        })

        await expect(
          provider.request({
            method: 'wallet_revokeAccessKey',
            params: [{ accessKeyAddress: accessKey.address, address: root.address }],
          }),
        ).rejects.toThrow('revocation rejected')
        expect(host.requests().map(({ method }) => method)).toEqual([
          'wallet_connect',
          ...Array(attempts).fill('wallet_revokeAccessKey'),
        ])
      } finally {
        await server.closeAsync()
      }
    },
  )

  test('behavior: sends a timed-out wallet request once', async () => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)
    const approvals: string[] = []

    try {
      const provider = CoreProvider.create({
        adapter: cli({
          host: `${server.url}/auth/device`,
          async open(url, prompt) {
            const { requests } = (await (await fetch(url)).json()) as {
              requests: readonly { method: string }[]
            }
            approvals.push(...requests.map(({ method }) => method))
            if (requests.some(({ method }) => method === 'wallet_connect'))
              await submitVerify(prompt)
          },
          pollingInterval: 10,
          timeout: 1_000,
        }),
        chains: [chain],
        storage: Storage.memory(),
      })
      await provider.request({ method: 'wallet_connect' })

      await expect(
        provider.request({
          method: 'eth_sendTransactionSync',
          params: [{ calls: [{ to: root.address }] }],
        }),
      ).rejects.toThrow('Timed out waiting for device code')
      expect(approvals).toMatchInlineSnapshot(`
        [
          "wallet_connect",
          "eth_sendTransactionSync",
        ]
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: retries failed chain reads', async () => {
    let attempts = 0
    const provider = CoreProvider.create({
      adapter: cli({ host: 'http://localhost/auth/device', open() {} }),
      chains: [chain],
      storage: Storage.memory(),
      transports: {
        [chain.id]: custom({
          async request() {
            attempts++
            if (attempts < 3) throw new Error('unavailable')
            return '0x1'
          },
        }),
      },
    })

    expect(await provider.request({ method: 'eth_blockNumber' })).toMatchInlineSnapshot(`"0x1"`)
    expect(attempts).toMatchInlineSnapshot(`3`)
  })
})
