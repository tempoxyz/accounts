import { AbiFunction, Address, Hex, PublicKey, RpcResponse, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { BaseError, type Client, type Transport } from 'viem'
import {
  Account as TempoAccount,
  Actions,
  KeyAuthorizationManager as TempoKeyAuthorizationManager,
} from 'viem/tempo'
import type { StoreApi } from 'zustand'

import type { OneOf } from '../internal/types.js'
import * as ExecutionError from './ExecutionError.js'
import * as Keystore from './Keystore.js'
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
  /** Account this authorization targets. */
  account?: Address.Address | undefined
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
  /** Whether this authorization grants admin key privileges. */
  isAdmin?: boolean | undefined
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
  /** TIP-1053 witness bound into the key authorization. */
  witness?: Hex.Hex | undefined
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
  | {
      /** Opaque keystore handle backing the access key. Persisted verbatim; schema owned by the keystore that wrote it. */
      handle: Keystore.Handle
      /** Public key backing the access key. */
      publicKey: Hex.Hex
    }
>

/** Calls used to match access key scopes. */
export type Call = {
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
  /** Access-key manager options. */
  store: ManagerOptions
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
  /** Access-key manager options. */
  store: ManagerOptions
}

/** Access key authorization reuse policy. */
export type ReusePolicy = {
  /** Minimum Unix timestamp a reusable key must be valid through. */
  minExpiry?: number | undefined
  /** Minimum spending limits a reusable key must satisfy. */
  minLimits?: readonly KeyAuthorization.TokenLimit[] | undefined
}

/** Access key authorization parameters plus SDK-only reuse policy. */
export type ReusableAuthorization = Omit<prepareAuthorization.Options, 'chainId' | 'keystores'> & {
  /** Chain ID the key authorization is scoped to. */
  chainId?: bigint | number | undefined
  /** SDK-only reuse policy. Not sent over RPC. */
  reuse?: ReusePolicy | undefined
}

type ReusableQuery = {
  /** Root account address. */
  account: Address.Address
  /** Calls the access key must be able to sign. */
  calls?: readonly Call[] | undefined
  /** Chain ID the access key must be authorized on. */
  chainId: number
  /** Current Unix timestamp in seconds. Defaults to `Date.now() / 1000`. */
  now?: number | undefined
  /** Access key authorization parameters with optional reuse policy. */
  parameters: ReusableAuthorization
  /** Access-key manager options. */
  store: ManagerOptions
}

type CallsQuery = {
  /** Calls the authorization must be able to sign. */
  calls?: readonly Call[] | undefined
  /** Access key authorization parameters. */
  parameters: Pick<ReusableAuthorization, 'scopes'>
}

type ListQuery = {
  /** Root account address. */
  account: Address.Address
  /** Specific access key address to match. */
  accessKey?: Address.Address | undefined
  /** Chain ID the access key is scoped to. */
  chainId: number
  /** Access-key manager dependencies. */
  store: ManagerOptions
}

type ManagerOptions = {
  /** Keystores backing access-key records that carry an opaque `handle`. */
  keystores: Keystore.Keystores
  /** Zustand store containing access-key metadata. */
  state: Pick<StoreApi<Store.State>, 'getState' | 'setState'>
}

/** Access-key identity. */
type Key = {
  /** Root account address. */
  account: Address.Address
  /** Access key address. */
  accessKey: Address.Address
  /** Chain ID the access key is scoped to. */
  chainId: number
}

/** Store-bound access-key operations. */
type Manager = {
  /** Adds a signed access-key authorization. */
  add: (options: Omit<add.Options, 'store'>) => add.ReturnType
  /** Prepares, signs, and saves an access key authorization. */
  authorize: (options: Omit<authorize.Options, 'store'>) => Promise<authorize.ReturnType>
  /** Clears all access-key records. */
  clear: () => void
  /** Prepares an unsigned key authorization, creating key material via the keystore when needed. */
  prepareAuthorization: (
    options: Omit<prepareAuthorization.Options, 'keystore'>,
  ) => Promise<prepareAuthorization.ReturnType>
  /** Returns publication status for a stored or on-chain access key. */
  getStatus: (options: Omit<StatusQuery, 'store'>) => Promise<Status>
  /** Returns a locally-signable access key account by exact address. */
  get: (options: Omit<get.Options, 'store'>) => Promise<get.ReturnType>
  /** Returns access-key metadata matching a query. */
  list: (options: Omit<ListQuery, 'store'>) => readonly AccessKey[]
  /** Removes an access-key record. */
  remove: (options: Omit<remove.Options, 'store'>) => void
  /** Selects a locally-signable access key account for an intent. */
  select: (
    options: Omit<SelectQuery, 'store'>,
  ) => Promise<TempoAccount.AccessKeyAccount | undefined>
  /** Updates stored authorization metadata for an existing access key. */
  updateAuthorization: (options: Omit<updateAuthorization.Options, 'store'>) => void
}

/** Creates store-bound access-key operations. */
export function createManager(options: createManager.Options): Manager {
  return {
    add: (parameters) => add({ ...parameters, store: options }),
    authorize: (parameters) => authorize({ ...parameters, store: options }),
    clear: () => clear({ store: options }),
    get: (parameters) => get({ ...parameters, store: options }),
    prepareAuthorization: (parameters) =>
      prepareAuthorization({ ...parameters, keystores: options.keystores }),
    getStatus: (parameters) => getStatus({ ...parameters, store: options }),
    list: (parameters) => list({ ...parameters, store: options }),
    remove: (parameters) => remove({ ...parameters, store: options }),
    select: (parameters) => select({ ...parameters, store: options }),
    updateAuthorization: (parameters) => updateAuthorization({ ...parameters, store: options }),
  }
}

export declare namespace createManager {
  /** Options for {@link createManager}. */
  type Options = ManagerOptions
}

/** Prepares an unsigned key authorization and local key material when needed. */
export async function prepareAuthorization(
  options: prepareAuthorization.Options,
): Promise<prepareAuthorization.ReturnType> {
  const {
    account,
    address,
    chainId,
    expiry,
    isAdmin,
    keystores,
    keyType,
    limits,
    privateKey,
    publicKey,
    scopes,
    witness,
  } = options
  const accountOptions = getAccountOptions({ account, isAdmin })

  if (privateKey) {
    const type = keyType ?? 'secp256k1'
    const accessKey = (() => {
      switch (type) {
        case 'secp256k1':
          return TempoAccount.fromSecp256k1(privateKey)
        case 'p256':
          return TempoAccount.fromP256(privateKey)
        case 'webAuthn':
          throw new RpcResponse.InvalidParamsError({
            message: '`privateKey` cannot be used with `keyType: "webAuthn"`.',
          })
      }
    })()
    const keyAuthorization = KeyAuthorization.from({
      address: accessKey.address,
      chainId: BigInt(chainId),
      expiry,
      ...accountOptions,
      limits,
      scopes,
      type,
      ...(witness ? { witness } : {}),
    })
    return { keyAuthorization, privateKey }
  }

  if (address || publicKey) {
    const keyAuthorization = KeyAuthorization.from({
      address: address ?? Address.fromPublicKey(PublicKey.from(publicKey!)),
      chainId: BigInt(chainId),
      expiry,
      ...accountOptions,
      limits,
      scopes,
      type: keyType ?? 'secp256k1',
      ...(witness ? { witness } : {}),
    })
    return { keyAuthorization }
  }
  // p256 is the default key type everywhere (WebCrypto-backed where
  // available, safest); secp256k1 is opt-in via an explicit `keyType`.
  const keystores_ = keystores ?? Keystore.defaults
  const type = keyType ?? 'p256'
  const keystore = type === 'webAuthn' ? undefined : keystores_[type]
  if (!keystore)
    throw new RpcResponse.InvalidParamsError({
      message: `\`keyType: "${type}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
    })
  const key = await keystore.createKey()
  const keyAuthorization = KeyAuthorization.from({
    address: Address.fromPublicKey(PublicKey.fromHex(key.publicKey)),
    chainId: BigInt(chainId),
    expiry,
    ...accountOptions,
    limits,
    scopes,
    type,
    ...(witness ? { witness } : {}),
  })
  return { key: { handle: key.handle, publicKey: key.publicKey }, keyAuthorization }
}

function getAccountOptions(options: {
  account?: Address.Address | undefined
  isAdmin?: boolean | undefined
}) {
  const { account, isAdmin } = options
  if (isAdmin && !account)
    throw new RpcResponse.InvalidParamsError({ message: '`isAdmin` requires `account`.' })
  return account ? ({ account, isAdmin: isAdmin ?? false } as const) : {}
}

export declare namespace prepareAuthorization {
  /** Options for {@link prepareAuthorization}. */
  type Options = {
    /** Account this authorization targets. */
    account?: Address.Address | undefined
    /** External access key address. Alternative to `publicKey`. */
    address?: Address.Address | undefined
    /** Chain ID the key authorization is scoped to. */
    chainId: bigint | number
    /** Unix timestamp when the key expires. */
    expiry: number
    /** Whether this authorization grants admin key privileges. */
    isAdmin?: boolean | undefined
    /**
     * Keystores used to create key material when none is provided.
     * @default Keystore.defaults
     */
    keystores?: Keystore.Keystores | undefined
    /** External key type. Defaults to `secp256k1` for external keys. */
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    /** TIP-20 spending limits for this key. */
    limits?: readonly KeyAuthorization.TokenLimit[] | undefined
    /** Exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** External public key to derive the access key address from. */
    publicKey?: Hex.Hex | undefined
    /** Call scopes restricting which contracts/selectors this key can call. */
    scopes?: readonly KeyAuthorization.Scope[] | undefined
    /**
     * TIP-1053 witness (32 bytes) to bind into the key authorization. Set to
     * `hashMessage(message)` to fuse a Sign-In-with-Tempo proof into the
     * access-key authorization so both are covered by a single signature.
     */
    witness?: Hex.Hex | undefined
  }

  /** Prepared unsigned key authorization and optional local key material. */
  type ReturnType = {
    /** Keystore-created key material reference. */
    key?: { handle: Keystore.Handle; publicKey: Hex.Hex } | undefined
    /** Unsigned key authorization to sign with the root account. */
    keyAuthorization: KeyAuthorization.KeyAuthorization<false>
    /** Exported private key backing an external access key. */
    privateKey?: Hex.Hex | undefined
  }
}

/** Prepares, signs, and saves an access key authorization. */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { account, chainId, parameters } = options
  const { store } = options
  const prepared = await prepareAuthorization({
    ...parameters,
    ...(parameters.account || parameters.isAdmin || parameters.witness
      ? { account: parameters.account ?? account.address }
      : {}),
    chainId: parameters.chainId ?? chainId,
    keystores: store.keystores,
  })
  const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
  const signature = await account.sign({ hash: digest })
  const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
    signature: SignatureEnvelope.from(signature),
  })

  add({
    account: account.address,
    authorization: keyAuthorization,
    ...(prepared.key ? { handle: prepared.key.handle, publicKey: prepared.key.publicKey } : {}),
    ...(prepared.privateKey ? { privateKey: prepared.privateKey } : {}),
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
    parameters: Omit<prepareAuthorization.Options, 'chainId' | 'keystores'> & {
      /** Chain ID the key authorization is scoped to. */
      chainId?: bigint | number | undefined
    }
    /** Reactive state store. */
    store: ManagerOptions
  }

  /** Signed key authorization in RPC form. */
  type ReturnType = KeyAuthorization.Rpc
}

/** Returns whether a local access key satisfies reusable authorization parameters. */
export async function hasReusableAuthorization(options: ReusableQuery): Promise<boolean> {
  const { account, calls, chainId, parameters, store } = options
  const now = options.now ?? Date.now() / 1000
  const records = list({ account, chainId, store })

  for (const record of records) {
    if (isExpired(record.expiry, now)) continue
    if (!authorizationMatches(record, parameters)) continue
    if (calls && !recordScopesMatch(record, { calls })) continue
    if (!(await hydrate(record, store))) continue
    return true
  }
  return false
}

/** Returns whether an authorization request could sign the provided calls. */
export function canAuthorizeCalls(options: CallsQuery): boolean {
  return scopesMatch(options.parameters.scopes, { calls: options.calls })
}

/** Returns publication status for a stored or on-chain access key. */
export async function getStatus(options: StatusQuery): Promise<Status> {
  const { accessKey, account, calls, chainId, client } = options
  const { store } = options
  const now = options.now ?? Date.now() / 1000
  const local = list({ account, accessKey, chainId, store }).find((key) =>
    recordScopesMatch(key, { calls }),
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
    if (!recordScopesMatch(record, { calls })) continue
    if (isExpired(record.expiry, now)) {
      await remove({
        accessKey: record.address,
        account: record.access,
        chainId: record.chainId,
        store,
      })
      continue
    }

    const account_accessKey = await hydrate(record, store)
    if (!account_accessKey) continue

    return account_accessKey
  }
}

/** Returns a locally-signable access key account by exact address. */
export async function get(options: get.Options): Promise<get.ReturnType> {
  const { accessKey, account, chainId } = options
  const { store } = options
  const now = options.now ?? Date.now() / 1000
  const record = list({ account, accessKey, chainId, store })[0]
  if (!record) return undefined
  if (isExpired(record.expiry, now)) {
    await remove({
      accessKey: record.address,
      account: record.access,
      chainId: record.chainId,
      store,
    })
    return undefined
  }
  return await hydrate(record, store)
}

export declare namespace get {
  type Options = {
    /** Root account address. */
    account: Address.Address
    /** Specific access key address to match. */
    accessKey: Address.Address
    /** Chain ID the access key must be authorized on. */
    chainId: number
    /** Current Unix timestamp in seconds. Defaults to `Date.now() / 1000`. */
    now?: number | undefined
    /** Reactive state store. */
    store: ManagerOptions
  }

  type ReturnType = TempoAccount.AccessKeyAccount | undefined
}

function createKeyAuthorizationManager(store: ManagerOptions) {
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
        updateAuthorization({
          account: key.address,
          accessKey: key.accessKey,
          authorization: keyAuthorization,
          chainId: key.chainId,
          store,
        })
      },
    },
  })
}

/** Adds a signed access key authorization. */
export function add(options: add.Options): add.ReturnType {
  const { account, authorization, handle, keyPair, privateKey, publicKey } = options
  const { store } = options
  const base = {
    address: authorization.address,
    access: account,
    chainId: Number(authorization.chainId),
    ...(authorization.account ? { account: authorization.account } : {}),
    ...(authorization.expiry !== undefined ? { expiry: authorization.expiry } : {}),
    keyAuthorization: authorization,
    keyType: authorization.type,
    ...(authorization.isAdmin !== undefined ? { isAdmin: authorization.isAdmin } : {}),
    limits: authorization.limits as AccessKey['limits'],
    scopes: authorization.scopes as AccessKey['scopes'],
    ...(authorization.witness ? { witness: authorization.witness } : {}),
  }
  const material = privateKey
    ? { privateKey }
    : keyPair
      ? { keyPair }
      : typeof handle !== 'undefined' && publicKey
        ? { handle, publicKey }
        : {}
  const record = { ...base, ...material } as AccessKey
  store.state.setState((state) => ({
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
    /** Opaque keystore handle backing the access key. Requires `publicKey`. */
    handle?: Keystore.Handle | undefined
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. */
    keyPair?: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Public key backing a keystore-managed access key. */
    publicKey?: Hex.Hex | undefined
    /** Reactive state store. */
    store: ManagerOptions
  }

  /** Stored access key record. */
  type ReturnType = AccessKey
}

function clearAuthorization(options: Key & { store: ManagerOptions }): void {
  const { store, ...key } = options
  patch({
    ...key,
    patch: { keyAuthorization: undefined },
    store,
  })
}

function updateAuthorization(options: updateAuthorization.Options): void {
  const { authorization, store, ...key } = options
  patch({
    ...key,
    patch: {
      account: authorization.account ?? undefined,
      expiry: authorization.expiry ?? undefined,
      isAdmin: authorization.isAdmin ?? undefined,
      keyAuthorization: authorization,
      limits: authorization.limits as AccessKey['limits'],
      scopes: authorization.scopes as AccessKey['scopes'],
      witness: authorization.witness ?? undefined,
    },
    store,
  })
}

declare namespace updateAuthorization {
  type Options = Key & {
    /** Signed key authorization for the access key. */
    authorization: KeyAuthorization.Signed
    /** Reactive state store. */
    store: ManagerOptions
  }
}

/** Removes an access key record. */
export function remove(options: remove.Options): void {
  const { store, ...key } = options
  store.state.setState((state) => ({
    accessKeys: state.accessKeys.filter((record) => !matches(record, key)),
  }))
}

export declare namespace remove {
  /** Options for {@link remove}. */
  type Options = Key & {
    /** Reactive state store. */
    store: ManagerOptions
  }
}

/** Clears all access-key records. */
function clear(options: { store: ManagerOptions }): void {
  const { store } = options
  store.state.setState({ accessKeys: [] })
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

function recordScopesMatch(
  key: AccessKey,
  options: {
    calls?: readonly Call[] | undefined
  },
): boolean {
  return scopesMatch(key.scopes, options)
}

function scopesMatch(
  scopes: readonly NonNullable<AccessKey['scopes']>[number][] | undefined,
  options: {
    calls?: readonly Call[] | undefined
  },
): boolean {
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
      const scopeSelector = normalizeSelector(selector)
      if (!scopeSelector || callSelector !== scopeSelector) return false
      if (!scope.recipients || scope.recipients.length === 0) return true
      if (!call.data || call.data.length < 74) return false
      const recipient = `0x${call.data.slice(34, 74)}` as Address.Address
      if (!Address.validate(recipient)) return false
      return scope.recipients.some((address) => address.toLowerCase() === recipient.toLowerCase())
    })
  })
}

function authorizationMatches(key: AccessKey, parameters: ReusableAuthorization): boolean {
  if (key.witness || parameters.witness) return false
  if (parameters.account) {
    if (!key.account) return false
    if (key.account.toLowerCase() !== parameters.account.toLowerCase()) return false
    if ((key.isAdmin ?? false) !== (parameters.isAdmin ?? false)) return false
  } else if (parameters.isAdmin || key.account) return false
  if (!scopesCover(key.scopes, parameters.scopes)) return false
  if (
    typeof parameters.reuse?.minExpiry === 'number' &&
    key.expiry &&
    key.expiry < parameters.reuse.minExpiry
  )
    return false
  if (!limitsCover(key.limits, parameters.reuse?.minLimits)) return false
  return true
}

function scopesCover(
  existing: AccessKey['scopes'],
  requested: ReusableAuthorization['scopes'],
): boolean {
  if (!requested) return true
  if (!existing) return true
  return requested.every((scope) => existing.some((candidate) => scopeCovers(candidate, scope)))
}

function scopeCovers(
  existing: NonNullable<AccessKey['scopes']>[number],
  requested: NonNullable<ReusableAuthorization['scopes']>[number],
): boolean {
  if (!isScope(existing) || !isScope(requested)) return false
  if (existing.address.toLowerCase() !== requested.address.toLowerCase()) return false
  if (!selectorCovers(existing.selector, requested.selector)) return false
  return recipientsCover(existing.recipients, requested.recipients)
}

function selectorCovers(existing: string | undefined, requested: string | undefined): boolean {
  if (!existing) return true
  if (!requested) return false
  const selector_existing = normalizeSelector(existing)
  const selector_requested = normalizeSelector(requested)
  return !!selector_existing && selector_existing === selector_requested
}

function normalizeSelector(value: string): string | undefined {
  try {
    return (
      value.startsWith('0x') && value.length === 10 ? value : AbiFunction.getSelector(value)
    ).toLowerCase()
  } catch {
    return undefined
  }
}

function recipientsCover(
  existing: readonly Address.Address[] | undefined,
  requested: readonly Address.Address[] | undefined,
): boolean {
  if (!existing || existing.length === 0) return true
  if (!requested || requested.length === 0) return false
  return requested.every((address) =>
    existing.some((candidate) => candidate.toLowerCase() === address.toLowerCase()),
  )
}

function limitsCover(
  existing: AccessKey['limits'],
  requested: readonly KeyAuthorization.TokenLimit[] | undefined,
): boolean {
  if (!requested) return true
  if (!existing) return true
  return requested.every((limit) =>
    existing.some(
      (candidate) =>
        candidate.token.toLowerCase() === limit.token.toLowerCase() &&
        Number(candidate.period ?? 0) === Number(limit.period ?? 0) &&
        BigInt(candidate.limit) >= BigInt(limit.limit),
    ),
  )
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

/** Keystore accounts hydrated this launch, keyed by record identity. */
const keystoreAccounts = new WeakMap<object, Promise<TempoAccount.AccessKeyAccount>>()

async function hydrate(
  accessKey: AccessKey,
  store: ManagerOptions,
): Promise<TempoAccount.AccessKeyAccount | undefined> {
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
  if ('handle' in accessKey && typeof accessKey.handle !== 'undefined' && accessKey.publicKey) {
    const keystore =
      accessKey.keyType === 'p256' || accessKey.keyType === 'secp256k1'
        ? store.keystores[accessKey.keyType]
        : undefined
    if (!keystore) return undefined
    let account = keystoreAccounts.get(accessKey)
    if (!account) {
      account = (async () =>
        await keystore.toAccount(
          {
            handle: accessKey.handle,
            keyType: accessKey.keyType,
            publicKey: accessKey.publicKey!,
          },
          { access: accessKey.access, keyAuthorizationManager },
        ))()
      keystoreAccounts.set(accessKey, account)
    }
    try {
      return await account
    } catch (error) {
      // The backend cannot materialize this key right now — treat the record
      // as unusable so callers fall back to re-authorization. Uncached so
      // transient failures (e.g. device locked) can retry; keystore-signaled
      // permanent loss (e.g. hardware key deleted) evicts the record.
      keystoreAccounts.delete(accessKey)
      if (Keystore.isKeyUnavailableError(error))
        remove({
          accessKey: accessKey.address,
          account: accessKey.access,
          chainId: accessKey.chainId,
          store,
        })
      return undefined
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
  return store.state.getState().accessKeys.filter((key) => matches(key, query))
}

function patch(options: Key & { patch: Partial<AccessKey>; store: ManagerOptions }): void {
  const { patch, store, ...key } = options
  store.state.setState((state) => ({
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
