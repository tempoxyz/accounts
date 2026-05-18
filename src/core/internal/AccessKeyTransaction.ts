import { AbiFunction, Address, Hex, Provider } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { Client, Transport } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import type { PrepareTransactionRequestReturnType } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'
import type { Transaction as TempoTransaction } from 'viem/tempo'

import type { Status } from '../AccessKey.js'
import * as ExecutionError from '../ExecutionError.js'
import type * as Store from '../Store.js'
import type * as Rpc from '../zod/rpc.js'
import * as AccessKeyStore from './AccessKeyStore.js'

type AccessKey = Store.AccessKey

const removalErrorNames = new Set([
  'InvalidSignature',
  'InvalidSignatureFormat',
  'InvalidSignatureType',
  'KeyAlreadyRevoked',
  'KeyExpired',
  'KeyNotFound',
  'SignatureTypeMismatch',
])

const status = {
  missing: 'missing',
  pending: 'pending',
  published: 'published',
  expired: 'expired',
} as const satisfies Record<string, Status>

/** Synchronously selects and hydrates a locally-signable access key account for a root account. */
export function selectAccountSync(
  options: selectAccountSync.Options,
): TempoAccount.AccessKeyAccount | undefined {
  const { address, calls, chainId, store } = options
  const keys = AccessKeyStore.list({ address, chainId, store })
  for (const key of keys) {
    if (!scopesMatch(key, { calls })) continue
    if (!hasLocalKey(key)) continue

    if (isExpired(key.expiry, Date.now() / 1000)) {
      AccessKeyStore.remove({ accessKey: key.address, store })
      continue
    }

    return hydrate(key) as TempoAccount.AccessKeyAccount
  }
  return undefined
}

export declare namespace selectAccountSync {
  /** Options for {@link selectAccountSync}. */
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

/** Creates a lifecycle-aware access-key transaction when a matching key is available. */
export async function create(options: create.Options): Promise<create.ReturnType> {
  const { address, calls, chainId, client, store } = options
  if (!address || typeof chainId === 'undefined') return undefined
  const account = selectAccountSync({ address, calls, chainId, store })
  if (!account) return undefined

  const keyAuthorization = await getPendingAuthorization(account, { client, store })
  return createTransaction({ account, client, keyAuthorization, store })
}

export declare namespace create {
  /** Options for {@link create}. */
  type Options = {
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

  /** Lifecycle-aware access-key transaction. */
  type Transaction = {
    /** Fills a transaction, attaching a pending key authorization when needed. */
    fill(parameters: FillParameters): Promise<FillReturnType>
    /** Prepares a transaction, attaching a pending key authorization when needed. */
    prepare(parameters: PrepareParameters): Promise<Prepared>
  }

  /** Lifecycle-aware access-key transaction, if one is available. */
  type ReturnType = Transaction | undefined
}

/** Returns publication status for a stored or on-chain access key. */
export async function getStatus(options: getStatus.Options): Promise<getStatus.ReturnType> {
  const { accessKey, address, calls, chainId, client, store } = options
  const now = options.now ?? Date.now() / 1000
  const local = AccessKeyStore.list({ accessKey, address, chainId, store }).find((key) =>
    scopesMatch(key, { calls }),
  )

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

async function getPendingAuthorization(
  account: TempoAccount.AccessKeyAccount,
  options: {
    client?: Client<Transport> | undefined
    store: Store.Store
  },
): Promise<KeyAuthorization.Signed | undefined> {
  const { client, store } = options
  const entry = AccessKeyStore.get({ accessKey: account.accessKeyAddress, store })
  const keyAuthorization = entry?.keyAuthorization
  if (!entry || !keyAuthorization) return undefined
  if (!entry.keyAuthorizationPending || !client) return keyAuthorization

  const publicationStatus = await getPublishedStatus(client, {
    accessKey: entry.address,
    address: entry.access,
    now: Date.now() / 1000,
  }).catch(() => status.pending)
  if (publicationStatus === status.published) {
    AccessKeyStore.removePending({ accessKey: account.accessKeyAddress, store })
    return undefined
  }

  return keyAuthorization
}

function createTransaction(options: {
  account: TempoAccount.AccessKeyAccount
  client: Client<Transport>
  keyAuthorization?: KeyAuthorization.Signed | undefined
  store: Store.Store
}): create.Transaction {
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
  request: create.PreparedRequest
  store: Store.Store
}): create.Prepared {
  const { account, client, keyAuthorization, request, store } = options

  async function sign() {
    try {
      const signed = await account.signTransaction(request as never)
      AccessKeyStore.markPending({ accessKey: account.accessKeyAddress, store })
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
        AccessKeyStore.removePending({ accessKey: account.accessKeyAddress, store })
        return result as create.SendSyncReturnType
      } catch (error) {
        invalidate(account, error, { store })
        throw error
      }
    },
  }
}

async function fillTransaction(
  client: Client<Transport>,
  parameters: create.FillParameters,
): Promise<create.FillReturnType> {
  const formatter = client.chain?.formatters?.transactionRequest
  const formatted =
    formatter && !parameters.keyAuthorization
      ? formatter.format({ ...parameters } as never, 'fillTransaction')
      : parameters
  return (await client.request({
    method: 'eth_fillTransaction' as never,
    params: [formatted as never],
  })) as create.FillReturnType
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

function invalidate(
  account: TempoAccount.AccessKeyAccount,
  error: unknown,
  options: { store: Store.Store },
): void {
  if (!shouldRemoveForError(error)) return
  AccessKeyStore.remove({ accessKey: account.accessKeyAddress, store: options.store })
}

function hasLocalKey(accessKey: AccessKey): boolean {
  return (
    ('keyPair' in accessKey && !!accessKey.keyPair) ||
    ('privateKey' in accessKey && !!accessKey.privateKey)
  )
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

function shouldRemoveForError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const parsed = ExecutionError.parse(error)
  return removalErrorNames.has(parsed.errorName)
}
