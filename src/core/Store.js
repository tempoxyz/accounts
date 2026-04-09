import { persist } from 'zustand/middleware'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import * as Storage from './Storage.js'
/**
 * Creates a Zustand vanilla store with `subscribeWithSelector` and `persist` middleware.
 */
export function create(options) {
  const {
    chainId,
    persistCredentials = true,
    storage = typeof window !== 'undefined'
      ? Storage.idb({ key: 'tempo' })
      : Storage.memory({ key: 'tempo' }),
  } = options
  return createStore(
    subscribeWithSelector(
      persist(
        () => ({
          accessKeys: [],
          accounts: [],
          activeAccount: 0,
          chainId,
          requestQueue: [],
        }),
        {
          merge(persisted, current) {
            const state = persisted
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
          },
          name: 'store',
          partialize: (state) => ({
            accounts: state.accounts,
            activeAccount: state.activeAccount,
            ...(persistCredentials ? { accessKeys: state.accessKeys } : {}),
            chainId: state.chainId,
          }),
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
export async function waitForHydration(store) {
  if (store.persist.hasHydrated()) return
  await new Promise((resolve) => {
    store.persist.onFinishHydration(() => resolve())
    setTimeout(() => resolve(), 100)
  })
}
//# sourceMappingURL=Store.js.map
