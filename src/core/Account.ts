import { AbiFunction, Provider, type WebCryptoP256 } from 'ox'
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
  /** Display label used during registration (e.g. email). */
  label?: string | undefined
} & OneOf<
  | {}
  | RootMetadata
  | (RootMetadata & Pick<TempoAccount.Account, 'sign'>)
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

/** Non-secret signer metadata for a root account. */
export type RootMetadata = {
  /** Root signer key type. Does not imply local signing material is available. */
  keyType: TempoAccount.Account['keyType']
}

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
  /** Key type. */
  keyType: 'secp256k1' | 'p256' | 'webAuthn' | 'webCrypto'
  /** TIP-20 spending limits for the access key. */
  limits?: { token: Address; limit: bigint; period?: number | undefined }[] | undefined
  /** Call scopes restricting which contracts/selectors this key can call. */
  scopes?:
    | {
        address: Address
        selector?: Hex | string | undefined
        recipients?: readonly Address[] | undefined
      }[]
    | undefined
} & OneOf<
  | {}
  | {
      /** The exported private key backing the access key. */
      privateKey: Hex
    }
  | {
      /** The WebCrypto key pair backing the access key. */
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
    }
>

/** JSON-RPC account metadata attached to a request before it reaches wallet UI. */
export type Request = JsonRpcAccount &
  Partial<Pick<TempoAccount.Account, 'keyType'>> &
  Partial<Pick<TempoAccount.AccessKeyAccount, 'accessKeyAddress'>>

/** Resolves a viem Account from the store by address (or active account). */
export function find(options: find.Options & { signable: true }): TempoAccount.Account
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount
export function find(options: find.Options): TempoAccount.Account | JsonRpcAccount {
  const { accessKey = true, address, signable = false, store } = options
  const { accessKeys, accounts, activeAccount } = store.getState()

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
    const key = findAccessKey(root, { accessKeys, options, store })
    if (key) return hydrateAccessKey(key) as never
  }

  return hydrate(root, { signable }) as never
}

export declare namespace find {
  type Options = {
    /** Whether to resolve an access key for this account. @default true */
    accessKey?: boolean | undefined
    /** Address to resolve. Defaults to the active account. */
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

/** Overloaded signature for `request` without `store` (pre-bound by the provider). */
export type GetRequest = (
  options?: Omit<request.Options, 'store'> | undefined,
) => Request | undefined

/** Resolves request account metadata without exposing local signing material. */
export function request(options: request.Options): Request | undefined {
  const { accessKey = true, address, store } = options
  const { accounts, activeAccount } = store.getState()
  const activeAddr = accounts[activeAccount]?.address
  const root = address
    ? accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())
    : accounts.find((a) => activeAddr && a.address.toLowerCase() === activeAddr.toLowerCase())
  if (!root) return undefined

  if (accessKey) {
    const key = findAccessKey(root, { accessKeys: store.getState().accessKeys, options, store })
    if (key) {
      const keyType = toRequestKeyType(key.keyType)
      return {
        address: root.address,
        type: 'json-rpc',
        ...(keyType ? { keyType } : {}),
        accessKeyAddress: key.address,
      }
    }
  }

  const keyType = toRequestKeyType(root.keyType)
  return {
    address: root.address,
    type: 'json-rpc',
    ...(keyType ? { keyType } : {}),
  }
}

function findAccessKey(
  root: Store,
  parameters: {
    accessKeys: readonly AccessKey[]
    options: find.Options
    store: core_Store.Store
  },
): AccessKey | undefined {
  const { accessKeys, options, store } = parameters
  for (const key of accessKeys) {
    if (key.access.toLowerCase() !== root.address.toLowerCase()) continue
    if (!('keyPair' in key && !!key.keyPair) && !('privateKey' in key && !!key.privateKey)) continue

    // Remove expired access keys.
    if (key.expiry && key.expiry < Date.now() / 1000) {
      store.setState({ accessKeys: accessKeys.filter((a) => a !== key) })
      continue
    }

    // Use access key if unscoped or scopes cover the requested calls; otherwise keep looking.
    if (scopesMatch(key, options)) return key
  }
  return undefined
}

function toRequestKeyType(keyType: Store['keyType'] | AccessKey['keyType']): Request['keyType'] {
  if (keyType === 'webAuthn_headless') return 'webAuthn'
  if (keyType === 'webCrypto') return 'p256'
  return keyType
}

export declare namespace request {
  type Options = {
    /** Whether access keys may be returned. @default true */
    accessKey?: boolean | undefined
    /** Address to resolve. Defaults to the active account. */
    address?: Address | undefined
    /** Calls to match against access key scopes. */
    calls?: find.Options['calls'] | undefined
    /** Chain ID associated with the request. Used by external resolvers. */
    chainId?: number | undefined
    /** Reactive state store. */
    store: core_Store.Store
  }
}

/** Hydrates an access key entry to a viem Account. Only works for locally-generated keys with a `keyPair`. */
export function hydrateAccessKey(accessKey: AccessKey): TempoAccount.Account {
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
  switch (account.keyType) {
    case 'secp256k1':
      if ('privateKey' in account && account.privateKey)
        return TempoAccount.fromSecp256k1(account.privateKey)
      break
    case 'p256':
      if ('privateKey' in account && account.privateKey)
        return TempoAccount.fromP256(account.privateKey)
      break
    case 'webCrypto':
      if ('keyPair' in account && account.keyPair)
        return TempoAccount.fromWebCryptoP256(account.keyPair)
      break
    case 'webAuthn':
      if ('credential' in account && account.credential)
        return TempoAccount.fromWebAuthnP256(account.credential, {
          rpId: account.credential.rpId,
        })
      break
    case 'webAuthn_headless':
      if ('privateKey' in account && account.privateKey)
        return TempoAccount.fromHeadlessWebAuthn(account.privateKey, {
          rpId: account.rpId,
          origin: account.origin,
        })
      break
  }

  throw new Provider.UnauthorizedError({ message: `Account "${account.address}" cannot sign.` })
}

export declare namespace hydrate {
  type Options = {
    /** Whether to hydrate signing capability. @default false */
    signable?: boolean | undefined
  }
}

/** Returns true if the access key's scopes cover the requested calls (or key is unscoped). */
function scopesMatch(key: AccessKey, options: find.Options): boolean {
  if (!options.calls || !key.scopes) return true
  return options.calls!.every((call) => {
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
