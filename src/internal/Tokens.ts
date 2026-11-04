/**
 * The app's tokens for Tempo APIs.
 * @module
 */
/** The app's tokens for Tempo APIs. */
export type Tokens = {
  /** The access token for Tempo APIs: a Bearer token, or a DPoP token from an instance with `dpop`. */
  accessToken: string
  /** When the access token expires, in milliseconds. */
  expiresAt: number
  /** The OIDC ID token, which names the user. A refresh may omit it. */
  idToken?: string | undefined
  /** Exchanges for new tokens through `Actions.refresh`, and rotates on each refresh. */
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
