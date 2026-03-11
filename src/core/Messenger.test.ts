import { describe, expect, test, vi } from 'vitest'

import * as Messenger from './Messenger.js'

describe('fromWindow', () => {
  test('default: sends and receives messages on a topic', () => {
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

    off()

    return new Promise<void>((resolve) => {
      sender.send('rpc-request', {
        id: 1,
        jsonrpc: '2.0',
        method: 'test',
      })

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
  test('default: sends and receives through bridge', () => {
    const [from, fromRemote] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to })

    const received: unknown[] = []
    b.on('rpc-request', (payload) => received.push(payload))

    // Simulate the remote side sending a message.
    fromRemote.send('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_chainId',
    })

    expect(received).toMatchInlineSnapshot(`
      [
        {
          "id": 1,
          "jsonrpc": "2.0",
          "method": "eth_chainId",
        },
      ]
    `)

    // Send through bridge and verify it arrives on the remote side.
    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.send('rpc-request', {
      id: 2,
      jsonrpc: '2.0',
      method: 'personal_sign',
    })

    expect(sent).toMatchInlineSnapshot(`
      [
        {
          "id": 2,
          "jsonrpc": "2.0",
          "method": "personal_sign",
        },
      ]
    `)

    b.destroy()
  })

  test('behavior: waitForReady delays sends until ready', () => {
    const [from, fromRemote] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.send('rpc-request', {
      id: 1,
      jsonrpc: '2.0',
      method: 'test',
    })

    // Not yet delivered — waiting for ready.
    expect(sent).toMatchInlineSnapshot('[]')

    // Remote side signals ready.
    fromRemote.send('ready', undefined)

    // Now the buffered send should have been delivered.
    expect(sent).toMatchInlineSnapshot(`
      [
        {
          "id": 1,
          "jsonrpc": "2.0",
          "method": "test",
        },
      ]
    `)

    b.destroy()
  })

  test('behavior: waitForReady resolves', async () => {
    const [from, fromRemote] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const readyPromise = b.waitForReady()
    fromRemote.send('ready', undefined)

    await readyPromise

    b.destroy()
  })

  test('behavior: ready sends ready topic', () => {
    const [from] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to })

    const received: unknown[] = []
    toRemote.on('ready', (payload) => received.push(payload))

    b.ready()

    expect(received).toMatchInlineSnapshot(`
      [
        undefined,
      ]
    `)

    b.destroy()
  })

  test('behavior: sends after ready go directly without buffering', () => {
    const [from, fromRemote] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    fromRemote.send('ready', undefined)

    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.send('rpc-request', {
      id: 2,
      jsonrpc: '2.0',
      method: 'post-ready',
    })

    expect(sent).toMatchInlineSnapshot(`
      [
        {
          "id": 2,
          "jsonrpc": "2.0",
          "method": "post-ready",
        },
      ]
    `)

    b.destroy()
  })

  test('behavior: destroy rejects pending waitForReady', async () => {
    const [from] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const readyPromise = b.waitForReady()
    b.destroy()

    await expect(readyPromise).rejects.toThrow('Bridge destroyed')
  })

  test('behavior: destroy cleans up', () => {
    const [from] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to })

    // Should not throw after destroy.
    b.destroy()
    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })
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

/** Creates a pair of synchronous in-memory messengers wired together. */
function createPair(): [Messenger.Messenger, Messenger.Messenger] {
  type Listener = { topic: string; fn: (payload: unknown) => void }
  const aListeners: Listener[] = []
  const bListeners: Listener[] = []

  function create(own: Listener[], peer: Listener[]): Messenger.Messenger {
    return Messenger.from({
      destroy() {
        own.length = 0
      },
      on(topic, listener) {
        const entry = { topic, fn: listener as (payload: unknown) => void }
        own.push(entry)
        return () => {
          const idx = own.indexOf(entry)
          if (idx >= 0) own.splice(idx, 1)
        }
      },
      send(topic, payload) {
        for (const l of [...peer]) if (l.topic === topic) l.fn(payload)
      },
    })
  }

  return [create(aListeners, bListeners), create(bListeners, aListeners)]
}
