import { Address, Hex } from 'ox'

import type { AccessKey } from '../core/Store.js'
/** Managed CLI access key persisted in `~/.tempo/wallet/keys.toml`. */
export type Entry = {
  /** Wallet type that approved the key. */
  walletType: 'passkey'
  /** Root wallet address. */
  walletAddress: AccessKey['access']
  /** Chain ID for the authorization. */
  chainId: number
  /** Authorized access-key type. */
  keyType: Extract<AccessKey['keyType'], 'secp256k1' | 'p256'>
  /** Derived access-key address. */
  keyAddress: AccessKey['address']
  /** Exported private key for the managed access key. */
  key: Hex.Hex
  /** Serialized key authorization payload. */
  keyAuthorization: Hex.Hex
  /** Authorization expiry timestamp. */
  expiry: NonNullable<AccessKey['expiry']>
  /** TIP-20 spending limits. */
  limits?: AccessKey['limits']
}
/** Returns the default managed-key file path. */
export declare function defaultPath(): string
/** Loads managed CLI access keys from `keys.toml`. */
export declare function load(options?: load.Options): Promise<readonly Entry[]>
export declare namespace load {
  type Options = {
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
  }
}
/** Finds a managed key by wallet address and chain ID. */
export declare function find(options: find.Options): Promise<Entry | undefined>
export declare namespace find {
  type Options = {
    /** Chain ID for the managed key. */
    chainId: number
    /** Restrict results to a specific managed-key type. */
    keyType?: Entry['keyType'] | undefined
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
    /** Root wallet address. */
    walletAddress: Address.Address
  }
}
/** Inserts or replaces a managed key in `keys.toml`. */
export declare function upsert(entry: Entry, options?: upsert.Options): Promise<void>
export declare namespace upsert {
  type Options = {
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
  }
}
//# sourceMappingURL=keyring.d.ts.map
