import { type Hex, P256, PublicKey } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Keystore from '../src/core/Keystore.js'

/** P256 keystore holding key material privately, keyed by handle id. */
export function testKeystore(kind = 'test') {
  const keys = new Map<string, Hex.Hex>()
  const stats = { toAccountCalls: 0 }
  const keystore: Keystore.Keystore = {
    async createKey() {
      const privateKey = P256.randomPrivateKey()
      const id = `key-${keys.size}`
      keys.set(id, privateKey)
      return {
        handle: { id, kind },
        publicKey: PublicKey.toHex(P256.getPublicKey({ privateKey })),
      }
    },
    toAccount(record, context) {
      stats.toAccountCalls++
      const handle = record.handle as { id: string; kind: string }
      if (handle.kind !== kind) throw new Error('not my handle')
      const privateKey = keys.get(handle.id)
      if (!privateKey) throw new Error(`unknown key: ${handle.id}`)
      return TempoAccount.fromP256(privateKey, {
        access: context.access,
        keyAuthorizationManager: context.keyAuthorizationManager,
      })
    },
  }
  return Object.assign(keystore, { stats })
}
