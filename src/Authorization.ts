/**
 * What every sign-in returns.
 * @module
 */
import type * as AccessKey from './AccessKey.js'
import type { Tokens } from './Tokens.js'
import type { User } from './User.js'

/**
 * The tokens, the access key, and the user. `chainId` types `key.chainId`, as a literal when
 * `accessKey` names one.
 */
export type Authorization<chainId extends number = number> = Tokens & {
  /**
   * The app's access key, as a Viem account at the user's Tempo Account, from `AccessKey.toAccount`. It
   * signs transactions, messages, and typed data with the access key, within the key's limits,
   * scopes, and expiry.
   */
  accessKey: ReturnType<typeof AccessKey.toAccount>
  /** The same access key as data, which `AccessKey.toAccount` rebuilds into `accessKey`. */
  key: AccessKey.AccessKey<chainId>
  /** The signed-in user, from the ID token. */
  user: User
}

/**
 * Instantiates a {@link Authorization}.
 *
 * @example
 * ```ts
 * const authorization = Authorization.from({ ...saved, accessKey: AccessKey.toAccount(saved.key) })
 * ```
 */
export function from<chainId extends number = number>(
  value: Authorization<chainId>,
): Authorization<chainId> {
  return value
}
