import type { RpcRequest, RpcResponse } from 'ox'

import type { OneOf } from '../../internal/types.js'

/** A remote JSON-RPC request tracked across the host/remote boundary. */
export type Request<result = unknown> = OneOf<
  | {
      /** JSON-RPC request sent to the remote. */
      request: RpcRequest.RpcRequest
      /** Request is waiting for a remote response. */
      status: 'pending'
    }
  | {
      /** JSON-RPC request sent to the remote. */
      request: RpcRequest.RpcRequest
      /** Resolved RPC result. */
      result: result
      /** Request completed successfully. */
      status: 'success'
    }
  | {
      /** JSON-RPC request sent to the remote. */
      request: RpcRequest.RpcRequest
      /** RPC error returned by the remote. */
      error: RpcResponse.ErrorObject
      /** Request completed with an error. */
      status: 'error'
    }
>

/** Request queue payload synced from a host adapter instance to the remote app. */
export type Sync = {
  /** Active account for the request source, or `undefined` if none is selected. */
  account: { address: string } | undefined
  /** Chain ID for the request source. */
  chainId: number
  /** Pending request queue sent to the remote auth app. */
  requests: readonly Request[]
}
