import { Address, Hex } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { Client, Transport } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import type { PrepareTransactionRequestReturnType } from 'viem/actions'
import type { Transaction as TempoTransaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import * as ExecutionError from '../ExecutionError.js'
import type * as Store from '../Store.js'
import type * as Rpc from '../zod/rpc.js'

type Call = {
  to?: Address.Address | undefined
  data?: Hex.Hex | undefined
}

type Selection = NonNullable<Awaited<ReturnType<typeof AccessKey.select>>>

const removalErrorNames = new Set([
  'InvalidSignature',
  'InvalidSignatureFormat',
  'InvalidSignatureType',
  'KeyAlreadyRevoked',
  'KeyExpired',
  'KeyNotFound',
  'SignatureTypeMismatch',
])

/** Creates a lifecycle-aware access-key transaction when a matching key is available. */
export async function create(options: create.Options): Promise<create.ReturnType> {
  const { address, calls, chainId, client, store } = options
  const selection = await AccessKey.select({
    account: address,
    calls,
    chainId,
    client,
    store,
  })
  if (!selection) return undefined
  return createTransaction({ client, selection, store })
}

export declare namespace create {
  /** Options for {@link create}. */
  type Options = {
    /** Root account address. */
    address: Address.Address
    /** Calls to match against access key scopes. */
    calls?: readonly Call[] | undefined
    /** Chain ID the access key must be authorized on. */
    chainId: number
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

function createTransaction(options: {
  client: Client<Transport>
  selection: Selection
  store: Store.Store
}): create.Transaction {
  const { client, selection, store } = options
  return {
    async fill(parameters) {
      try {
        return await fillTransaction(client, {
          ...parameters,
          ...(!parameters.keyAuthorization && selection.authorization
            ? {
                keyAuthorization: {
                  address: selection.authorization.address,
                  ...KeyAuthorization.toRpc(selection.authorization),
                } as never,
              }
            : {}),
        } as never)
      } catch (error) {
        removeForError(error, selection, { store })
        throw error
      }
    },
    async prepare(parameters) {
      try {
        const request = await prepareTransactionRequest(client, {
          account: selection.account,
          ...parameters,
          ...(selection.authorization ? { keyAuthorization: selection.authorization } : {}),
          type: 'tempo',
        } as never)
        return createPreparedTransaction({
          client,
          request: request as never,
          selection,
          store,
        })
      } catch (error) {
        removeForError(error, selection, { store })
        throw error
      }
    },
  }
}

function createPreparedTransaction(options: {
  client: Client<Transport>
  request: create.PreparedRequest
  selection: Selection
  store: Store.Store
}): create.Prepared {
  const { client, request, selection, store } = options

  async function sign() {
    try {
      const signed = await selection.account.signTransaction(request as never)
      if (selection.authorization)
        AccessKey.markPending({
          accessKey: selection.accessKey,
          account: selection.record.access,
          chainId: selection.record.chainId,
          store,
        })
      return signed
    } catch (error) {
      removeForError(error, selection, { store })
      throw error
    }
  }

  return {
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
        removeForError(error, selection, { store })
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
        AccessKey.markPublished({
          accessKey: selection.accessKey,
          account: selection.record.access,
          chainId: selection.record.chainId,
          store,
        })
        return result as create.SendSyncReturnType
      } catch (error) {
        removeForError(error, selection, { store })
        throw error
      }
    },
  }
}

async function fillTransaction(
  client: Client<Transport>,
  parameters: create.FillParameters,
): Promise<create.FillReturnType> {
  const { keyAuthorization, ...rest } = parameters as create.FillParameters & {
    keyAuthorization?: unknown
  }
  const formatter = client.chain?.formatters?.transactionRequest
  const formatted = formatter ? formatter.format({ ...rest } as never, 'fillTransaction') : rest
  return (await client.request({
    method: 'eth_fillTransaction' as never,
    params: [{ ...formatted, ...(keyAuthorization ? { keyAuthorization } : {}) } as never],
  })) as create.FillReturnType
}

function removeForError(
  error: unknown,
  selection: Selection,
  options: { store: Store.Store },
): void {
  if (!shouldRemoveForError(error)) return
  AccessKey.remove({
    accessKey: selection.accessKey,
    account: selection.record.access,
    chainId: selection.record.chainId,
    store: options.store,
  })
}

function shouldRemoveForError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const parsed = ExecutionError.parse(error)
  return removalErrorNames.has(parsed.errorName)
}
