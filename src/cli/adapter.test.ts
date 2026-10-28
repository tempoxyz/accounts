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

/** Connects through the CLI adapter, then makes the host reject every revocation. */
async function connect(options: {
  host: ReturnType<typeof createDeviceCodeHost>
  retryCount?: number | undefined
  server: Awaited<ReturnType<typeof createServer>>
}) {
  const { host, retryCount, server } = options
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
  return provider
}

function revoke(provider: CoreProvider.Provider) {
  return provider.request({
    method: 'wallet_revokeAccessKey',
    params: [{ accessKeyAddress: accessKey.address, address: root.address }],
  })
}

describe('cli', () => {
  test('behavior: sends a failed wallet request once', async () => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)

    try {
      const provider = await connect({ host, server })

      await expect(revoke(provider)).rejects.toThrowErrorMatchingInlineSnapshot(`
        [RpcResponse.InternalError: An internal error was received.

        Details: revocation rejected
        Version: viem@0.0.0-d18ea6dc3d66f8bc327005bf1e764450f20f5c5b]
      `)
      expect(host.requests().map(({ method }) => method)).toMatchInlineSnapshot(`
        [
          "wallet_connect",
          "wallet_revokeAccessKey",
        ]
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('behavior: retryCount overrides the default', async () => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)

    try {
      const provider = await connect({ host, retryCount: 1, server })

      await expect(revoke(provider)).rejects.toThrowErrorMatchingInlineSnapshot(`
        [RpcResponse.InternalError: An internal error was received.

        Details: revocation rejected
        Version: viem@0.0.0-d18ea6dc3d66f8bc327005bf1e764450f20f5c5b]
      `)
      expect(host.requests().map(({ method }) => method)).toMatchInlineSnapshot(`
        [
          "wallet_connect",
          "wallet_revokeAccessKey",
          "wallet_revokeAccessKey",
        ]
      `)
    } finally {
      await server.closeAsync()
    }
  })

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

      const error = await provider
        .request({
          method: 'eth_sendTransactionSync',
          params: [{ calls: [{ to: root.address }] }],
        })
        .then(
          () => undefined,
          (error: Error) => error,
        )
      // The user code and server port are random per run.
      expect({
        message: error?.message
          .replaceAll(server.url, '<server>')
          .replaceAll(/[A-Z]{4}-[A-Z]{4}/g, '<code>'),
        name: error?.name,
      }).toMatchInlineSnapshot(`
        {
          "message": "An internal error was received.

        Details: Timed out waiting for device code <code>. Continue at <server>/auth/device/verify?user_code=<code>.
        Version: viem@0.0.0-d18ea6dc3d66f8bc327005bf1e764450f20f5c5b",
          "name": "RpcResponse.InternalError",
        }
      `)
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
