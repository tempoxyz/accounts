/**
 * A sign-in redirect in progress, which an app keeps until Tempo ID redirects back.
 * @module
 */
import type * as AccessKey from './AccessKey.js'

/**
 * A redirect that authorizes a new access key, with the key's material. {@link WithoutKey}
 * authorizes none.
 */
export type Pending = AccessKey.Material &
  Base & {
    /** Absent, since the redirect authorizes an access key. */
    key?: undefined
  }

/** What every sign-in redirect keeps. */
type Base = {
  /** The chain of the instance that started the redirect. Absent in a redirect of an earlier version. */
  chainId?: number | undefined
  /** The app that started the redirect. Absent in a redirect of an earlier version. */
  clientId?: string | undefined
  /** Where Tempo ID redirects back to. The code exchange repeats it. */
  redirectUri: string
  /** The value that the callback must echo, so a forged callback fails. */
  state: string
  /** The PKCE verifier that redeems the code. */
  verifier: string
}

/** A redirect that authorizes no access key. */
export type WithoutKey = Base & {
  /** `false`, since the redirect authorizes no access key. */
  key: false
}

/**
 * Instantiates a {@link Pending}, or a {@link WithoutKey}.
 *
 * @example
 * ```ts
 * const pending = Pending.from(await unseal(c, 'oauth'))
 * ```
 */
export function from<const value extends Pending | WithoutKey>(
  value: value,
): value {
  return value
}
