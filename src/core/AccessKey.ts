import { Address, Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'

import type * as Store from './Store.js'

/** Returns the pending key authorization for an access key account without removing it. */
export function getPending(
  account: TempoAccount.Account,
  options: { store: Store.Store },
): KeyAuthorization.Signed | undefined {
  if (account.source !== 'accessKey') return undefined
  const { store } = options
  const accessKeyAddress = (account as TempoAccount.AccessKeyAccount).accessKeyAddress
  const { accessKeys } = store.getState()
  const entry = accessKeys.find((a) => a.address?.toLowerCase() === accessKeyAddress.toLowerCase())
  return entry?.keyAuthorization
}

/** Generates a P256 key pair and access key account. */
export async function generate(options: generate.Options = {}): Promise<generate.ReturnType> {
  const { account } = options
  const keyPair = await WebCryptoP256.createKeyPair()
  const accessKey = TempoAccount.fromWebCryptoP256(
    keyPair,
    account ? { access: account } : undefined,
  )
  return { accessKey, keyPair }
}

export declare namespace generate {
  type Options = {
    /** Root account to attach to the access key. */
    account?: TempoAccount.Account | undefined
  }

  type ReturnType = {
    /** The generated access key account. */
    accessKey: TempoAccount.AccessKeyAccount
    /** Generated key pair to pass to `authorizeAccessKey`. */
    keyPair: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>>
  }
}

/** Removes an access key entry for the given account from the store. */
export function remove(account: TempoAccount.Account, options: { store: Store.Store }): void {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = account.accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.filter(
      (a) => a.address?.toLowerCase() !== accessKeyAddress?.toLowerCase(),
    ),
  }))
}

/** Permanently removes the pending key authorization for an access key account. */
export function removePending(
  account: TempoAccount.Account,
  options: { store: Store.Store },
): void {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = (account as TempoAccount.AccessKeyAccount).accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((a) =>
      a.address.toLowerCase() === accessKeyAddress.toLowerCase()
        ? { ...a, keyAuthorization: undefined }
        : a,
    ),
  }))
}

/** Removes an access key from the store. */
export function revoke(options: revoke.Options): void {
  const { address, store } = options
  const { accessKeys } = store.getState()
  store.setState({
    accessKeys: accessKeys.filter((a) => a.access.toLowerCase() !== address.toLowerCase()),
  })
}

export declare namespace revoke {
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Saves an access key to the store with its one-time key authorization. */
export function save(options: save.Options): void {
  const { address, keyAuthorization, keyPair, privateKey, store } = options

  store.setState((state) => ({
    accessKeys: [
      {
        address: keyAuthorization.address,
        access: address,
        expiry: keyAuthorization.expiry ?? undefined,
        keyAuthorization,
        keyType: keyAuthorization.type,
        limits: keyAuthorization.limits as { token: Address.Address; limit: bigint }[] | undefined,
        ...(privateKey ? { privateKey } : {}),
        ...(keyPair ? { keyPair } : {}),
      },
      ...state.accessKeys.filter(
        (entry) => entry.address.toLowerCase() !== keyAuthorization.address.toLowerCase(),
      ),
    ],
  }))
}

export declare namespace save {
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Signed key authorization to attach to the first transaction. */
    keyAuthorization: KeyAuthorization.Signed
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. Only present for locally-generated keys. */
    keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}
