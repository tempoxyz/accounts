import type { Address } from 'viem/accounts'

import type * as Store from './Store.js'

/** Adapter interface for the provider. */
export type Adapter = {
  /** Called once when the provider is created. Returns an optional cleanup function. */
  setup?: (params: setup.Parameters) => (() => void) | undefined
  /** Adapter actions dispatched by the provider's `request()` method. */
  actions: {
    /** Create a new account (e.g. WebAuthn registration). */
    createAccount: () => Promise<createAccount.ReturnType>
    /** Disconnect and clear local state. */
    disconnect: () => Promise<void>
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: () => Promise<loadAccounts.ReturnType>
    /** Switch the active chain. */
    switchChain: (params: switchChain.Parameters) => Promise<void>
  }
}

export declare namespace setup {
  type Parameters = { store: Store.Store }
}

export declare namespace createAccount {
  type ReturnType = readonly { address: Address }[]
}

export declare namespace loadAccounts {
  type ReturnType = readonly { address: Address }[]
}

export declare namespace switchChain {
  type Parameters = { chainId: number }
}

/** Creates an adapter from a custom implementation. */
export function from(adapter: Adapter): Adapter {
  return adapter
}
