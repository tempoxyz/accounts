/**
 * The `push` payment of a charge that no access key of the payer signs. Tempo ID's payment page
 * sends the charge's transfer from the Tempo Account, once the user approves it, and the credential
 * names the transaction's hash, which the endpoint reads from the chain.
 * @module
 */
import { type Challenge, Credential } from 'mppx'
import { Attribution, Proof } from 'mppx/tempo'
import { Address, type Hex } from 'ox'
import { TempoAddress } from 'ox/tempo'

/** A transfer that pays a charge: the amount in the token's base units, to the recipient. */
export type Transfer = {
  /** The amount that the recipient receives, in the token's base units. */
  amount: bigint
  /** The memo of 32 bytes that binds the transfer to the charge's challenge. */
  memo: Hex.Hex
  /** The recipient's address. */
  to: Address.Address
  /** The token's address. */
  token: Address.Address
}

/**
 * Returns the credential of a charge that the transaction of `options.hash` paid from
 * `options.account`, in the form of mppx's `push` mode.
 *
 * @example
 * ```ts
 * const credential = Charge.credential(challenge, { account: '0x1f90…', chainId: tempo.id, hash })
 * ```
 */
export function credential(
  challenge: Challenge.Challenge,
  options: credential.Options,
) {
  const { account, chainId, hash } = options
  return Credential.serialize({
    challenge,
    payload: { hash, type: 'hash' },
    source: Proof.proofSource({ address: account, chainId }),
  })
}

export declare namespace credential {
  type Options = {
    /** The Tempo Account that paid. */
    account: Address.Address
    /** The chain of the transaction. */
    chainId: number
    /** The hash of the transaction that holds the transfer. */
    hash: Hex.Hex
  }
}

/**
 * Returns the transfer that pays a charge of `challenge` in `push` mode on `options.chainId`, with
 * the memo that mppx's own charge sends. Returns `undefined` for a challenge that one transfer of
 * the payment page does not pay:
 *
 * | Challenge                                        | Reason                                    |
 * | ------------------------------------------------ | ----------------------------------------- |
 * | Another intent than `charge`                     | The page sends a transfer only            |
 * | An amount of zero, or no amount                  | A proof pays it, which an access key signs |
 * | Splits                                           | The page sends one transfer               |
 * | `supportedModes` without `push`                  | The endpoint refuses a hash               |
 * | Another chain than `options.chainId`             | The payer pays on one chain               |
 * | A currency or a recipient that is no address     | mppx refuses the charge                   |
 * | A payer of `options.mode` `pull`                 | The app permits no `push` payment         |
 *
 * @example
 * ```ts
 * const transfer = Charge.transfer(challenge, { chainId: tempo.id })
 * ```
 */
export function transfer(
  challenge: Challenge.Challenge,
  options: transfer.Options,
): Transfer | undefined {
  const { chainId, clientId, mode } = options
  const { amount, currency, methodDetails, recipient } =
    challenge.request as Request
  if (challenge.intent !== 'charge' || mode === 'pull') return undefined
  if (methodDetails?.splits?.length) return undefined
  if (methodDetails?.supportedModes?.includes('push') === false)
    return undefined
  // mppx reads a charge without a chain as one on the payer's chain.
  if (methodDetails?.chainId !== undefined && methodDetails.chainId !== chainId)
    return undefined

  const value = (() => {
    try {
      return BigInt(String(amount))
    } catch {
      return undefined
    }
  })()
  const to = address(recipient)
  const token = address(currency)
  if (!value || value <= 0n || !to || !token) return undefined

  return {
    amount: value,
    memo: Attribution.encode({
      challengeId: challenge.id,
      ...(clientId !== undefined ? { clientId } : {}),
      serverId: challenge.realm,
    }),
    to,
    token,
  }
}

export declare namespace transfer {
  type Options = {
    /** The chain that the payer pays on. */
    chainId: number
    /** The app's name in the memo, as mppx's `clientId`. Absent, the memo names no app. */
    clientId?: string | undefined
    /** The payer's `mode`. `pull` permits no `push` payment. Absent, the payer permits each mode. */
    mode?: 'pull' | 'push' | undefined
  }
}

/** The fields of a charge's request that a `push` payment reads. */
type Request = {
  amount?: unknown
  currency?: unknown
  methodDetails?:
    | {
        chainId?: number | undefined
        splits?: readonly unknown[] | undefined
        supportedModes?: readonly string[] | undefined
      }
    | undefined
  recipient?: unknown
}

/** Returns the address of `value`, in either address format, or `undefined` for any other value. */
function address(value: unknown) {
  const resolved = (() => {
    try {
      return TempoAddress.resolve(String(value) as TempoAddress.Address)
    } catch {
      return undefined
    }
  })()
  // The resolver returns a value in neither format as it is.
  return resolved && Address.validate(resolved) ? resolved : undefined
}
