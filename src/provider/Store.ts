import type { Mutate, StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import type { Store as Account } from './Account.js'
import * as Storage from './Storage.js'

export type { Account }

/** Reactive state for the provider. */
export type State = {
  /** Connected accounts. */
  accounts: readonly Account[]
  /** Index of the active account in {@link State.accounts}. */
  activeAccount: number
  /** Active chain ID. */
  chainId: number
  /** Connection status. */
  status: 'connected' | 'disconnected' | 'reconnecting'
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
  /** Storage adapter for persistence. Defaults to `Storage.memory()`. */
  storage?: Storage.Storage | undefined
  /** Storage key. */
  storageKey?: string | undefined
  /**
   * Whether to persist account key data (private keys, credentials) to storage.
   * When `false`, only addresses are persisted.
   * @default false
   * @internal
   * @deprecated
   */
  internal_persistPrivate?: boolean | undefined
}

/**
 * Creates a Zustand vanilla store with `subscribeWithSelector` and `persist` middleware.
 */
export function create(options: Options): Store {
  const {
    chainId,
    storage = Storage.memory(),
    storageKey = 'tempo.account',
    internal_persistPrivate = false,
  } = options

  return createStore(
    subscribeWithSelector(
      persist<State>(
        () => ({
          accounts: [],
          activeAccount: 0,
          chainId,
          status: 'disconnected',
        }),
        {
          merge(persisted, current) {
            const state = persisted as State
            return {
              ...current,
              ...state,
              chainId: state.chainId ?? current.chainId,
              status: current.status,
            }
          },
          name: storageKey,
          partialize: (state) =>
            ({
              accounts: internal_persistPrivate
                ? state.accounts
                : state.accounts.map((a) => ({ address: a.address })),
              activeAccount: state.activeAccount,
              chainId: state.chainId,
            }) as unknown as State,
          storage,
          version: 0,
        },
      ),
    ),
  )
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
