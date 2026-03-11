import type * as Messenger from '../core/Messenger.js'
import type * as Store from '../core/Store.js'
import type * as Remote from './Remote.js'

/**
 * Subscribes to incoming RPC requests from the parent context.
 * Updates the remote store with the received requests.
 *
 * @param remote - Remote context.
 * @param cb - Callback receiving the full queued request list.
 * @returns Unsubscribe function.
 */
export function onRequests(
  remote: Remote.Remote,
  cb: (requests: readonly Store.QueuedRequest[], event: MessageEvent) => void,
) {
  return remote.messenger.on('rpc-requests', (payload, event) => {
    remote._internal.store.setState({ requests: payload })
    cb(payload, event)
  })
}

/**
 * Subscribes to the initialization message from the parent context.
 *
 * @param remote - Remote context.
 * @param cb - Callback receiving the init payload.
 * @returns Unsubscribe function.
 */
export function onInitialized(
  remote: Remote.Remote,
  cb: (
    payload: Extract<Messenger.Payload<'__internal'>, { type: 'init' }>,
    event: MessageEvent,
  ) => void,
) {
  return remote.messenger.on('__internal', (payload, event) => {
    if (payload.type === 'init') cb(payload, event)
  })
}
