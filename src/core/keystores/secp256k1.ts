import { PublicKey, Secp256k1 } from 'ox'
import type { Hex } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Keystore from '../Keystore.js'

/** Handle persisted by the {@link secp256k1} keystore. */
type Handle = {
  kind: 'secp256k1'
  /** Exported private key. At-rest protection is the host app's storage adapter. */
  privateKey: Hex.Hex
}

/**
 * Pure-JS secp256k1 keystore. The private key is held as hex in the handle
 * and signing runs in JavaScript — at-rest protection is the host app's
 * storage adapter, and the key is readable by anything with JS execution.
 * secp256k1 signatures are the chain's cheapest envelope, making this the
 * economical default for environments without a WebCrypto implementation
 * (e.g. React Native, CLI).
 */
export function secp256k1(): Keystore.Keystore {
  return {
    async createKey() {
      const privateKey = Secp256k1.randomPrivateKey()
      return {
        handle: { kind: 'secp256k1', privateKey } satisfies Handle,
        publicKey: PublicKey.toHex(Secp256k1.getPublicKey({ privateKey })),
      }
    },
    toAccount(record, context) {
      const handle = record.handle as Partial<Handle> | undefined
      if (handle?.kind !== 'secp256k1' || !handle.privateKey)
        throw new Error('Unrecognized `secp256k1` keystore handle.')
      return TempoAccount.fromSecp256k1(handle.privateKey, {
        access: context.access,
        keyAuthorizationManager: context.keyAuthorizationManager,
      })
    },
  }
}
