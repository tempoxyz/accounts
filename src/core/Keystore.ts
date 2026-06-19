import type { Address, Hex } from 'ox'
import type {
  Account as TempoAccount,
  KeyAuthorizationManager as TempoKeyAuthorizationManager,
} from 'viem/tempo'

import type { MaybePromise } from '../internal/types.js'
import { webCryptoP256 } from './keystores/webCryptoP256.js'

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
 * Opaque key reference persisted verbatim alongside the access-key record.
 * `kind` marks which keystore wrote it; the remaining fields are owned by
 * that keystore and must survive its declared persistence format.
 */
export type Handle = { kind: string; [key: string]: unknown }

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
    handle: Handle
    /** Public key of the created key. */
    publicKey: Hex.Hex
  }
}

export declare namespace toAccount {
  /** Persisted access-key record fields passed to {@link Keystore.toAccount}. */
  type Record = {
    /** Opaque handle persisted by {@link Keystore.createKey}. */
    handle: Handle
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

export { p256 } from './keystores/p256.js'
export { secp256k1 } from './keystores/secp256k1.js'
export { webCryptoP256 }

/** Built-in default keystores used when none are configured. */
export const defaults: Keystores = { p256: webCryptoP256() }
