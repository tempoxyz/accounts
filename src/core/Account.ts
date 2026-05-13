import { Provider, type WebCryptoP256 } from 'ox'
import type { Hex } from 'viem'
import type { Address, JsonRpcAccount } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import * as core_AccessKey from './AccessKey.js'
import type * as core_Store from './Store.js'

/** Account stored in the provider state. */
export type Store = {
  /** Account address. */
  address: Address
  /** Display label used during registration (e.g. email). */
  label?: string | undefined
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

/** Resolves a viem Account from the store by address (or active account). */
export function find(options: find.Options & { signable: true }): TempoAccount.Account
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount {
  const { accessKey = true, address, signable = false, store } = options
  const { accounts, activeAccount } = store.getState()

  const activeAddr = accounts[activeAccount]?.address
  const root = address
    ? accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())
    : accounts.find((a) => activeAddr && a.address.toLowerCase() === activeAddr.toLowerCase())
  if (!root)
    throw address
      ? new Provider.UnauthorizedError({ message: `Account "${address}" not found.` })
      : new Provider.DisconnectedError({ message: 'No active account.' })

  // When accessKey is requested, prefer a locally-signable access key for this address.
  if (accessKey) {
    const key = core_AccessKey.select({ address: root.address, calls: options.calls, store })
    if (key) return core_AccessKey.hydrate(key) as never
  }

  return hydrate(root, { signable }) as never
}

export declare namespace find {
  type Options = {
    /** Whether to prefer an access key for this account. @default true */
    accessKey?: boolean | undefined
    /** Address to find. Defaults to the active account. */
    address?: Address | undefined
    /** Calls to match against access key scopes. When provided, access keys whose scopes don't cover these calls are skipped. */
    calls?: readonly { to?: Address | undefined; data?: Hex | undefined }[] | undefined
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
