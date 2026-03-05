import type { Hex } from 'viem'
import type { Address, JsonRpcAccount, LocalAccount } from 'viem/accounts'
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
  | { keyType: 'webAuthn'; credential: { id: string; publicKey: Hex } }
  | {
      keyType: 'webCrypto'
      privateKey: Hex
    }
  | {
      keyType: 'headlessWebAuthn'
      privateKey: Hex
      rpId: string
      origin: string
    }
>

/** Resolves a viem Account from the store by address (or active account). */
export function fromAddress(options: fromAddress.Options): LocalAccount {
  const { address, signable = false, store } = options
  const { accounts, activeAccount } = store.getState()
  const account = address ? accounts.find((a) => a.address === address) : accounts[activeAccount]
  if (!account) throw new Error(address ? `Account ${address} not found.` : 'No active account.')
  return hydrate(account, { sign: signable }) as never
}

export declare namespace fromAddress {
  type Options = {
    /** Address to resolve. Defaults to the active account. */
    address?: Address | undefined
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
    /** Reactive state store. */
    store: core_Store.Store
  }
}

/** Hydrates a store account to a viem Account. */
export function hydrate(account: Store, options: { sign: true }): TempoAccount.Account
export function hydrate(
  account: Store,
  options?: hydrate.Options,
): TempoAccount.Account | JsonRpcAccount
export function hydrate(
  account: Store,
  options: hydrate.Options = {},
): TempoAccount.Account | JsonRpcAccount {
  const { sign = false } = options
  if (!sign) return { address: account.address, type: 'json-rpc' }
  if ('sign' in account && typeof account.sign === 'function')
    return account as TempoAccount.Account
  if (!account.keyType) throw new Error(`Account "${account.address}" cannot sign.`)
  switch (account.keyType) {
    case 'secp256k1':
      return TempoAccount.fromSecp256k1(account.privateKey)
    case 'p256':
      return TempoAccount.fromP256(account.privateKey)
    case 'webCrypto':
      return TempoAccount.fromP256(account.privateKey)
    case 'webAuthn':
      return TempoAccount.fromWebAuthnP256(account.credential)
    case 'headlessWebAuthn':
      return TempoAccount.fromHeadlessWebAuthn(account.privateKey, {
        rpId: account.rpId,
        origin: account.origin,
      })
    default:
      throw new Error('Unknown key type.')
  }
}

export declare namespace hydrate {
  type Options = {
    /** Whether to hydrate signing capability. @default false */
    sign?: boolean | undefined
  }
}
