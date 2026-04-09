import type { RpcRequest, RpcResponse } from 'ox'
import type { Mutate, StoreApi } from 'zustand'

import type { OneOf } from '../internal/types.js'
import type { AccessKey, Store as Account } from './Account.js'
import * as Storage from './Storage.js'
export type { AccessKey, Account }
/** Reactive state for the provider. */
export type State = {
  /** Stored access keys. */
  accessKeys: readonly AccessKey[]
  /** Connected accounts. */
  accounts: readonly Account[]
  /** Index of the active account. */
  activeAccount: number
  /** Active chain ID. */
  chainId: number
  /** Queued RPC requests pending resolution by the dialog. */
  requestQueue: readonly QueuedRequest[]
}
/** Zustand vanilla store with `subscribeWithSelector` and `persist` middleware. */
export type Store = Mutate<
  StoreApi<State>,
  [['zustand/subscribeWithSelector', never], ['zustand/persist', State]]
>
/** Options for {@link create}. */
export type Options = {
  /** Initial chain ID. */
  chainId: number
  /** Whether to persist credentials and access keys to storage. When `false`, only account addresses are persisted. @default true */
  persistCredentials?: boolean | undefined
  /** Storage adapter for persistence. */
  storage?: Storage.Storage | undefined
}
/** A queued JSON-RPC request tracked in the store. */
export type QueuedRequest<result = unknown> = OneOf<
  | {
      request: RpcRequest.RpcRequest
      status: 'pending'
    }
  | {
      request: RpcRequest.RpcRequest
      result: result
      status: 'success'
    }
  | {
      request: RpcRequest.RpcRequest
      error: RpcResponse.ErrorObject
      status: 'error'
    }
>
/**
 * Creates a Zustand vanilla store with `subscribeWithSelector` and `persist` middleware.
 */
export declare function create(options: Options): Store
/**
 * Waits for the store to finish hydrating from storage.
 *
 * Returns immediately if the store has already hydrated. Otherwise, waits
 * for the `onFinishHydration` callback with a 100ms safety timeout fallback.
 */
export declare function waitForHydration(store: Store): Promise<void>
//# sourceMappingURL=Store.d.ts.map
