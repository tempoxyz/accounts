import { AbiFunction, Address, Hex, Provider, PublicKey, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import type { Client, Transport } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import type { PrepareTransactionRequestReturnType } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'
import type { Transaction as TempoTransaction } from 'viem/tempo'

import type { OneOf } from '../internal/types.js'
import * as ExecutionError from './ExecutionError.js'
import type * as Store from './Store.js'
import type * as Rpc from './zod/rpc.js'

const removalErrorNames = new Set([
  'InvalidSignature',
  'InvalidSignatureFormat',
  'InvalidSignatureType',
  'KeyAlreadyRevoked',
  'KeyExpired',
  'KeyNotFound',
  'SignatureTypeMismatch',
])

/** Access-key publication states. */
export const status = {
  /** No matching usable access key was found. */
  missing: 'missing',
  /** A matching key exists locally and still needs its first transaction to publish the authorization. */
  pending: 'pending',
  /** A matching key exists on-chain and can be used. */
  published: 'published',
  /** A matching key exists but is past its expiry. */
  expired: 'expired',
} as const

/** Publication state for an access key. */
export type Status = (typeof status)[keyof typeof status]

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
  /** Signed key authorization to attach until the key is observed on-chain. */
  keyAuthorization?: KeyAuthorization.Signed | undefined
  /** Whether the key authorization is pending confirmation on-chain. */
  keyAuthorizationPending?: boolean | undefined
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

async function getPendingAuthorization(
  account: TempoAccount.Account,
  options: {
    client?: Client<Transport> | undefined
    store: Store.Store
  },
): Promise<KeyAuthorization.Signed | undefined> {
  const { client, store } = options
  const entry = getEntry(account, { store })
  const keyAuthorization = entry?.keyAuthorization
  if (!entry || !keyAuthorization) return undefined
  if (!entry.keyAuthorizationPending || !client) return keyAuthorization

  const publicationStatus = await getPublishedStatus(client, {
    accessKey: entry.address,
    address: entry.access,
    now: Date.now() / 1000,
  }).catch(() => status.pending)
  if (publicationStatus === status.published) {
    removePending(account, { store })
    return undefined
  }

  return keyAuthorization
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

/** Saves a prepared access key authorization with an existing signature. */
export function saveAuthorization(
  options: saveAuthorization.Options,
): saveAuthorization.ReturnType {
  const { address, prepared, signature, store } = options
  const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
    signature: SignatureEnvelope.from(signature),
  })

  savePending({
    address,
    keyAuthorization,
    ...(prepared.keyPair ? { keyPair: prepared.keyPair } : {}),
    store,
  })

  return KeyAuthorization.toRpc(keyAuthorization)
}

export declare namespace saveAuthorization {
  /** Options for {@link saveAuthorization}. */
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Prepared unsigned key authorization returned by {@link prepareAuthorization}. */
    prepared: prepareAuthorization.ReturnType
    /** Signature over the key authorization digest. */
    signature: Hex.Hex
    /** Reactive state store. */
    store: Store.Store
  }

  /** Signed key authorization in RPC form. */
  type ReturnType = KeyAuthorization.Rpc
}

/** Prepares, signs, and saves an access key authorization. */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { account, chainId, parameters, store } = options
  const prepared = await prepareAuthorization({
    ...parameters,
    chainId: parameters.chainId ?? chainId,
  })
  return await signAuthorization({ account, prepared, store })
}

export declare namespace authorize {
  /** Options for {@link authorize}. */
  type Options = {
    /** Root account that owns this access key and signs its authorization. */
    account: TempoAccount.Account
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

async function signAuthorization(
  options: signAuthorization.Options,
): Promise<signAuthorization.ReturnType> {
  const { account, prepared, store } = options
  const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
  const signature = await account.sign({ hash: digest })
  return saveAuthorization({ address: account.address, prepared, signature, store })
}

declare namespace signAuthorization {
  type Options = {
    account: TempoAccount.Account
    prepared: prepareAuthorization.ReturnType
    store: Store.Store
  }

  type ReturnType = KeyAuthorization.Rpc
}

function hydrate(accessKey: AccessKey): TempoAccount.Account {
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
function remove(account: TempoAccount.Account, options: { store: Store.Store }): void {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = account.accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.filter(
      (a) => a.address?.toLowerCase() !== accessKeyAddress?.toLowerCase(),
    ),
  }))
}

/** Invalidates a stored access key when the error proves it is no longer usable. */
function invalidate(
  account: TempoAccount.Account,
  error: unknown,
  options: { store: Store.Store },
): void {
  if (account.source !== 'accessKey') return
  if (!shouldRemoveForError(error)) return
  remove(account, options)
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
        ? { ...a, keyAuthorization: undefined, keyAuthorizationPending: undefined }
        : a,
    ),
  }))
}

/** Marks a key authorization as pending confirmation on-chain. */
function markKeyAuthorizationPending(
  account: TempoAccount.Account,
  options: { store: Store.Store },
): void {
  if (account.source !== 'accessKey') return
  const { store } = options
  const accessKeyAddress = (account as TempoAccount.AccessKeyAccount).accessKeyAddress
  store.setState((state) => ({
    accessKeys: state.accessKeys.map((a) =>
      a.address.toLowerCase() === accessKeyAddress.toLowerCase() && a.keyAuthorization
        ? { ...a, keyAuthorizationPending: true }
        : a,
    ),
  }))
}

/** Selects and hydrates a locally-signable access key account for a root account. */
export function selectAccount(
  options: selectAccount.Options,
): TempoAccount.AccessKeyAccount | undefined {
  const { address, calls, chainId, store } = options
  const { accessKeys } = store.getState()
  let accessKeys_next = accessKeys
  for (const key of accessKeys) {
    if (key.access.toLowerCase() !== address.toLowerCase()) continue
    if (key.chainId !== chainId) continue
    if (!('keyPair' in key && !!key.keyPair) && !('privateKey' in key && !!key.privateKey)) continue

    if (key.expiry && key.expiry < Date.now() / 1000) {
      accessKeys_next = accessKeys_next.filter((a) => a !== key)
      store.setState({ accessKeys: accessKeys_next })
      continue
    }

    if (scopesMatch(key, { calls })) return hydrate(key) as TempoAccount.AccessKeyAccount
  }
  return undefined
}

export declare namespace selectAccount {
  /** Options for {@link selectAccount}. */
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    /** Chain ID the access key must be authorized on. */
    chainId: number
    /** Reactive state store. */
    store: Store.Store
  }
}

/** Selects a locally-signable access key transaction attempt. */
export async function selectForTransaction(
  options: selectForTransaction.Options,
): Promise<selectForTransaction.ReturnType> {
  const { account: account_option, address, calls, chainId, client, store } = options
  const account = (() => {
    if (account_option) {
      if (account_option.source !== 'accessKey') return undefined
      return account_option as TempoAccount.AccessKeyAccount
    }
    if (!address || typeof chainId === 'undefined') return undefined
    return selectAccount({ address, calls, chainId, store })
  })()
  if (!account) return undefined

  const keyAuthorization = await getPendingAuthorization(account, { client, store })
  return createTransactionAttempt({ account, client, keyAuthorization, store })
}

export declare namespace selectForTransaction {
  /** Options for {@link selectForTransaction}. */
  type Options = {
    /** Already selected account. When provided, address/calls/chainId selection is skipped. */
    account?: TempoAccount.Account | undefined
    /** Root account address. */
    address?: Address.Address | undefined
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    /** Chain ID the access key must be authorized on. */
    chainId?: number | undefined
    /** Client used to prepare, submit, and check access-key transactions. */
    client: Client<Transport>
    /** Reactive state store. */
    store: Store.Store
  }

  /** Parameters accepted when preparing an access-key transaction. */
  type PrepareParameters = Omit<
    TempoTransaction.TransactionRequestTempo,
    'account' | 'keyAuthorization' | 'type'
  >

  /** Prepared transaction request returned by viem. */
  type PreparedRequest = PrepareTransactionRequestReturnType

  /** Parameters accepted by `eth_fillTransaction`. */
  type FillParameters = Rpc.eth_fillTransaction.Decoded['params'][0]

  /** Result returned by `eth_fillTransaction`. */
  type FillReturnType = Rpc.eth_fillTransaction.Encoded['returns']

  /** Result returned by `eth_sendTransactionSync`. */
  type SendSyncReturnType = Rpc.eth_sendTransactionSync.Encoded['returns']

  /** Prepared access-key transaction with lifecycle-aware execution methods. */
  type Prepared = {
    /** Pending key authorization attached to this transaction, if any. */
    keyAuthorization?: KeyAuthorization.Signed | undefined
    /** Prepared request that will be signed by the selected access key. */
    request: PreparedRequest
    /** Signs the prepared transaction and marks an attached authorization as pending. */
    sign(): Promise<Hex.Hex>
    /** Signs and submits the transaction asynchronously. */
    send(): Promise<Hex.Hex>
    /** Signs, submits, and waits for the transaction to be accepted. */
    sendSync(): Promise<SendSyncReturnType>
  }

  /** Access-key transaction attempt selected for a root account. */
  type Attempt = {
    /** Fills a transaction, attaching a pending key authorization when needed. */
    fill(parameters: FillParameters): Promise<FillReturnType>
    /** Prepares a transaction, attaching a pending key authorization when needed. */
    prepare(parameters: PrepareParameters): Promise<Prepared>
  }

  /** Selected access-key transaction attempt. */
  type ReturnType = Attempt | undefined
}

function createTransactionAttempt(options: {
  account: TempoAccount.AccessKeyAccount
  client: Client<Transport>
  keyAuthorization?: KeyAuthorization.Signed | undefined
  store: Store.Store
}): selectForTransaction.Attempt {
  const { account, client, keyAuthorization, store } = options
  return {
    async fill(parameters) {
      try {
        return await fillTransaction(client, {
          ...parameters,
          ...(!parameters.keyAuthorization && keyAuthorization
            ? {
                keyAuthorization: {
                  address: keyAuthorization.address,
                  ...KeyAuthorization.toRpc(keyAuthorization),
                } as never,
              }
            : {}),
        } as never)
      } catch (error) {
        invalidate(account, error, { store })
        throw error
      }
    },
    async prepare(parameters) {
      try {
        const request = await prepareTransactionRequest(client, {
          account,
          ...parameters,
          ...(keyAuthorization ? { keyAuthorization } : {}),
          type: 'tempo',
        } as never)
        return createPreparedTransaction({
          account,
          client,
          keyAuthorization,
          request: request as never,
          store,
        })
      } catch (error) {
        invalidate(account, error, { store })
        throw error
      }
    },
  }
}

function createPreparedTransaction(options: {
  account: TempoAccount.AccessKeyAccount
  client: Client<Transport>
  keyAuthorization?: KeyAuthorization.Signed | undefined
  request: selectForTransaction.PreparedRequest
  store: Store.Store
}): selectForTransaction.Prepared {
  const { account, client, keyAuthorization, request, store } = options

  async function sign() {
    try {
      const signed = await account.signTransaction(request as never)
      markKeyAuthorizationPending(account, { store })
      return signed
    } catch (error) {
      invalidate(account, error, { store })
      throw error
    }
  }

  return {
    ...(keyAuthorization ? { keyAuthorization } : {}),
    request,
    sign,
    async send() {
      try {
        const signed = await sign()
        return (await client.request({
          method: 'eth_sendRawTransaction' as never,
          params: [signed],
        })) as Hex.Hex
      } catch (error) {
        invalidate(account, error, { store })
        throw error
      }
    },
    async sendSync() {
      try {
        const signed = await sign()
        const result = await client.request({
          method: 'eth_sendRawTransactionSync' as never,
          params: [signed],
        })
        removePending(account, { store })
        return result as selectForTransaction.SendSyncReturnType
      } catch (error) {
        invalidate(account, error, { store })
        throw error
      }
    },
  }
}

async function fillTransaction(
  client: Client<Transport>,
  parameters: selectForTransaction.FillParameters,
): Promise<selectForTransaction.FillReturnType> {
  const formatter = client.chain?.formatters?.transactionRequest
  const formatted =
    formatter && !parameters.keyAuthorization
      ? formatter.format({ ...parameters } as never, 'fillTransaction')
      : parameters
  return (await client.request({
    method: 'eth_fillTransaction' as never,
    params: [formatted as never],
  })) as selectForTransaction.FillReturnType
}

/** Returns publication status for a stored or on-chain access key. */
export async function getStatus(options: getStatus.Options): Promise<getStatus.ReturnType> {
  const { accessKey, address, calls, chainId, client, store } = options
  const now = options.now ?? Date.now() / 1000
  const local = store
    .getState()
    .accessKeys.find((key) => matches(key, { accessKey, address, calls, chainId }))

  if (local) {
    if (isExpired(local.expiry, now)) return status.expired
    if (local.keyAuthorization) {
      if (local.keyAuthorizationPending && client) {
        const publicationStatus = await getPublishedStatus(client, {
          accessKey: local.address,
          address,
          now,
        }).catch(() => status.pending)
        if (publicationStatus === status.published) return status.published
      }
      return status.pending
    }
    if (client) return await getPublishedStatus(client, { accessKey: local.address, address, now })
    return status.published
  }

  if (accessKey && client) return await getPublishedStatus(client, { accessKey, address, now })
  return status.missing
}

export declare namespace getStatus {
  /** Options for {@link getStatus}. */
  type Options = {
    /** Root account address that owns the access key. */
    address: Address.Address
    /** Specific access key address to query. When omitted, the first locally matching key is used. */
    accessKey?: Address.Address | undefined
    /** Calls to match against access key scopes. */
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    /** Chain ID the access key must be authorized on. */
    chainId: number
    /** Client used to verify published state on-chain. */
    client?: Client<Transport> | undefined
    /** Current Unix timestamp in seconds. Defaults to `Date.now() / 1000`. */
    now?: number | undefined
    /** Reactive state store. */
    store: Store.Store
  }

  /** Access-key publication status. */
  type ReturnType = Status
}

function scopesMatch(
  key: AccessKey,
  options: {
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
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
      if (!scope.selector) return scope.recipients ? scope.recipients.length === 0 : true
      const scopeSelector = getSelector(scope.selector)
      if (!scopeSelector || callSelector !== scopeSelector) return false
      return recipientsMatch(scope.recipients, call.data)
    })
  })
}

function matches(
  key: AccessKey,
  options: {
    accessKey?: Address.Address | undefined
    address: Address.Address
    calls?: readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[] | undefined
    chainId: number
  },
): boolean {
  const { accessKey, address, calls, chainId } = options
  if (key.access.toLowerCase() !== address.toLowerCase()) return false
  if (key.chainId !== chainId) return false
  if (accessKey && key.address.toLowerCase() !== accessKey.toLowerCase()) return false
  return scopesMatch(key, { calls })
}

function getEntry(
  account: TempoAccount.Account,
  options: { store: Store.Store },
): AccessKey | undefined {
  if (account.source !== 'accessKey') return undefined
  const accessKeyAddress = (account as TempoAccount.AccessKeyAccount).accessKeyAddress
  return options.store
    .getState()
    .accessKeys.find((a) => a.address.toLowerCase() === accessKeyAddress.toLowerCase())
}

function isExpired(expiry: number | undefined, now: number): boolean {
  return typeof expiry === 'number' && expiry < now
}

async function getPublishedStatus(
  client: Client<Transport>,
  options: { accessKey: Address.Address; address: Address.Address; now: number },
): Promise<Status> {
  const { accessKey, address, now } = options
  try {
    const metadata = await Actions.accessKey.getMetadata(client, {
      account: address,
      accessKey,
    })
    if (metadata.isRevoked) return status.missing
    if (metadata.expiry > 0n && metadata.expiry < BigInt(Math.floor(now))) return status.expired
    return status.published
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const parsed = ExecutionError.parse(error)
    if (parsed.errorName === 'KeyNotFound' || parsed.errorName === 'KeyAlreadyRevoked')
      return status.missing
    throw error
  }
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

function getSelector(selector: string): string | undefined {
  try {
    return (
      selector.startsWith('0x') && selector.length === 10
        ? selector
        : AbiFunction.getSelector(selector)
    ).toLowerCase()
  } catch {
    return undefined
  }
}

function recipientsMatch(
  recipients: readonly Address.Address[] | undefined,
  data: Hex.Hex | undefined,
): boolean {
  if (!recipients || recipients.length === 0) return true
  const recipient = getCallRecipient(data)
  if (!recipient) return false
  return recipients.some((address) => address.toLowerCase() === recipient.toLowerCase())
}

function getCallRecipient(data: Hex.Hex | undefined): Address.Address | undefined {
  if (!data || data.length < 74) return undefined
  const recipient = `0x${data.slice(34, 74)}` as Address.Address
  if (!Address.validate(recipient)) return undefined
  return recipient
}

function shouldRemoveForError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const parsed = ExecutionError.parse(error)
  return removalErrorNames.has(parsed.errorName)
}

/** Saves an access key authorization that still needs to be included on-chain. */
export function savePending(options: savePending.Options): void {
  saveAccessKey({ ...options, pending: true })
}

export declare namespace savePending {
  type Options = saveAccessKey.Options & {
    /** Whether the authorization may already be in a signed transaction. */
    keyAuthorizationPending?: boolean | undefined
  }
}

/** Saves an access key that is already authorized on-chain. */
export function saveAuthorized(options: saveAuthorized.Options): void {
  saveAccessKey({ ...options, pending: false })
}

export declare namespace saveAuthorized {
  type Options = Omit<saveAccessKey.Options, 'keyAuthorizationPending'>
}

function saveAccessKey(options: saveAccessKey.Options & { pending: boolean }): void {
  const {
    address,
    keyAuthorization,
    keyAuthorizationPending,
    keyPair,
    pending,
    privateKey,
    store,
  } = options

  const base = {
    address: keyAuthorization.address,
    access: address,
    chainId: Number(keyAuthorization.chainId),
    expiry: keyAuthorization.expiry ?? undefined,
    ...(pending ? { keyAuthorization } : {}),
    ...(keyAuthorizationPending ? { keyAuthorizationPending } : {}),
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

declare namespace saveAccessKey {
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Signed key authorization for deriving and storing access-key metadata. */
    keyAuthorization: KeyAuthorization.Signed
    /** Whether the authorization may already be in a signed transaction. */
    keyAuthorizationPending?: boolean | undefined
    /** The exported private key backing the access key. */
    privateKey?: Hex.Hex | undefined
    /** The WebCrypto key pair backing the access key. Only present for locally-generated keys. */
    keyPair?: Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
    /** Reactive state store. */
    store: Store.Store
  }
}
