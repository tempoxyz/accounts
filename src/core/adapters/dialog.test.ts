import { Provider as ox_Provider } from 'ox'
import { tempoLocalnet } from 'viem/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as AccessKey from '../AccessKey.js'
import * as Dialog from '../Dialog.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { dialog } from './dialog.js'

const address = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'

describe('dialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('behavior: sendTransaction signs locally when an access key is selected', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    const clientRequests: unknown[] = []
    const signRequests: unknown[] = []
    vi.spyOn(AccessKey, 'selectAccount').mockReturnValue({
      accessKeyAddress: '0x0000000000000000000000000000000000000099',
      address: '0x0000000000000000000000000000000000000099',
      signTransaction: async (request: unknown) => {
        signRequests.push(request)
        return '0xsigned'
      },
      source: 'accessKey',
      type: 'local',
    } as never)
    const adapter = dialog({ dialog: Dialog.noop() })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () =>
        ({
          chain: { id: tempoLocalnet.id },
          request: async (request: unknown) => {
            clientRequests.push(request)
            return '0xtransaction'
          },
        }) as never,
      storage,
      store,
    })

    const result = await adapter.actions.sendTransaction(
      {
        calls: [{ data: '0x12345678', to: recipient }],
        chainId: 1,
        from: address,
        gas: 1n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
      },
      {
        method: 'eth_sendTransaction',
        params: [
          {
            calls: [{ data: '0x12345678' as const, to: recipient }],
            chainId: '0x1' as const,
            from: address,
          },
        ] as const,
      },
    )

    expect(result).toMatchInlineSnapshot(`"0xtransaction"`)
    expect(signRequests.length).toMatchInlineSnapshot(`1`)
    expect(clientRequests).toMatchInlineSnapshot(`
      [
        {
          "method": "eth_sendRawTransaction",
          "params": [
            "0xsigned",
          ],
        },
      ]
    `)
    expect(store.getState().requestQueue).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: sendTransaction falls through when no access key is selected', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    vi.spyOn(AccessKey, 'selectAccount').mockReturnValue(undefined)
    const lookups: unknown[] = []
    const adapter = dialog({ dialog: Dialog.noop() })({
      getAccount: (options) => {
        lookups.push(options)
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const request = {
      method: 'eth_sendTransaction' as const,
      params: [
        {
          calls: [{ data: '0x12345678' as const, to: recipient }],
          chainId: '0x1' as const,
          from: address,
        },
      ] as const,
    }

    const promise = adapter.actions.sendTransaction(
      {
        calls: [{ data: '0x12345678', to: recipient }],
        chainId: 1,
        from: address,
      },
      request,
    )

    await vi.waitFor(() => {
      if (!store.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = store.getState().requestQueue[0]!
    store.setState({
      requestQueue: [
        {
          request: queued.request,
          result: '0x1234',
          status: 'success',
        },
      ],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    expect(lookups).toMatchInlineSnapshot(`[]`)
  })

  test('error: wallet validation errors keep their RPC code', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    vi.spyOn(AccessKey, 'selectAccount').mockReturnValue(undefined)
    const adapter = dialog({ dialog: Dialog.noop() })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const promise = adapter.actions.sendTransaction(
      {
        calls: [{ data: '0x12345678', to: recipient }],
        chainId: 1,
        from: address,
      },
      {
        method: 'eth_sendTransaction',
        params: [
          {
            calls: [{ data: '0x12345678' as const, to: recipient }],
            chainId: '0x1' as const,
            from: address,
          },
        ] as const,
      },
    )

    await vi.waitFor(() => {
      if (!store.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = store.getState().requestQueue[0]!
    store.setState({
      requestQueue: [
        {
          request: queued.request,
          error: {
            code: -32602,
            message: '`authorizeAccessKey` must include at least one `limits` entry.',
          },
          status: 'error',
        },
      ],
    })

    await expect(
      promise.catch((error) => ({
        code: error.code,
        message: error.message,
        name: error.name,
      })),
    ).resolves.toMatchInlineSnapshot(`
      {
        "code": -32602,
        "message": "\`authorizeAccessKey\` must include at least one \`limits\` entry.",
        "name": "RpcResponse.InvalidParamsError",
      }
    `)
  })
})
