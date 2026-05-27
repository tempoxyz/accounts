import { Address, Hex } from 'ox'
import type { Client, Transport } from 'viem'
import { prepareTransactionRequest } from 'viem/actions'
import type { PrepareTransactionRequestReturnType } from 'viem/actions'
import type { Account as TempoAccount, Transaction as TempoTransaction } from 'viem/tempo'

import * as AccessKey from '../AccessKey.js'
import type * as Store from '../Store.js'
import type * as Rpc from '../zod/rpc.js'

type Call = {
  to?: Address.Address | undefined
  data?: Hex.Hex | undefined
}

/** Creates a transaction helper for a matching locally-signable access key. */
export async function create(options: create.Options): Promise<create.ReturnType> {
  const { address, calls, chainId, client, store } = options
  const account = await AccessKey.select({
    account: address,
    calls,
    chainId,
    store,
  })
  if (!account) return undefined
  return createTransaction({ account, client })
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
  client: Client<Transport>
}): create.Transaction {
  const { account, client } = options
  return {
    async fill(parameters) {
      const request = await prepareTransactionRequest(client, {
        account,
        ...parameters,
        parameters: [],
        type: 'tempo',
      } as never)
      return await fillTransaction(client, request as never)
    },
    async prepare(parameters) {
      const request = await prepareTransactionRequest(client, {
        account,
        ...parameters,
        type: 'tempo',
      } as never)
      return createPreparedTransaction({
        account,
        client,
        request: request as never,
      })
    },
  }
}

function createPreparedTransaction(options: {
  account: TempoAccount.AccessKeyAccount
  client: Client<Transport>
  request: create.PreparedRequest
}): create.Prepared {
  const { account, client, request } = options

  async function sign() {
    return await account.signTransaction(request as never)
  }

  return {
    request,
    sign,
    async send() {
      const signed = await sign()
      return (await client.request({
        method: 'eth_sendRawTransaction' as never,
        params: [signed],
      })) as Hex.Hex
    },
    async sendSync() {
      const signed = await sign()
      return (await client.request({
        method: 'eth_sendRawTransactionSync' as never,
        params: [signed],
      })) as create.SendSyncReturnType
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
