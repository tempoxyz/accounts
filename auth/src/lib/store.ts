import { useStore as useStore_ } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** App-level store for the auth dialog. */
export const store = createStore<store.State>(() => ({
  origin: undefined,
  ready: false,
}))

/** React hook to select from the app store. */
export function useStore(): store.State
export function useStore<selected>(selector: (state: store.State) => selected): selected
export function useStore(selector?: (state: store.State) => unknown) {
  return useStore_(store, selector as never)
}

export declare namespace store {
  type State = {
    /** Trusted host origin from MessageEvent. */
    origin: string | undefined
    /** Whether the first dialog request has been received. */
    ready: boolean
  }
}
