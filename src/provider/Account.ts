import type { Address, JsonRpcAccount, LocalAccount } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import type * as core_Store from './Store.js'

/** Account stored in the provider state. */
export type Store = {
  /** Account address. */
  address: Address
  /** Data needed to rehydrate a signing account on page refresh. */
  sign?:
    | OneOf<
        | { keyType: 'secp256k1'; privateKey: `0x${string}` }
        | { keyType: 'p256'; privateKey: `0x${string}` }
        | { keyType: 'webAuthn'; credential: { id: string; publicKey: `0x${string}` } }
        | {
            keyType: 'webcryptoP256'
            privateKey: `0x${string}`
          }
        | {
            keyType: 'headlessWebAuthn'
            privateKey: `0x${string}`
            rpId: string
            origin: string
          }
      >
    | undefined
}

/** Resolves a viem Account from the store by address (or active account). */
export function fromAddress(options: fromAddress.Options): LocalAccount {
  const { address, signable = false, store } = options
  const { accounts, activeAccount } = store.getState()
  const account = address
    ? accounts.find((a) => a.address === address)
    : accounts[activeAccount]
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
export function hydrate(account: Store, options?: hydrate.Options): TempoAccount.Account | JsonRpcAccount
export function hydrate(account: Store, options: hydrate.Options = {}): TempoAccount.Account | JsonRpcAccount {
  const { sign = false } = options
  if (!sign) return { address: account.address, type: 'json-rpc' }
  if (!account.sign) throw new Error(`Account "${account.address}" cannot perform sign.`)
  switch (account.sign.keyType) {
    case 'secp256k1':
      return TempoAccount.fromSecp256k1(account.sign.privateKey)
    case 'p256':
      return TempoAccount.fromP256(account.sign.privateKey)
    case 'webcryptoP256':
      return TempoAccount.fromP256(account.sign.privateKey)
    case 'webAuthn':
      return TempoAccount.fromWebAuthnP256(account.sign.credential)
    case 'headlessWebAuthn':
      return TempoAccount.fromHeadlessWebAuthn(account.sign.privateKey, {
        rpId: account.sign.rpId,
        origin: account.sign.origin,
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
