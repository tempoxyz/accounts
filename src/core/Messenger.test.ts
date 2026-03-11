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
    const messenger = Messenger.fromWindow(fakeWindow(listeners), {
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

  test('behavior: ignores messages without _tempo marker', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const w = fakeWindow(listeners)

    const messenger = Messenger.fromWindow(w)
    const fn = vi.fn()
    messenger.on('rpc-request', fn)

    for (const listener of listeners)
      listener({
        data: { topic: 'rpc-request', payload: { id: 1 } },
      } as MessageEvent)

    expect(fn).not.toHaveBeenCalled()
    messenger.destroy()
  })

  test('behavior: ignores non-object and malformed event.data', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const w = fakeWindow(listeners)

    const messenger = Messenger.fromWindow(w)
    const fn = vi.fn()
    messenger.on('rpc-request', fn)

    for (const data of [null, undefined, 42, 'hello', [], { _tempo: true }])
      for (const listener of listeners) listener({ data } as MessageEvent)

    expect(fn).not.toHaveBeenCalled()
    messenger.destroy()
  })

  test('behavior: filters by expectedSource', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const w = fakeWindow(listeners)
    const trustedSource = {} as MessageEventSource

    const messenger = Messenger.fromWindow(w, { expectedSource: trustedSource })
    const fn = vi.fn()
    messenger.on('rpc-request', fn)

    // Wrong source.
    for (const listener of listeners)
      listener({
        data: {
          topic: 'rpc-request',
          payload: { id: 1, jsonrpc: '2.0', method: 'test' },
          _tempo: true,
        },
        origin: '',
        source: {} as MessageEventSource,
      } as MessageEvent)

    expect(fn).not.toHaveBeenCalled()

    // Correct source.
    for (const listener of listeners)
      listener({
        data: {
          topic: 'rpc-request',
          payload: { id: 1, jsonrpc: '2.0', method: 'test' },
          _tempo: true,
        },
        origin: '',
        source: trustedSource,
      } as MessageEvent)

    expect(fn).toHaveBeenCalledOnce()
    messenger.destroy()
  })

  test('behavior: enforces both targetOrigin and expectedSource', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const w = fakeWindow(listeners)
    const trustedSource = {} as MessageEventSource

    const messenger = Messenger.fromWindow(w, {
      targetOrigin: 'https://auth.tempo.xyz',
      expectedSource: trustedSource,
    })
    const fn = vi.fn()
    messenger.on('rpc-request', fn)

    const msg = {
      topic: 'rpc-request',
      payload: { id: 1, jsonrpc: '2.0', method: 'test' },
      _tempo: true,
    }

    // Right origin, wrong source.
    for (const listener of listeners)
      listener({
        data: msg,
        origin: 'https://auth.tempo.xyz',
        source: {} as MessageEventSource,
      } as MessageEvent)
    expect(fn).not.toHaveBeenCalled()

    // Wrong origin, right source.
    for (const listener of listeners)
      listener({
        data: msg,
        origin: 'https://evil.com',
        source: trustedSource,
      } as MessageEvent)
    expect(fn).not.toHaveBeenCalled()

    // Both correct.
    for (const listener of listeners)
      listener({
        data: msg,
        origin: 'https://auth.tempo.xyz',
        source: trustedSource,
      } as MessageEvent)
    expect(fn).toHaveBeenCalledOnce()
    messenger.destroy()
  })

  test('behavior: wrong-topic messages do not notify unrelated listeners', () => {
    const [a, b] = createPair()

    const fn = vi.fn()
    a.on('rpc-response', fn)

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })

    expect(fn).not.toHaveBeenCalled()
    a.destroy()
    b.destroy()
  })

  test('behavior: same listener registered twice fires twice', () => {
    const [a, b] = createPair()

    const calls: number[] = []
    const fn = () => calls.push(1)
    a.on('rpc-request', fn)
    a.on('rpc-request', fn)

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })

    expect(calls).toMatchInlineSnapshot(`
      [
        1,
        1,
      ]
    `)
    a.destroy()
    b.destroy()
  })

  test('behavior: each unsubscribe removes only its own registration', () => {
    const [a, b] = createPair()

    const calls: string[] = []
    const fn = () => calls.push('called')
    const off1 = a.on('rpc-request', fn)
    a.on('rpc-request', fn)

    off1()

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })

    expect(calls).toMatchInlineSnapshot(`
      [
        "called",
      ]
    `)
    a.destroy()
    b.destroy()
  })

  test('behavior: unsubscribe is idempotent', () => {
    const [a] = createPair()

    const off = a.on('rpc-request', () => {})
    off()
    expect(() => off()).not.toThrow()
    a.destroy()
    expect(() => off()).not.toThrow()
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

  test('behavior: send after destroy does not deliver', () => {
    const [from] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to })

    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.destroy()
    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })

    expect(sent).toMatchInlineSnapshot('[]')
  })

  test('behavior: destroy is idempotent', () => {
    const [from] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to })

    b.destroy()
    expect(() => b.destroy()).not.toThrow()
  })

  test('behavior: duplicate ready flushes buffered queue exactly once', () => {
    const [from, fromRemote] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'first' })

    fromRemote.send('ready', undefined)
    fromRemote.send('ready', undefined)

    expect(sent).toMatchInlineSnapshot(`
      [
        {
          "id": 1,
          "jsonrpc": "2.0",
          "method": "first",
        },
      ]
    `)

    b.destroy()
  })

  test('behavior: buffered sends are dropped if destroyed before ready', () => {
    const [from] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const sent: unknown[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload))

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'test' })
    b.destroy()

    expect(sent).toMatchInlineSnapshot('[]')
  })

  test('behavior: buffered sends preserve FIFO order across ready', () => {
    const [from, fromRemote] = createPair()
    const [toRemote, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const sent: string[] = []
    toRemote.on('rpc-request', (payload) => sent.push(payload.method))

    b.send('rpc-request', { id: 1, jsonrpc: '2.0', method: 'A' })
    b.send('rpc-request', { id: 2, jsonrpc: '2.0', method: 'B' })

    fromRemote.send('ready', undefined)

    b.send('rpc-request', { id: 3, jsonrpc: '2.0', method: 'C' })

    expect(sent).toMatchInlineSnapshot(`
      [
        "A",
        "B",
        "C",
      ]
    `)

    b.destroy()
  })

  test('behavior: multiple waitForReady callers all resolve', async () => {
    const [from, fromRemote] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const p1 = b.waitForReady()
    const p2 = b.waitForReady()

    fromRemote.send('ready', undefined)

    await Promise.all([p1, p2])

    b.destroy()
  })

  test('behavior: multiple waitForReady callers all reject on destroy', async () => {
    const [from] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    const p1 = b.waitForReady()
    const p2 = b.waitForReady()

    b.destroy()

    await expect(p1).rejects.toThrow('Bridge destroyed')
    await expect(p2).rejects.toThrow('Bridge destroyed')
  })

  test('behavior: waitForReady called after ready resolves immediately', async () => {
    const [from, fromRemote] = createPair()
    const [, to] = createPair()

    const b = Messenger.bridge({ from, to, waitForReady: true })

    fromRemote.send('ready', undefined)

    await b.waitForReady()

    b.destroy()
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

function fakeWindow(listeners: Array<(event: MessageEvent) => void>) {
  return {
    addEventListener(_: string, handler: (event: MessageEvent) => void) {
      listeners.push(handler)
    },
    removeEventListener() {},
    postMessage() {},
  } as unknown as Window
}

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
