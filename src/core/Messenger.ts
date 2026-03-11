import type { RpcRequest, RpcResponse } from 'ox'

import type * as Store from './Store.js'

/** Messenger interface for cross-frame communication. */
export type Messenger = {
  /** Tear down all listeners. */
  destroy: () => void
  /** Subscribe to a topic. Returns an unsubscribe function. */
  on: <const topic extends Topic>(
    topic: topic,
    listener: (payload: Payload<topic>, event: MessageEvent) => void,
  ) => () => void
  /** Send a message on a topic. */
  send: <const topic extends Topic>(topic: topic, payload: Payload<topic>) => void
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
  {
    topic: '__internal'
    payload:
      | {
         type: 'init'
         chainId: number
         mode: 'iframe' | 'popup'
       }
      | {
          type: 'resize'
          height?: number | undefined
          width?: number | undefined
        }
  },
]

/** Union of all topic strings. */
export type Topic = Schema[number]['topic']

/** Payload for a given topic. */
export type Payload<topic extends Topic> = Extract<Schema[number], { topic: topic }>['payload']

type Message<topic extends Topic = Topic> = {
  topic: topic
  payload: Payload<topic>
  /** Namespace to avoid collisions with other postMessage users. */
  _tempo: true
}

/** Creates a messenger from a custom implementation. */
export function from(messenger: Messenger): Messenger {
  return messenger
}

/**
 * Creates a messenger backed by `window.postMessage` / `addEventListener('message')`.
 * Filters messages by `targetOrigin` when provided.
 */
export function fromWindow(w: Window, options: fromWindow.Options = {}): Messenger {
  const { expectedSource, targetOrigin } = options
  const listeners = new Map<string, (event: MessageEvent) => void>()

  return from({
    destroy() {
      for (const listener of listeners.values()) w.removeEventListener('message', listener)
      listeners.clear()
    },
    on(topic, listener) {
      function onMessage(event: MessageEvent) {
        const data = event.data as Message | undefined
        if (!data?._tempo) return
        if (data.topic !== topic) return
        if (targetOrigin && event.origin !== targetOrigin) return
        if (expectedSource && event.source !== expectedSource) return
        listener(data.payload as never, event)
      }
      w.addEventListener('message', onMessage)
      listeners.set(topic, onMessage)
      return () => {
        w.removeEventListener('message', onMessage)
        listeners.delete(topic)
      }
    },
    send(topic, payload) {
      const message: Message = { topic, payload, _tempo: true } as never
      w.postMessage(message, targetOrigin ?? '*')
    },
  })
}

export declare namespace fromWindow {
  type Options = {
    /** Expected `event.source` — rejects messages from other frames. */
    expectedSource?: MessageEventSource | undefined
    /** Only accept messages from this origin. Also used as the `targetOrigin` for `postMessage`. */
    targetOrigin?: string | undefined
  }
}

/**
 * Bridges two window messengers. The bridge waits for a `ready` signal
 * before sending messages when `waitForReady` is `true`.
 */
export function bridge(parameters: bridge.Parameters): Bridge {
  const { from, to, waitForReady } = parameters

  const promise = Promise.withResolvers<void>()
  promise.promise.catch(() => {})

  let destroyed = false
  let readyReceived = false

  const pending: Array<() => void> = []

  const offReady = from.on('ready', () => {
    if (readyReceived) return
    readyReceived = true
    promise.resolve()
    for (const send of pending) send()
    pending.length = 0
  })

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      offReady()
      from.destroy()
      to.destroy()
      pending.length = 0
      promise.reject(new Error('Bridge destroyed'))
    },
    on(topic, listener) {
      return from.on(topic, listener)
    },
    send(topic, payload) {
      if (destroyed) return
      if (waitForReady && !readyReceived) {
        pending.push(() => {
          if (!destroyed) to.send(topic, payload)
        })
        return
      }
      to.send(topic, payload)
    },
    ready() {
      to.send('ready', undefined)
    },
    waitForReady() {
      return promise.promise
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
    send() {},
    ready() {},
    waitForReady() {
      return Promise.resolve()
    },
  }
}
