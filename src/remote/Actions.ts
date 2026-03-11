import * as Provider from 'ox/Provider'
import * as RpcResponse from 'ox/RpcResponse'

import type * as Store from '../core/Store.js'
import type * as Remote from './Remote.js'

/** Reject an RPC request. */
export function reject(
  remote: Remote.Remote,
  request: Store.QueuedRequest['request'],
  error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined,
) {
  const error_ = error ?? new Provider.UserRejectedRequestError()
  remote.messenger.send(
    'rpc-response',
    Object.assign(
      RpcResponse.from({
        error: { code: error_.code, message: error_.message },
        id: request.id,
        jsonrpc: '2.0',
      }),
      { _request: request },
    ),
  )
}

/** Reject all pending RPC requests. */
export function rejectAll(
  remote: Remote.Remote,
  error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined,
) {
  const requests = remote._internal.store.getState().requests
  for (const queued of requests) reject(remote, queued.request, error)
}

/**
 * Respond to an RPC request.
 *
 * When `options.result` is provided, sends it directly.
 * When `options.error` is provided, sends an error response.
 * Otherwise, executes `provider.request(request)` and sends the result.
 */
export async function respond(
  remote: Remote.Remote,
  request: Store.QueuedRequest['request'],
  options: respond.Options = {},
) {
  const { error, selector } = options
  const shared = { id: request.id, jsonrpc: '2.0' } as const

  if (error) {
    remote.messenger.send(
      'rpc-response',
      Object.assign(RpcResponse.from({ ...shared, error, status: 'error' }), { _request: request }),
    )
    return
  }

  try {
    let result = options.result ?? (await remote.provider?.request(request as never))
    if (selector) result = selector(result)
    remote.messenger.send(
      'rpc-response',
      Object.assign(RpcResponse.from({ ...shared, result }), { _request: request }),
    )
    return result
  } catch (e) {
    const err = e as RpcResponse.BaseError
    remote.messenger.send(
      'rpc-response',
      Object.assign(RpcResponse.from({ ...shared, error: err, status: 'error' }), {
        _request: request,
      }),
    )
    throw err
  }
}

export declare namespace respond {
  type Options = {
    /** Error to respond with (takes precedence over result). */
    error?: { code: number; message: string } | undefined
    /** Explicit result — if omitted, calls `provider.request(request)`. */
    result?: unknown | undefined
    /** Transform the result before sending. */
    selector?: ((result: any) => unknown) | undefined
  }
}
