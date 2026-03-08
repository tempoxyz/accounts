import type { Client, Hex, Transport } from 'viem'
import type { Address, LocalAccount } from 'viem/accounts'
import type { tempo } from 'viem/chains'

import type * as Store from './Store.js'
import type * as Rpc from './zod/rpc.js'

/** Adapter interface for the provider. */
export type Adapter = {
  /** Called once when the provider is created. Returns an optional cleanup function. */
  setup?: (params: setup.Parameters) => (() => void) | undefined
  /** Data URI of the provider icon. @default Black 1×1 SVG. */
  icon?: `data:image/${string}` | undefined
  /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
  name?: string | undefined
  /** Reverse DNS identifier (e.g. `"com.example.mywallet"`). @default `com.{lowercase name}` */
  rdns?: string | undefined
  /** Adapter actions dispatched by the provider's `request()` method. */
  actions: {
    /** Create a new account (e.g. WebAuthn registration). */
    createAccount: (params: createAccount.Parameters) => Promise<createAccount.ReturnType>
    /** Disconnect hook for adapter-specific cleanup. */
    disconnect?: (() => Promise<void>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (params?: loadAccounts.Parameters | undefined) => Promise<loadAccounts.ReturnType>
    /** Send a transaction. */
    sendTransaction: (
      request: ActionRequest<Rpc.eth_sendTransaction.Schema>,
    ) => Promise<Rpc.eth_sendTransaction.Schema['returns']>
    /** Send a transaction and wait for the receipt. */
    sendTransactionSync: (
      request: ActionRequest<Rpc.eth_sendTransactionSync.Schema>,
    ) => Promise<Rpc.eth_sendTransactionSync.Schema['returns']>
    /** Sign a personal message (EIP-191). */
    signPersonalMessage: (params: signPersonalMessage.Parameters) => Promise<Hex>
    /** Sign a transaction without broadcasting it. */
    signTransaction: (request: ActionRequest<Rpc.eth_signTransaction.Schema>) => Promise<Hex>
    /** Sign EIP-712 typed data. */
    signTypedData: (params: signTypedData.Parameters) => Promise<Hex>
    /** Switch chain hook for adapter-specific handling. */
    switchChain?: ((params: switchChain.Parameters) => Promise<void>) | undefined
  }
  /**
   * Whether to persist account sign data (private keys, credentials) to storage.
   * When `false`, only addresses are persisted.
   * @default false
   */
  internal_persistPrivate?: boolean | undefined
}

/** Spreads decoded params with `_encoded` carrying the raw wire format. */
export type ActionRequest<rpc extends { method: string; params: unknown }> =
  (rpc['params'] extends readonly [infer first] ? first : never) & {
    _encoded: { method: rpc['method']; params: rpc['params'] }
  }

export declare namespace setup {
  type Parameters = {
    /** Returns the rehydrated local account for the given address, or the active account if omitted. */
    getAccount: (
      address?: Address | undefined,
      options?: { signable?: boolean | undefined } | undefined,
    ) => LocalAccount
    /** Get the viem client for a given chain ID. Defaults to the active chain. */
    getClient: (chainId?: number | undefined) => Client<Transport, typeof tempo>
    /** Reactive state store. */
    store: Store.Store
  }
}

export declare namespace createAccount {
  type Parameters = {
    /** Digest to sign. */
    digest?: Hex | undefined
    /** Display name for the new account (e.g. credential name for WebAuthn). */
    name: string
    /** Opaque user identifier (e.g. for WebAuthn `user.id`). */
    userId?: string | undefined
  }
  type ReturnType = {
    accounts: readonly Store.Account[]
    /** Signature over the digest, if one was provided. */
    signature?: Hex | undefined
  }
}

export declare namespace loadAccounts {
  type Parameters = {
    /** Digest to sign. */
    digest?: Hex | undefined
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
  }
  type ReturnType = {
    /** Loaded accounts. */
    accounts: readonly Store.Account[]
    /** Signature over the digest, if one was provided. */
    signature?: Hex | undefined
  }
}

export declare namespace signPersonalMessage {
  type Parameters = {
    /** Address of the account to sign with. */
    address: Address
    /** Hex-encoded message data. */
    data: Hex
  }
}

export declare namespace signTypedData {
  type Parameters = {
    /** Address of the account to sign with. */
    address: Address
    /** JSON-encoded EIP-712 typed data. */
    data: string
  }
}

export declare namespace switchChain {
  type Parameters = { chainId: number }
}

/** Creates an adapter from a custom implementation. */
export function from(adapter: Adapter): Adapter {
  return adapter
}
