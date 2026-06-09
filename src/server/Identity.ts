import { createRemoteJWKSet, jwtVerify } from 'jose'

/** Cache of remote JWKS sets keyed by issuer, so verification reuses fetched keys. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Verifies an OIDC identity token (JWT) against an issuer's JWKS and returns its
 * claims. Asserts the signature, `iss`, `aud`, and `exp` (via `jose`), plus
 * `email_verified === true`. Optionally cross-checks `sub` (the account address)
 * and `nonce` when provided. Throws on any failure.
 *
 * Standalone counterpart to `Handler.auth({ identity })` — use it when minting
 * your own session inside `onAuthenticate` with `session: false`.
 */
export async function verify(idToken: string, options: verify.Options): Promise<verify.Claims> {
  const { audience, issuer, nonce, subject } = options

  let jwks = jwksCache.get(issuer)
  if (!jwks) {
    // Discover the JWKS endpoint (standard OIDC), falling back to the
    // conventional path when the issuer omits the discovery document.
    const discovery = await fetch(`${trimTrailingSlash(issuer)}/.well-known/openid-configuration`)
      .then((res) => (res.ok ? (res.json() as Promise<{ jwks_uri?: string }>) : null))
      .catch(() => null)
    const jwksUri = discovery?.jwks_uri ?? `${trimTrailingSlash(issuer)}/.well-known/jwks.json`
    jwks = createRemoteJWKSet(new URL(jwksUri))
    jwksCache.set(issuer, jwks)
  }

  const { payload } = await jwtVerify(idToken, jwks, {
    algorithms: ['EdDSA'],
    audience,
    issuer,
  })

  if (payload.email_verified !== true) throw new Error('email not verified')
  if (subject && String(payload.sub).toLowerCase() !== subject.toLowerCase())
    throw new Error('identity token subject mismatch')
  if (nonce !== undefined && payload.nonce !== nonce)
    throw new Error('identity token nonce mismatch')

  return {
    email: typeof payload.email === 'string' ? payload.email : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    subject: String(payload.sub),
  }
}

export declare namespace verify {
  type Options = {
    /** Expected audience (`aud`) — the relying party's origin. */
    audience: string
    /** Issuer (IdP) URL whose JWKS signs the token. */
    issuer: string
    /** When set, require the token's `nonce` to equal this value. */
    nonce?: string | undefined
    /** When set, require the token's `sub` to equal this address (case-insensitive). */
    subject?: string | undefined
  }

  type Claims = {
    /** Verified email, if present. */
    email: string | undefined
    /** OIDC nonce echoed in the token, if present. */
    nonce: string | undefined
    /** Token subject (`sub`) — the account address. */
    subject: string
  }
}

/** Strips a single trailing slash so issuer-relative URLs join cleanly. */
function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
