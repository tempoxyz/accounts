import type { RpcRequest, RpcResponse } from 'ox'

import type * as Store from './Store.js'

/** Messenger interface for cross-frame communication. */
export type Messenger = {
  /** Tear down all listeners. */
  destroy: () => void
  /** Subscribe to a topic. Returns an unsubscribe function. */
  on: <const topic extends Topic>(
    topic: topic | Topic,
    listener: (payload: Payload<topic>, event: MessageEvent) => void,
    id?: string | undefined,
  ) => () => void
  /** Send a message on a topic. */
  send: <const topic extends Topic>(
    topic: topic | Topic,
    payload: Payload<topic>,
    targetOrigin?: string | undefined,
  ) => Promise<{ id: string; topic: topic; payload: Payload<topic> }>
}

/** Bridge messenger that waits for a `ready` signal from the remote frame. */
export type Bridge = Messenger & {
  /** Signal readiness (called by the remote frame). */
  ready: () => void
  /** Promise that resolves when the remote frame signals ready. */
  waitForReady: () => Promise<void>
}

/** Message schema for cross-frame communication. */
export type Schema = [
  {
    topic: 'ready'
    payload: undefined
  },
  {
    topic: 'rpc-requests'
    payload: {
      account: { address: string } | undefined
      chainId: number
      requests: readonly Store.QueuedRequest[]
    }
  },
  {
    topic: 'rpc-response'
    payload: RpcResponse.RpcResponse & {
      _request: RpcRequest.RpcRequest
    }
  },
  {
    topic: 'close'
    payload: undefined
  },
]

/** Union of all topic strings. */
export type Topic = Schema[number]['topic']

/** Payload for a given topic. */
export type Payload<topic extends Topic> = Extract<Schema[number], { topic: topic }>['payload']

/** Creates a messenger from a custom implementation. */
export function from(messenger: Messenger): Messenger {
  return messenger
}

/**
 * Creates a messenger backed by `window.postMessage` / `addEventListener('message')`.
 * Filters messages by `targetOrigin` when provided.
 */
export function fromWindow(w: Window, options: fromWindow.Options = {}): Messenger {
  const { targetOrigin } = options
  const listeners = new Map<string, (event: MessageEvent) => void>()

  return from({
    destroy() {
      for (const listener of listeners.values()) w.removeEventListener('message', listener)
      listeners.clear()
    },
    on(topic, listener, id) {
      function onMessage(event: MessageEvent) {
        if (event.data.topic !== topic) return
        if (id && event.data.id !== id) return
        if (targetOrigin && event.origin !== targetOrigin) return
        listener(event.data.payload as never, event)
      }
      w.addEventListener('message', onMessage)
      listeners.set(topic, onMessage)
      return () => {
        w.removeEventListener('message', onMessage)
        listeners.delete(topic)
      }
    },
    async send(topic, payload, target) {
      const id = crypto.randomUUID()
      w.postMessage(normalizeValue({ id, payload, topic }), target ?? targetOrigin ?? '*')
      return { id, payload, topic } as never
    },
  })
}

export declare namespace fromWindow {
  type Options = {
    /** Only accept messages from this origin. Also used as the `targetOrigin` for `postMessage`. */
    targetOrigin?: string | undefined
  }
}

/**
 * Bridges two window messengers. The bridge waits for a `ready` signal
 * before sending messages when `waitForReady` is `true`.
 */
export function bridge(parameters: bridge.Parameters): Bridge {
  const { from: from_, to, waitForReady = false } = parameters

  let pending = false

  const ready = withResolvers<void>()
  from_.on('ready', ready.resolve)

  const messenger = from({
    destroy() {
      from_.destroy()
      to.destroy()
      if (pending) ready.reject()
    },
    on(topic, listener, id) {
      return from_.on(topic, listener, id)
    },
    async send(topic, payload) {
      pending = true
      if (waitForReady) await ready.promise.finally(() => (pending = false))
      return to.send(topic, payload)
    },
  })

  return {
    ...messenger,
    ready() {
      void messenger.send('ready', undefined)
    },
    waitForReady() {
      return ready.promise
    },
  }
}

export declare namespace bridge {
  type Parameters = {
    /** Listens on this messenger. */
    from: Messenger
    /** Sends to this messenger. */
    to: Messenger
    /** Buffer sends until `ready` is received. */
    waitForReady?: boolean | undefined
  }
}

/** Returns a no-op bridge for SSR environments. */
export function noop(): Bridge {
  return {
    destroy() {},
    on() {
      return () => {}
    },
    send() {
      return Promise.resolve(undefined as never)
    },
    ready() {},
    waitForReady() {
      return Promise.resolve()
    },
  }
}

function withResolvers<type>() {
  let resolve: (value: type | PromiseLike<type>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<type>((resolve_, reject_) => {
    resolve = resolve_
    reject = reject_
  })
  return { promise, reject, resolve }
}

/**
 * Normalizes a value into a structured-clone compatible format.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
 */
function normalizeValue<type>(value: type): type {
  if (Array.isArray(value)) return value.map(normalizeValue) as never
  if (typeof value === 'function') return undefined as never
  if (typeof value !== 'object' || value === null) return value
  if (Object.getPrototypeOf(value) !== Object.prototype)
    try {
      return structuredClone(value)
    } catch {
      return undefined as never
    }

  const normalized: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) normalized[k] = normalizeValue(v)
  return normalized as never
}
