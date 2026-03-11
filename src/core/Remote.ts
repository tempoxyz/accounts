import { Hex } from 'ox'
import * as Provider from 'ox/Provider'
import * as RpcResponse from 'ox/RpcResponse'
import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import type * as Messenger from '../core/Messenger.js'
import type * as CoreProvider from '../core/Provider.js'
import type * as Store from '../core/Store.js'

/** State managed by the remote (dialog) side. */
export type State = {
  /** Whether the dialog is rendered in an iframe or popup. */
  mode: 'iframe' | 'popup' | undefined
  /** Queued RPC requests received from the host. */
  requests: readonly Store.QueuedRequest[]
}

/** Remote context — bundles messenger, provider, and remote store. */
export type Remote = {
  /** 
   * Messenger for remote communication.
   */
  messenger: Messenger.Bridge
  /** 
   * Provider instance for executing RPC methods. 
   */
  provider: CoreProvider.Provider
  /** 
   * Remote context store.
   */
  store: StoreApi<State>
  /**
   * Subscribes to dialog-worthy RPC requests from the parent context.
   *
   * Syncs the host's active chain, updates the remote store, and invokes
   * the callback with the first pending request (or `null` when the queue
   * is cleared, signalling the dialog should close).
   *
   * @param cb - Callback receiving the dialog request payload.
   * @returns Unsubscribe function.
   */
  onDialogRequest: (cb: (payload: onDialogRequest.Payload) => void) => () => void
  /**
   * Subscribes to incoming RPC requests from the parent context.
   * Updates the remote store with the received requests and syncs the
   * host's active chain to the remote provider.
   *
   * @param cb - Callback receiving the full queued request list.
   * @returns Unsubscribe function.
   */
  onRequests: (
    cb: (requests: readonly Store.QueuedRequest[], event: MessageEvent) => void,
  ) => () => void
  /**
   * Signals readiness to the host and begins accepting requests.
   * Call this after the remote context is fully initialized.
   */
  ready: () => void
  /** 
   * Reject an RPC request. 
   */
  reject: (
    request: Store.QueuedRequest['request'],
    error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined,
  ) => void
  /** Reject all pending RPC requests. */
  rejectAll: (error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined) => void
  /**
   * Respond to an RPC request.
   *
   * When `options.result` is provided, sends it directly.
   * When `options.error` is provided, sends an error response.
   * Otherwise, executes `provider.request(request)` and sends the result.
   */
  respond: (
    request: Store.QueuedRequest['request'],
    options?: respond.Options,
  ) => Promise<unknown>
}

export declare namespace onDialogRequest {
  type Payload = {
    /** Origin of the host that opened this dialog. */
    origin: string
    /** The pending request to display, or `null` when the dialog should close. */
    request: Store.QueuedRequest['request'] | null
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

/** Creates a remote context for the dialog app. */
export function create(options: create.Options): Remote {
  const { messenger, provider } = options
  const store = createStore<State>(() => ({ mode: undefined, requests: [] }))

  return {
    messenger,
    provider,
    store,

    onDialogRequest(cb) {
      return this.onRequests((requests, event) => {
        const pending = requests.find((r) => r.status === 'pending')
        cb({
          origin: event.origin,
          request: pending?.request ?? null,
        })
      })
    },

    onRequests(cb) {
      return messenger.on('rpc-requests', (payload, event) => {
        const { chainId, requests } = payload

        store.setState({ requests })

        if (provider.store.getState().chainId !== chainId)
          provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(chainId) }],
          })

        cb(requests, event)
      })
    },

    ready() {
      messenger.ready()

      messenger.on('__internal', (payload) => {
        if (payload.type !== 'init') return

        store.setState({ mode: payload.mode })

        if (provider.store.getState().chainId !== payload.chainId)
          provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(payload.chainId) }],
          })
      })
    },

    reject(request, error) {
      const error_ = error ?? new Provider.UserRejectedRequestError()
      messenger.send(
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
    },

    rejectAll(error) {
      const requests = store.getState().requests
      for (const queued of requests) this.reject(queued.request, error)
    },

    async respond(request, options = {}) {
      const { error, selector } = options
      const shared = { id: request.id, jsonrpc: '2.0' } as const

      if (error) {
        messenger.send(
          'rpc-response',
          Object.assign(RpcResponse.from({ ...shared, error, status: 'error' }), {
            _request: request,
          }),
        )
        return
      }

      try {
        let result = options.result ?? (await provider?.request(request as never))
        if (selector) result = selector(result)
        messenger.send(
          'rpc-response',
          Object.assign(RpcResponse.from({ ...shared, result }), { _request: request }),
        )
        return result
      } catch (e) {
        const err = e as RpcResponse.BaseError
        messenger.send(
          'rpc-response',
          Object.assign(RpcResponse.from({ ...shared, error: err, status: 'error' }), {
            _request: request,
          }),
        )
        throw err
      }
    },
  }
}

export declare namespace create {
  type Options = {
    /** Bridge messenger for cross-frame communication. */
    messenger: Messenger.Bridge
    /** Provider to execute RPC requests against. */
    provider: CoreProvider.Provider
  }
}
