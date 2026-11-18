/**
 * The app's tokens for Tempo APIs.
 * @module
 */
/** The app's tokens for Tempo APIs. */
export type Tokens = {
  /**
   * The access token for Tempo APIs: a Bearer token, or a
   * [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) from an instance with `dpop`.
   */
  accessToken: string
  /** When the access token expires, in milliseconds, counted from the start of the request that issued it. */
  expiresAt: number
  /** The OIDC ID token, which names the user. A refresh may omit it. */
  idToken?: string | undefined
  /**
   * When the instance received the tokens, in milliseconds. Absent for tokens that an earlier release
   * saved, and for tokens from another source, such as a posted authorization.
   */
  receivedAt?: number | undefined
  /**
   * Exchanges for new tokens through `accounts.session.refresh` or `Actions.refresh`, and rotates
   * on each refresh.
   */
  refreshToken?: string | undefined
}

/**
 * Instantiates a {@link Tokens}.
 *
 * @example
 * ```ts
 * const tokens = Tokens.from({ ...saved, ...(await Actions.refresh(auth, { refreshToken })) })
 * ```
 */
export function from(value: Tokens): Tokens {
  return value
}
