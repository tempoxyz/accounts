import type { RpcRequest } from 'ox'
import type * as Provider from 'ox/Provider'
import type * as RpcResponse from 'ox/RpcResponse'
import type { StoreApi } from 'zustand/vanilla'

import type { OneOf } from '../../internal/types.js'
import type * as CoreProvider from '../Provider.js'

/** Visual theme configuration for the dialog embed. */
export type Theme = {
  /** Accent color — a theme preset name or a CSS color value (e.g. `'#6366f1'`). */
  accent?: 'neutral' | 'blue' | 'red' | 'amber' | 'green' | 'purple' | (string & {}) | undefined
  /** Border radius preset. */
  radius?: 'none' | 'small' | 'medium' | 'large' | 'full' | undefined
  /** Color scheme — controls light/dark appearance. Defaults to `'light dark'` (follows OS). */
  scheme?: 'light' | 'dark' | undefined
}

/** Options sent with the ready signal from the dialog host. */
export type ReadyOptions = {
  /** CSS `color-scheme` used by the dialog host (e.g. `'dark'`). */
  colorScheme?: string | undefined
  /** Hostnames trusted by the dialog host to render in an iframe. */
  trustedHosts?: readonly string[] | undefined
}

/** A JSON-RPC request tracked across the dialog boundary. */
export type Request<result = unknown> = OneOf<
  | {
      /** JSON-RPC request sent to the dialog host. */
      request: RpcRequest.RpcRequest
      /** Request is waiting for a host response. */
      status: 'pending'
    }
  | {
      /** JSON-RPC request sent to the dialog host. */
      request: RpcRequest.RpcRequest
      /** Resolved RPC result. */
      result: result
      /** Request completed successfully. */
      status: 'success'
    }
  | {
      /** JSON-RPC request sent to the dialog host. */
      request: RpcRequest.RpcRequest
      /** RPC error returned by the dialog host. */
      error: RpcResponse.ErrorObject
      /** Request completed with an error. */
      status: 'error'
    }
>

/** Pending JSON-RPC request tracked across the dialog boundary. */
export type PendingRequest = Extract<Request, { status: 'pending' }>

/** RPC request payload sent from a consumer adapter to the dialog host. */
export type RequestContext = {
  /** Active account for the request source, or `undefined` if none is selected. */
  account: { address: string } | undefined
  /** Chain ID for the request source. */
  chainId: number
  /** Pending request sent to the dialog host. */
  request: PendingRequest
}

/** State managed by the dialog host side. */
export type State = {
  /** Whether the dialog is rendered in an iframe or popup. */
  mode: 'iframe' | 'popup' | undefined
  /** Consumer origin that opened this dialog. */
  origin: string | undefined
  /** Whether the dialog is ready to display content. */
  ready: boolean
  /** Queued RPC requests received from the consumer. */
  requests: readonly Request[]
}

/** Metadata attached to dialog channel messages. */
export type Meta = {
  /** Origin of the peer that sent the message. */
  origin: string
}

/** Dialog host runtime — bundles channel, provider, and store. */
export type Host = {
  /** Dialog channel for consumer/host communication. */
  channel: import('./channel.js').Host
  /** Provider instance for executing RPC methods. */
  provider: CoreProvider.Provider
  /** Dialog host state store. */
  store: StoreApi<State>
  /** Hostnames trusted to render the embed in an iframe. */
  trustedHosts: readonly string[]
  /** Subscribes to user-facing RPC requests from the consumer context. */
  onUserRequest: (cb: (payload: onUserRequest.Payload) => void | Promise<void>) => () => void
  /** Subscribes to incoming RPC requests from the consumer context. */
  onRequest: (
    cb: (
      request: PendingRequest,
      meta: Meta,
      extra: { account: { address: string } | undefined; chainId: number },
    ) => void | Promise<void>,
  ) => () => void
  /** Signals readiness to the consumer and begins accepting requests. */
  ready: (options?: ready.Options | undefined) => void
  /** Reject an RPC request. */
  reject: (
    request: Request['request'],
    error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined,
  ) => void
  /** Reject all pending RPC requests. */
  rejectAll: (error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined) => void
  /** Respond to an RPC request. */
  respond: (request: Request['request'], options?: respond.Options) => Promise<unknown>
}

export declare namespace onUserRequest {
  type Payload = {
    /** Active account on the consumer side. */
    account: { address: string } | undefined
    /** Origin of the consumer that opened this dialog. */
    origin: string
    /** The pending request to display. */
    request: Request['request']
  }
}

export declare namespace ready {
  type Options = ReadyOptions & {
    /** Authenticated account addresses. When provided, the host validates cached consumer accounts. */
    accounts?: readonly string[] | undefined
  }
}

export declare namespace respond {
  type Options = {
    /** Return the resolved result without sending the RPC response. */
    defer?: boolean | undefined
    /** Error to respond with (takes precedence over result). */
    error?: { code: number; message: string } | undefined
    /**
     * Called when `provider.request()` throws. Return `true` to suppress the
     * error response to the consumer — the dialog stays open and can show a
     * recovery UI. The error is still re-thrown to the caller.
     */
    onError?: ((error: Error) => boolean | void) | undefined
    /** Explicit result — if omitted, calls `provider.request(request)`. */
    result?: unknown | undefined
    /** Transform the result before sending. */
    selector?: ((result: any) => unknown) | undefined
  }
}
