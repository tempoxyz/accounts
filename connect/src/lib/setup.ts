import * as Messenger from './messenger.js'
import * as Request from './request.js'
import * as Store from './store.js'

/** Messenger bridge singleton. */
export const messenger = Messenger.init()

/** Dialog state store singleton. */
export const store = Store.create()

/** Wire messenger events. */
messenger.on('__internal', (payload) => {
  if (payload.type !== 'init') return
  store.setState({ mode: payload.mode, referrer: payload.referrer })
})
messenger.on('rpc-requests', (requests) => {
  for (const request of requests) {
    const response = Request.handle(request)
    messenger.send('rpc-response', {
      id: request.id,
      jsonrpc: '2.0',
      ...response,
      _request: { id: request.id, method: request.method },
    })
  }
})
messenger.ready()
