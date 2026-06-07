import 'react-native-get-random-values'

if (typeof globalThis.MessageEvent === 'undefined') {
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
