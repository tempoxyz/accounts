/**
 * Verifies the logout tokens that Tempo ID posts to an app's backend when a session ends (OpenID
 * Connect Back-Channel Logout 1.0), and reads the session and the user that each names.
 * @module
 */
import { errors, jwtVerify } from 'jose'
import { type Config, RequestError } from './Accounts.js'
import * as KeySet from './internal/KeySet.js'

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
 * `clientIds`, or of the instance's own app by default. The verifier holds the issuer's key set for `maxAge`, as
 * `KeySet.create` of `accounts/internal` describes. A set younger than half of `maxAge` verifies as
 * it is, an older one verifies while a background fetch replaces it, and from `maxAge` a
 * verification waits for a fetch. A token that names an unknown `kid` waits for a fetch, at most
 * once each 30 seconds after the last fetch ended. Each fetch ends within `timeout`. The
 * configuration's `keySet` keeps the set beyond the verifier, such as for a new Worker isolate.
 * Create one verifier for each Worker isolate or process.
 *
 * @example
 * ```ts
 * const verifier = LogoutToken.create(Accounts.from({ clientId: 'tempo-wallet' }))
 * const form = await request.formData()
 * const token = await verifier.verify({ logoutToken: String(form.get('logout_token')) })
 * // { clientId: 'tempo-wallet', id: 'Xk2…', issuedAt: 1794811083000, sessionId: '0f9c…', userId: 'user_…' }
 * // The app's own index lists the session IDs of each `sid`, since one Tempo ID session can sign in several.
 * const ids = await sessionIds.get(token.sessionId)
 * await Promise.all(ids.map((id) => accounts.backend.end({ id, revoke: false })))
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
      // jose admits an `aud` that names an app of `clientIds` among others. Tempo ID names one app in
      // each logout token, so a token that names any other app, also beside an allowed one, throws.
      const audiences =
        typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? [])
      const [clientId] = audiences
      if (
        clientId === undefined ||
        audiences.some((entry) => !clientIds.includes(entry))
      )
        throw new InvalidError()

      return {
        clientId,
        id: payload.jti,
        issuedAt: payload.iat! * 1000,
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
     * Verifies a logout token: its RS256 signature over the issuer's keys, `typ: logout+jwt`, `iss`
     * of the issuer, an `aud` that names only apps of `clientIds`, an `exp` that has not passed, the
     * logout event, a `sid`, a `sub`, a `jti`, and no `nonce`.
     * @throws {InvalidError} For a token that does not verify, or a token that names another app.
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
    /**
     * When Tempo ID issued the token, in milliseconds, from its `iat`. A sign-in of the session
     * whose tokens Tempo ID issued later outlasts the token.
     */
    issuedAt: number
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
