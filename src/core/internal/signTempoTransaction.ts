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

  if (typeof transaction.feePayerSignature === 'undefined')
    return await account.signTransaction(transaction as never)

  const envelope = TxEnvelopeTempo.deserialize(
    (await Transaction.serialize(transaction as never)) as never,
  )

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
    transaction: Record<string, unknown> & {
      feePayerSignature?: unknown
    }
  }

  type ReturnType = Promise<Hex.Hex>
}
