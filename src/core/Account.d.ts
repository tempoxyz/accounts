import { type WebCryptoP256 } from 'ox'
import { type KeyAuthorization } from 'ox/tempo'
import type { Hex } from 'viem'
import type { Address, JsonRpcAccount } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import type * as core_Store from './Store.js'
/** Account stored in the provider state. */
export type Store = {
  /** Account address. */
  address: Address
} & OneOf<
  | {}
  | Pick<TempoAccount.Account, 'keyType' | 'sign'>
  | {
      keyType: 'secp256k1'
      privateKey: Hex
    }
  | {
      keyType: 'p256'
      privateKey: Hex
    }
  | {
      keyType: 'webAuthn'
      credential: {
        id: string
        publicKey: Hex
        rpId: string
      }
    }
  | {
      keyType: 'webCrypto'
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
    }
  | {
      keyType: 'webAuthn_headless'
      privateKey: Hex
      rpId: string
      origin: string
    }
>
/** Access key entry stored alongside accounts. */
export type AccessKey = {
  /** Access key address. */
  address: Address
  /** Owner of the access key. */
  access: Address
  /** Unix timestamp when the access key expires. */
  expiry?: number | undefined
  /** Signed key authorization to attach to the first transaction. Consumed on use. */
  keyAuthorization?: KeyAuthorization.Signed | undefined
  /** Key type. */
  keyType: 'secp256k1' | 'p256' | 'webAuthn' | 'webCrypto'
  /** TIP-20 spending limits for the access key. */
  limits?:
    | {
        token: Address
        limit: bigint
      }[]
    | undefined
} & OneOf<
  | {}
  | {
      /** The exported private key backing the access key. */
      privateKey: Hex
    }
  | {
      /** The WebCrypto key pair backing the access key. */
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
    }
>
/** Resolves a viem Account from the store by address (or active account). */
export declare function find(
  options: find.Options & {
    signable: true
  },
): TempoAccount.Account
export declare function find(options: find.Options): TempoAccount.Account | JsonRpcAccount
export declare namespace find {
  type Options = {
    /** Whether to resolve an access key for this account. @default true */
    accessKey?: boolean | undefined
    /** Address to resolve. Defaults to the active account. */
    address?: Address | undefined
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
    /** Reactive state store. */
    store: core_Store.Store
  }
}
/** Overloaded signature for `find` without `store` (pre-bound by the provider). */
export type Find = {
  (
    options: Omit<find.Options, 'store'> & {
      signable: true
    },
  ): TempoAccount.Account
  (options?: Omit<find.Options, 'store'>): TempoAccount.Account | JsonRpcAccount
}
/** Hydrates an access key entry to a viem Account. Only works for locally-generated keys with a `keyPair`. */
export declare function hydrateAccessKey(accessKey: AccessKey): TempoAccount.Account
/** Hydrates a store account to a viem Account. */
export declare function hydrate(
  account: Store,
  options: {
    signable: true
  },
): TempoAccount.Account
export declare function hydrate(
  account: Store,
  options?: hydrate.Options,
): TempoAccount.Account | JsonRpcAccount
export declare namespace hydrate {
  type Options = {
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
  }
}
//# sourceMappingURL=Account.d.ts.map
