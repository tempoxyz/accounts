import { Address, Hex } from 'ox'
import {
  BaseError,
  type Client,
  HttpRequestError,
  SocketClosedError,
  TimeoutError,
  type Transport,
  WebSocketRequestError,
} from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import type { PrepareTransactionRequestReturnType } from 'viem/actions'
import type { Account as TempoAccount, Transaction as TempoTransaction } from 'viem/tempo'

import * as ExecutionError from '../ExecutionError.js'
import type * as Store from '../Store.js'
import type * as Rpc from '../zod/rpc.js'

type Call = {
  to?: Address.Address | undefined
  data?: Hex.Hex | undefined
}

const removalErrorNames = new Set([
  'InvalidSignature',
  'InvalidSignatureFormat',
  'InvalidSignatureType',
  'KeyAlreadyRevoked',
  'KeyExpired',
  'KeyNotFound',
  'SignatureTypeMismatch',
])

// Errors thrown while submitting a signed transaction.
const submitted = new WeakSet<object>()

/**
 * Whether an error came from submitting a signed transaction in a way that may
 * still land it: a timeout or a lost response, as opposed to the node refusing
 * it. Signing the same calls again with another key could then send them twice.
 */
export function maybeSubmitted(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !submitted.has(error)) return false
  if (!(error instanceof BaseError)) return true
  return !!error.walk(
    (e) =>
      // No response, or one that doesn't say the request was refused: a lost
      // connection, a timeout or a gateway error. A 429 can answer a retry of
      // an attempt that landed. Other 4xx responses refused it.
      (e instanceof HttpRequestError &&
        (e.status === undefined || e.status === 408 || e.status === 429 || e.status >= 500)) ||
      e instanceof SocketClosedError ||
      e instanceof TimeoutError ||
      e instanceof WebSocketRequestError ||
      // EIP-7966: added to the mempool, but not included within the timeout.
      (e as { code?: unknown }).code === 4 ||
      // A retry the node rejected as a duplicate that couldn't be confirmed
      // (see `Client`'s raw transaction transport): an earlier attempt may
      // have landed.
      /already known|known transaction|nonce too low|already imported/i.test((e as Error).message),
  )
}

/** Creates a transaction helper for a matching locally-signable access key. */
export async function create(options: create.Options): Promise<create.ReturnType> {
  const { address, calls, chainId, client, store } = options
  const account = await store.accessKeys.select({
    account: address,
    calls,
    chainId,
  })
  if (!account) return undefined
  return createTransaction({ account, address, chainId, client, store })
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

  /** Prepared access-key transaction with execution methods. */
  type Prepared = {
    /** Prepared request that will be signed by the selected access key. */
    request: PreparedRequest
    /** Signs the prepared transaction. */
    sign(): Promise<Hex.Hex>
    /** Signs and submits the transaction asynchronously. */
    send(): Promise<Hex.Hex>
    /** Signs, submits, and waits for the transaction to be accepted. */
    sendSync(): Promise<SendSyncReturnType>
  }

  /** Access-key transaction helper. */
  type Transaction = {
    /** Fills a transaction through the selected access key account. */
    fill(parameters: FillParameters): Promise<FillReturnType>
    /** Prepares a transaction through the selected access key account. */
    prepare(parameters: PrepareParameters): Promise<Prepared>
  }

  /** Access-key transaction helper, if one is available. */
  type ReturnType = Transaction | undefined
}

function createTransaction(options: {
  account: TempoAccount.AccessKeyAccount
  address: Address.Address
  chainId: number
  client: Client<Transport>
  store: Store.Store
}): create.Transaction {
  const { account, address, chainId, client, store } = options
  return {
    async fill(parameters) {
      try {
        // Run prepareTransactionRequest to attach any pending key authorizations.
        // `eth_fillTransaction` below needs to return the node's fill response.
        const request = await prepareTransactionRequest(client, {
          account,
          ...parameters,
          parameters: [],
          type: 'tempo',
        } as never)
        return await fillTransaction(client, request as never)
      } catch (error) {
        removeForError(error, { account, address, chainId, store })
        throw error
      }
    },
    async prepare(parameters) {
      try {
        const request = await prepareTransactionRequest(client, {
          account,
          ...parameters,
          type: 'tempo',
        } as never)
        return createPreparedTransaction({
          account,
          address,
          chainId,
          client,
          request: request as never,
          store,
        })
      } catch (error) {
        removeForError(error, { account, address, chainId, store })
        throw error
      }
    },
  }
}

function createPreparedTransaction(options: {
  account: TempoAccount.AccessKeyAccount
  address: Address.Address
  chainId: number
  client: Client<Transport>
  request: create.PreparedRequest
  store: Store.Store
}): create.Prepared {
  const { account, address, chainId, client, request, store } = options

  async function sign() {
    try {
      return await account.signTransaction(request as never)
    } catch (error) {
      removeForError(error, { account, address, chainId, store })
      throw error
    }
  }

  return {
    request,
    sign,
    async send() {
      const signed = await sign()
      try {
        return (await client.request({
          method: 'eth_sendRawTransaction' as never,
          params: [signed],
        })) as Hex.Hex
      } catch (error) {
        removeForError(error, { account, address, chainId, store })
        if (typeof error === 'object' && error !== null) submitted.add(error)
        throw error
      }
    },
    async sendSync() {
      const signed = await sign()
      try {
        return (await client.request({
          method: 'eth_sendRawTransactionSync' as never,
          params: [signed],
        })) as create.SendSyncReturnType
      } catch (error) {
        removeForError(error, { account, address, chainId, store })
        if (typeof error === 'object' && error !== null) submitted.add(error)
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
  const formatted = formatter
    ? formatter.format({ ...parameters } as never, 'fillTransaction')
    : parameters
  return (await client.request({
    method: 'eth_fillTransaction' as never,
    params: [formatted as never],
  })) as create.FillReturnType
}

function removeForError(
  error: unknown,
  options: {
    account: TempoAccount.AccessKeyAccount
    address: Address.Address
    chainId: number
    store: Store.Store
  },
): void {
  if (!shouldRemoveForError(error)) return
  options.store.accessKeys.remove({
    accessKey: options.account.accessKeyAddress,
    account: options.address,
    chainId: options.chainId,
  })
}

function shouldRemoveForError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const parsed = ExecutionError.parse(error)
  if (removalErrorNames.has(parsed.errorName)) return true
  const text = getErrorText(error)
  return [...removalErrorNames].some((name) => text.includes(name))
}

function getErrorText(error: unknown): string {
  if (!(error instanceof Error)) return ''
  const details = (error as { details?: unknown }).details
  const shortMessage = (error as { shortMessage?: unknown }).shortMessage
  const cause = (error as { cause?: unknown }).cause
  return [
    error.message,
    typeof details === 'string' ? details : '',
    typeof shortMessage === 'string' ? shortMessage : '',
    getErrorText(cause),
  ].join('\n')
}
