/**
 * Verifies the ID tokens that Tempo ID issues to an app at each sign-in (OpenID Connect Core 1.0
 * §3.1.3.7), and reads the user that each names.
 * @module
 */
import { errors, jwtVerify } from 'jose'
import { type Config, RequestError } from '../Accounts.js'
import * as KeySet from './KeySet.js'

/**
 * The jose errors that refuse the token itself. Every other failure, such as a key set that cannot be
 * fetched or imported, makes the key set unavailable.
 */
const refusals = [
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSMultipleMatchingKeys,
  errors.JWKSNoMatchingKey,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWTClaimValidationFailed,
  errors.JWTExpired,
  errors.JWTInvalid,
] as const

/**
 * The header types of an ID token, in lowercase. Tempo ID signs each ID token without `typ`, a
 * logout token with `logout+jwt`, and an access token with `at+jwt`.
 */
const types = ['application/jwt', 'jwt'] as const

/**
 * Creates a verifier of the ID tokens that Tempo ID issues to the apps of `clientIds`, or to the
 * instance's own app by default. The verifier holds the issuer's key set for `maxAge`, as
 * `KeySet.create` of `accounts/internal` describes. A set younger than half of `maxAge` verifies as
 * it is, an older one verifies while a background fetch replaces it, and from `maxAge` a
 * verification waits for a fetch. A token that names an unknown `kid` waits for a fetch, at most
 * once each 30 seconds after the last fetch ended. Each fetch ends within `timeout`. The
 * configuration's `keySet` keeps the set beyond the verifier, such as for a new Worker isolate.
 * Create one verifier for each Worker isolate or process.
 *
 * @example
 * ```ts
 * const verifier = IdToken.create(Accounts.from({ clientId: 'https://app.example' }))
 * const token = await verifier.verify({ idToken })
 * if (!token) return new Response(null, { status: 401 })
 * // { authTime: 1767225000000, clientId: 'https://app.example', email: 'user@example.com', … }
 * ```
 */
export function create(
  auth: Config,
  options: create.Options = {},
): create.ReturnType {
  const { clientIds = [auth.clientId] } = options
  const issuer = new URL(options.issuer ?? auth.url).origin
  const keys = KeySet.create(auth, {
    maxAge: options.maxAge,
    timeout: options.timeout,
  })

  return {
    async verify(verifyOptions) {
      // OIDC Core §3.1.3.7: the signature, `iss`, `aud`, and `exp`. The package requests the
      // `email` scope at each sign-in, so each of its ID tokens holds `email` and `email_verified`.
      const verified = await jwtVerify(verifyOptions.idToken, keys, {
        algorithms: ['RS256'],
        audience: [...clientIds],
        issuer,
        requiredClaims: [
          'aud',
          'email',
          'email_verified',
          'exp',
          'iat',
          'iss',
          'sub',
        ],
      }).catch((error: unknown) => {
        // Only a check of the token refuses it. A key set that cannot be fetched or imported is
        // unavailable, since the token can still be valid.
        if (refusals.some((refusal) => error instanceof refusal))
          return undefined
        throw unavailable(error)
      })
      if (!verified) return undefined

      const { payload, protectedHeader } = verified
      // The same keys sign logout tokens and access tokens, each with a `typ` of its own. jose
      // types `typ` as a string but does not check it.
      const typ: unknown = protectedHeader.typ
      if (
        typ !== undefined &&
        (typeof typ !== 'string' ||
          !(types as readonly string[]).includes(typ.toLowerCase()))
      )
        return undefined
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.email_verified !== 'boolean' ||
        (payload.auth_time !== undefined &&
          typeof payload.auth_time !== 'number') ||
        (payload.sid !== undefined && typeof payload.sid !== 'string')
      )
        return undefined
      // jose admits an `aud` that names an app of `clientIds` among others. Tempo ID names one app in
      // each ID token, so a token that names any other app, also beside an allowed one, is refused.
      const audiences =
        typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? [])
      const [clientId] = audiences
      if (
        clientId === undefined ||
        audiences.some((entry) => !clientIds.includes(entry))
      )
        return undefined

      return {
        authTime:
          typeof payload.auth_time === 'number'
            ? payload.auth_time * 1000
            : undefined,
        clientId,
        email: payload.email,
        emailVerified: payload.email_verified,
        expiresAt: payload.exp! * 1000,
        issuedAt: payload.iat! * 1000,
        sessionId: payload.sid,
        userId: payload.sub,
      }
    },
  }
}

export declare namespace create {
  type Options = {
    /**
     * The client IDs of the apps whose ID tokens the server accepts. Every other app's token is
     * refused. Defaults to the instance's `clientId`.
     */
    clientIds?: readonly string[] | undefined
    /**
     * The `iss` of Tempo ID's tokens, its public origin, such as `https://id.tempo.xyz`. Set it when
     * the instance's `url` reaches Tempo ID at another address, such as an internal host. Defaults
     * to the origin of the instance's `url`.
     */
    issuer?: string | undefined
    /**
     * How long a key set verifies, in milliseconds. After half of it, a verification starts a
     * background fetch of the set. From all of it, a verification waits for a new set, so a signing
     * key that the issuer removed stops verifying, and throws if that fetch fails. Defaults to 10
     * minutes.
     */
    maxAge?: number | undefined
    /**
     * How long a fetch of the key set may take, in milliseconds. A slower fetch throws
     * `Accounts.RequestError` with status 0. Defaults to 5 seconds.
     */
    timeout?: number | undefined
  }

  /** The verifier. */
  type ReturnType = {
    /**
     * Verifies an ID token: its RS256 signature over the issuer's keys, a `typ` that is absent or
     * `JWT`, `iss` of the issuer, an `aud` that names only apps of `clientIds`, an `exp` that has
     * not passed, an `iat`, a `sub`, an `email`, and an `email_verified`. Returns the token's claims,
     * or `undefined` for a token that fails a check, such as a logout token or an access token.
     * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched or imported.
     */
    verify: (options: VerifyOptions) => Promise<Token | undefined>
  }

  /** The options of `verify`. */
  type VerifyOptions = {
    /** The ID token, such as the `idToken` of a session that a page sends. */
    idToken: string
  }

  /** A verified ID token's claims. */
  type Token = {
    /**
     * When the user signed in to Tempo ID, from `auth_time`, in milliseconds since the Unix epoch.
     * Absent when the token holds no `auth_time`.
     */
    authTime?: number | undefined
    /** The app that the token names as its `aud`. */
    clientId: string
    /** The user's email address. */
    email: string
    /** Whether Tempo ID verified the email address, from `email_verified`. */
    emailVerified: boolean
    /** When the token expires, from `exp`, in milliseconds since the Unix epoch. */
    expiresAt: number
    /** When Tempo ID issued the token, from `iat`, in milliseconds since the Unix epoch. */
    issuedAt: number
    /**
     * The Tempo ID session of the sign-in, from `sid`, which the app's logout tokens name. Absent
     * for an app without a registered logout.
     */
    sessionId?: string | undefined
    /** The user's ID, `user_` and a ULID, from `sub`. It is the `id` of the session's `user`. */
    userId: string
  }
}

/**
 * Returns a key set that could not be fetched or imported as a `RequestError` with status 0, such as
 * after a non-200 response, a DNS failure, a timeout, or a key that does not import.
 */
function unavailable(error: unknown): RequestError {
  return new RequestError({
    cause: error,
    code: 'temporarily_unavailable',
    message:
      "Key set unavailable: the request for the issuer's signing keys failed. Retry later.",
    status: 0,
  })
}
