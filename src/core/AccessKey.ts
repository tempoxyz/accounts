import { AbiFunction, Address, Hex, Provider, WebCryptoP256 } from 'ox'
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

/** Hydrates an access key entry to a viem Account. Only works for locally-generated keys. */
export function hydrate(accessKey: Store.AccessKey): TempoAccount.Account {
  if ('keyPair' in accessKey && accessKey.keyPair)
    return TempoAccount.fromWebCryptoP256(accessKey.keyPair, { access: accessKey.access })
  if ('privateKey' in accessKey && accessKey.privateKey) {
    switch (accessKey.keyType) {
      case 'secp256k1':
        return TempoAccount.fromSecp256k1(accessKey.privateKey, { access: accessKey.access })
      case 'p256':
        return TempoAccount.fromP256(accessKey.privateKey, { access: accessKey.access })
    }
  }
  throw new Provider.UnauthorizedError({
    message: 'External access key cannot be hydrated for signing.',
  })
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

/** Selects a locally-signable access key for a root account, removing expired keys. */
export function select(options: select.Options): Store.AccessKey | undefined {
  const { address, calls, store } = options
  const { accessKeys } = store.getState()
  let accessKeys_next = accessKeys
  for (const key of accessKeys) {
    if (key.access.toLowerCase() !== address.toLowerCase()) continue
    if (!('keyPair' in key && !!key.keyPair) && !('privateKey' in key && !!key.privateKey)) continue

    if (key.expiry && key.expiry < Date.now() / 1000) {
      accessKeys_next = accessKeys_next.filter((a) => a !== key)
      store.setState({ accessKeys: accessKeys_next })
      continue
    }

    if (scopesMatch(key, { calls })) return key
  }
  return undefined
}

export declare namespace select {
  /** Options for {@link select}. */
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    /** Reactive state store. */
    store: Store.Store
  }
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

function scopesMatch(
  key: Store.AccessKey,
  options: {
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
  },
): boolean {
  if (!key.scopes) return true
  if (!options.calls) return false
  return options.calls.every((call) => {
    if (!call.to) return false
    const callTo = call.to.toLowerCase()
    const callSelector = call.data?.slice(0, 10).toLowerCase()
    return key.scopes!.some((scope) => {
      if (scope.address.toLowerCase() !== callTo) return false
      if (!scope.selector) return true
      const scopeSelector = (
        scope.selector.startsWith('0x') && scope.selector.length === 10
          ? scope.selector
          : AbiFunction.getSelector(scope.selector)
      ).toLowerCase()
      return callSelector === scopeSelector
    })
  })
}

/** Saves an access key to the store with its one-time key authorization. */
export function save(options: save.Options): void {
  const { address, keyAuthorization, keyPair, privateKey, store } = options

  const base = {
    address: keyAuthorization.address,
    access: address,
    expiry: keyAuthorization.expiry ?? undefined,
    keyAuthorization,
    keyType: keyAuthorization.type,
    limits: keyAuthorization.limits as Store.AccessKey['limits'],
    scopes: keyAuthorization.scopes as Store.AccessKey['scopes'],
  }

  const accessKey: Store.AccessKey = privateKey
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
