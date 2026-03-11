import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import type * as Messenger from '../core/Messenger.js'
import type * as Provider from '../core/Provider.js'
import type * as Store from '../core/Store.js'

/** State managed by the remote (dialog) side. */
export type State = {
  /** Queued RPC requests received from the host. */
  requests: readonly Store.QueuedRequest[]
}

/** Remote context — bundles messenger, provider, and remote store. */
export type Remote = {
  /** Bridge messenger for cross-frame communication. */
  messenger: Messenger.Bridge
  /** Provider instance for executing RPC methods. */
  provider?: Provider.Provider | undefined
  /** Zustand store holding queued requests. */
  _internal: {
    store: StoreApi<State>
  }
}

/** Creates a remote context for the dialog app. */
export function create(options: create.Options): Remote {
  const { messenger, provider } = options
  const store = createStore<State>(() => ({ requests: [] }))

  return {
    messenger,
    provider,
    _internal: { store },
  }
}

export declare namespace create {
  type Options = {
    /** Bridge messenger for cross-frame communication. */
    messenger: Messenger.Bridge
    /** Provider to execute RPC requests against. */
    provider?: Provider.Provider | undefined
  }
}

/**
 * Signals readiness to the host and begins accepting requests.
 * Call this after the remote context is fully initialized.
 */
export function ready(remote: Remote) {
  remote.messenger.ready()
}
