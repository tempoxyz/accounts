import { P256, PublicKey } from 'ox'
import type { Hex } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Keystore from '../Keystore.js'

/** Handle persisted by the {@link p256} keystore. */
type Handle = {
  kind: 'p256'
  /** Exported private key. At-rest protection is the host app's storage adapter. */
  privateKey: Hex.Hex
}

/**
 * Pure-JS P-256 keystore. The private key is held as hex in the handle and
 * signing runs in JavaScript — at-rest protection is the host app's storage
 * adapter, and the key is readable by anything with JS execution. Prefer
 * `webCryptoP256` (or a hardware keystore) where a WebCrypto
 * implementation is available; this exists chiefly as an adapter default
 * for environments without one.
 */
export function p256(): Keystore.Keystore {
  return {
    async createKey() {
      const privateKey = P256.randomPrivateKey()
      return {
        handle: { kind: 'p256', privateKey } satisfies Handle,
        publicKey: PublicKey.toHex(P256.getPublicKey({ privateKey })),
      }
    },
    toAccount(record, context) {
      const handle = record.handle as Partial<Handle> | undefined
      if (handle?.kind !== 'p256' || !handle.privateKey)
        throw new Error('Unrecognized `p256` keystore handle.')
      return TempoAccount.fromP256(handle.privateKey, {
        access: context.access,
        keyAuthorizationManager: context.keyAuthorizationManager,
      })
    },
  }
}
