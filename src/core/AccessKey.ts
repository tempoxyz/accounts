import { AbiFunction, Address, Hex, PublicKey, RpcResponse, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { BaseError, type Client, type Transport } from 'viem'
import {
  Account as TempoAccount,
  Actions,
  KeyAuthorizationManager as TempoKeyAuthorizationManager,
} from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import * as ExecutionError from './ExecutionError.js'
import type * as Store from './Store.js'

const status = {
  /** No matching usable access key was found. */
  missing: 'missing',
  /** A matching key has a stored authorization that has not been observed on-chain yet. */
  pending: 'pending',
  /** A matching key exists on-chain and can be used. */
  published: 'published',
  /** A matching key exists but is past its expiry. */
  expired: 'expired',
} as const

const unavailableErrorNames = new Set(['KeyAlreadyRevoked', 'KeyNotFound'])

type Status = (typeof status)[keyof typeof status]

/** Access key entry stored alongside accounts. */
export type AccessKey = {
  /** Access key address. */
  address: Address.Address
  /** Owner of the access key. */
  access: Address.Address
  /** Chain ID this access key authorization is scoped to. */
  chainId: number
  /** Unix timestamp when the access key expires. */
  expiry?: number | undefined
  /** Signed key authorization managed by viem until the key is observed on-chain. */
  keyAuthorization?: KeyAuthorization.Signed | undefined
  /** Key type. */
  keyType: 'secp256k1' | 'p256' | 'webAuthn' | 'webCrypto'
  /** TIP-20 spending limits for the access key. */
  limits?: { token: Address.Address; limit: bigint; period?: number | undefined }[] | undefined
  /** Call scopes restricting which contracts/selectors this key can call. */
  scopes?:
    | {
        address: Address.Address
        selector?: Hex.Hex | string | undefined
        recipients?: readonly Address.Address[] | undefined
      }[]
    | undefined
} & OneOf<
  | {}
  | {
      /** The exported private key backing the access key. */
      privateKey: Hex.Hex
    }
  | {
      /** The WebCrypto key pair backing the access key. */
      keyPair: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>
    }
>

/** Calls used to match access key scopes. */
type Call = {
  /** Contract address being called. */
  to?: Address.Address | undefined
  /** Calldata being sent. */
  data?: Hex.Hex | undefined
}

/** Access key status query. */
type StatusQuery = {
  /** Root account address. */
  account: Address.Address
  /** Specific access key address to match. */
  accessKey?: Address.Address | undefined
  /** Calls to match against access key scopes. */
  calls?: readonly Call[] | undefined
  /** Chain ID the access key must be authorized on. */
  chainId: number
  /** Client used to verify publication state on-chain. */
  client: Client<Transport>
  /** Current Unix timestamp in seconds. Defaults to `Date.now() / 1000`. */
  now?: number | undefined
  /** Reactive state store. */
  store: Store.Store
}

/** Access key selection query. */
type SelectQuery = {
  /** Root account address. */
  account: Address.Address
  /** Calls to match against access key scopes. */
  calls?: readonly Call[] | undefined
  /** Chain ID the access key must be authorized on. */
  chainId: number
  /** Current Unix timestamp in seconds. Defaults to `Date.now() / 1000`. */
  now?: number | undefined
  /** Reactive state store. */
  store: Store.Store
}

type Key = {
  /** Root account address. */
  account: Address.Address
  /** Access key address. */
  accessKey: Address.Address
  /** Chain ID the access key is scoped to. */
  chainId: number
  /** Reactive state store. */
  store: Store.Store
}

type ListQuery = {
  /** Root account address. */
  account: Address.Address
  /** Specific access key address to match. */
  accessKey?: Address.Address | undefined
  /** Chain ID the access key is scoped to. */
  chainId: number
  /** Reactive state store. */
  store: Store.Store
}

type ManagedAccount = TempoAccount.AccessKeyAccount

type KeyAuthorizationManager = TempoKeyAuthorizationManager.KeyAuthorizationManager

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

/** Prepares an unsigned key authorization and local key material when needed. */
export async function prepareAuthorization(
  options: prepareAuthorization.Options,
): Promise<prepareAuthorization.ReturnType> {
  const { address, chainId, expiry, keyType, limits, publicKey, scopes } = options

  if (address || publicKey) {
    const keyAuthorization = KeyAuthorization.from({
      address: address ?? Address.fromPublicKey(PublicKey.from(publicKey!)),
      chainId: BigInt(chainId),
      expiry,
      limits,
      scopes,
      type: keyType ?? 'secp256k1',
    })
    return { keyAuthorization }
  }
  if (keyType && keyType !== 'p256')
    throw new RpcResponse.InvalidParamsError({
      message: `\`keyType: "${keyType}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
    })

  const keyPair = await WebCryptoP256.createKeyPair()
  const keyAuthorization = KeyAuthorization.from({
    address: Address.fromPublicKey(PublicKey.from(keyPair.publicKey)),
    chainId: BigInt(chainId),
    expiry,
    limits,
    scopes,
    type: 'p256',
  })
  return { keyAuthorization, keyPair }
}

export declare namespace prepareAuthorization {
  /** Options for {@link prepareAuthorization}. */
  type Options = {
    /** External access key address. Alternative to `publicKey`. */
    address?: Address.Address | undefined
    /** Chain ID the key authorization is scoped to. */
    chainId: bigint | number
    /** Unix timestamp when the key expires. */
    expiry: number
    /** External key type. Defaults to `secp256k1` for external keys. */
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    /** TIP-20 spending limits for this key. */
    limits?: readonly KeyAuthorization.TokenLimit[] | undefined
    /** External public key to derive the access key address from. */
    publicKey?: Hex.Hex | undefined
    /** Call scopes restricting which contracts/selectors this key can call. */
    scopes?: readonly KeyAuthorization.Scope[] | undefined
  }

  /** Prepared unsigned key authorization and optional local key material. */
  type ReturnType = {
    /** Unsigned key authorization to sign with the root account. */
    keyAuthorization: KeyAuthorization.KeyAuthorization<false>
    /** Generated WebCrypto key pair for local access keys. */
    keyPair?: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
  }
}

/** Prepares, signs, and saves an access key authorization. */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { account, chainId, parameters, store } = options
  const prepared = await prepareAuthorization({
    ...parameters,
    chainId: parameters.chainId ?? chainId,
  })
  const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
  const signature = await account.sign({ hash: digest })
  const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
    signature: SignatureEnvelope.from(signature),
  })

  add({
    account: account.address,
    authorization: keyAuthorization,
    ...(prepared.keyPair ? { keyPair: prepared.keyPair } : {}),
    store,
  })

  return KeyAuthorization.toRpc(keyAuthorization)
}

export declare namespace authorize {
  /** Options for {@link authorize}. */
  type Options = {
    /** Root account that owns this access key and signs its authorization. */
    account: Pick<TempoAccount.Account, 'address' | 'sign'>
    /** Default chain ID for the authorization when `parameters.chainId` is not set. */
    chainId: bigint | number
    /** Access key authorization parameters. */
    parameters: Omit<prepareAuthorization.Options, 'chainId'> & {
      /** Chain ID the key authorization is scoped to. */
      chainId?: bigint | number | undefined
    }
    /** Reactive state store. */
    store: Store.Store
  }

  /** Signed key authorization in RPC form. */
  type ReturnType = KeyAuthorization.Rpc
}

/** Returns publication status for a stored or on-chain access key. */
export async function getStatus(options: StatusQuery): Promise<Status> {
  const { accessKey, account, calls, chainId, client, store } = options
  const now = options.now ?? Date.now() / 1000
  const local = list({ account, accessKey, chainId, store }).find((key) =>
    scopesMatch(key, { calls }),
  )

  if (local) {
    if (isExpired(local.expiry, now)) return status.expired
    if (local.keyAuthorization) {
      const publicationStatus = await getPublishedStatus(client, {
        accessKey: local.address,
        account,
        now,
      }).catch(() => status.pending)
      if (publicationStatus === status.published)
        clearAuthorization({
          accessKey: local.address,
          account,
          chainId,
          store,
        })
      return publicationStatus === status.published ? status.published : status.pending
    }
    return await getPublishedStatus(client, { accessKey: local.address, account, now })
  }

  if (accessKey) return await getPublishedStatus(client, { accessKey, account, now })
  return status.missing
}

/** Selects a locally-signable access key account for an intent. */
export async function select(
  options: SelectQuery,
): Promise<TempoAccount.AccessKeyAccount | undefined> {
  const { account, calls, chainId, store } = options
  const now = options.now ?? Date.now() / 1000
  const records = list({ account, chainId, store })

  for (const record of records) {
    if (!scopesMatch(record, { calls })) continue
    if (isExpired(record.expiry, now)) {
      remove({ accessKey: record.address, account: record.access, chainId: record.chainId, store })
      continue
    }

    const account_accessKey = hydrate(record, store)
    if (!account_accessKey) continue

    return account_accessKey
  }
}

function createKeyAuthorizationManager(store: Store.Store): KeyAuthorizationManager {
  return TempoKeyAuthorizationManager.from({
    source: {
      get(key) {
        return list({
          account: key.address,
          accessKey: key.accessKey,
          chainId: key.chainId,
          store,
        })[0]?.keyAuthorization
      },
      remove(key) {
        clearAuthorization({
          account: key.address,
          accessKey: key.accessKey,
          chainId: key.chainId,
          store,
        })
      },
      set(key, keyAuthorization) {
        patch({
          account: key.address,
          accessKey: key.accessKey,
          chainId: key.chainId,
          patch: { keyAuthorization },
          store,
        })
      },
    },
  })
}

/** Adds a signed access key authorization. */
export function add(options: add.Options): add.ReturnType {
  const { account, authorization, keyPair, privateKey, store } = options
  const base = {
    address: authorization.address,
    access: account,
    chainId: Number(authorization.chainId),
    expiry: authorization.expiry ?? undefined,
    keyAuthorization: authorization,
    keyType: authorization.type,
    limits: authorization.limits as AccessKey['limits'],
    scopes: authorization.scopes as AccessKey['scopes'],
  }
  const record = (
    privateKey ? { ...base, privateKey } : keyPair ? { ...base, keyPair } : base
  ) as AccessKey
  store.setState((state) => ({
    accessKeys: [
      record,
      ...state.accessKeys.filter(
        (entry) =>
          !matches(entry, {
            account: record.access,
            accessKey: record.address,
            chainId: record.chainId,
          }),
      ),
    ],
  }))
  return record
}

export declare namespace add {
  /** Options for {@link add}. */
  type Options = {
    /** Root account address that owns this access key. */
    account: Address.Address
    /** Signed key authorization for the access key. */
    authorization: KeyAuthorization.Signed
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. */
    keyPair?: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Reactive state store. */
    store: Store.Store
  }

  /** Stored access key record. */
  type ReturnType = AccessKey
}

function clearAuthorization(options: Key): void {
  const { store, ...key } = options
  patch({
    ...key,
    patch: { keyAuthorization: undefined },
    store,
  })
}

/** Removes an access key record. */
export function remove(options: remove.Options): void {
  const { store, ...key } = options
  store.setState((state) => ({
    accessKeys: state.accessKeys.filter((record) => !matches(record, key)),
  }))
}

export declare namespace remove {
  /** Options for {@link remove}. */
  type Options = Key
}

/** Returns whether an error means an access key is already unavailable on-chain. */
export function isUnavailableError(error: unknown): boolean {
  if (error instanceof BaseError) {
    const found = error.walk((e) => {
      const errorName = (e as { data?: { errorName?: string } }).data?.errorName
      return !!errorName && unavailableErrorNames.has(errorName)
    })
    if (found) return true
  }

  if (!(error instanceof Error)) return false
  return unavailableErrorNames.has(ExecutionError.parse(error).errorName)
}

function scopesMatch(
  key: AccessKey,
  options: {
    calls?: readonly Call[] | undefined
  },
): boolean {
  const scopes = key.scopes
  if (typeof scopes === 'undefined') return true
  if (!Array.isArray(scopes)) return false
  if (!options.calls) return false
  return options.calls.every((call) => {
    if (!call.to) return false
    const callTo = call.to.toLowerCase()
    const callSelector = call.data?.slice(0, 10).toLowerCase()
    return scopes.some((scope) => {
      if (!isScope(scope)) return false
      if (scope.address.toLowerCase() !== callTo) return false
      const selector = scope.selector
      if (!selector) return scope.recipients ? scope.recipients.length === 0 : true
      const scopeSelector = (() => {
        try {
          return (
            selector.startsWith('0x') && selector.length === 10
              ? selector
              : AbiFunction.getSelector(selector)
          ).toLowerCase()
        } catch {
          return undefined
        }
      })()
      if (!scopeSelector || callSelector !== scopeSelector) return false
      if (!scope.recipients || scope.recipients.length === 0) return true
      if (!call.data || call.data.length < 74) return false
      const recipient = `0x${call.data.slice(34, 74)}` as Address.Address
      if (!Address.validate(recipient)) return false
      return scope.recipients.some((address) => address.toLowerCase() === recipient.toLowerCase())
    })
  })
}

function isScope(scope: unknown): scope is NonNullable<AccessKey['scopes']>[number] {
  if (!scope || typeof scope !== 'object') return false
  const value = scope as {
    address?: unknown
    recipients?: unknown
    selector?: unknown
  }
  if (typeof value.address !== 'string' || !Address.validate(value.address)) return false
  if (typeof value.selector !== 'undefined' && typeof value.selector !== 'string') return false
  if (typeof value.recipients !== 'undefined') {
    if (!Array.isArray(value.recipients)) return false
    if (value.recipients.some((recipient) => typeof recipient !== 'string')) return false
    if (value.recipients.some((recipient) => !Address.validate(recipient))) return false
  }
  return true
}

function hydrate(accessKey: AccessKey, store: Store.Store): ManagedAccount | undefined {
  const keyAuthorizationManager = createKeyAuthorizationManager(store)
  if ('keyPair' in accessKey && accessKey.keyPair)
    return TempoAccount.fromWebCryptoP256(accessKey.keyPair, {
      access: accessKey.access,
      keyAuthorizationManager,
    }) as TempoAccount.AccessKeyAccount
  if ('privateKey' in accessKey && accessKey.privateKey) {
    switch (accessKey.keyType) {
      case 'secp256k1':
        return TempoAccount.fromSecp256k1(accessKey.privateKey, {
          access: accessKey.access,
          keyAuthorizationManager,
        }) as TempoAccount.AccessKeyAccount
      case 'p256':
        return TempoAccount.fromP256(accessKey.privateKey, {
          access: accessKey.access,
          keyAuthorizationManager,
        }) as TempoAccount.AccessKeyAccount
    }
  }
  return undefined
}

function isExpired(expiry: number | undefined, now: number): boolean {
  return typeof expiry === 'number' && expiry < now
}

async function getPublishedStatus(
  client: Client<Transport>,
  options: { accessKey: Address.Address; account: Address.Address; now: number },
): Promise<Status> {
  const { accessKey, account, now } = options
  try {
    const metadata = await Actions.accessKey.getMetadata(client, {
      account,
      accessKey,
    })
    if (metadata.address.toLowerCase() !== accessKey.toLowerCase()) return status.missing
    if (metadata.isRevoked) return status.missing
    if (metadata.expiry > 0n && metadata.expiry < BigInt(Math.floor(now))) return status.expired
    return status.published
  } catch (error) {
    if (isUnavailableError(error)) return status.missing
    throw error
  }
}

function list(options: ListQuery): readonly AccessKey[] {
  const { store, ...query } = options
  return store.getState().accessKeys.filter((key) => matches(key, query))
}

function patch(options: Key & { patch: Partial<AccessKey> }): void {
  const { patch, store, ...key } = options
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((record) => {
      if (!matches(record, key)) return record
      const next = { ...record } as Record<string, unknown>
      for (const [name, value] of Object.entries(patch)) {
        if (typeof value === 'undefined') delete next[name]
        else next[name] = value
      }
      return next as AccessKey
    }),
  }))
}

function matches(
  record: AccessKey,
  options: {
    account: Address.Address
    accessKey?: Address.Address | undefined
    chainId: number
  },
): boolean {
  const { accessKey, account, chainId } = options
  if (record.access.toLowerCase() !== account.toLowerCase()) return false
  if (record.chainId !== chainId) return false
  if (accessKey && record.address.toLowerCase() !== accessKey.toLowerCase()) return false
  return true
}
