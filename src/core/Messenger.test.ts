import { afterEach, expect, test, vi } from 'vp/test'

import * as Messenger from './Messenger.js'

function setup() {
  let ready: (options: Messenger.ReadyOptions) => void = () => {}
  const send = vi.fn(async () => ({ id: '1', payload: {}, topic: 'ready' }) as never)
  const bridge = Messenger.bridge({
    from: {
      destroy: vi.fn(),
      on(_topic, listener) {
        ready = (options) => listener(options as never, {} as MessageEvent)
        return () => {}
      },
      send,
    },
    to: { destroy: vi.fn(), on: () => () => {}, send },
    waitForReady: true,
  })
  return { bridge, ready: (options: Messenger.ReadyOptions = {}) => ready(options), send }
}

afterEach(() => vi.useRealTimers())

test('never-ready waits expire without leaving a dispatch continuation', async () => {
  vi.useFakeTimers()
  const { bridge, ready, send } = setup()
  const result = bridge.waitForReady({ timeout: 15_000 }).then(
    () => bridge.send('theme', {}),
    (error) => error.message,
  )
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toMatchInlineSnapshot(`"Wallet readiness timed out."`)
  ready()
  await Promise.resolve()
  expect(send.mock.calls).toMatchInlineSnapshot('[]')
  expect(vi.getTimerCount()).toMatchInlineSnapshot('0')
  bridge.destroy()
})

test('a fresh wait succeeds after a previous wait timed out', async () => {
  vi.useFakeTimers()
  const { bridge, ready } = setup()
  const first = bridge.waitForReady({ timeout: 1 }).catch((error) => error.message)
  await vi.advanceTimersByTimeAsync(1)
  await first
  const next = bridge.waitForReady({ timeout: 15_000 })
  ready({ trustedHosts: ['example.com'] })
  expect(await next).toMatchInlineSnapshot(`
    {
      "trustedHosts": [
        "example.com",
      ],
    }
  `)
  expect(vi.getTimerCount()).toMatchInlineSnapshot('0')
  bridge.destroy()
})

test('abort cancels a readiness wait and removes its timer', async () => {
  vi.useFakeTimers()
  const { bridge, ready, send } = setup()
  const controller = new AbortController()
  const result = bridge.waitForReady({ signal: controller.signal, timeout: 15_000 }).then(
    () => bridge.send('theme', {}),
    (error) => error.message,
  )
  controller.abort()
  ready()
  expect(await result).toMatchInlineSnapshot(`"Readiness wait cancelled."`)
  expect(send.mock.calls).toMatchInlineSnapshot('[]')
  expect(vi.getTimerCount()).toMatchInlineSnapshot('0')
  bridge.destroy()
})

test('destroy settles direct waits and buffered sends without late dispatch', async () => {
  const { bridge, ready, send } = setup()
  const waiting = bridge.waitForReady().catch((error) => error.message)
  const sending = bridge.send('theme', {}).catch((error) => error.message)
  bridge.destroy()
  ready()
  expect(await Promise.all([waiting, sending])).toMatchInlineSnapshot(`
    [
      "Messenger closed.",
      "Messenger closed.",
    ]
  `)
  expect(send.mock.calls).toMatchInlineSnapshot('[]')
  await expect(bridge.send('theme', {})).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: Messenger closed.]`,
  )
})

test('destroy after ready still prevents queued sends', async () => {
  const { bridge, ready, send } = setup()
  const sending = bridge.send('theme', {}).catch((error) => error.message)
  ready()
  bridge.destroy()
  expect(await sending).toMatchInlineSnapshot(`"Messenger closed."`)
  expect(send.mock.calls).toMatchInlineSnapshot('[]')
})
