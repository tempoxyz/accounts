import type { RpcRequest, RpcResponse } from 'ox'
import type { Mutate, StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import type { OneOf } from '../internal/types.js'
import type { AccessKey } from './AccessKey.js'
import type { Store as Account } from './Account.js'
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
  /**
   * Absolutized Server Authentication endpoints from the most recent
   * `wallet_connect` (or the Provider's `auth` option). Persisted so
   * `wallet_disconnect` can call `logout` even after a page reload, even
   * when the URL was passed per-call rather than at Provider creation.
   */
  auth?:
    | {
        challenge?: string | undefined
        verify?: string | undefined
        logout?: string | undefined
        returnToken?: boolean | undefined
      }
    | undefined
  /** Active chain ID. */
  chainId: number
  /** Queued RPC requests pending resolution by the dialog. */
  requestQueue: readonly QueuedRequest[]
}

/** Provider state persisted as a refresh snapshot. */
export type Persisted = {
  /** Stored access keys. */
  accessKeys?: readonly AccessKey[] | undefined
  /** Connected accounts. */
  accounts?: readonly Account[] | undefined
  /** Index of the active account. */
  activeAccount?: number | undefined
  /**
   * Absolutized Server Authentication endpoints from the most recent
   * `wallet_connect` (or the Provider's `auth` option).
   */
  auth?: State['auth'] | undefined
  /** Active chain ID. */
  chainId?: number | undefined
}

/** Zustand vanilla store with `subscribeWithSelector` and `persist` middleware. */
export type Store = Mutate<
  StoreApi<State>,
  [['zustand/subscribeWithSelector', never], ['zustand/persist', Persisted]]
>

/** Options for {@link create}. */
export type Options = {
  /** Initial chain ID. */
  chainId: number
  /** Maximum number of accounts to persist. Oldest accounts are evicted when exceeded (LRU). */
  maxAccounts?: number | undefined
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
export function create(options: Options): Store {
  const {
    chainId,
    maxAccounts,
    persistCredentials = true,
    storage = typeof window !== 'undefined'
      ? Storage.idb({ key: 'tempo' })
      : Storage.memory({ key: 'tempo' }),
  } = options

  return createStore(
    subscribeWithSelector(
      persist<State, [], [], Persisted>(
        () => ({
          accessKeys: [],
          accounts: [],
          activeAccount: 0,
          chainId,
          requestQueue: [],
        }),
        {
          merge: hydrate,
          name: 'store',
          partialize: (state) => serialize(state, { maxAccounts, persistCredentials }),
          storage,
          version: 0,
        },
      ),
    ),
  )
}

/** Converts runtime provider state into the persisted refresh snapshot. */
export function serialize(state: State, options: serialize.Options = {}): Persisted {
  const { maxAccounts, persistCredentials = true } = options
  const accounts =
    maxAccounts && state.accounts.length > maxAccounts
      ? state.accounts.slice(0, maxAccounts)
      : state.accounts
  return {
    accounts,
    activeAccount: state.activeAccount,
    ...(persistCredentials ? { accessKeys: state.accessKeys } : {}),
    ...(state.auth ? { auth: state.auth } : {}),
    chainId: state.chainId,
  }
}

export declare namespace serialize {
  /** Options for {@link serialize}. */
  type Options = {
    /** Maximum number of accounts to persist. Oldest accounts are evicted when exceeded. */
    maxAccounts?: number | undefined
    /** Whether to persist credentials and access keys to storage. @default true */
    persistCredentials?: boolean | undefined
  }
}

/** Restores runtime provider state from a persisted refresh snapshot. */
export function hydrate(persisted: unknown, current: State): State {
  const state = persisted && typeof persisted === 'object' ? (persisted as Partial<Persisted>) : {}
  return {
    ...state,
    ...current,
    // Preserve in-memory credentials when persisted accounts only have addresses.
    accounts:
      state.accounts?.map((persisted) => {
        const account = current.accounts.find(
          (a) => a.address.toLowerCase() === persisted.address.toLowerCase(),
        )
        return account ?? persisted
      }) ?? current.accounts,
    accessKeys: state.accessKeys ?? current.accessKeys,
    chainId: state.chainId ?? current.chainId,
  }
}

/**
 * Waits for the store to finish hydrating from storage.
 *
 * Returns immediately if the store has already hydrated. Otherwise, waits
 * for the `onFinishHydration` callback with a 100ms safety timeout fallback.
 */
export async function waitForHydration(store: Store): Promise<void> {
  if (store.persist.hasHydrated()) return
  await new Promise<void>((resolve) => {
    store.persist.onFinishHydration(() => resolve())
    setTimeout(() => resolve(), 100)
  })
}
