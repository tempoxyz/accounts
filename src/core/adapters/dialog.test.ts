import { Address, Hex, Provider as ox_Provider, PublicKey } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vp/test'

import * as Dialog from '../Dialog.js'
import * as AccessKeyTransaction from '../internal/AccessKeyTransaction.js'
import type * as RemoteRequest from '../internal/RemoteRequest.js'
import * as RemoteSession from '../internal/RemoteSession.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { dialog } from './dialog.js'

const address = '0x0000000000000000000000000000000000000001'
const host = 'https://wallet.test/embed'
const recipient = '0x0000000000000000000000000000000000000002'

function createKeyAuthorization(options: {
  expiry: number
  keyType: 'secp256k1' | 'p256'
  publicKey: Hex.Hex
}) {
  const { expiry, keyType, publicKey } = options
  return KeyAuthorization.toRpc(
    KeyAuthorization.from(
      {
        address: Address.fromPublicKey(PublicKey.from(publicKey)),
        chainId: BigInt(tempoLocalnet.id),
        expiry,
        type: keyType,
      },
      { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
    ),
  )
}

function setup() {
  const storage = Storage.memory()
  const store = Store.create({ chainId: tempoLocalnet.id, storage })
  const dialog_ = createDialog()
  RemoteSession.reset(host)
  const adapter = dialog({ dialog: dialog_.dialog, host })({
    getAccount: (options) => {
      if (options?.signable) throw new ox_Provider.UnauthorizedError({ message: 'No signer.' })
      return { address, type: 'json-rpc' } as never
    },
    getClient: () => ({}) as never,
    storage,
    store,
  })
  return { adapter, requestStore: RemoteSession.get(host).store, store }
}

function createDialog() {
  return {
    dialog: Dialog.define({ name: 'test' }, () => ({
      close() {},
      destroy() {},
      open() {},
      async syncRequests() {},
      syncTheme() {},
    })),
  }
}

function createTrackedDialog() {
  const syncs: RemoteRequest.Sync[] = []
  const synced: (readonly RemoteRequest.Request[])[] = []
  return {
    dialog: Dialog.define({ name: 'tracked' }, () => ({
      close() {},
      destroy() {},
      open() {},
      async syncRequests(sync) {
        syncs.push(sync)
        synced.push(sync.requests)
      },
      syncTheme() {},
    })),
    syncs,
    synced,
  }
}

async function takeRequest(store: ReturnType<typeof RemoteSession.get>['store']) {
  await vi.waitFor(() => {
    if (!store.getState().requestQueue[0]) throw new Error('request not queued')
  })
  return store.getState().requestQueue[0]!
}

function success(queued: Awaited<ReturnType<typeof takeRequest>>, result: unknown) {
  return {
    account: queued.account,
    chainId: queued.chainId,
    request: queued.request,
    result,
    status: 'success' as const,
    synced: queued.synced,
  }
}

function failure(
  queued: Awaited<ReturnType<typeof takeRequest>>,
  error: { code: number; message: string },
) {
  return {
    account: queued.account,
    chainId: queued.chainId,
    error,
    request: queued.request,
    status: 'error' as const,
    synced: queued.synced,
  }
}

describe('dialog', () => {
  beforeEach(() => {
    RemoteSession.reset(host)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    RemoteSession.reset(host)
  })

  test('behavior: sendTransaction signs locally when an access key is selected', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    const clientRequests: unknown[] = []
    const signRequests: unknown[] = []
    vi.spyOn(AccessKeyTransaction, 'create').mockResolvedValue({
      fill: async () => ({ capabilities: { sponsored: false }, tx: {} }),
      prepare: async (request) => ({
        request: request as never,
        send: async () => {
          signRequests.push(request)
          clientRequests.push({ method: 'eth_sendRawTransaction', params: ['0xsigned'] })
          return '0xtransaction'
        },
        sendSync: async () => {
          throw new Error('unexpected sendSync')
        },
        sign: async () => {
          signRequests.push(request)
          return '0xsigned'
        },
      }),
    })
    const dialog_ = createDialog()
    const adapter = dialog({ dialog: dialog_.dialog, host })({
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
    const requestStore = RemoteSession.get(host).store

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
    expect(requestStore.getState().requestQueue).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: loadAccounts forwards auth capabilities returned by the dialog', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    const dialog_ = createDialog()
    const adapter = dialog({ dialog: dialog_.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const requestStore = RemoteSession.get(host).store
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

    await vi.waitFor(() => {
      if (!requestStore.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = requestStore.getState().requestQueue[0]!
    requestStore.setState({
      requestQueue: [
        success(queued, {
          accounts: [
            {
              address,
              capabilities: {
                auth: { token: 'test-token' },
              },
            },
          ],
        }),
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
    const dialog_a = createTrackedDialog()
    const dialog_b = createTrackedDialog()
    const adapter_a = dialog({ dialog: dialog_a.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store: store_a,
    })
    const adapter_b = dialog({ dialog: dialog_b.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store: store_b,
    })
    const requestStore = RemoteSession.get(host).store

    const promise = adapter_a.actions.sendTransaction(
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

    const queued = await takeRequest(requestStore)

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

    requestStore.setState({
      requestQueue: [success(queued, '0x1234')],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    expect(dialog_b.synced.map((requests) => requests.map((x) => x.request.method)))
      .toMatchInlineSnapshot(`
        [
          [
            "eth_sendTransaction",
          ],
        ]
      `)
    adapter_a.cleanup?.()
    adapter_b.cleanup?.()
  })

  test('behavior: remounted provider resumes pending host requests', async () => {
    const storage = Storage.memory()
    const store_a = Store.create({ chainId: 123, storage })
    store_a.setState({ accounts: [{ address }], activeAccount: 0 })
    const dialog_a = createTrackedDialog()
    const adapter_a = dialog({ dialog: dialog_a.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store: store_a,
    })
    const requestStore = RemoteSession.get(host).store

    const promise = adapter_a.actions.sendTransaction(
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

    const queued = await takeRequest(requestStore)
    adapter_a.cleanup?.()

    const store_b = Store.create({ chainId: 456, storage })
    const dialog_b = createTrackedDialog()
    const adapter_b = dialog({ dialog: dialog_b.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
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

    requestStore.setState({
      requestQueue: [success(queued, '0x1234')],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    adapter_b.cleanup?.()
  })

  test('behavior: sendTransaction falls through when no access key is selected', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    const lookups: unknown[] = []
    const dialog_ = createDialog()
    const adapter = dialog({ dialog: dialog_.dialog, host })({
      getAccount: (options) => {
        lookups.push(options)
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const requestStore = RemoteSession.get(host).store
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
      if (!requestStore.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = requestStore.getState().requestQueue[0]!
    requestStore.setState({
      requestQueue: [success(queued, '0x1234')],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`"0x1234"`)
    expect(lookups).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: revokeAccessKey clears the forwarded key from local state', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    store.setState({
      accessKeys: [
        {
          access: address,
          address: recipient,
          chainId: tempoLocalnet.id,
          keyType: 'p256',
        } as never,
      ],
    })
    const dialog_ = createDialog()
    const adapter = dialog({ dialog: dialog_.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const requestStore = RemoteSession.get(host).store
    const request = {
      method: 'wallet_revokeAccessKey' as const,
      params: [{ accessKeyAddress: recipient, address }] as const,
    }

    const promise = adapter.actions.revokeAccessKey!(
      { accessKeyAddress: recipient, address },
      request,
    )

    await vi.waitFor(() => {
      if (!requestStore.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = requestStore.getState().requestQueue[0]!
    requestStore.setState({
      requestQueue: [success(queued, undefined)],
    })

    await expect(promise).resolves.toMatchInlineSnapshot(`undefined`)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: authorizeAccessKey forwards an external secp256k1 key', async () => {
    const { adapter, requestStore, store } = setup()
    const expiry = 123
    const promise = adapter.actions.authorizeAccessKey!(
      { address: recipient, expiry, keyType: 'secp256k1' },
      {
        method: 'wallet_authorizeAccessKey',
        params: [{ address: recipient, expiry, keyType: 'secp256k1' }],
      },
    )

    const queued = await takeRequest(requestStore)
    const request = queued.request as {
      params: [{ address: typeof recipient; expiry: number; keyType: 'secp256k1' }]
    }
    const params = request.params[0]
    const keyAuthorization = KeyAuthorization.toRpc(
      KeyAuthorization.from(
        {
          address: recipient,
          chainId: BigInt(tempoLocalnet.id),
          expiry,
          type: 'secp256k1',
        },
        { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
      ),
    )
    requestStore.setState({
      requestQueue: [success(queued, { keyAuthorization, rootAddress: address })],
    })

    await expect(promise).resolves.toMatchObject({ rootAddress: address })
    expect(params.keyType).toMatchInlineSnapshot(`"secp256k1"`)
    expect(params.address).toMatchInlineSnapshot(`"0x0000000000000000000000000000000000000002"`)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: authorizeAccessKey generates a p256 key by default', async () => {
    const { adapter, requestStore, store } = setup()
    const expiry = 123
    const promise = adapter.actions.authorizeAccessKey!(
      { expiry },
      { method: 'wallet_authorizeAccessKey', params: [{ expiry }] },
    )

    const queued = await takeRequest(requestStore)
    const request = queued.request as {
      params: [{ expiry: number; keyType: 'p256'; publicKey: Hex.Hex }]
    }
    const params = request.params[0]
    requestStore.setState({
      requestQueue: [
        success(queued, {
          keyAuthorization: createKeyAuthorization(params),
          rootAddress: address,
        }),
      ],
    })

    await expect(promise).resolves.toMatchObject({ rootAddress: address })
    expect(params.keyType).toMatchInlineSnapshot(`"p256"`)
    expect(store.getState().accessKeys).toMatchObject([
      {
        access: address,
        keyType: 'p256',
      },
    ])
    expect('keyPair' in store.getState().accessKeys[0]!).toMatchInlineSnapshot(`true`)
  })

  test('behavior: authorizeAccessKey forwards showDeposit', async () => {
    const { adapter, requestStore } = setup()
    const expiry = 123
    const showDeposit = { amount: '50', token: 'USDC' }
    const promise = adapter.actions.authorizeAccessKey!(
      { expiry, showDeposit },
      { method: 'wallet_authorizeAccessKey', params: [{ expiry, showDeposit }] },
    )

    const queued = await takeRequest(requestStore)
    const request = queued.request as {
      params: [
        {
          expiry: number
          keyType: 'p256'
          publicKey: Hex.Hex
          showDeposit: typeof showDeposit
        },
      ]
    }
    const params = request.params[0]
    requestStore.setState({
      requestQueue: [
        success(queued, {
          keyAuthorization: createKeyAuthorization(params),
          rootAddress: address,
        }),
      ],
    })

    await expect(promise).resolves.toMatchObject({ rootAddress: address })
    expect(params.showDeposit).toMatchInlineSnapshot(`
      {
        "amount": "50",
        "token": "USDC",
      }
    `)
  })

  test('behavior: authorizeAccessKey generates a p256 key when requested', async () => {
    const { adapter, requestStore, store } = setup()
    const expiry = 123
    const promise = adapter.actions.authorizeAccessKey!(
      { expiry, keyType: 'p256' },
      { method: 'wallet_authorizeAccessKey', params: [{ expiry, keyType: 'p256' }] },
    )

    const queued = await takeRequest(requestStore)
    const request = queued.request as {
      params: [{ expiry: number; keyType: 'p256'; publicKey: Hex.Hex }]
    }
    const params = request.params[0]
    requestStore.setState({
      requestQueue: [
        success(queued, {
          keyAuthorization: createKeyAuthorization(params),
          rootAddress: address,
        }),
      ],
    })

    await expect(promise).resolves.toMatchObject({ rootAddress: address })
    expect(params.keyType).toMatchInlineSnapshot(`"p256"`)
    expect(store.getState().accessKeys).toMatchObject([
      {
        access: address,
        keyType: 'p256',
      },
    ])
    expect('keyPair' in store.getState().accessKeys[0]!).toMatchInlineSnapshot(`true`)
  })

  test('error: secp256k1 access key requires external key material', async () => {
    const { adapter, requestStore } = setup()

    await expect(
      adapter.actions.authorizeAccessKey!(
        { expiry: 123, keyType: 'secp256k1' },
        {
          method: 'wallet_authorizeAccessKey',
          params: [{ expiry: 123, keyType: 'secp256k1' }],
        },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`keyType: "secp256k1"\` requires externally generated key material; provide \`publicKey\` or \`address\`.]`,
    )
    expect(requestStore.getState().requestQueue).toMatchInlineSnapshot(`[]`)
  })

  test('error: webAuthn access key requires external key material', async () => {
    const { adapter, requestStore } = setup()

    await expect(
      adapter.actions.authorizeAccessKey!(
        { expiry: 123, keyType: 'webAuthn' },
        {
          method: 'wallet_authorizeAccessKey',
          params: [{ expiry: 123, keyType: 'webAuthn' }],
        },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`keyType: "webAuthn"\` requires externally generated key material; provide \`publicKey\` or \`address\`.]`,
    )
    expect(requestStore.getState().requestQueue).toMatchInlineSnapshot(`[]`)
  })

  test('error: wallet validation errors keep their RPC code', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: tempoLocalnet.id, storage })
    const dialog_ = createDialog()
    const adapter = dialog({ dialog: dialog_.dialog, host })({
      getAccount: () => {
        throw new ox_Provider.UnauthorizedError({ message: 'No local signer.' })
      },
      getClient: () => ({}) as never,
      storage,
      store,
    })
    const requestStore = RemoteSession.get(host).store
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
      if (!requestStore.getState().requestQueue[0]) throw new Error('request not queued')
    })

    const queued = requestStore.getState().requestQueue[0]!
    requestStore.setState({
      requestQueue: [
        failure(queued, {
          code: -32602,
          message: '`authorizeAccessKey` must include at least one `limits` entry.',
        }),
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
