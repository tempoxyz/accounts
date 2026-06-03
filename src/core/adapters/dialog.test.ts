import { Provider as ox_Provider } from 'ox'
import { tempoLocalnet } from 'viem/tempo/chains'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vp/test'

import * as Dialog from '../Dialog.js'
import * as RemoteRequests from '../internal/RemoteRequests.js'
import * as Provider from '../Provider.js'
import type * as Remote from '../Remote.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { dialog } from './dialog.js'

const address = '0x0000000000000000000000000000000000000001'
const accessKey = '0x0000000000000000000000000000000000000002'
const host = 'https://wallet.test/embed'
const receipt = {
  blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  blockNumber: '0x1',
  contractAddress: null,
  cumulativeGasUsed: '0x1',
  effectiveGasPrice: '0x1',
  from: address,
  gasUsed: '0x1',
  logs: [],
  logsBloom: `0x${'00'.repeat(256)}`,
  status: '0x1',
  to: address,
  transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  transactionIndex: '0x0',
  type: '0x76',
}

function setup() {
  const storage = Storage.memory()
  const store = Store.create({ chainId: tempoLocalnet.id, storage })
  const dialog_ = createDialog()
  const adapter = dialog({ dialog: dialog_.dialog, host })({
    getAccount: (options) => {
      if (options?.signable) throw new ox_Provider.UnauthorizedError({ message: 'No signer.' })
      return { address, type: 'json-rpc' } as never
    },
    getClient: () => ({}) as never,
    storage,
    store,
  })
  return { adapter, dialog: dialog_, store }
}

function createDialog() {
  let parameters: Dialog.SetupFn.Parameters | undefined
  const syncs: Remote.Sync[] = []
  const synced: (readonly Remote.Request[])[] = []
  return {
    dialog: Dialog.define({ name: 'test' }, (options) => ({
      close() {},
      destroy() {},
      open() {},
      async syncRequests(sync) {
        parameters = options
        syncs.push(sync)
        synced.push(sync.requests)
      },
      syncTheme() {},
    })),
    async takeRequest() {
      await vi.waitFor(() => {
        if (!syncs[0]?.requests[0]) throw new Error('request not synced')
      })
      return syncs[0]!.requests[0]!
    },
    failure(request: Remote.Request, error: { code: number; message: string }) {
      parameters!.onResponse({ error, id: request.request.id })
    },
    success(request: Remote.Request, result: unknown) {
      parameters!.onResponse({ id: request.request.id, result })
    },
    syncs,
    synced,
  }
}

async function getDialogClient(adapter: ReturnType<typeof setup>['adapter']) {
  const result = await adapter.getAccount!()
  if (result.account.type !== 'json-rpc') throw new Error('Expected JSON-RPC account.')
  if (!result.transport) throw new Error('Expected dialog transport.')
  return result.transport({}) as never as {
    request: (request: unknown) => Promise<unknown>
  }
}

describe('dialog', () => {
  beforeEach(() => {
    RemoteRequests.reset(host)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    RemoteRequests.reset(host)
  })

  test('behavior: loadAccounts forwards auth capabilities returned by the dialog', async () => {
    const { adapter, dialog } = setup()
    const request = {
      method: 'wallet_connect' as const,
      params: [
        {
          capabilities: {
            auth: {
              url: 'https://app.example/auth',
              returnToken: true,
            },
          },
          chainId: '0x1079' as const,
        },
      ] as const,
    }

    const promise = adapter.actions.loadAccounts(undefined, request)

    const queued = await dialog.takeRequest()
    dialog.success(queued, {
      accounts: [
        {
          address,
          capabilities: {
            auth: { token: 'test-token' },
          },
        },
      ],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "auth": {
          "token": "test-token",
        },
      }
    `)
  })

  test('behavior: host session syncs pending requests through the attached dialog', async () => {
    const storage = Storage.memory()
    const store_a = Store.create({ chainId: 123, storage })
    store_a.setState({ accounts: [{ address }], activeAccount: 0 })
    const store_b = Store.create({ chainId: 456, storage })
    const dialog_a = createDialog()
    const dialog_b = createDialog()
    const adapter_a = dialog({ dialog: dialog_a.dialog, host })({
      getAccount: () => ({ address, type: 'json-rpc' }) as never,
      getClient: () => ({}) as never,
      storage,
      store: store_a,
    })
    const adapter_b = dialog({ dialog: dialog_b.dialog, host })({
      getAccount: () => ({ address, type: 'json-rpc' }) as never,
      getClient: () => ({}) as never,
      storage,
      store: store_b,
    })

    const client = await getDialogClient(adapter_a)
    const promise = client.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    })

    const queued = await dialog_b.takeRequest()

    expect(dialog_a.synced).toMatchInlineSnapshot(`[]`)
    expect(dialog_b.synced.map((requests) => requests.map((x) => x.request.method)))
      .toMatchInlineSnapshot(`
        [
          [
            "eth_sendTransaction",
          ],
        ]
      `)
    expect(dialog_b.syncs.map((sync) => ({ account: sync.account, chainId: sync.chainId })))
      .toMatchInlineSnapshot(`
        [
          {
            "account": {
              "address": "0x0000000000000000000000000000000000000001",
            },
            "chainId": 123,
          },
        ]
      `)

    dialog_b.success(queued, '0x1234')

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    adapter_a.cleanup?.()
    adapter_b.cleanup?.()
  })

  test('behavior: remounted provider resumes pending host requests', async () => {
    const storage = Storage.memory()
    const store_a = Store.create({ chainId: 123, storage })
    store_a.setState({ accounts: [{ address }], activeAccount: 0 })
    const dialog_a = createDialog()
    const adapter_a = dialog({ dialog: dialog_a.dialog, host })({
      getAccount: () => ({ address, type: 'json-rpc' }) as never,
      getClient: () => ({}) as never,
      storage,
      store: store_a,
    })

    const client = await getDialogClient(adapter_a)
    const promise = client.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    })

    const queued = await dialog_a.takeRequest()
    adapter_a.cleanup?.()

    const store_b = Store.create({ chainId: 456, storage })
    const dialog_b = createDialog()
    const adapter_b = dialog({ dialog: dialog_b.dialog, host })({
      getAccount: () => ({ address, type: 'json-rpc' }) as never,
      getClient: () => ({}) as never,
      storage,
      store: store_b,
    })

    expect(dialog_b.synced.map((requests) => requests.map((x) => x.request.method)))
      .toMatchInlineSnapshot(`
        [
          [
            "eth_sendTransaction",
          ],
        ]
      `)
    expect(dialog_b.syncs.map((sync) => ({ account: sync.account, chainId: sync.chainId })))
      .toMatchInlineSnapshot(`
        [
          {
            "account": {
              "address": "0x0000000000000000000000000000000000000001",
            },
            "chainId": 123,
          },
        ]
      `)

    dialog_b.success(queued, '0x1234')

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    adapter_b.cleanup?.()
  })

  test('behavior: resolving one pending request advances the remote queue', async () => {
    const { adapter, dialog } = setup()
    const client = await getDialogClient(adapter)

    const first = client.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    })
    const second = client.request({
      method: 'eth_signTransaction',
      params: [{ from: address }],
    })

    const request_1 = await dialog.takeRequest()
    dialog.success(request_1, '0x1')

    await expect(first).resolves.toMatchInlineSnapshot(`"0x1"`)
    expect(dialog.synced.map((requests) => requests.map((x) => x.request.id)))
      .toMatchInlineSnapshot(`
        [
          [
            0,
          ],
          [
            1,
          ],
        ]
      `)

    const request_2 = dialog.synced.at(-1)![0]!
    dialog.success(request_2, '0x2')

    await expect(second).resolves.toMatchInlineSnapshot(`"0x2"`)
  })

  test('behavior: dialog transport resolves chain ID locally', async () => {
    const { adapter, dialog } = setup()
    const client = await getDialogClient(adapter)

    await expect(client.request({ method: 'eth_chainId' })).resolves.toMatchInlineSnapshot(
      `"0x539"`,
    )
    expect(dialog.synced).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: provider forwards eth_sendTransaction without chain preflight', async () => {
    const dialog_ = createDialog()
    const provider = Provider.create({
      adapter: dialog({ dialog: dialog_.dialog, host }),
      chains: [tempoLocalnet],
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    const promise = provider.request({
      method: 'eth_sendTransaction',
      params: [{ calls: [{ to: address, value: '0x1' }] }],
    })
    const request = await dialog_.takeRequest()

    expect(request.request).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "method": "eth_sendTransaction",
        "params": [
          {
            "calls": [
              {
                "data": "0x",
                "to": "0x0000000000000000000000000000000000000001",
                "value": "0x1",
              },
            ],
            "chainId": "0x539",
            "data": undefined,
            "from": "0x0000000000000000000000000000000000000001",
            "to": undefined,
            "type": "0x76",
            "value": undefined,
          },
        ],
      }
    `)

    dialog_.success(request, '0x1234')

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
  })

  test('behavior: provider forwards eth_sendTransactionSync with encoded params', async () => {
    const dialog_ = createDialog()
    const provider = Provider.create({
      adapter: dialog({ dialog: dialog_.dialog, host }),
      chains: [tempoLocalnet],
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    const promise = provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [{ to: address, value: '0x1' }] }],
    })
    const request = await dialog_.takeRequest()

    expect(request.request).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "method": "eth_sendTransactionSync",
        "params": [
          {
            "calls": [
              {
                "to": "0x0000000000000000000000000000000000000001",
                "value": "0x1",
              },
            ],
            "chainId": "0x539",
            "from": "0x0000000000000000000000000000000000000001",
          },
        ],
      }
    `)

    dialog_.success(request, receipt)

    await expect(promise.then((x) => x.status)).resolves.toMatchInlineSnapshot(`"0x1"`)
  })

  test('behavior: provider forwards JSON-RPC access-key authorization with encoded params', async () => {
    const dialog_ = createDialog()
    const provider = Provider.create({
      adapter: dialog({ dialog: dialog_.dialog, host }),
      chains: [tempoLocalnet],
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })

    const promise = provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ address: accessKey, expiry: 123 }],
    })
    const request = await dialog_.takeRequest()

    expect(request.request).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "method": "wallet_authorizeAccessKey",
        "params": [
          {
            "address": "0x0000000000000000000000000000000000000002",
            "chainId": "0x539",
            "expiry": 123,
            "keyType": "secp256k1",
          },
        ],
      }
    `)

    dialog_.failure(request, { code: 4001, message: 'Rejected' })
    await promise.catch(() => undefined)
  })

  test('behavior: getAccount materializes a json-rpc account with dialog transport', async () => {
    const { adapter } = setup()

    const result = await adapter.getAccount!()

    expect(result.account).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000001",
        "type": "json-rpc",
      }
    `)
    expect(typeof result.transport).toMatchInlineSnapshot(`"function"`)
  })
})
