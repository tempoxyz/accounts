import { Hex } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { Account as TempoAccount, Transaction } from 'viem/tempo'

/**
 * Signs a prepared Tempo transaction, preserving sponsor-first payload
 * semantics when a fee payer signature is already attached.
 */
export async function signTempoTransaction(
  parameters: signTempoTransaction.Parameters,
): signTempoTransaction.ReturnType {
  const { account, transaction } = parameters

  const tx = transaction as Transaction.TransactionSerializableTempo & {
    feePayerSignature?: unknown
  }

  if (typeof tx.feePayerSignature === 'undefined') return await account.signTransaction(tx as never)

  const serialized = (await Transaction.serialize(tx)) as `0x76${string}`
  const envelope = TxEnvelopeTempo.deserialize(serialized)

  const signature = await account.sign({
    hash: TxEnvelopeTempo.getSignPayload(envelope),
  })

  return TxEnvelopeTempo.serialize(envelope, {
    signature: SignatureEnvelope.from(signature),
  })
}

export declare namespace signTempoTransaction {
  type Parameters = {
    account: TempoAccount.Account
    /** A prepared Tempo transaction (from `prepareTransactionRequest` or `Transaction.deserialize`). */
    transaction: object
  }

  type ReturnType = Promise<Hex.Hex>
}
