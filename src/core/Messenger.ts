import type { RpcRequest, RpcResponse } from 'ox'
import { Envelope, postMessage as consumerPostMessage, Rpc } from 'wata'
import type { Transport } from 'wata'
import { postMessage as hostPostMessage } from 'wata/host'

import type * as Remote from './Remote.js'

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

type Startable = Messenger & {
  /** Start the underlying transport after listeners are registered. */
  start: () => Promise<void>
}

/** Options sent with the `ready` signal from the remote frame. */
export type ReadyOptions = {
  /** CSS `color-scheme` used by the remote embed (e.g. `'dark'`). */
  colorScheme?: string | undefined
  /** Hostnames trusted by the remote embed to render in an iframe. */
  trustedHosts?: readonly string[] | undefined
}

/** Bridge messenger that waits for a `ready` signal from the remote frame. */
export type Bridge = Messenger & {
  /** Signal readiness (called by the remote frame). */
  ready: (options?: ReadyOptions | undefined) => void
  /** Promise that resolves when the remote frame signals ready. */
  waitForReady: () => Promise<ReadyOptions>
}

/** Message schema for cross-frame communication. */
export type Schema = [
  {
    topic: 'ready'
    payload: ReadyOptions
  },
  {
    topic: 'rpc-requests'
    payload: Remote.Sync
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
    topic: 'switch-mode'
    payload: { mode: 'popup' }
  },
  {
    topic: 'sync'
    payload: { addresses?: readonly string[] | undefined; valid?: boolean | undefined }
  },
  {
    topic: 'theme'
    payload: {
      accent?: string | undefined
      radius?: string | undefined
      scheme?: string | undefined
    }
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

/** Creates a messenger backed by Wata's `postMessage` transport. */
export function fromPostMessage(options: fromPostMessage.Options): Messenger {
  const { source = window } = options
  const { source: source_, getOrigin } = withOrigin(source)
  if (options.role === 'consumer') {
    return fromTransport(
      consumerPostMessage({
        close: () => {},
        host: options.host,
        source: source_,
        target: () => options.target,
      }),
      { getOrigin, open: options.open },
    )
  }

  return fromTransport(
    hostPostMessage({
      close: () => {},
      source: source_,
      target: () => options.target,
      targetOrigin: options.targetOrigin,
    }),
    { getOrigin, open: options.open },
  )
}

export declare namespace fromPostMessage {
  type Options =
    | {
        /** Consumer side of the Wata postMessage transport. */
        role: 'consumer'
        /** Host URL or origin. Used for Wata origin pinning. */
        host: string
        /** Window that receives inbound postMessage events. */
        source?: Window | undefined
        /** Optional gate before opening the Wata transport. */
        open?: Promise<void> | undefined
        /** Peer window to send messages to. */
        target: Window
      }
    | {
        /** Host side of the Wata postMessage transport. */
        role: 'host'
        /** Window that receives inbound postMessage events. */
        source?: Window | undefined
        /** Optional gate before opening the Wata transport. */
        open?: Promise<void> | undefined
        /** Peer window to send messages to. */
        target: Window
        /** Consumer origin. Defaults to Wata's host-side wildcard. */
        targetOrigin?: string | undefined
      }
}

function fromTransport(
  transport: Transport.Transport,
  options: { getOrigin: () => string | undefined; open?: Promise<void> | undefined },
): Startable {
  const listeners = new Set<{
    topic: Topic
    id: string | undefined
    listener: (payload: never, event: MessageEvent) => void
  }>()
  const abort = new AbortController()
  let opening: Promise<void> | undefined
  transport.on(
    'message',
    (envelope) => {
      if (envelope.type !== 'rpc-requests') return
      const event = { origin: options.getOrigin() ?? '' } as MessageEvent
      for (const message of envelope.payload) {
        if (!('id' in message)) continue
        const topic = message.method as Topic
        const payload = Array.isArray(message.params) ? message.params[0] : undefined
        const id = String(message.id)
        dispatch({ event, id, payload, topic })
      }
    },
    { signal: abort.signal },
  )
  transport.on('error', () => {}, { signal: abort.signal })

  return {
    destroy() {
      abort.abort()
      listeners.clear()
      void transport.close()
    },
    on(topic, listener, id) {
      const item = { id, listener: listener as never, topic }
      listeners.add(item)
      return () => {
        listeners.delete(item)
      }
    },
    async send(topic, payload) {
      const id = crypto.randomUUID()
      await start()
      await transport.send(
        Envelope.rpcRequests([
          Rpc.request({
            id,
            method: topic,
            params: [normalizeValue(payload)] as const,
          }),
        ]),
      )
      return { id, payload, topic } as never
    },
    start,
  }

  function start() {
    opening ??= (async () => {
      if (options.open) await options.open
      await transport.start()
    })()
    return opening
  }

  function dispatch(message: {
    topic: Topic
    id: string
    payload: unknown
    event: MessageEvent
  }): boolean {
    let handled = false
    for (const item of listeners) {
      if (item.topic !== message.topic) continue
      if (item.id && item.id !== message.id) continue
      handled = true
      item.listener(message.payload as never, message.event)
    }
    return handled
  }
}

function withOrigin(source: Window): {
  getOrigin: () => string | undefined
  source: fromPostMessage.WindowLike
} {
  const listeners = new Map<EventListenerOrEventListenerObject, EventListener>()
  let origin: string | undefined
  return {
    getOrigin() {
      return origin
    },
    source: {
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean | undefined,
      ) {
        if (type !== 'message') {
          source.addEventListener(type, listener, options)
          return
        }
        const wrapped = ((event: MessageEvent) => {
          origin = event.origin
          if (typeof listener === 'function') listener(event)
          else listener.handleEvent(event)
        }) as EventListener
        listeners.set(listener, wrapped)
        source.addEventListener(type, wrapped, options)
      },
      postMessage(data, targetOrigin) {
        source.postMessage(data, targetOrigin)
      },
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: EventListenerOptions | boolean | undefined,
      ) {
        if (type !== 'message') {
          source.removeEventListener(type, listener, options)
          return
        }
        const wrapped = listeners.get(listener)
        source.removeEventListener(type, wrapped ?? listener, options)
        listeners.delete(listener)
      },
    },
  }
}

export declare namespace fromPostMessage {
  type WindowLike = {
    addEventListener: Window['addEventListener']
    postMessage: (data: unknown, targetOrigin: string) => void
    removeEventListener: Window['removeEventListener']
  }
}

/**
 * Bridges two window messengers. The bridge waits for a `ready` signal
 * before sending messages when `waitForReady` is `true`.
 */
export function bridge(parameters: bridge.Parameters): Bridge {
  const { from: from_, to, waitForReady = false } = parameters

  let pending = false

  const ready = withResolvers<ReadyOptions>()
  from_.on('ready', (payload) => ready.resolve(payload ?? {}))
  start(from_)
  if (from_ !== to) start(to)

  const messenger = from({
    destroy() {
      from_.destroy()
      if (from_ !== to) to.destroy()
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
    ready(options) {
      void messenger.send('ready', options ?? {})
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

function start(messenger: Messenger) {
  void (messenger as Partial<Startable>).start?.()
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
      return Promise.resolve({})
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
