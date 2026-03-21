import { Provider, type WebCryptoP256 } from 'ox'
import { type KeyAuthorization } from 'ox/tempo'
import type { Hex } from 'viem'
import type { Address, JsonRpcAccount } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import type * as core_Store from './Store.js'

/** Account stored in the provider state. */
export type Store = {
  /** Account address. */
  address: Address
} & OneOf<
  | {}
  | Pick<TempoAccount.Account, 'keyType' | 'sign'>
  | { keyType: 'secp256k1'; privateKey: Hex }
  | { keyType: 'p256'; privateKey: Hex }
  | { keyType: 'webAuthn'; credential: { id: string; publicKey: Hex; rpId: string } }
  | {
      keyType: 'webCrypto'
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
    }
  | {
      keyType: 'webAuthn_headless'
      privateKey: Hex
      rpId: string
      origin: string
    }
>

/** Access key entry stored alongside accounts. */
export type AccessKey = {
  /** Access key address. */
  address: Address
  /** Owner of the access key. */
  access: Address
  /** Unix timestamp when the access key expires. */
  expiry?: number | undefined
  /** Signed key authorization to attach to the first transaction. Consumed on use. */
  keyAuthorization?: KeyAuthorization.Signed | undefined
  /** The WebCrypto key pair backing the access key. Only present for locally-generated keys. */
  keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
  /** Key type. */
  keyType: 'secp256k1' | 'p256' | 'webAuthn' | 'webCrypto'
  /** TIP-20 spending limits for the access key. */
  limits?: { token: Address; limit: bigint }[] | undefined
}

/** Resolves a viem Account from the store by address (or active account). */
export function find(options: find.Options & { signable: true }): TempoAccount.Account
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount {
  const { accessKey = true, address, signable = false, store } = options
  const { accessKeys, accounts, activeAccount } = store.getState()

  const activeAddr = accounts[activeAccount]?.address
  const root = address
    ? accounts.find((a) => a.address === address)
    : accounts.find((a) => a.address === activeAddr)
  if (!root)
    throw address
      ? new Provider.UnauthorizedError({ message: `Account "${address}" not found.` })
      : new Provider.DisconnectedError({ message: 'No active account.' })

  // When accessKey is requested, prefer a locally-signable access key for this address.
  if (accessKey) {
    const key = accessKeys.find(
      (a) => a.access.toLowerCase() === root.address.toLowerCase() && a.keyPair,
    )
    if (key) {
      // Remove expired access keys.
      if (key.expiry && key.expiry < Date.now() / 1000)
        store.setState({ accessKeys: accessKeys.filter((a) => a !== key) })
      else return hydrateAccessKey(key) as never
    }
  }

  return hydrate(root, { signable }) as never
}

export declare namespace find {
  type Options = {
    /** Whether to resolve an access key for this account. @default true */
    accessKey?: boolean | undefined
    /** Address to resolve. Defaults to the active account. */
    address?: Address | undefined
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
    /** Reactive state store. */
    store: core_Store.Store
  }
}

/** Overloaded signature for `find` without `store` (pre-bound by the provider). */
export type Find = {
  (options: Omit<find.Options, 'store'> & { signable: true }): TempoAccount.Account
  (options?: Omit<find.Options, 'store'>): TempoAccount.Account | JsonRpcAccount
}

/** Hydrates an access key entry to a viem Account. Only works for locally-generated keys with a `keyPair`. */
export function hydrateAccessKey(accessKey: AccessKey): TempoAccount.Account {
  if (!accessKey.keyPair)
    throw new Provider.UnauthorizedError({
      message: 'External access key cannot be hydrated for signing.',
    })
  return TempoAccount.fromWebCryptoP256(accessKey.keyPair, { access: accessKey.access })
}

/** Hydrates a store account to a viem Account. */
export function hydrate(account: Store, options: { signable: true }): TempoAccount.Account
export function hydrate(
  account: Store,
  options?: hydrate.Options,
): TempoAccount.Account | JsonRpcAccount
export function hydrate(
  account: Store,
  options: hydrate.Options = {},
): TempoAccount.Account | JsonRpcAccount {
  const { signable = false } = options
  if (!signable) return { address: account.address, type: 'json-rpc' }
  if ('sign' in account && typeof account.sign === 'function')
    return account as TempoAccount.Account
  if (!account.keyType)
    throw new Provider.UnauthorizedError({ message: `Account "${account.address}" cannot sign.` })
  switch (account.keyType) {
    case 'secp256k1':
      return TempoAccount.fromSecp256k1(account.privateKey)
    case 'p256':
      return TempoAccount.fromP256(account.privateKey)
    case 'webCrypto':
      return TempoAccount.fromWebCryptoP256(account.keyPair)
    case 'webAuthn':
      return TempoAccount.fromWebAuthnP256(account.credential, {
        rpId: account.credential.rpId,
      })
    case 'webAuthn_headless':
      return TempoAccount.fromHeadlessWebAuthn(account.privateKey, {
        rpId: account.rpId,
        origin: account.origin,
      })
    default:
      throw new Provider.UnauthorizedError({ message: 'Unknown key type.' })
  }
}

export declare namespace hydrate {
  type Options = {
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
  }
}
