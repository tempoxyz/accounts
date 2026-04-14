import { RpcResponse, Signature } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Client } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { signTransaction } from 'viem/actions'
import { Transaction } from 'viem/tempo'

import * as Utils from './utils.js'

/** Returns sponsor metadata for `eth_fillTransaction` responses. */
export function getSponsor(options: getSponsor.Options): getSponsor.ReturnType {
  const { account, name, url } = options
  return {
    address: account.address,
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  }
}

export declare namespace getSponsor {
  type Options = {
    /** Account used for sponsorship. */
    account: LocalAccount
    /** Optional display name. */
    name?: string | undefined
    /** Optional display URL. */
    url?: string | undefined
  }

  type ReturnType = {
    /** Sponsor address. */
    address: Address
    /** Sponsor display name. */
    name?: string | undefined
    /** Sponsor display URL. */
    url?: string | undefined
  }
}

/** Returns whether the fee payer approves a filled transaction. */
export async function shouldSponsor(options: shouldSponsor.Options) {
  const { sender, transaction, validate } = options
  if (!validate) return true
  return await validate({
    ...transaction,
    from: sender,
  } as Transaction.TransactionRequest)
}

export declare namespace shouldSponsor {
  type Options = {
    /** Sender address from the original request. */
    sender?: Address | undefined
    /** Filled transaction to validate. */
    transaction: Record<string, unknown>
    /** Optional sponsorship approval callback. */
    validate?: ((request: Transaction.TransactionRequest) => boolean | Promise<boolean>) | undefined
  }
}

/** Returns whether a raw Tempo transaction is explicitly requesting sponsorship. */
export function requestsRawSponsorship(serialized: `0x${string}`) {
  if (!serialized.startsWith('0x76') && !serialized.startsWith('0x78')) return false
  const transaction = Transaction.deserialize(serialized as `0x76${string}`)
  return 'feePayerSignature' in transaction && transaction.feePayerSignature === null
}

/** Returns `true` when a fill request already has the fields needed for sponsorship signing. */
export function isPreparedTransaction(value: Record<string, unknown>) {
  return (
    typeof value.from === 'string' &&
    typeof Utils.resolveChainId(value.chainId) === 'number' &&
    typeof value.gas !== 'undefined' &&
    typeof value.nonce !== 'undefined' &&
    (typeof value.maxFeePerGas !== 'undefined' || typeof value.gasPrice !== 'undefined')
  )
}

/** Signs a filled transaction as the fee payer. */
export async function sign(options: sign.Options) {
  const { account, transaction, sender } = options
  const from = (transaction.from as Address | undefined) ?? sender
  const { signature: _, ...withoutSenderSig } = transaction
  const prepared = { ...withoutSenderSig, from }

  if (!prepared.from)
    throw new RpcResponse.InvalidParamsError({
      message: 'Transaction sender must be provided before fee payer signing.',
    })
  if (!account.sign) throw new Error('Fee payer account cannot sign transactions.')

  const feePayerSignature = Signature.from(
    await account.sign({
      hash: TxEnvelopeTempo.getFeePayerSignPayload(TxEnvelopeTempo.from(prepared as never), {
        sender: prepared.from,
      }),
    }),
  )

  return { ...prepared, feePayerSignature }
}

export declare namespace sign {
  type Options = {
    /** Account used as the fee payer. */
    account: LocalAccount
    /** Filled transaction to sign. */
    transaction: Record<string, unknown>
    /** Sender address from the original request. */
    sender?: Address | undefined
  }
}

/** Handles `eth_signRawTransaction` and broadcast methods for sponsored Tempo transactions. */
export async function handleRawTransaction(options: handleRawTransaction.Options) {
  const { account, getClient, method, request, validate } = options
  const serialized = request.params?.[0] as `0x76${string}` | undefined

  if (!serialized?.startsWith('0x76') && !serialized?.startsWith('0x78'))
    throw new RpcResponse.InvalidParamsError({
      message: 'Only Tempo (0x76/0x78) transactions are supported.',
    })

  const transaction = Transaction.deserialize(serialized)

  if (!transaction.signature || !transaction.from)
    throw new RpcResponse.InvalidParamsError({
      message: 'Transaction must be signed by the sender before fee payer signing.',
    })

  if (validate && !(await validate(transaction as Transaction.TransactionRequest)))
    throw new RpcResponse.InvalidParamsError({
      message: 'Sponsorship rejected.',
    })

  const client = getClient(transaction.chainId)
  const serializedTransaction = toSerializedTransaction(
    await signTransaction(client, {
      ...transaction,
      account,
      feePayer: account,
    } as never),
  )

  if (method === 'eth_signRawTransaction') return serializedTransaction
  return await client.request({
    method: method as never,
    params: [serializedTransaction],
  })
}

export declare namespace handleRawTransaction {
  type Options = {
    /** Account used as the fee payer. */
    account: LocalAccount
    /** Client resolver keyed by transaction `chainId`. */
    getClient: (chainId?: number | undefined) => Client
    /** Raw transaction method to handle. */
    method: 'eth_signRawTransaction' | 'eth_sendRawTransaction' | 'eth_sendRawTransactionSync'
    /** Incoming JSON-RPC request. */
    request: { params?: readonly unknown[] | undefined }
    /** Optional sponsorship approval callback. */
    validate?: ((request: Transaction.TransactionRequest) => boolean | Promise<boolean>) | undefined
  }
}

function toSerializedTransaction(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'raw' in value && typeof value.raw === 'string')
    return value.raw
  throw new Error('Expected a serialized transaction result.')
}
