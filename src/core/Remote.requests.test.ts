import { RpcRequest, RpcResponse } from 'ox'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterEach, expect, test, vi } from 'vp/test'

import * as Adapter from './Adapter.js'
import type * as Messenger from './Messenger.js'
import * as Provider from './Provider.js'
import * as Remote from './Remote.js'
import * as Storage from './Storage.js'

afterEach(() => vi.restoreAllMocks())

async function setup() {
  const provider = Provider.create({
    adapter: Adapter.define({ name: 'Test', rdns: 'test.remote' }, () => ({
      actions: {
        createAccount: async () => ({ accounts: [] }),
        loadAccounts: async () => ({ accounts: [] }),
      },
    })),
    chains: [tempo, tempoModerato],
    mpp: { polyfill: false },
    storage: Storage.memory(),
  })
  await provider.ready()
  let receive = (_payload: Remote.Sync): void => {}
  const off = vi.fn()
  const send = vi.fn(
    async (_topic: Messenger.Topic, _payload: Messenger.Payload<Messenger.Topic>) =>
      undefined as never,
  )
  const remote = Remote.create({
    messenger: {
      destroy: vi.fn(),
      on(_topic, listener) {
        receive = (payload) =>
          listener(
            payload as never,
            new MessageEvent('message', {
              origin: 'https://app.example',
            }),
          )
        return off
      },
      ready: vi.fn(),
      send,
      waitForReady: async () => ({}),
    },
    provider,
  })
  return {
    off,
    provider,
    remote,
    send,
    sync: (
      chainId: number,
      requests: readonly Remote.Request[] = [pending(1)],
      account?: Remote.Sync['account'],
    ) => receive({ account, chainId, requests }),
  }
}

function pending(id: number) {
  return {
    request: RpcRequest.from({ id, method: 'wallet_connect' }),
    status: 'pending',
  } satisfies Remote.Request
}

test('unsupported sync replies to pending requests without invoking the approval callback', async () => {
  const { provider, remote, send, sync } = await setup()
  const cb = vi.fn()
  remote.onRequests(cb)
  await sync(1, [pending(1), { ...pending(2), result: {}, status: 'success' }, pending(3)])
  expect({
    chainId: provider.store.getState().chainId,
    callbacks: cb.mock.calls.length,
    ready: remote.store.getState().ready,
    replies: send.mock.calls,
  }).toMatchInlineSnapshot(`
    {
      "callbacks": 0,
      "chainId": 4217,
      "ready": false,
      "replies": [
        [
          "rpc-response",
          {
            "_request": {
              "id": 1,
              "jsonrpc": "2.0",
              "method": "wallet_connect",
            },
            "error": {
              "code": 5710,
              "message": "Chain 1 not configured.",
            },
            "id": 1,
            "jsonrpc": "2.0",
          },
        ],
        [
          "rpc-response",
          {
            "_request": {
              "id": 3,
              "jsonrpc": "2.0",
              "method": "wallet_connect",
            },
            "error": {
              "code": 5710,
              "message": "Chain 1 not configured.",
            },
            "id": 3,
            "jsonrpc": "2.0",
          },
        ],
      ],
    }
  `)
})

test.each([
  { requests: [] },
  { requests: [{ ...pending(1), result: {}, status: 'success' }] },
] as const)(
  'settled queues close without switching to an unsupported chain: %j',
  async ({ requests }) => {
    const { provider, remote, send, sync } = await setup()
    const request = vi.spyOn(provider, 'request')
    const cb = vi.fn()
    remote.onUserRequest(cb)
    await sync(1, requests)
    expect({
      callbacks: cb.mock.calls,
      chainId: provider.store.getState().chainId,
      requests: request.mock.calls,
      replies: send.mock.calls,
      ready: remote.store.getState().ready,
    }).toMatchInlineSnapshot(`
      {
        "callbacks": [
          [
            {
              "account": undefined,
              "origin": "https://app.example",
              "request": null,
            },
          ],
        ],
        "chainId": 4217,
        "ready": false,
        "replies": [],
        "requests": [],
      }
    `)
  },
)

test('a supported chain is active before showing an approval', async () => {
  const { provider, remote, sync } = await setup()
  const cb = vi.fn(() => provider.store.getState().chainId)
  remote.onRequests(cb)
  await sync(tempoModerato.id)
  expect(cb.mock.results.map((result) => result.value)).toMatchInlineSnapshot(`
    [
      42431,
    ]
  `)
})

test('a failed switch does not prevent a later valid sync', async () => {
  const { provider, remote, send, sync } = await setup()
  const cb = vi.fn()
  remote.onRequests(cb)
  await sync(1)
  await sync(tempoModerato.id, [pending(2)])
  expect({
    callbacks: cb.mock.calls.map(([requests]) => requests[0].request.id),
    chainId: provider.store.getState().chainId,
    replies: send.mock.calls.length,
  }).toMatchInlineSnapshot(`
    {
      "callbacks": [
        2,
      ],
      "chainId": 42431,
      "replies": 1,
    }
  `)
})

test('other switch failures reach the caller rather than executing on the previous chain', async () => {
  const { provider, remote, send, sync } = await setup()
  vi.spyOn(provider, 'request').mockRejectedValue(
    new RpcResponse.InternalError({ message: 'Switch failed.' }),
  )
  const cb = vi.fn()
  remote.onRequests(cb)
  await sync(tempoModerato.id)
  expect({ callbacks: cb.mock.calls.length, error: send.mock.calls[0]?.[1] })
    .toMatchInlineSnapshot(`
    {
      "callbacks": 0,
      "error": {
        "_request": {
          "id": 1,
          "jsonrpc": "2.0",
          "method": "wallet_connect",
        },
        "error": {
          "code": -32603,
          "message": "Switch failed.",
        },
        "id": 1,
        "jsonrpc": "2.0",
      },
    }
  `)
})

test.each(['close', 'unsubscribe'] as const)(
  '%s during a switch prevents a late approval',
  async (action) => {
    const { off, provider, remote, send, sync } = await setup()
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    vi.spyOn(provider, 'request').mockImplementationOnce(async () => {
      started.resolve()
      await gate.promise
      throw new RpcResponse.InternalError({ message: 'Late switch failure.' })
    })
    const cb = vi.fn()
    const unsubscribe = remote.onRequests(cb)
    const request = sync(tempoModerato.id)
    await started.promise
    if (action === 'close') await sync(1, [])
    else unsubscribe()
    gate.resolve()
    await request
    expect({
      callbacks: cb.mock.calls.map(([requests]) => requests.length),
      replies: send.mock.calls,
      unsubscribed: off.mock.calls.length,
    }).toMatchObject({
      callbacks: action === 'close' ? [0] : [],
      replies: [],
      unsubscribed: action === 'unsubscribe' ? 1 : 0,
    })
  },
)

test('overlapping switches cannot show an approval on a stale chain', async () => {
  const { provider, remote, sync } = await setup()
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const request = provider.request.bind(provider)
  vi.spyOn(provider, 'request').mockImplementationOnce(async (parameters) => {
    started.resolve()
    await gate.promise
    return request(parameters)
  })
  const cb = vi.fn(() => provider.store.getState().chainId)
  remote.onRequests(cb)
  const first = sync(tempoModerato.id)
  await started.promise
  const second = sync(tempo.id, [pending(2)])
  gate.resolve()
  await Promise.all([first, second])
  expect({
    chainId: provider.store.getState().chainId,
    callbacks: cb.mock.results.map((result) => result.value),
  }).toMatchInlineSnapshot(`
    {
      "callbacks": [
        4217,
      ],
      "chainId": 4217,
    }
  `)
})

test('a closing queue ignores an unknown host account', async () => {
  const { provider, remote, send, sync } = await setup()
  const cb = vi.fn()
  remote.onUserRequest(cb)
  await sync(1, [], { address: '0x0000000000000000000000000000000000000001' })
  expect({
    requests: cb.mock.calls.map(([payload]) => payload.request),
    accounts: provider.store.getState().accounts,
    replies: send.mock.calls,
  }).toMatchInlineSnapshot(`
    {
      "accounts": [],
      "replies": [],
      "requests": [
        null,
      ],
    }
  `)
})

test('resubscribing waits for an earlier successful switch before approving another chain', async () => {
  const { provider, remote, sync } = await setup()
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const request = provider.request.bind(provider)
  vi.spyOn(provider, 'request').mockImplementationOnce(async (parameters) => {
    started.resolve()
    await gate.promise
    return request(parameters)
  })
  const cb = vi.fn(() => provider.store.getState().chainId)
  const unsubscribe = remote.onRequests(cb)
  const first = sync(tempoModerato.id)
  await started.promise
  unsubscribe()
  remote.onRequests(cb)
  const second = sync(tempo.id, [pending(2)])
  gate.resolve()
  await Promise.all([first, second])
  expect({
    chainId: provider.store.getState().chainId,
    callbacks: cb.mock.results.map((result) => result.value),
  }).toMatchInlineSnapshot(`
    {
      "callbacks": [
        4217,
      ],
      "chainId": 4217,
    }
  `)
})

test('an old approval callback cannot make a closed queue ready again', async () => {
  const { remote, sync } = await setup()
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  remote.onUserRequest(async ({ request }) => {
    if (!request) return
    started.resolve()
    await gate.promise
  })
  const first = sync(tempo.id)
  await started.promise
  await sync(1, [])
  gate.resolve()
  await first
  expect(remote.store.getState().ready).toMatchInlineSnapshot('false')
})
