import { afterEach, expect, test, vi } from 'vp/test'

import * as Dialog from '../Dialog.js'
import * as RemoteRequests from './RemoteRequests.js'

const host = 'https://wallet.example/remote?secret=private'
const options = {
  account: undefined,
  chainId: 4217,
  request: { method: 'personal_sign', params: ['private-payload'] },
}

function setup(syncRequests: Dialog.Instance['syncRequests'] = async () => {}) {
  let callbacks: Dialog.SetupFn.Parameters
  const handle = {
    close: vi.fn(),
    destroy: vi.fn(),
    open: vi.fn(),
    syncRequests: vi.fn(syncRequests),
    syncTheme: vi.fn(),
  }
  const detach = RemoteRequests.attach(host, {
    dialog: (parameters) => {
      callbacks = parameters
      return handle
    },
    host,
    store: {} as never,
  })
  return { callbacks: () => callbacks, detach, handle }
}

afterEach(() => RemoteRequests.reset(host))

test('asynchronous startup errors reject the actual provider request safely', async () => {
  setup(async () => {
    throw new Dialog.TransportError(host, 'dialog_ready')
  })
  const error = await RemoteRequests.request(host, options).catch((error) => error)
  if (!(error instanceof Dialog.TransportError)) throw new Error('Expected transport error')
  expect({ code: error.code, data: error.data, message: error.message, name: error.name })
    .toMatchInlineSnapshot(`
      {
        "code": -32000,
        "data": {
          "origin": "https://wallet.example",
          "stage": "dialog_ready",
        },
        "message": "Wallet startup did not complete at https://wallet.example. Check that the wallet is running and reachable, then try again.",
        "name": "Dialog.TransportError",
      }
    `)
})

test('transport failure rejects the queue without automatically replaying signing', async () => {
  const { handle } = setup(async () => {
    throw new Error('https://wallet.example/remote?secret=private private-payload')
  })
  const results = await Promise.all([
    RemoteRequests.request(host, options).catch((error) => error.data),
    RemoteRequests.request(host, options).catch((error) => error.data),
  ])
  expect(results).toMatchInlineSnapshot(`
    [
      {
        "origin": "https://wallet.example",
        "stage": "dispatch",
      },
      {
        "origin": "https://wallet.example",
        "stage": "dispatch",
      },
    ]
  `)
  expect(handle.syncRequests.mock.calls.length).toMatchInlineSnapshot('1')
  expect(handle.close.mock.calls.length).toMatchInlineSnapshot('1')
})

test('a fresh request can succeed after a failed startup', async () => {
  const { callbacks, handle } = setup(async () => {
    throw new Dialog.TransportError(host, 'dialog_ready')
  })
  await RemoteRequests.request(host, options).catch(() => {})
  handle.syncRequests.mockResolvedValue(undefined)
  const next = RemoteRequests.request(host, options)
  const id = handle.syncRequests.mock.calls.at(-1)![0].requests[0]!.request.id
  callbacks().onResponse({ id, result: 'signed-once' })
  expect(await next).toMatchInlineSnapshot(`"signed-once"`)
  expect(handle.syncRequests.mock.calls.length).toMatchInlineSnapshot('2')
})

test('a cancelled request cannot fail the next request with its late transport error', async () => {
  let reject: (error: Error) => void = () => {}
  const { callbacks, handle } = setup(
    () =>
      new Promise((_resolve, reject_) => {
        reject = reject_
      }),
  )
  const first = RemoteRequests.request(host, options).catch((error) => error.code)
  const id = handle.syncRequests.mock.calls[0]![0].requests[0]!.request.id
  callbacks().onReject([id])
  expect(await first).toMatchInlineSnapshot('4001')
  handle.syncRequests.mockResolvedValue(undefined)
  const next = RemoteRequests.request(host, options)
  reject(new Error('old failure'))
  await Promise.resolve()
  const id_next = handle.syncRequests.mock.calls.at(-1)![0].requests[0]!.request.id
  callbacks().onResponse({ id: id_next, result: 'next' })
  expect(await next).toMatchInlineSnapshot(`"next"`)
})

test('reset rejects pending requests and destroys the transport', async () => {
  const { handle } = setup()
  const result = RemoteRequests.request(host, options).catch((error) => error.data)
  RemoteRequests.reset(host)
  expect(await result).toMatchInlineSnapshot(`
    {
      "origin": "https://wallet.example",
      "stage": "closed",
    }
  `)
  expect(handle.destroy.mock.calls.length).toMatchInlineSnapshot('1')
})

test('synchronous transport errors also reject safely', async () => {
  const { handle } = setup(() => {
    throw new Error('private-payload')
  })
  const error = await RemoteRequests.request(host, options).catch((error) => error)
  if (!(error instanceof Dialog.TransportError)) throw new Error('Expected transport error')
  expect(error.data).toMatchInlineSnapshot(`
    {
      "origin": "https://wallet.example",
      "stage": "dispatch",
    }
  `)
  expect(handle.close.mock.calls.length).toMatchInlineSnapshot('1')
})

test('asynchronous popup handoff failures reach the pending request', async () => {
  const { callbacks, handle } = setup()
  const result = RemoteRequests.request(host, options).catch((error) => error.data)
  const id = handle.syncRequests.mock.calls[0]![0].requests[0]!.request.id
  callbacks().onError?.(new Dialog.TransportError(host, 'dialog_ready'), [id])
  expect(await result).toMatchInlineSnapshot(`
    {
      "origin": "https://wallet.example",
      "stage": "dialog_ready",
    }
  `)
})

test('a superseded sync cannot reject the newer attempt for the same request ID', async () => {
  let reject: (error: Error) => void = () => {}
  const { callbacks, handle } = setup(
    () =>
      new Promise((_resolve, reject_) => {
        reject = reject_
      }),
  )
  const first = RemoteRequests.request(host, options)
  const second = RemoteRequests.request(host, options).catch((error) => error.code)
  const id = handle.syncRequests.mock.calls[0]![0].requests[0]!.request.id
  handle.syncRequests.mockResolvedValue(undefined)
  // Removing another queued request force-syncs the still-pending first request.
  callbacks().onReject([id + 1])
  expect(await second).toMatchInlineSnapshot('4001')
  reject(new Dialog.TransportError(host, 'closed'))
  await Promise.resolve()
  callbacks().onResponse({ id, result: 'current attempt' })
  expect(await first).toMatchInlineSnapshot(`"current attempt"`)
  expect(handle.syncRequests.mock.calls.map(([sync]) => sync.requests[0]!.request.id))
    .toMatchInlineSnapshot(`
      [
        0,
        0,
      ]
    `)
})
