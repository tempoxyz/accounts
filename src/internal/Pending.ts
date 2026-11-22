/**
 * A sign-in redirect in progress, which an app keeps until Tempo ID redirects back.
 * @module
 */
import type * as AccessKey from './AccessKey.js'

/**
 * A redirect that authorizes a new access key, with its material. {@link WithoutAccessKey}
 * authorizes none, and {@link Addressed} authorizes another party's.
 */
export type Pending = AccessKey.Material &
  Base & {
    /** Absent, since the redirect authorizes an access key. */
    accessKey?: undefined
  }

/** A redirect that authorizes an access key that another party holds, by its address. */
export type Addressed = Base & {
  /** `'address'`, since another party holds the access key, so the redirect keeps no material. */
  accessKey: 'address'
}

/** What every sign-in redirect keeps. */
type Base = {
  /** The chain of the instance that started the redirect. Absent in a redirect of an earlier version. */
  chainId?: number | undefined
  /** `true` when the request sent a challenge, whose signature the token response must carry. */
  challenge?: true | undefined
  /** The app that started the redirect. Absent in a redirect of an earlier version. */
  clientId?: string | undefined
  /**
   * The origin of the Tempo ID deployment that the redirect signed in at, whose token endpoint
   * redeems its code. Absent in a redirect of an earlier version.
   */
  issuer?: string | undefined
  /** Where Tempo ID redirects back to. The code exchange repeats it. */
  redirectUri: string
  /** The value that the callback must echo, so a forged callback fails. */
  state: string
  /** The PKCE verifier that redeems the code. */
  verifier: string
}

/** A redirect that authorizes no access key. */
export type WithoutAccessKey = Base & {
  /** `false`, since the redirect authorizes no access key. */
  accessKey: false
}

/**
 * Instantiates a {@link Pending}, an {@link Addressed}, or a {@link WithoutAccessKey}.
 *
 * @example
 * ```ts
 * const pending = Pending.from(await unseal(c, 'oauth'))
 * ```
 */
export function from<
  const value extends Addressed | Pending | WithoutAccessKey,
>(value: value): value {
  return value
}
