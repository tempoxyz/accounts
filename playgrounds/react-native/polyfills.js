import 'react-native-get-random-values'

if (typeof globalThis.MessageEvent === 'undefined') {
  // Plain class (not `extends Event`): Hermes lacks an Event constructor, so
  // `instanceof Event` and propagation methods are unavailable on this shim.
  class MessageEventPolyfill {
    constructor(type, options = {}) {
      this.data = options.data ?? null
      this.lastEventId = options.lastEventId ?? ''
      this.origin = options.origin ?? ''
      this.ports = options.ports ?? []
      this.source = options.source ?? null
      this.type = type
    }
  }

  globalThis.MessageEvent = MessageEventPolyfill
}
