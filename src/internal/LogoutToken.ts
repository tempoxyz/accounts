/**
 * Verifies the logout tokens that Tempo ID posts to an app's backend when a session ends (OpenID
 * Connect Back-Channel Logout 1.0), and reads the session and the user that each names.
 * @module
 */
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose'
import { type Config, RequestError } from '../Accounts.js'

/** A logout token that does not verify, or names an app that the verifier does not allow. */
export class InvalidError extends Error {
  override readonly name = 'LogoutToken.InvalidError'

  constructor(options: InvalidError.Options = {}) {
    super(
      'Invalid logout token: the token does not verify, has expired, is no logout token, or names an app that the backend does not allow. Respond with 400.',
      { cause: options.cause },
    )
  }
}

export declare namespace InvalidError {
  type Options = {
    /** The error that caused this one, such as jose's `JWTExpired`. */
    cause?: unknown
  }
}

/** The `events` member of every logout token (Back-Channel Logout §2.4). */
export const event = 'http://schemas.openid.net/event/backchannel-logout'

/** How long after a key set's fetch an unknown `kid` fetches the set again, in milliseconds. */
const cooldown = 30_000

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
 * Creates a verifier of the logout tokens that Tempo ID posts to the backends of the apps of
 * `clientIds`, or of the instance's own app by default, on jose's remote key set. The verifier holds
 * the issuer's key set for `maxAge`, and fetches it again for a token that names an unknown `kid`, at
 * most once each 30 seconds after a successful fetch. Each fetch ends within `timeout`. Create one
 * verifier for each Worker isolate or process.
 *
 * @example
 * ```ts
 * const verifier = LogoutToken.create(Accounts.from({ clientId: 'tempo-wallet' }))
 * const form = await request.formData()
 * const token = await verifier.verify({ logoutToken: String(form.get('logout_token')) })
 * // { clientId: 'tempo-wallet', id: 'Xk2…', sessionId: '0f9c…', userId: 'user_…' }
 * await sessions.endTempoIdSession(token.sessionId)
 * ```
 */
export function create(
  auth: Config,
  options: create.Options = {},
): create.ReturnType {
  const {
    clientIds = [auth.clientId],
    maxAge = 10 * 60 * 1000,
    timeout = 5_000,
  } = options
  const issuer = new URL(options.issuer ?? auth.url).origin
  const keys = createRemoteJWKSet(new URL('/oauth2/jwks', auth.url), {
    cacheMaxAge: maxAge,
    cooldownDuration: cooldown,
    timeoutDuration: timeout,
    ...(auth.fetch ? { [customFetch]: auth.fetch } : {}),
  })

  return {
    async verify(verifyOptions) {
      // Back-Channel Logout §2.6: the signature, `iss`, `aud`, `iat`, a `typ` that no ID token holds,
      // the logout event, a `sid`, and no `nonce`.
      const { payload } = await jwtVerify(verifyOptions.logoutToken, keys, {
        algorithms: ['RS256'],
        audience: [...clientIds],
        issuer,
        requiredClaims: ['aud', 'exp', 'iat', 'jti', 'sid', 'sub'],
        typ: 'logout+jwt',
      }).catch((error: unknown) => {
        // Only a check of the token refuses it. A key set that cannot be fetched or imported is
        // unavailable, since the token can still be valid.
        if (refusals.some((refusal) => error instanceof refusal))
          throw new InvalidError({ cause: error })
        throw unavailable(error)
      })

      const events = payload.events
      if (
        !events ||
        typeof events !== 'object' ||
        !(event in events) ||
        'nonce' in payload ||
        typeof payload.sid !== 'string' ||
        typeof payload.jti !== 'string'
      )
        throw new InvalidError()
      // Tempo ID names one app in each logout token.
      const clientId = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud
      return {
        clientId: clientId!,
        id: payload.jti,
        sessionId: payload.sid,
        userId: payload.sub!,
      }
    },
  }
}

export declare namespace create {
  type Options = {
    /**
     * The client IDs of the apps whose logout tokens the backend accepts. Every other app's token
     * throws. Defaults to the instance's `clientId`.
     */
    clientIds?: readonly string[] | undefined
    /**
     * The `iss` of Tempo ID's tokens, its public origin, such as `https://id.tempo.xyz`. Set it when
     * the instance's `url` reaches Tempo ID at another address, such as an internal host. Defaults
     * to the origin of the instance's `url`.
     */
    issuer?: string | undefined
    /**
     * How long the verifier keeps a key set, in milliseconds. The next verification after it
     * fetches the set again. Defaults to 10 minutes.
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
     * Verifies a logout token: its RS256 signature over the issuer's keys, `typ: logout+jwt`, `iss`
     * of the issuer, an `aud` of `clientIds`, an `exp` that has not passed, the logout event, a
     * `sid`, a `sub`, a `jti`, and no `nonce`.
     * @throws {InvalidError} For a token that does not verify, or another app's token.
     * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched or imported.
     */
    verify: (options: VerifyOptions) => Promise<Token>
  }

  /** The options of `verify`. */
  type VerifyOptions = {
    /** The `logout_token` of the request's form body. */
    logoutToken: string
  }

  /** A verified logout token's claims. */
  type Token = {
    /** The app that the token names. */
    clientId: string
    /**
     * The token's `jti`, unique to each token. A backend that refuses a replay stores it until the
     * token expires, 2 minutes after its issue.
     */
    id: string
    /** The ended session, which the app's ID tokens of the session name as `sid`. */
    sessionId: string
    /** The user's ID, `user_` and a ULID, which the app's ID tokens name as `sub`. */
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
