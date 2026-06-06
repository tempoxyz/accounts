import 'react-native-get-random-values'

if (typeof globalThis.MessageEvent === 'undefined') {
  class MessageEventPolyfill extends Event {
    constructor(type, options = {}) {
      super(type, options)
      this.data = options.data ?? null
      this.lastEventId = options.lastEventId ?? ''
      this.origin = options.origin ?? ''
      this.ports = options.ports ?? []
      this.source = options.source ?? null
    }
  }

  globalThis.MessageEvent = MessageEventPolyfill
}
