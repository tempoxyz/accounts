/**
 * Verifies Tempo ID access tokens in an API, with the issuer's signing keys, and reads the user,
 * the app, the user's Tempo Accounts, and the app's access keys from their claims.
 * @module
 */
import {
  createRemoteJWKSet,
  customFetch,
  errors,
  type JWTPayload,
  jwtVerify,
} from 'jose'
import { Address } from 'ox'
import { type Config, RequestError } from './Accounts.js'

/** An access token that does not verify, or names an app that the verifier does not allow. */
export class InvalidError extends Error {
  override readonly name = 'AccessToken.InvalidError'

  constructor(options: InvalidError.Options = {}) {
    super(
      'Invalid access token: the token does not verify, has expired, or names an app that the API does not allow. Request a new access token.',
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
 * Creates a verifier of the access tokens that Tempo ID issues to the apps of `clientIds`, or to the
 * instance's own app by default, on jose's remote key set. The verifier holds the issuer's key set
 * for `maxAge`, and fetches it again for a token that names an unknown `kid`, at most once each 30
 * seconds after a successful fetch. Each fetch ends within `timeout`. Create one verifier for each Worker isolate or process.
 *
 * @example
 * ```ts
 * const verifier = AccessToken.create(Accounts.from({ clientId: 'tempo-wallet' }))
 * const token = await verifier.verify({ accessToken })
 * // { accessKeys: [{ account: '0x…', address: '0x…', chainId: 4217 }], accounts: ['0x…'], clientId: 'tempo-wallet', expiresAt: 1767225600000, scope: ['openid', 'email'], userId: 'user_…' }
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
  // jose shares a fetch in flight outside Workers, and on Workers each request fetches the set itself.
  const keys = createRemoteJWKSet(new URL('/oauth2/jwks', auth.url), {
    cacheMaxAge: maxAge,
    cooldownDuration: cooldown,
    timeoutDuration: timeout,
    ...(auth.fetch ? { [customFetch]: auth.fetch } : {}),
  })

  return {
    async verify(verifyOptions) {
      const { payload } = await jwtVerify(verifyOptions.accessToken, keys, {
        algorithms: ['RS256'],
        audience: issuer,
        issuer,
        requiredClaims: ['client_id', 'exp', 'sub'],
        typ: 'at+jwt',
      }).catch((error: unknown) => {
        // Only a check of the token refuses it. A key set that cannot be fetched or imported is
        // unavailable, since the token can still be valid.
        if (refusals.some((refusal) => error instanceof refusal))
          throw new InvalidError({ cause: error })
        throw unavailable(error)
      })
      // Every app's token carries the same audience, so the app's `client_id` decides.
      if (
        typeof payload.client_id !== 'string' ||
        !clientIds.includes(payload.client_id)
      )
        throw new InvalidError()
      return {
        accessKeys: accessKeys(payload),
        accounts: accounts(payload),
        clientId: payload.client_id,
        expiresAt: payload.exp! * 1000,
        scope:
          typeof payload.scope === 'string'
            ? payload.scope.split(' ').filter(Boolean)
            : [],
        userId: payload.sub!,
      }
    },
  }
}

export declare namespace create {
  type Options = {
    /**
     * The client IDs of the apps whose tokens the API accepts. Every other app's token throws.
     * Defaults to the instance's `clientId`.
     */
    clientIds?: readonly string[] | undefined
    /**
     * The `iss` and `aud` of Tempo ID's tokens, its public origin, such as `https://id.tempo.xyz`.
     * Set it when the instance's `url` reaches Tempo ID at another address, such as an internal
     * host. Defaults to the origin of the instance's `url`.
     */
    issuer?: string | undefined
    /**
     * How long the verifier keeps a key set, in milliseconds. The next verification after it
     * fetches the set again, so a key that the issuer removed stops verifying, and throws if that
     * fetch fails. Defaults to 10 minutes.
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
     * Verifies an access token: its RS256 signature over the issuer's keys, `typ: at+jwt`, `iss`
     * and `aud` of the issuer, an `exp` that has not passed, and a `client_id` of `clientIds`.
     * @throws {InvalidError} For a token that does not verify, or another app's token.
     * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched or imported, such
     *   as during an issuer outage.
     */
    verify: (options: VerifyOptions) => Promise<Token>
  }

  /** The options of `verify`. */
  type VerifyOptions = {
    /** The Bearer token that the API received. */
    accessToken: string
  }

  /** A verified access token's claims. */
  type Token = {
    /**
     * The user's live access keys that Tempo ID signed for the app, from `access_keys`: those of
     * the token's own session first, then the others, newest first. Empty for a token that Tempo ID
     * issued before the claim.
     */
    accessKeys: readonly AccessKey[]
    /**
     * The addresses of the user's Tempo Accounts in the app's realms, from `tempo_accounts`, in no
     * order. Empty for a third-party app, whose tokens name no accounts.
     */
    accounts: readonly `0x${string}`[]
    /** The app that received the token. */
    clientId: string
    /** When the token expires, in milliseconds. */
    expiresAt: number
    /** The scopes that the app received. */
    scope: readonly string[]
    /** The user's ID, `user_` and a ULID. */
    userId: string
  }
}

/** An access key that a verified token names, as `create.Token` holds it. */
export type AccessKey = {
  /** The Tempo Account that the access key acts for, checksummed. */
  account: `0x${string}`
  /** The access key's address, its key ID, checksummed. */
  address: `0x${string}`
  /** The ID of the chain where the access key acts. */
  chainId: number
}

/**
 * Returns whether `address` is one of a verified token's accounts, in any letter case. A value that is
 * no address returns `false`.
 *
 * @example
 * ```ts
 * if (!AccessToken.includes(token, { address: transaction.from })) throw forbidden()
 * ```
 */
export function includes(
  token: Pick<create.Token, 'accounts'>,
  options: includes.Options,
): boolean {
  // A value that is no address, such as one from a request, matches no account.
  if (!Address.validate(options.address, { strict: false })) return false
  return token.accounts.some((account) =>
    Address.isEqual(account, options.address),
  )
}

export declare namespace includes {
  type Options = {
    /** The address to look for, such as a transaction's sender. */
    address: `0x${string}`
  }
}

/** Returns the valid entries of the `access_keys` claim, with checksummed addresses. */
function accessKeys(payload: JWTPayload): readonly AccessKey[] {
  const { access_keys } = payload
  if (!Array.isArray(access_keys)) return []
  return access_keys.flatMap((value: unknown) => {
    if (typeof value !== 'object' || value === null) return []
    const entry = value as Record<string, unknown>
    const { account, address, chain_id } = entry
    if (
      typeof account !== 'string' ||
      typeof address !== 'string' ||
      typeof chain_id !== 'number' ||
      !Address.validate(account, { strict: false }) ||
      !Address.validate(address, { strict: false })
    )
      return []
    return [
      {
        account: Address.checksum(account),
        address: Address.checksum(address),
        chainId: chain_id,
      },
    ]
  })
}

/** Returns the valid addresses of the `tempo_accounts` claim, which a third-party app's token lacks. */
function accounts(payload: JWTPayload): readonly `0x${string}`[] {
  const { tempo_accounts } = payload
  if (!Array.isArray(tempo_accounts)) return []
  return tempo_accounts.filter(
    (value): value is `0x${string}` =>
      typeof value === 'string' && Address.validate(value, { strict: false }),
  )
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
