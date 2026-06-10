import { sign } from 'hono/jwt'
import * as z from 'zod/mini'

import { type Handler, from } from '../../Handler.js'
import * as Hono from '../hono.js'

const defaults = {
  claimsSupported: ['iss', 'aud', 'sub', 'iat', 'exp', 'nonce'],
  kid: 'oidc-1',
  path: '/',
  ttl: 5 * 60, // 5 minutes
} as const

/** Zod schemas for the OIDC provider's request and response payloads. */
export namespace schema {
  /** Schemas for `POST {path}/token`. */
  export namespace token {
    /** Request body schema. */
    export const parameters = z.object({
      /** Audience the token is minted for — the requesting app's origin. */
      audience: z.string(),
      /** One-time value bound into the token (OIDC `nonce`). */
      nonce: z.optional(z.string()),
      /**
       * Subject the token is minted for. Ignored when an `authenticate`
       * callback is configured (the resolved subject wins); required
       * otherwise.
       */
      subject: z.optional(z.string()),
    })

    /** Response body schema. */
    export const returns = z.object({
      idToken: z.string(),
    })
  }
}

/**
 * OpenID Connect provider (issuer) request handler. Mounts three routes
 * under `path`:
 *
 * - `POST {path}/token` → mints + signs an EdDSA id_token, returns `{ idToken }`
 * - `GET {path}/.well-known/openid-configuration` → OIDC discovery document
 * - `GET {path}/.well-known/jwks.json` → public signing keys (JWKS)
 *
 * The handler owns the OIDC protocol mechanics (claim set, EdDSA signing,
 * discovery + JWKS shape); a deployment supplies its key material and the
 * claim source via callbacks, so nothing here is deployment-specific:
 *
 * - `authenticate(request)` resolves the authenticated subject (e.g. mapping
 *   a session cookie to an account address). When omitted, the request body's
 *   `subject` is trusted instead — only safe behind an authenticating gateway.
 * - `getClaims({ subject, audience, nonce, request })` returns the claim set
 *   embedded into the token (e.g. `{ email, email_verified: true }`). Throwing
 *   rejects issuance (e.g. no verified email) with `400`.
 *
 * Tokens carry `iss`, `aud`, `sub`, `iat`, `exp`, an optional `nonce`, and any
 * claims returned by `getClaims`. They are signed EdDSA (Ed25519) with the
 * provided `signingKey`; the public counterpart is served at the JWKS route so
 * relying parties can verify them.
 */
export function oidcProvider(options: oidcProvider.Options): oidcProvider.ReturnType {
  const {
    authenticate,
    claimsSupported = defaults.claimsSupported,
    getClaims,
    issuer,
    jwksUri,
    kid = defaults.kid,
    path = defaults.path,
    publicKey,
    signingKey,
    ttl = defaults.ttl,
    ...rest
  } = options

  const key = parseJwk(signingKey)
  const jwk = { ...parseJwk(publicKey), kid, use: 'sig', alg: 'EdDSA' }

  const tokenPath = path === '/' ? '/token' : `${path}/token`
  const discoveryPath =
    path === '/' ? '/.well-known/openid-configuration' : `${path}/.well-known/openid-configuration`
  const jwksPath = path === '/' ? '/.well-known/jwks.json' : `${path}/.well-known/jwks.json`

  // The advertised `jwks_uri` is issuer-relative (OIDC serves discovery at
  // `{issuer}/.well-known/openid-configuration`), not origin + routing path —
  // those differ when `issuer` is path-based (e.g. `{origin}/api/oidc`).
  const resolvedJwksUri = jwksUri ?? `${trimTrailingSlash(issuer)}/.well-known/jwks.json`

  const router = from(rest)

  router.post(tokenPath, Hono.validate('json', schema.token.parameters), async (c) => {
    const { audience, nonce, subject: subject_body } = c.req.valid('json')

    // Resolve the subject the token is minted for. An `authenticate` callback
    // (e.g. session cookie → address) always wins so the server never trusts a
    // client-supplied subject when it can prove one itself.
    const subject = await (async () => {
      try {
        const resolved = authenticate ? await authenticate(c.req.raw) : (subject_body ?? '')
        if (!resolved) return c.json({ error: 'missing subject' }, 400)
        return resolved
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'unauthenticated' }, 401)
      }
    })()
    if (subject instanceof Response) return subject

    // Resolve the claim set (e.g. verified email). Throwing here rejects
    // issuance — the deployment owns the policy (e.g. `email_verified`).
    const claims = await (async () => {
      try {
        return await getClaims({ audience, nonce, request: c.req.raw, subject })
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'claims unavailable' }, 400)
      }
    })()
    if (claims instanceof Response) return claims

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: issuer,
      aud: audience,
      sub: subject,
      iat: now,
      exp: now + ttl,
      ...(nonce ? { nonce } : {}),
      ...claims,
    }

    const idToken = await sign(payload, key, 'EdDSA')
    return c.json(z.encode(schema.token.returns, { idToken }))
  })

  // Verify-only discovery: this is a verifiable ID-token issuer (JWKS + JWT),
  // not a full interactive OIDC OP. Apps integrate by verifying the token (the
  // `jwks_uri` is the field that matters), not by running a redirect login — so
  // `authorization_endpoint`/`token_endpoint` are intentionally omitted. The
  // shape otherwise mirrors workload-identity issuers (GitHub Actions, GitLab
  // CI, Kubernetes), which advertise `response_types_supported: ["id_token"]`
  // + JWKS only.
  router.get(discoveryPath, (c) =>
    c.json({
      issuer,
      jwks_uri: resolvedJwksUri,
      response_types_supported: ['id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      claims_supported: claimsSupported,
    }),
  )

  router.get(jwksPath, (c) =>
    c.json(
      { keys: [jwk] },
      { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
    ),
  )

  return router
}

export declare namespace oidcProvider {
  /** Return type of `oidcProvider()` — a `Handler`. */
  type ReturnType = Handler

  /**
   * Resolves the authenticated subject for a token request — e.g. mapping a
   * session cookie to an account address. Throwing rejects issuance with
   * `401`. When omitted, the request body's `subject` is used instead.
   */
  type authenticate = (request: Request) => string | Promise<string>

  /**
   * Returns the claim set embedded into the minted token. The deployment owns
   * the verification policy (e.g. only return `email` when verified, and set
   * `email_verified: true`). Throwing rejects issuance with `400`.
   */
  type getClaims = (params: {
    /** Audience the token is minted for. */
    audience: string
    /** OIDC `nonce`, when supplied by the caller. */
    nonce: string | undefined
    /** Underlying request — useful for headers, IP, etc. */
    request: Request
    /** Resolved subject the token is minted for. */
    subject: string
  }) => Record<string, unknown> | Promise<Record<string, unknown>>

  type Options = from.Options & {
    /**
     * Resolves the authenticated subject from the request (e.g. session
     * cookie → account address). When omitted, the request body's `subject`
     * is trusted — only safe behind an authenticating gateway.
     */
    authenticate?: authenticate | undefined
    /**
     * Claim names advertised in the discovery document's `claims_supported`.
     * Append the deployment's own claims (e.g. `email`, `email_verified`) to
     * the protocol defaults.
     * @default ["iss", "aud", "sub", "iat", "exp", "nonce"]
     */
    claimsSupported?: readonly string[] | undefined
    /** Returns the claim set embedded into the minted token. */
    getClaims: getClaims
    /**
     * Issuer identifier — set as the token `iss` and the discovery `issuer`.
     * Must be an absolute URL (e.g. `'https://wallet.tempo.xyz'`). OIDC serves
     * discovery at `{issuer}/.well-known/openid-configuration`, so `issuer` must
     * equal the mount's public URL — i.e. `{origin}{path}` when mounted under a
     * `path` (e.g. `'https://wallet.tempo.xyz/api/oidc'` for `path: '/api/oidc'`).
     */
    issuer: string
    /**
     * Absolute URL advertised as the discovery `jwks_uri`. Defaults to the
     * mounted JWKS route under `issuer`. Set this when JWKS is served
     * elsewhere (e.g. an existing `/.well-known/jwks.json`).
     */
    jwksUri?: string | undefined
    /** Key id set on the JWKS entry. @default "oidc-1" */
    kid?: string | undefined
    /** Path prefix for the provider endpoints. @default "/" */
    path?: string | undefined
    /** Public signing key (JWK string), served at the JWKS route. */
    publicKey: string
    /** Private signing key (JWK string), used to sign tokens (EdDSA). */
    signingKey: string
    /** Token lifetime in seconds. @default 300 */
    ttl?: number | undefined
  }
}

/**
 * Parse a JWK string, normalizing the `Ed25519` algorithm name to the JWT
 * `EdDSA` value expected by `hono/jwt`.
 */
function parseJwk(jwk: string): JsonWebKey {
  const parsed = JSON.parse(jwk) as JsonWebKey
  if (parsed.alg === 'Ed25519') parsed.alg = 'EdDSA'
  return parsed
}

/** Strip a single trailing slash so URL joins don't double up. */
function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
