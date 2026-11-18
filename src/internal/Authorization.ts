/**
 * What every sign-in returns.
 * @module
 */
import type * as AccessKey from './AccessKey.js'
import type { Tokens } from './Tokens.js'
import type { User } from './User.js'

/**
 * The tokens, the access key, and the user. `chainId` types `accessKey.chainId`, as a literal when
 * `accessKey` names one.
 */
export type Authorization<chainId extends number = number> = Tokens & {
  /** The app's access key as data, which `AccessKey.toAccount` rebuilds into `signer`. */
  accessKey: AccessKey.AccessKey<chainId>
  /** The Tempo Account that signed the sign-in's `challenge`. Absent without a challenge. */
  address?: `0x${string}` | undefined
  /**
   * The signature of the sign-in's `challenge` by `address`, serialized. Without an access key, it
   * signs the challenge's EIP-191 hash, as `personal_sign` does, on the instance's chain. With one,
   * whose `witness` binds that hash (TIP-1053), it is the key authorization's signature. A passkey
   * registration with an access key signs the same way. A Tempo ID that binds its own witness to a
   * registration returns a signature over the EIP-191 hash instead, whose key authorization's witness is
   * not that hash. Absent without a challenge.
   */
  challengeSignature?: `0x${string}` | undefined
  /**
   * The app's access key, as a Viem account at the user's Tempo Account, from
   * `AccessKey.toAccount`. It signs transactions, messages, and typed data with the access key,
   * within its limits, scopes, and expiry.
   */
  signer: ReturnType<typeof AccessKey.toAccount>
  /** The signed-in user, from the ID token. */
  user: User
}

/**
 * Instantiates a {@link Authorization}.
 *
 * @example
 * ```ts
 * const authorization = Authorization.from({
 *   ...saved,
 *   signer: AccessKey.toAccount(saved.accessKey),
 * })
 * ```
 */
export function from<chainId extends number = number>(
  value: Authorization<chainId>,
): Authorization<chainId> {
  return value
}

/**
 * The tokens, the signed access key, and the user of a sign-in whose access key another party
 * holds, such as an MPP merchant's, which the sign-in named by its address. Nothing on the page
 * signs with it, so it holds no `signer`.
 */
export type Addressed<chainId extends number = number> = Omit<
  Authorization<chainId>,
  'signer'
>
