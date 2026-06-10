import { PublicKey, WebCryptoP256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Keystore from '../core/Keystore.js'

export type { Keystore } from '../core/Keystore.js'

/** Handle persisted by the {@link webCryptoP256} keystore. */
type WebCryptoP256Handle = {
  kind: 'webcrypto-p256'
  /** Exported private key. At-rest protection is the host app's storage adapter. */
  jwk: JsonWebKey
}

/**
 * WebCrypto P-256 reference keystore.
 *
 * `createKey` exports the private key as a JWK once (at-rest protection is
 * the host app's storage adapter); `toAccount` imports it non-extractable
 * for the session. Useful as a dev/simulator fallback for hardware-backed
 * keystores.
 *
 * @example
 * ```ts
 * import { Provider } from 'accounts'
 * import { webCryptoP256 } from 'accounts/keystore'
 *
 * const provider = Provider.create({ keystore: webCryptoP256() })
 * ```
 */
export function webCryptoP256(): Keystore.Keystore {
  return {
    async createKey(options) {
      if (options.keyType && options.keyType !== 'p256')
        throw new Error(`\`webCryptoP256\` keystore cannot create "${options.keyType}" keys.`)
      if (!globalThis.crypto?.subtle)
        throw new Error('`webCryptoP256` keystore requires WebCrypto (`crypto.subtle`) support.')
      const keyPair = await WebCryptoP256.createKeyPair({ extractable: true })
      const jwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey)
      return {
        handle: { jwk, kind: 'webcrypto-p256' } satisfies WebCryptoP256Handle,
        keyType: 'p256',
        publicKey: PublicKey.toHex(keyPair.publicKey),
      }
    },
    async toAccount(record, context) {
      const handle = record.handle as Partial<WebCryptoP256Handle> | undefined
      if (handle?.kind !== 'webcrypto-p256' || !handle.jwk)
        throw new Error('Unrecognized `webCryptoP256` keystore handle.')
      const privateKey = await globalThis.crypto.subtle.importKey(
        'jwk',
        handle.jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      )
      return TempoAccount.fromWebCryptoP256(
        { privateKey, publicKey: PublicKey.fromHex(record.publicKey) },
        {
          access: context.access,
          keyAuthorizationManager: context.keyAuthorizationManager,
        },
      )
    },
  }
}
