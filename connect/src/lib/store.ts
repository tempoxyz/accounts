import type { Messenger } from '@tempoxyz/accounts'
import { createStore } from 'zustand/vanilla'

/** Pending RPC request from the host. */
export type Request = Messenger.Payload<'rpc-request'> & {
  status: 'pending' | 'responded'
}

/** Dialog UI state. */
export type State = {
  /** Whether the app is rendered in an iframe or popup. */
  mode: 'iframe' | 'popup' | undefined
  /** Information about the host that opened this dialog. */
  referrer: { title: string; icon?: string | undefined } | undefined
  /** All received RPC requests. */
  requests: readonly Request[]
}

/** Zustand vanilla store for dialog UI state. */
export type Store = ReturnType<typeof create>

/** Creates a vanilla Zustand store for dialog UI state. */
export function create() {
  return createStore<State>(() => ({
    mode: undefined,
    referrer: undefined,
    requests: [],
  }))
}
