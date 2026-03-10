import type { KeyAuthorization } from 'ox/tempo'
import type { Client, Hex, Transport } from 'viem'
import type { Address } from 'viem/accounts'
import type { tempo } from 'viem/chains'

import type * as Account from './Account.js'
import type * as Schema from './Schema.js'
import type * as Storage from './Storage.js'
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
    /** Grant an access key for the active account. */
    authorizeAccessKey?:
      | ((params: authorizeAccessKey.Parameters) => Promise<authorizeAccessKey.ReturnType>)
      | undefined
    /** Create a new account (e.g. WebAuthn registration). */
    createAccount: (params: createAccount.Parameters) => Promise<createAccount.ReturnType>
    /** Disconnect hook for adapter-specific cleanup. */
    disconnect?: (() => Promise<void>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (params?: loadAccounts.Parameters | undefined) => Promise<loadAccounts.ReturnType>
    /** Revoke an access key. */
    revokeAccessKey?: ((params: revokeAccessKey.Parameters) => Promise<void>) | undefined
    /** Send a transaction. */
    sendTransaction: (request: sendTransaction.Parameters) => Promise<sendTransaction.ReturnType>
    /** Send a transaction and wait for the receipt. */
    sendTransactionSync: (
      request: sendTransactionSync.Parameters,
    ) => Promise<sendTransactionSync.ReturnType>
    /** Sign a personal message (EIP-191). */
    signPersonalMessage: (params: signPersonalMessage.Parameters) => Promise<Hex>
    /** Sign a transaction without broadcasting it. */
    signTransaction: (request: signTransaction.Parameters) => Promise<signTransaction.ReturnType>
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
export type ActionRequest<item extends Schema.Item> =
  Schema.Decoded<item>['params'] extends readonly [infer first]
    ? first & {
        _encoded: { method: Schema.Encoded<item>['method']; params: Schema.Encoded<item>['params'] }
      }
    : never

export declare namespace setup {
  type Parameters = {
    /** Returns the rehydrated local account for the given address, or the active account if omitted. */
    getAccount: Account.Find
    /** Get the viem client for a given chain ID. Defaults to the active chain. */
    getClient: (options?: getClient.Options | undefined) => Client<Transport, typeof tempo>
    /** Storage adapter used by the provider. */
    storage: Storage.Storage
    /** Reactive state store. */
    store: Store.Store
  }
}

export declare namespace getClient {
  type Options = {
    /** Chain ID. Defaults to the active chain. */
    chainId?: number | undefined
    /** Fee payer service URL. */
    feePayer?: string | undefined
  }
}

export declare namespace createAccount {
  type Parameters = {
    /** Digest to sign. */
    digest?: Hex | undefined
    /** Grant an access key during the ceremony. */
    authorizeAccessKey?: authorizeAccessKey.Parameters | undefined
    /** Display name for the new account (e.g. credential name for WebAuthn). */
    name: string
    /** Opaque user identifier (e.g. for WebAuthn `user.id`). */
    userId?: string | undefined
  }
  type ReturnType = {
    accounts: readonly Store.Account[]
    /** Signed key authorization, if an access key was granted. */
    keyAuthorization?: authorizeAccessKey.ReturnType | undefined
    /** Signature over the digest, if one was provided. */
    signature?: Hex | undefined
  }
}

export declare namespace loadAccounts {
  type Parameters = {
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
    /** Digest to sign. */
    digest?: Hex | undefined
    /** Grant an access key during the ceremony. */
    authorizeAccessKey?: authorizeAccessKey.Parameters | undefined
    /** When `true`, prompts the user to pick from all available credentials instead of using the last-used one. */
    selectAccount?: boolean | undefined
  }
  type ReturnType = {
    /** Loaded accounts. */
    accounts: readonly Store.Account[]
    /** Signed key authorization, if an access key was granted. */
    keyAuthorization?: authorizeAccessKey.ReturnType | undefined
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

export declare namespace authorizeAccessKey {
  type Parameters = {
    /** Access key address. Alternative to `publicKey` when the caller already knows the derived address. */
    address?: Address | undefined
    /** Unix timestamp (seconds) when the key expires. */
    expiry: number
    /** Key type of the external public key. Required when `publicKey` or `address` is provided. */
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    /** TIP-20 spending limits for this key. */
    limits?: { token: Address; limit: bigint }[] | undefined
    /** External public key to authorize. When provided, no key pair is generated — the caller holds the signing material. */
    publicKey?: Hex | undefined
    /** Pre-computed signature over the key authorization digest (skips a second signing ceremony). */
    signature?: Hex | undefined
  }

  type ReturnType = KeyAuthorization.Rpc
}

export declare namespace revokeAccessKey {
  type Parameters = {
    /** Root account address. */
    address: Address
    /** Address of the access key to revoke. */
    accessKeyAddress: Address
  }
}

export declare namespace sendTransaction {
  type Parameters = ActionRequest<typeof Rpc.eth_sendTransaction.schema>
  type ReturnType = Rpc.eth_sendTransaction.Encoded['returns']
}

export declare namespace sendTransactionSync {
  type Parameters = ActionRequest<typeof Rpc.eth_sendTransactionSync.schema>
  type ReturnType = Rpc.eth_sendTransactionSync.Encoded['returns']
}

export declare namespace signTransaction {
  type Parameters = ActionRequest<typeof Rpc.eth_signTransaction.schema>
  type ReturnType = Hex
}

export declare namespace switchChain {
  type Parameters = { chainId: number }
}

/** Creates an adapter from a custom implementation. */
export function from(adapter: Adapter): Adapter {
  return adapter
}
