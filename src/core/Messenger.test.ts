import { describe, expect, test, vi } from 'vitest'

import * as Messenger from './Messenger.js'

describe('fromWindow', () => {
  test('default: sends and receives messages on a topic', () => {
    // Use a MessageChannel to simulate two ends of a window pair.
    const channel = new MessageChannel()
    const sender = Messenger.fromWindow(channel.port1 as never)
    const receiver = Messenger.fromWindow(channel.port2 as never)

    channel.port1.start()
    channel.port2.start()

    return new Promise<void>((resolve) => {
      const request = {
        id: 1,
        jsonrpc: '2.0' as const,
        method: 'eth_chainId',
      }
      receiver.on('rpc-request', (payload) => {
        expect(payload).toEqual(request)
        sender.destroy()
        receiver.destroy()
        resolve()
      })
      sender.send('rpc-request', request)
    })
  })

  test('behavior: filters by targetOrigin', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const mockWindow = {
      addEventListener(_: string, handler: (event: MessageEvent) => void) {
        listeners.push(handler)
      },
      removeEventListener() {},
      postMessage() {},
    } as unknown as Window

    const messenger = Messenger.fromWindow(mockWindow, {
      targetOrigin: 'https://auth.tempo.xyz',
    })

    const fn = vi.fn()
    messenger.on('rpc-request', fn)

    // Simulate a message from a different origin.
    for (const listener of listeners)
      listener({
        data: {
          topic: 'rpc-request',
          payload: { id: 1, jsonrpc: '2.0', method: 'test' },
          _tempo: true,
        },
        origin: 'https://evil.com',
      } as MessageEvent)

    expect(fn).not.toHaveBeenCalled()
    messenger.destroy()
  })

  test('behavior: on returns unsubscribe function', () => {
    const channel = new MessageChannel()
    const sender = Messenger.fromWindow(channel.port1 as never)
    const receiver = Messenger.fromWindow(channel.port2 as never)

    channel.port1.start()
    channel.port2.start()

    const fn = vi.fn()
    const off = receiver.on('rpc-request', fn)

    // Unsubscribe before sending.
    off()

    return new Promise<void>((resolve) => {
      sender.send('rpc-request', {
        id: 1,
        jsonrpc: '2.0',
        method: 'test',
      })

      // Give the message time to arrive (it shouldn't call fn).
      setTimeout(() => {
        expect(fn).not.toHaveBeenCalled()
        sender.destroy()
        receiver.destroy()
        resolve()
      }, 50)
    })
  })

  test('behavior: destroy removes all listeners', () => {
    const channel = new MessageChannel()
    const sender = Messenger.fromWindow(channel.port1 as never)
    const receiver = Messenger.fromWindow(channel.port2 as never)

    channel.port1.start()
    channel.port2.start()

    const fn = vi.fn()
    receiver.on('rpc-request', fn)

    // Destroy receiver.
    receiver.destroy()

    return new Promise<void>((resolve) => {
      sender.send('rpc-request', {
        id: 1,
        jsonrpc: '2.0',
        method: 'test',
      })

      setTimeout(() => {
        expect(fn).not.toHaveBeenCalled()
        sender.destroy()
        resolve()
      }, 50)
    })
  })
})

describe('bridge', () => {
  test('default: on delegates to from, send delegates to to', () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to })

    const fn = vi.fn()
    b.on('rpc-request', fn)
    expect(from.on).toHaveBeenCalledWith('rpc-request', fn)

    b.send('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'test',
    })
    expect(to.send).toHaveBeenCalledWith('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'test',
    })

    b.destroy()
  })

  test('behavior: waitForReady delays sends until ready', async () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    b.send('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'test',
    })

    // to.send should NOT have been called yet (only from.on for 'ready').
    expect(to.send).not.toHaveBeenCalledWith('rpc-request', expect.anything())

    // Simulate the remote frame signaling ready.
    const readyListener = (from.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'ready',
    )?.[1] as () => void
    readyListener()

    // Wait for the ready promise microtask to flush.
    await new Promise((r) => setTimeout(r, 10))

    expect(to.send).toHaveBeenCalledWith('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'test',
    })

    b.destroy()
  })

  test('behavior: waitForReady resolves', async () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const readyPromise = b.waitForReady()

    const readyListener = (from.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'ready',
    )?.[1] as () => void
    readyListener()

    await readyPromise

    b.destroy()
  })

  test('behavior: ready sends ready topic', () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to })

    b.ready()

    expect(to.send).toHaveBeenCalledWith('ready', undefined)

    b.destroy()
  })

  test('behavior: sends after ready go directly without buffering', async () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    // Simulate ready.
    const readyListener = (from.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'ready',
    )?.[1] as () => void
    readyListener()

    // Send after ready — should go directly to `to.send`.
    b.send('rpc-request', {
      id: 2,
      jsonrpc: '2.0',
      method: 'post-ready',
    })

    expect(to.send).toHaveBeenCalledWith('rpc-request', {
      id: 2,
      jsonrpc: '2.0',
      method: 'post-ready',
    })

    b.destroy()
  })

  test('behavior: destroy rejects pending waitForReady', async () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const readyPromise = b.waitForReady()
    b.destroy()

    await expect(readyPromise).rejects.toThrow('Bridge destroyed')
  })

  test('behavior: destroy cleans up', () => {
    const from = mockMessenger()
    const to = mockMessenger()

    const b = Messenger.bridge({ from, to })
    b.destroy()

    expect(from.destroy).toHaveBeenCalled()
    expect(to.destroy).toHaveBeenCalled()
  })
})

describe('noop', () => {
  test('default: send resolves without error', () => {
    const b = Messenger.noop()
    expect(() =>
      b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' }),
    ).not.toThrow()
  })

  test('default: on returns noop unsubscribe', () => {
    const b = Messenger.noop()
    const off = b.on('rpc-request', () => {})
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })

  test('default: destroy is callable', () => {
    const b = Messenger.noop()
    expect(() => b.destroy()).not.toThrow()
  })

  test('default: waitForReady resolves', async () => {
    const b = Messenger.noop()
    await b.waitForReady()
  })
})

function mockMessenger(): Messenger.Messenger {
  return {
    destroy: vi.fn(),
    on: vi.fn(() => () => {}),
    send: vi.fn(),
  }
}
