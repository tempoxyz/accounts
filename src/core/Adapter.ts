import type { KeyAuthorization } from 'ox/tempo'
import type { Client, Hex, Transport } from 'viem'
import type { Address } from 'viem/accounts'
import type { tempo } from 'viem/chains'

import type * as Account from './Account.js'
import type * as Schema from './Schema.js'
import type * as Storage from './Storage.js'
import type * as Store from './Store.js'
import type * as Rpc from './zod/rpc.js'

/** Wire-format request (method + params) for a given RPC schema item. */
type EncodedRequest<encoded extends { method: unknown; params: unknown }> = Pick<
  encoded,
  'method' | 'params'
>

/** Adapter interface for the provider. */
export type Adapter = SetupFn & Meta

/** The setup function an adapter must implement. */
export type SetupFn = (params: SetupFn.Parameters) => Instance

/** Static metadata attached to an adapter function. */
export type Meta = {
  /** Data URI of the provider icon. @default Black 1×1 SVG. */
  icon?: `data:image/${string}` | undefined
  /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
  name?: string | undefined
  /** Reverse DNS identifier (e.g. `"com.example.mywallet"`). @default `com.{lowercase name}` */
  rdns?: string | undefined
}

export type Instance = {
  /** Adapter actions dispatched by the provider's `request()` method. */
  actions: {
    /** Grant an access key for the active account. */
    authorizeAccessKey?:
      | ((
          params: authorizeAccessKey.Parameters,
          request: EncodedRequest<Rpc.wallet_authorizeAccessKey.Encoded>,
        ) => Promise<authorizeAccessKey.ReturnType>)
      | undefined
    /** Create a new account (e.g. WebAuthn registration). */
    createAccount: (
      params: createAccount.Parameters,
      request: EncodedRequest<Rpc.wallet_connect.Encoded>,
    ) => Promise<createAccount.ReturnType>
    /** Deposit funds into the account. */
    deposit?:
      | ((
          params: deposit.Parameters,
          request: EncodedRequest<Rpc.wallet_deposit.Encoded>,
        ) => Promise<deposit.ReturnType>)
      | undefined
    /** Disconnect hook for adapter-specific cleanup. */
    disconnect?: (() => Promise<void>) | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (
      params: loadAccounts.Parameters | undefined,
      request: EncodedRequest<Rpc.wallet_connect.Encoded>,
    ) => Promise<loadAccounts.ReturnType>
    /** Revoke an access key. */
    revokeAccessKey?:
      | ((
          params: revokeAccessKey.Parameters,
          request: EncodedRequest<Rpc.wallet_revokeAccessKey.Encoded>,
        ) => Promise<void>)
      | undefined
    /** Send a transaction. */
    sendTransaction: (
      params: sendTransaction.Parameters,
      request: EncodedRequest<Rpc.eth_sendTransaction.Encoded>,
    ) => Promise<sendTransaction.ReturnType>
    /** Send a transaction and wait for the receipt. */
    sendTransactionSync: (
      params: sendTransactionSync.Parameters,
      request: EncodedRequest<Rpc.eth_sendTransactionSync.Encoded>,
    ) => Promise<sendTransactionSync.ReturnType>
    /** Sign a personal message (EIP-191). */
    signPersonalMessage: (
      params: signPersonalMessage.Parameters,
      request: EncodedRequest<Rpc.personal_sign.Encoded>,
    ) => Promise<Hex>
    /** Sign a transaction without broadcasting it. */
    signTransaction: (
      params: signTransaction.Parameters,
      request: EncodedRequest<Rpc.eth_signTransaction.Encoded>,
    ) => Promise<signTransaction.ReturnType>
    /** Sign EIP-712 typed data. */
    signTypedData: (
      params: signTypedData.Parameters,
      request: EncodedRequest<Rpc.eth_signTypedData_v4.Encoded>,
    ) => Promise<Hex>
    /** Switch chain hook for adapter-specific handling. */
    switchChain?: ((params: switchChain.Parameters) => Promise<void>) | undefined
  }
  /** Cleanup function called when the provider is destroyed. */
  cleanup?: (() => void) | undefined
  /** When `true`, the provider merges new accounts onto existing ones instead of replacing. */
  persistAccounts?: boolean | undefined
}

export declare namespace SetupFn {
  /** Parameters passed to an adapter's setup function. */
  export type Parameters = {
    /** Returns the rehydrated local account for the given address, or the active account if omitted. */
    getAccount: Account.Find
    /** Get the viem client for a given chain ID. Defaults to the active chain. */
    getClient: (options?: getClient.Options | undefined) => Client<Transport, typeof tempo>
    /** Storage adapter used by the provider. */
    storage: Storage.Storage
    /** Reactive state store. */
    store: Store.Store
  }

  /** Value returned from an adapter's setup function. */
  export type ReturnType = Instance
}

/** Creates an adapter from metadata and a setup function. */
export function define(meta: Meta, fn: SetupFn): Adapter {
  const { name, ...rest } = meta
  Object.defineProperty(fn, 'name', { value: name, configurable: true })
  return Object.assign(fn, rest) as Adapter
}

/** Spreads decoded params. */
export type ActionRequest<item extends Schema.Item> =
  Schema.Decoded<item>['params'] extends readonly [infer first] ? first : never

export declare namespace getClient {
  type Options = {
    /** Chain ID. Defaults to the active chain. */
    chainId?: number | undefined
    /** Fee payer service URL, or `false` to opt out of fee payers for this transaction if set globally. */
    feePayer?: string | false | undefined
  }
}

export declare namespace createAccount {
  type Parameters = {
    /** Grant an access key during the ceremony. */
    authorizeAccessKey?: authorizeAccessKey.Parameters | undefined
    /** Digest to sign. */
    digest?: Hex | undefined
    /** Display name for the new account (e.g. credential name for WebAuthn). */
    name: string
    /** Opaque user identifier (e.g. for WebAuthn `user.id`). */
    userId?: string | undefined
  }
  type ReturnType = {
    accounts: readonly Store.Account[]
    /** Signed key authorization, if an access key was granted. */
    keyAuthorization?: KeyAuthorization.Rpc | undefined
    /** Signature over the digest, if one was provided. */
    signature?: Hex | undefined
  }
}

export declare namespace deposit {
  type Parameters = ActionRequest<typeof Rpc.wallet_deposit.schema>
  type ReturnType = Rpc.wallet_deposit.Encoded['returns']
}

export declare namespace loadAccounts {
  type Parameters = {
    /** Grant an access key during the ceremony. */
    authorizeAccessKey?: authorizeAccessKey.Parameters | undefined
    /** Credential ID to restrict authentication to a specific credential. */
    credentialId?: string | undefined
    /** Digest to sign. */
    digest?: Hex | undefined
    /** When `true`, prompts the user to pick from all available credentials instead of using the last-used one. */
    selectAccount?: boolean | undefined
  }
  type ReturnType = {
    /** Loaded accounts. */
    accounts: readonly Store.Account[]
    /** Signed key authorization, if an access key was granted. */
    keyAuthorization?: KeyAuthorization.Rpc | undefined
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
    /** Chain ID the key authorization is scoped to. Defaults to the active chain. */
    chainId?: bigint | undefined
    /** Unix timestamp (seconds) when the key expires. */
    expiry: number
    /** Key type of the external public key. Required when `publicKey` or `address` is provided. */
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    /** TIP-20 spending limits for this key. */
    limits?: readonly { token: Address; limit: bigint; period?: number | undefined }[] | undefined
    /** External public key to authorize. When provided, no key pair is generated — the caller holds the signing material. */
    publicKey?: Hex | undefined
    /** Call scopes restricting which contracts/selectors this key can call. */
    scopes?:
      | readonly {
          address: Address
          selector?: Hex | string | undefined
          recipients?: readonly Address[] | undefined
        }[]
      | undefined
    /** Pre-computed signature over the key authorization digest (skips a second signing ceremony). */
    signature?: Hex | undefined
  }

  type ReturnType = {
    keyAuthorization: KeyAuthorization.Rpc
    rootAddress: Address
  }
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
