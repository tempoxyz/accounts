import { PublicKey, WebCryptoP256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import { KeyUnavailableError, type Keystore } from '../Keystore.js'

/** Handle persisted by the {@link webCryptoP256} keystore. */
type WebCryptoP256Handle = {
  kind: 'webcrypto-p256'
} & (
  | {
      /** Live key pair (non-extractable). Requires structured-clone storage. */
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
      jwk?: undefined
    }
  | {
      /** Exported private key. At-rest protection is the host app's storage adapter. */
      jwk: JsonWebKey
      keyPair?: undefined
    }
)

/**
 * WebCrypto P-256 keystore. The built-in default (see `Keystore.defaults`).
 *
 * By default the key is generated non-extractable: the private key never has
 * a JS-visible encoding, and the handle holds the live `CryptoKey`, which
 * persists only through structured-clone storage (`Storage.idb`,
 * `Storage.memory`) — on string-based storage the key is session-only.
 *
 * Pass `extractable: true` for environments without structured-clone storage
 * where keys must survive restarts (e.g. React Native, Node, CLI): the
 * private key is exported once as a JWK (at-rest protection is the host
 * app's storage adapter) and re-imported non-extractable each session. In
 * browsers with IndexedDB storage, prefer the non-extractable default.
 *
 * @example
 * ```ts
 * import { Keystore, Provider } from 'accounts'
 *
 * const provider = Provider.create({
 *   accessKey: { keystores: { p256: Keystore.webCryptoP256({ extractable: true }) } },
 * })
 * ```
 */
export function webCryptoP256(options: webCryptoP256.Options = {}): Keystore {
  const { extractable = false } = options
  return {
    requiresStructuredClone: !extractable,
    async createKey() {
      if (!globalThis.crypto?.subtle)
        throw new Error('`webCryptoP256` keystore requires WebCrypto (`crypto.subtle`) support.')
      const keyPair = await WebCryptoP256.createKeyPair({ extractable })
      const publicKey = PublicKey.toHex(keyPair.publicKey)
      if (!extractable)
        return {
          handle: { keyPair, kind: 'webcrypto-p256' } satisfies WebCryptoP256Handle,
          publicKey,
        }
      const jwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey)
      return { handle: { jwk, kind: 'webcrypto-p256' } satisfies WebCryptoP256Handle, publicKey }
    },
    async toAccount(record, context) {
      const handle = record.handle as Partial<WebCryptoP256Handle> | undefined
      if (handle?.kind !== 'webcrypto-p256')
        throw new Error('Unrecognized `webCryptoP256` keystore handle.')
      const account = {
        access: context.access,
        keyAuthorizationManager: context.keyAuthorizationManager,
      }
      if (handle.keyPair) {
        // A live key pair serialized through non-structured-clone storage
        // arrives mangled — the key is permanently gone.
        if (!isCryptoKey(handle.keyPair.privateKey))
          throw new KeyUnavailableError('`webCryptoP256` key material did not survive storage.')
        return TempoAccount.fromWebCryptoP256(handle.keyPair, account)
      }
      if (handle.jwk) {
        const privateKey = await globalThis.crypto.subtle
          .importKey('jwk', handle.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
          .catch((error) => {
            throw new KeyUnavailableError(
              '`webCryptoP256` keystore handle holds unusable key material.',
              { cause: error },
            )
          })
        return TempoAccount.fromWebCryptoP256(
          { privateKey, publicKey: PublicKey.fromHex(record.publicKey) },
          account,
        )
      }
      throw new Error('Unrecognized `webCryptoP256` keystore handle.')
    },
  }
}

export declare namespace webCryptoP256 {
  /** Options for {@link webCryptoP256}. */
  type Options = {
    /**
     * Generate the key extractable and persist it as a JWK so it survives
     * string-based storage adapters. When `false` (default), the key is
     * non-extractable from creation and persists only through
     * structured-clone storage.
     *
     * @default false
     */
    extractable?: boolean | undefined
  }
}


function isCryptoKey(value: unknown): value is CryptoKey {
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return true
  // Cross-realm fallback (e.g. keys structured-cloned through IndexedDB).
  return (
    !!value &&
    typeof value === 'object' &&
    'algorithm' in value &&
    (value as CryptoKey).type === 'private'
  )
}
