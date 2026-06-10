import type { Address, Hex } from 'ox'
import type {
  Account as TempoAccount,
  KeyAuthorizationManager as TempoKeyAuthorizationManager,
} from 'viem/tempo'

import type { MaybePromise } from '../internal/types.js'

/**
 * Pluggable access-key keystore.
 *
 * A keystore owns access-key material end to end: `createKey` provisions a
 * key and returns an opaque, JSON-serializable `handle` that the SDK persists
 * verbatim alongside the access-key record; `toAccount` turns a persisted
 * record back into a signing account. The handle's schema is owned by
 * whichever keystore wrote it, so backends can be heterogeneous per device
 * (e.g. hardware-backed keys with a WebCrypto fallback).
 *
 * Records carrying `privateKey` or `keyPair` material continue to hydrate
 * without consulting the keystore.
 */
export type Keystore = {
  /**
   * Creates access-key material.
   *
   * Must fail loudly when the keystore's runtime prerequisites are missing
   * (e.g. no Secure Enclave, no `crypto.subtle`) so provisioning errors
   * surface at authorization time, not at first sign.
   */
  createKey: (options: createKey.Options) => Promise<createKey.ReturnType>
  /**
   * Turns a persisted access-key record back into a signing account.
   *
   * Called lazily when a stored record is first used after hydration; the
   * SDK caches the result per record.
   *
   * Throw {@link KeyUnavailableError} when the key behind the handle is
   * permanently gone (e.g. hardware key deleted) — the SDK evicts the record
   * so callers fall back to authorizing a fresh key. Any other error is
   * treated as transient (e.g. device locked): the record is kept and
   * retried on next use.
   */
  toAccount: (
    record: toAccount.Record,
    context: toAccount.Context,
  ) => MaybePromise<TempoAccount.AccessKeyAccount>
}

/**
 * Signals that the key behind a persisted handle is permanently gone
 * (e.g. hardware key deleted, app keychain wiped). Thrown from
 * {@link Keystore.toAccount}, it evicts the access-key record so callers
 * fall back to authorizing a fresh key.
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

export declare namespace createKey {
  /** Options for {@link Keystore.createKey}. */
  type Options = {
    /** Requested key type. Defaults to keystore policy. */
    keyType?: 'p256' | 'secp256k1' | undefined
  }

  /** Created access-key material. */
  type ReturnType = {
    /**
     * Opaque handle for the created key. Persisted verbatim, so it must be
     * JSON-serializable (and must not be `undefined`). Its schema is owned
     * by the keystore that wrote it.
     */
    handle: unknown
    /** Created key type. */
    keyType: 'p256' | 'secp256k1'
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
