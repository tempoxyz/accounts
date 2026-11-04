/**
 * Calls Tempo ID's standard OAuth endpoints for tokens that an app holds.
 * @module
 */
import type { Config } from '../Accounts.js'
import * as Api from '../internal/api.js'
import type { User } from '../internal/User.js'

/**
 * Checks whether a token is active (RFC 7662). Unlike local verification against {@link jwks}, it
 * reports a revoked token inactive at once. The client secret authenticates the request, so only a
 * backend calls it.
 *
 * @example
 * ```ts
 * const result = await Actions.oauth.introspect(auth, { token: accessToken })
 * if (!result.active) return c.json({ error: 'Sign in again.' }, 401)
 * ```
 */
export async function introspect(
  auth: Config,
  options: introspect.Options,
): Promise<introspect.ReturnType> {
  const { token, tokenTypeHint } = options
  const body = await Api.json<{
    active: boolean
    client_id?: string | undefined
    exp?: number | undefined
    iat?: number | undefined
    scope?: string | undefined
    sub?: string | undefined
  }>(
    await (auth.fetch ?? fetch)(new URL('/oauth2/introspect', auth.url), {
      body: new URLSearchParams({
        client_id: auth.clientId,
        ...(await Api.clientAuthentication(auth)),
        token,
        ...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
      }),
      method: 'POST',
    }),
  )
  // An inactive token carries no other members (RFC 7662 §2.2).
  if (!body.active) return { active: false }
  return {
    active: true,
    clientId: body.client_id,
    expiresAt: body.exp === undefined ? undefined : body.exp * 1000,
    issuedAt: body.iat === undefined ? undefined : body.iat * 1000,
    scope: body.scope,
    userId: body.sub,
  }
}

export declare namespace introspect {
  type Options = {
    /** The access token or refresh token to check. */
    token: string
    /** The kind of token, which speeds up the lookup. */
    tokenTypeHint?: 'access_token' | 'refresh_token' | undefined
  }

  /** Whether the token is active, with the issuer's claims about an active one. */
  type ReturnType =
    | {
        /** The token is expired, revoked, or never issued. */
        active: false
      }
    | {
        /** The token is active. */
        active: true
        /** The app the token was issued to. */
        clientId: string | undefined
        /** When the token expires, in milliseconds. */
        expiresAt: number | undefined
        /** When the token was issued, in milliseconds. */
        issuedAt: number | undefined
        /** The token's scopes, space-separated. */
        scope: string | undefined
        /** The user that the token names, as its `sub`. */
        userId: string | undefined
      }
}

/**
 * Returns the issuer's JSON Web Key Set, whose keys verify every Tempo ID token. A key rotation
 * signs with a new key, so fetch the set again for an unknown `kid`, at most once in a cooldown.
 * jose's `createRemoteJWKSet` does this from the `/oauth2/jwks` URL.
 *
 * @example
 * ```ts
 * import { createLocalJWKSet, errors, jwtVerify } from 'jose'
 *
 * let keys = createLocalJWKSet(await Actions.oauth.jwks(auth))
 * let fetchedAt = Date.now()
 * let refetch: Promise<void> | undefined
 *
 * async function verify(accessToken: string) {
 *   try {
 *     return await jwtVerify(accessToken, keys, { audience, issuer })
 *   } catch (error) {
 *     if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
 *     // Concurrent failures share one fetch. The cooldown bounds fetches for forged `kid` values.
 *     if (!refetch) {
 *       if (Date.now() - fetchedAt < 30_000) throw error
 *       fetchedAt = Date.now()
 *       refetch = Actions.oauth
 *         .jwks(auth)
 *         .then((set) => {
 *           keys = createLocalJWKSet(set)
 *         })
 *         .finally(() => {
 *           refetch = undefined
 *         })
 *     }
 *     await refetch
 *     return await jwtVerify(accessToken, keys, { audience, issuer })
 *   }
 * }
 *
 * const { payload } = await verify(accessToken)
 * // Every app's token carries the same audience, so allow each app by its `client_id`.
 * if (!allowedClientIds.includes(String(payload.client_id))) throw forbidden()
 * ```
 */
export async function jwks(auth: Config): Promise<jwks.ReturnType> {
  return Api.json<jwks.ReturnType>(
    await (auth.fetch ?? fetch)(new URL('/oauth2/jwks', auth.url)),
  )
}

export declare namespace jwks {
  /** The key set, in RFC 7517's format. */
  type ReturnType = {
    /** The issuer's signing keys. */
    keys: JsonWebKey[]
  }
}

/**
 * Returns the user that an access token names, from the UserInfo endpoint (OIDC Core §5.3). Access
 * tokens carry no email, so an API that needs it calls this once per user. An instance with a DPoP
 * key sends a DPoP token, one whose `cnf` names a key, with the `DPoP` scheme and a proof. Throws `invalid_token` for a rejected
 * token.
 *
 * @example
 * ```ts
 * const user = await Actions.oauth.userInfo(auth, { accessToken })
 * // { email: 'user@example.com', id: 'user_…' }
 * ```
 */
export async function userInfo(
  auth: Config,
  options: userInfo.Options,
): Promise<User> {
  const url = new URL('/oauth2/userinfo', auth.url)
  const response = await (auth.fetch ?? fetch)(url, {
    headers: await Api.tokenHeaders(auth, {
      accessToken: options.accessToken,
      method: 'GET',
      url,
    }),
  })
  // RFC 6750 §3 names a rejected bearer token `invalid_token`. The issuer's 401 body uses its own
  // code, or none, so the refusal always carries the standard one.
  if (response.status === 401)
    throw Api.error(
      {
        error: 'invalid_token',
        error_description:
          'Invalid or expired access token. Refresh the tokens, or sign in again.',
      },
      { status: 401 },
    )
  const claims = await Api.json<{ email: string; sub: string }>(response)
  return { email: claims.email, id: claims.sub }
}

export declare namespace userInfo {
  type Options = {
    /** An access token, from any sign-in or refresh. */
    accessToken: string
  }
}
