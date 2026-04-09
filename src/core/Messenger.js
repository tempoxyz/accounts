/** Creates a messenger from a custom implementation. */
export function from(messenger) {
  return messenger
}
/**
 * Creates a messenger backed by `window.postMessage` / `addEventListener('message')`.
 * Filters messages by `targetOrigin` when provided.
 */
export function fromWindow(w, options = {}) {
  const { targetOrigin } = options
  const listeners = new Map()
  return from({
    destroy() {
      for (const listener of listeners.values()) w.removeEventListener('message', listener)
      listeners.clear()
    },
    on(topic, listener, id) {
      function onMessage(event) {
        if (event.data.topic !== topic) return
        if (id && event.data.id !== id) return
        if (targetOrigin && event.origin !== targetOrigin) return
        listener(event.data.payload, event)
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
      return { id, payload, topic }
    },
  })
}
/**
 * Bridges two window messengers. The bridge waits for a `ready` signal
 * before sending messages when `waitForReady` is `true`.
 */
export function bridge(parameters) {
  const { from: from_, to, waitForReady = false } = parameters
  let pending = false
  const ready = withResolvers()
  from_.on('ready', (payload) => ready.resolve(payload ?? {}))
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
    ready(options) {
      void messenger.send('ready', options ?? {})
    },
    waitForReady() {
      return ready.promise
    },
  }
}
/** Returns a no-op bridge for SSR environments. */
export function noop() {
  return {
    destroy() {},
    on() {
      return () => {}
    },
    send() {
      return Promise.resolve(undefined)
    },
    ready() {},
    waitForReady() {
      return Promise.resolve({})
    },
  }
}
function withResolvers() {
  let resolve = () => undefined
  let reject = () => undefined
  const promise = new Promise((resolve_, reject_) => {
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
function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'function') return undefined
  if (typeof value !== 'object' || value === null) return value
  if (Object.getPrototypeOf(value) !== Object.prototype)
    try {
      return structuredClone(value)
    } catch {
      return undefined
    }
  const normalized = {}
  for (const [k, v] of Object.entries(value)) normalized[k] = normalizeValue(v)
  return normalized
}
//# sourceMappingURL=Messenger.js.map
