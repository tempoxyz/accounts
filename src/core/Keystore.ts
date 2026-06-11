import { P256, PublicKey, Secp256k1, WebCryptoP256 } from 'ox'
import type { Address, Hex } from 'ox'
import {
  Account as TempoAccount,
  type KeyAuthorizationManager as TempoKeyAuthorizationManager,
} from 'viem/tempo'

import type { MaybePromise } from '../internal/types.js'

/**
 * Keystores backing locally generated access keys: one {@link Keystore} per
 * key type. When none are configured, {@link defaults} applies.
 */
export type Keystores = {
  /** Keystore used to create and rehydrate `p256` access keys. */
  p256?: Keystore | undefined
  /** Keystore used to create and rehydrate `secp256k1` access keys. */
  secp256k1?: Keystore | undefined
}

/** Key types keystores can be configured for. */
export type KeyType = keyof Keystores

/**
 * Single-key-type access-key backend.
 *
 * A keystore owns access-key material end to end: `createKey` provisions a
 * key and returns an opaque `handle` that the SDK persists verbatim alongside
 * the access-key record; `toAccount` turns a persisted record back into a
 * signing account. The handle's schema is owned by whichever keystore wrote
 * it, so backends can be heterogeneous per device (e.g. hardware-backed keys
 * with a software fallback composed behind one keystore).
 *
 * Records carrying `privateKey` or `keyPair` material hydrate without
 * consulting the keystore.
 */
export type Keystore = {
  /**
   * Whether this keystore's handles hold live objects (e.g. a `CryptoKey`)
   * that persist only through structured-clone storage (`Storage.idb`,
   * `Storage.memory`). On other storage the handle is stripped at persist
   * time, making the key session-only.
   *
   * When `false` (default), handles must survive JSON serialization —
   * portable across all storage adapters.
   *
   * @default false
   */
  requiresStructuredClone?: boolean | undefined
  /**
   * Creates access-key material. `handle` is opaque and persisted verbatim.
   *
   * Must fail loudly when the keystore's runtime prerequisites are missing
   * (e.g. no Secure Enclave, no `crypto.subtle`) so provisioning errors
   * surface at authorization time, not at first sign.
   */
  createKey: () => Promise<createKey.ReturnType>
  /**
   * Turns a persisted access-key record back into a signing account.
   *
   * Called lazily when a stored record is first used after hydration; the
   * SDK caches the result per record.
   *
   * Throw {@link KeyUnavailableError} when the key behind the handle is
   * permanently gone (e.g. hardware key deleted) — the SDK evicts the record
   * so callers fall back to authorizing a fresh key. Throw any other error
   * for handles the keystore does not recognize or transient failures (e.g.
   * device locked): the record is kept and retried on next use.
   */
  toAccount: (
    record: toAccount.Record,
    context: toAccount.Context,
  ) => MaybePromise<TempoAccount.AccessKeyAccount>
}

export declare namespace createKey {
  /** Created access-key material. */
  type ReturnType = {
    /** Opaque handle for the created key. Persisted verbatim; schema owned by the keystore that wrote it. */
    handle: unknown
    /** Public key of the created key. */
    publicKey: Hex.Hex
  }
}

export declare namespace toAccount {
  /** Persisted access-key record fields passed to {@link Keystore.toAccount}. */
  type Record = {
    /** Opaque handle persisted by {@link Keystore.createKey}. */
    handle: unknown
    /** Key type. */
    keyType: string
    /** Public key backing the access key. */
    publicKey: Hex.Hex
  }

  /** Account construction context passed to {@link Keystore.toAccount}. */
  type Context = {
    /** Root account address the access key signs for. */
    access: Address.Address
    /** Pending key authorization manager to thread into the account. */
    keyAuthorizationManager: TempoKeyAuthorizationManager.KeyAuthorizationManager
  }
}

/**
 * Signals that the key behind a persisted handle is permanently gone
 * (e.g. hardware key deleted, app keychain wiped). Thrown from
 * {@link Keystore.toAccount}, it evicts the access-key record so callers fall
 * back to authorizing a fresh key. Keystores composing multiple backends
 * should treat it as an ownership claim: do not route the handle to another
 * backend.
 */
export class KeyUnavailableError extends Error {
  constructor(message?: string, options?: { cause?: unknown | undefined }) {
    super(message ?? 'Keystore key material is permanently unavailable.', options)
    this.name = 'Keystore.KeyUnavailableError'
  }
}

/** Returns whether an error signals permanently unavailable key material. */
export function isKeyUnavailableError(error: unknown): error is KeyUnavailableError {
  if (error instanceof KeyUnavailableError) return true
  return error instanceof Error && error.name === 'Keystore.KeyUnavailableError'
}

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
 * WebCrypto P-256 keystore. The built-in default (see {@link defaults}).
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

/** Handle persisted by the {@link p256} and {@link secp256k1} keystores. */
type HexKeyHandle = {
  kind: 'p256' | 'secp256k1'
  /** Exported private key. At-rest protection is the host app's storage adapter. */
  privateKey: Hex.Hex
}

/**
 * Pure-JS P-256 keystore. The private key is held as hex in the handle and
 * signing runs in JavaScript — at-rest protection is the host app's storage
 * adapter, and the key is readable by anything with JS execution. Prefer
 * {@link webCryptoP256} (or a hardware keystore) where a WebCrypto
 * implementation is available; this exists chiefly as an adapter default
 * for environments without one.
 */
export function p256(): Keystore {
  return hexKeystore('p256')
}

/**
 * Pure-JS secp256k1 keystore. The private key is held as hex in the handle
 * and signing runs in JavaScript — at-rest protection is the host app's
 * storage adapter, and the key is readable by anything with JS execution.
 * secp256k1 signatures are the chain's cheapest envelope, making this the
 * economical default for environments without a WebCrypto implementation
 * (e.g. React Native, CLI).
 */
export function secp256k1(): Keystore {
  return hexKeystore('secp256k1')
}

function hexKeystore(kind: HexKeyHandle['kind']): Keystore {
  const curve = kind === 'p256' ? P256 : Secp256k1
  return {
    async createKey() {
      const privateKey = curve.randomPrivateKey()
      return {
        handle: { kind, privateKey } satisfies HexKeyHandle,
        publicKey: PublicKey.toHex(curve.getPublicKey({ privateKey })),
      }
    },
    toAccount(record, context) {
      const handle = record.handle as Partial<HexKeyHandle> | undefined
      if (handle?.kind !== kind || !handle.privateKey)
        throw new Error(`Unrecognized \`${kind}\` keystore handle.`)
      const account = {
        access: context.access,
        keyAuthorizationManager: context.keyAuthorizationManager,
      }
      return kind === 'p256'
        ? TempoAccount.fromP256(handle.privateKey, account)
        : TempoAccount.fromSecp256k1(handle.privateKey, account)
    },
  }
}

/** Built-in default keystores used when none are configured. */
export const defaults: Keystores = { p256: webCryptoP256() }

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
