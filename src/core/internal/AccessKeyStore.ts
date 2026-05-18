import { Address, Hex } from 'ox'
import type { WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'

import type * as Store from '../Store.js'

type AccessKey = Store.AccessKey

/** Returns the stored access key record for an access key address. */
export function get(options: get.Options): AccessKey | undefined {
  const { accessKey, store } = options
  return store
    .getState()
    .accessKeys.find((key) => key.address.toLowerCase() === accessKey.toLowerCase())
}

export declare namespace get {
  /** Options for {@link get}. */
  type Options = {
    /** Access key address. */
    accessKey: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Returns all stored access key records matching the owner and chain. */
export function list(options: list.Options): readonly AccessKey[] {
  const { store } = options
  return store.getState().accessKeys.filter((key) => matches(key, options))
}

export declare namespace list {
  /** Options for {@link list}. */
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Specific access key address to match. */
    accessKey?: Address.Address | undefined
    /** Chain ID the access key must be authorized on. */
    chainId: number
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Upserts an access key record from a signed authorization. */
export function upsertAuthorization(options: upsertAuthorization.Options): void {
  const { address, keyAuthorization, keyPair, privateKey, state, store } = options

  const base = {
    address: keyAuthorization.address,
    access: address,
    chainId: Number(keyAuthorization.chainId),
    expiry: keyAuthorization.expiry ?? undefined,
    ...(state === 'authorized' ? {} : { keyAuthorization }),
    ...(state === 'pending' ? { keyAuthorizationPending: true } : {}),
    keyType: keyAuthorization.type,
    limits: keyAuthorization.limits as AccessKey['limits'],
    scopes: keyAuthorization.scopes as AccessKey['scopes'],
  }

  const accessKey: AccessKey = privateKey
    ? { ...base, privateKey }
    : keyPair
      ? { ...base, keyPair }
      : { ...base }

  store.setState((state) => ({
    accessKeys: [
      accessKey,
      ...state.accessKeys.filter(
        (entry) => entry.address.toLowerCase() !== keyAuthorization.address.toLowerCase(),
      ),
    ],
  }))
}

export declare namespace upsertAuthorization {
  /** Options for {@link upsertAuthorization}. */
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Signed key authorization for deriving and storing access-key metadata. */
    keyAuthorization: KeyAuthorization.Signed
    /** Publication lifecycle state for the key authorization. */
    state: 'signed' | 'pending' | 'authorized'
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. Only present for locally-generated keys. */
    keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Removes a stored access key record. */
export function remove(options: remove.Options): void {
  const { accessKey, store } = options
  store.setState((state) => ({
    accessKeys: state.accessKeys.filter(
      (key) => key.address.toLowerCase() !== accessKey.toLowerCase(),
    ),
  }))
}

export declare namespace remove {
  /** Options for {@link remove}. */
  type Options = {
    /** Access key address. */
    accessKey: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Clears a pending key authorization from a stored access key record. */
export function removePending(options: removePending.Options): void {
  const { accessKey, store } = options
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((key) =>
      key.address.toLowerCase() === accessKey.toLowerCase()
        ? { ...key, keyAuthorization: undefined, keyAuthorizationPending: undefined }
        : key,
    ),
  }))
}

export declare namespace removePending {
  /** Options for {@link removePending}. */
  type Options = {
    /** Access key address. */
    accessKey: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Marks a stored key authorization as pending confirmation on-chain. */
export function markPending(options: markPending.Options): void {
  const { accessKey, store } = options
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((key) =>
      key.address.toLowerCase() === accessKey.toLowerCase() && key.keyAuthorization
        ? { ...key, keyAuthorizationPending: true }
        : key,
    ),
  }))
}

export declare namespace markPending {
  /** Options for {@link markPending}. */
  type Options = {
    /** Access key address. */
    accessKey: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}

function matches(key: AccessKey, options: list.Options): boolean {
  const { accessKey, address, chainId } = options
  if (key.access.toLowerCase() !== address.toLowerCase()) return false
  if (key.chainId !== chainId) return false
  if (accessKey && key.address.toLowerCase() !== accessKey.toLowerCase()) return false
  return true
}
