import { Address, Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Store from './Store.js'
/** Returns the pending key authorization for an access key account without removing it. */
export declare function getPending(
  account: TempoAccount.Account,
  options: {
    store: Store.Store
  },
): KeyAuthorization.Signed | undefined
/** Generates a P256 key pair and access key account. */
export declare function generate(options?: generate.Options): Promise<generate.ReturnType>
export declare namespace generate {
  type Options = {
    /** Root account to attach to the access key. */
    account?: TempoAccount.Account | undefined
  }
  type ReturnType = {
    /** The generated access key account. */
    accessKey: TempoAccount.AccessKeyAccount
    /** Generated key pair to pass to `authorizeAccessKey`. */
    keyPair: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>>
  }
}
/** Removes an access key entry for the given account from the store. */
export declare function remove(
  account: TempoAccount.Account,
  options: {
    store: Store.Store
  },
): void
/** Permanently removes the pending key authorization for an access key account. */
export declare function removePending(
  account: TempoAccount.Account,
  options: {
    store: Store.Store
  },
): void
/** Removes an access key from the store. */
export declare function revoke(options: revoke.Options): void
export declare namespace revoke {
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}
/** Saves an access key to the store with its one-time key authorization. */
export declare function save(options: save.Options): void
export declare namespace save {
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Signed key authorization to attach to the first transaction. */
    keyAuthorization: KeyAuthorization.Signed
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. Only present for locally-generated keys. */
    keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}
//# sourceMappingURL=AccessKey.d.ts.map
