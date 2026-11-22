/**
 * Verifies Tempo ID access tokens in an API, with the issuer's signing keys, and reads the user,
 * the app, the user's Tempo Accounts, and the app's access keys from their claims.
 * @module
 */
import {
  calculateJwkThumbprint,
  EmbeddedJWK,
  errors,
  type JWTPayload,
  jwtVerify,
} from 'jose'
import { Address, Base64, Bytes, Hash } from 'ox'
import { type Config, RequestError } from './Accounts.js'
import * as Dpop from './internal/Dpop.js'
import * as KeySet from './internal/KeySet.js'

/**
 * Thrown by `verifyHash`, `verifyMessage`, and `verifyTypedData` of the `viem` plugin, and by
 * `connections.connect`, for an access token that does not verify, or names an app that the
 * verifier does not allow. A DPoP token, whose `cnf` names a key, also throws it without a valid
 * DPoP proof of that key for the request. `verifyHash`, `verifyMessage`, and `verifyTypedData` thus
 * refuse a DPoP token without `dpop`, and `connections.connect` refuses every DPoP token.
 */
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

/** The `typ` header of an access key request token, which Tempo ID posts to an API's access key endpoint. */
const accessKeyRequestType = 'access-key-request+jwt'

/** How long after its `iat` a DPoP proof verifies, in seconds, as at Tempo ID's own endpoints. */
const proofMaxAge = 300

/**
 * How far a DPoP proof's `iat` may be from the verifier's clock beyond its window, in seconds. The
 * client's device clock sets `iat`, so the tolerance covers its drift.
 */
const proofSkew = 60

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

/** The screening states of the `compliance` claim, as Tempo ID names them. */
const screeningStates = ['blocked', 'clear', 'exit_only', 'pending'] as const

/**
 * Creates a verifier of the access tokens that Tempo ID issues to the apps of `clientIds`, or to the
 * instance's own app by default. A DPoP token verifies only with the request's DPoP proof. The
 * verifier holds the issuer's key set for `maxAge`, as `KeySet.create` of `accounts/internal`
 * describes. A set younger than half of `maxAge` verifies as it is, an older one verifies while a
 * background fetch replaces it, and from `maxAge` a verification waits for a fetch. A token that
 * names an unknown `kid` waits for a fetch, at most once each 30 seconds after the last fetch started and ended.
 * Each fetch ends within `timeout`. The configuration's `keySet` keeps the set beyond the verifier,
 * such as for a new Worker isolate. Create one verifier for each Worker isolate or process.
 *
 * @example
 * ```ts
 * const verifier = AccessToken.create(Accounts.from({ clientId: 'tempo-wallet' }))
 * const [scheme, accessToken] = request.headers.get('authorization')!.split(' ')
 * const token = await verifier.verify({
 *   accessToken: accessToken!,
 *   dpop: { method: request.method, proof: request.headers.get('dpop'), scheme, url: request.url },
 * })
 * // { accessKeys: [{ account: '0x…', address: '0x…', chainId: 4217 }], accounts: ['0x…'], apiAccessKeys: [], boundTo: undefined, clientId: 'tempo-wallet', compliance: { '0x…': 'clear' }, expiresAt: 1767225600000, issuedAt: 1767225300000, proof: { expiresAt: 1767225661000, id: 'Zm9v…' }, scope: ['openid', 'email'], userId: 'user_…' }
 * ```
 */
export function create(
  auth: create.Auth,
  options: create.Options = {},
): create.ReturnType {
  const clientIds =
    options.clientIds ?? (auth.clientId ? [auth.clientId] : undefined)
  if (!clientIds)
    throw new Error(
      'Missing `clientIds`: the configuration names no `clientId`. Name the client IDs, or set `clientId`.',
    )
  const issuer = new URL(options.issuer ?? auth.url).origin
  // Every app can request a token for the issuer's origin, so `'any'` needs a registered resource.
  if (clientIds === 'any' && !options.audience)
    throw new Error(
      "Invalid `clientIds`: `'any'` accepts every app's token for the issuer's origin. Set `audience` to the API's registered resource, or name the client IDs.",
    )
  const audience = options.audience ?? issuer
  // The issuer adds its `userinfo` URL to the audience of every token with the `openid` scope.
  const own = [audience, `${issuer}/oauth2/userinfo`]
  const keys = KeySet.create(auth, {
    maxAge: options.maxAge,
    timeout: options.timeout,
  })

  /** Verifies a JWT of `typ` against the key set, and maps a refusal or an outage. */
  async function check(
    token: string,
    options: { requiredClaims: readonly string[]; typ: string },
  ) {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      audience,
      issuer,
      requiredClaims: [...options.requiredClaims],
      typ: options.typ,
    }).catch((error: unknown) => {
      // Only a check of the token refuses it. A key set that cannot be fetched or imported is
      // unavailable, since the token can still be valid.
      if (refusals.some((refusal) => error instanceof refusal))
        throw new InvalidError({ cause: error })
      throw unavailable(error)
    })
    return payload
  }

  return {
    async verify(verifyOptions) {
      const payload = await check(verifyOptions.accessToken, {
        requiredClaims: ['client_id', 'exp', 'sub'],
        typ: 'at+jwt',
      })
      // jose admits an `aud` that names the audience among others. Another API that a token names
      // holds the token, so a token for any other audience, also beside this one, throws.
      const audiences =
        typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? [])
      if (audiences.some((entry) => !own.includes(entry)))
        throw new InvalidError()
      // Every app may request a token for the audience, so the app's `client_id` decides.
      if (
        typeof payload.client_id !== 'string' ||
        (clientIds !== 'any' && !clientIds.includes(payload.client_id))
      )
        throw new InvalidError()
      // A DPoP token is valid only with a proof of the key that binds it (RFC 9449 §7.1), so a
      // stolen token does not verify without that key.
      const boundTo = thumbprint(payload.cnf)
      // A request with the DPoP scheme asks for proof of possession, which a Bearer token lacks.
      if (
        boundTo === undefined &&
        verifyOptions.dpop?.scheme?.toLowerCase() === 'dpop'
      )
        throw new InvalidError({
          cause: new Error(
            'Invalid authorization scheme: no DPoP key binds the token. Send the token with the Bearer scheme.',
          ),
        })
      // One request can verify its token more than once, such as for two signatures, so the API
      // refuses a repeated proof once per request, in a store that its isolates share.
      const accepted =
        boundTo === undefined
          ? undefined
          : await proof({
              accessToken: verifyOptions.accessToken,
              boundTo,
              dpop: verifyOptions.dpop,
            })
      return {
        accessKeys: accessKeys(payload.access_keys),
        accounts: accounts(payload),
        apiAccessKeys: accessKeys(payload.api_access_keys),
        boundTo,
        clientId: payload.client_id,
        compliance: compliance(payload.compliance),
        expiresAt: payload.exp! * 1000,
        issuedAt:
          typeof payload.iat === 'number' ? payload.iat * 1000 : undefined,
        proof: accepted,
        scope:
          typeof payload.scope === 'string'
            ? payload.scope.split(' ').filter(Boolean)
            : [],
        userId: payload.sub!,
      }
    },
    async verifyAccessKeyRequest(verifyOptions) {
      const payload = await check(verifyOptions.token, {
        requiredClaims: ['chain_id', 'client_id', 'exp', 'jti', 'nonce'],
        typ: accessKeyRequestType,
      })
      // An access key request token names the API alone, so any other audience beside it throws.
      const audiences =
        typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? [])
      if (audiences.length !== 1 || audiences[0] !== audience)
        throw new InvalidError()
      const { chain_id, client_id, jti, nonce } = payload
      if (
        typeof chain_id !== 'number' ||
        typeof client_id !== 'string' ||
        typeof jti !== 'string' ||
        typeof nonce !== 'string'
      )
        throw new InvalidError()
      return {
        chainId: chain_id,
        clientId: client_id,
        expiresAt: payload.exp! * 1000,
        id: jti,
        nonce,
      }
    },
  }
}

export declare namespace create {
  /**
   * The configuration of Tempo ID: an instance's `config`, `Accounts.from`'s result, or only its
   * `url`, such as for an API that is no OAuth app and names `clientIds`.
   */
  type Auth = Pick<Config, 'url'> &
    Partial<Pick<Config, 'clientId' | 'fetch' | 'keySet'>>

  type Options = {
    /**
     * The resource that the API serves, which each token that it accepts names in `aud`: Tempo ID's
     * origin, or a [registered resource](https://github.com/tempoxyz/id/blob/main/docs/resources.md),
     * such as `https://mercator.sh/mcp`. A token that names any other audience, also beside this
     * one, throws. The issuer's `userinfo` URL is allowed beside it. Defaults to `issuer`.
     */
    audience?: string | undefined
    /**
     * The client IDs of the apps whose tokens the API accepts, or `'any'` for every app's token, as
     * a registered resource that any app may call, such as an MCP server. Every other app's token
     * throws. `'any'` needs `audience`, and throws without it. Defaults to the configuration's
     * `clientId`, and throws without one.
     */
    clientIds?: readonly string[] | 'any' | undefined
    /**
     * The `iss` and `aud` of Tempo ID's tokens, its public origin, such as `https://id.tempo.xyz`.
     * Set it when the instance's `url` reaches Tempo ID at another address, such as an internal
     * host. Defaults to the origin of the instance's `url`.
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
     * Verifies an access token: its RS256 signature over the issuer's keys, `typ: at+jwt`, `iss` of
     * the issuer, an `aud` of `audience` and nothing else but the `userinfo` URL, an `exp` that has
     * not passed, and a `client_id` of `clientIds`. A DPoP token also needs `dpop`, whose proof
     * the key of the token's `cnf` signs with ES256 or EdDSA over the request's method and URL,
     * within 5 minutes, with 60 seconds of clock drift. It refuses no repeated proof, which the API
     * refuses with the returned `proof`.
     * @throws {InvalidError} For a token that does not verify, another app's token, or a DPoP token
     *   without a valid proof of its key.
     * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched or imported, such
     *   as during an issuer outage.
     */
    verify: (options: VerifyOptions) => Promise<Token>
    /**
     * Verifies an access key request token, which Tempo ID posts to an API's access key endpoint: its RS256
     * signature, `typ: access-key-request+jwt`, `iss` of the issuer, an `aud` of `audience` alone, and
     * an `exp` that has not passed. Returns its claims. The caller refuses a repeated `id` or
     * `nonce`.
     * @throws {InvalidError} For a token that does not verify.
     * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched.
     */
    verifyAccessKeyRequest: (options: {
      /** The Bearer token of the access key endpoint's request. */
      token: string
    }) => Promise<AccessKeyRequest>
  }

  /** A verified access key request token's claims. */
  type AccessKeyRequest = {
    /** The chain of the access key, from `chain_id`. */
    chainId: number
    /** The app of the connection that the user approves, from `client_id`. */
    clientId: string
    /** When the token expires, in milliseconds. */
    expiresAt: number
    /** The token's unique ID, from `jti`. */
    id: string
    /** The connection nonce, which the redemption sends with the access key's public key. */
    nonce: string
  }

  /** The options of `verify`. */
  type VerifyOptions = {
    /** The access token that the API received, without its `Bearer` or `DPoP` scheme. */
    accessToken: string
    /**
     * The request's DPoP proof. A DPoP token, whose `cnf` names a key, throws without it. A Bearer
     * token throws with the `DPoP` scheme and ignores the rest.
     */
    dpop?: Proof | undefined
  }

  /** A DPoP proof that `verify` checked. */
  type Proof_verified = {
    /** When the proof stops verifying, in milliseconds. */
    expiresAt: number
    /** The proof's `jti`, which the client sets. */
    id: string
  }

  /** The request that a DPoP proof covers (RFC 9449 §4.3). */
  type Proof = {
    /** The request's HTTP method, such as `GET`, as sent: the proof's `htm` must equal it. */
    method: string
    /** The request's `DPoP` header. Absent, a DPoP token throws. */
    proof: string | null | undefined
    /**
     * The scheme of the request's `Authorization` header, such as `DPoP`. A DPoP token throws with
     * any other scheme, such as `Bearer` (RFC 9449 §7.1).
     */
    scheme: string | undefined
    /**
     * The absolute URL that the client requested, as the proof names it, without its query and
     * fragment. Behind a proxy that terminates TLS, pass the API's public URL, not the URL that
     * the server received. A relative URL throws.
     */
    url: string | URL
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
    /**
     * The live access keys that a registered resource's API holds for the token's connection, from
     * `api_access_keys`. Empty for a token whose `aud` names no API with an access key policy, and
     * for a token that Tempo ID issued before the API redeemed the connection's allowance.
     */
    apiAccessKeys: readonly AccessKey[]
    /**
     * The thumbprint of the DPoP key that the token is bound to, from `cnf.jkt`, whose proof
     * `verify` checked. Absent for a Bearer token.
     */
    boundTo: string | undefined
    /** The app that received the token. */
    clientId: string
    /**
     * The screening state of each address of the user's Tempo Accounts, by checksummed address,
     * from `compliance`. An address without an entry has no state, which an API refuses, as it
     * refuses `pending`. Empty for the token of an app without a registration, and for a token
     * without the claim.
     */
    compliance: Readonly<Partial<Record<`0x${string}`, ScreeningState>>>
    /** When the token expires, in milliseconds. */
    expiresAt: number
    /** When Tempo ID issued the token, in milliseconds. Absent for a token without `iat`. */
    issuedAt: number | undefined
    /**
     * The DPoP proof that `verify` checked, absent for a Bearer token. `verify` accepts a proof
     * again within its window, so an API refuses a repeated `id` once per request, in a store that
     * its isolates share, until `expiresAt` (RFC 9449 §11.1).
     */
    proof: Proof_verified | undefined
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
 * The [screening state](https://github.com/tempoxyz/id/blob/main/docs/compliance.md) of an address:
 * `clear` for no high risk, `exit_only` for only an exit of funds, `blocked` for no action, and
 * `pending` for no valid result.
 */
export type ScreeningState = (typeof screeningStates)[number]

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

/**
 * Verifies the access token of `request`: its `Authorization` header with the `Bearer` or `DPoP`
 * scheme, and its `DPoP` header against the request's method and `url`. Returns the verified token,
 * or `undefined` without such a header, and for a token that does not verify, such as another app's.
 * @throws {Accounts.RequestError} With status 0, when the key set cannot be fetched or imported.
 *
 * @example
 * ```ts
 * const token = await AccessToken.verifyRequest(verifier, { request })
 * if (!token) return Response.json({ error: 'invalid_token' }, { status: 401 })
 * ```
 */
export async function verifyRequest(
  verifier: Pick<create.ReturnType, 'verify'>,
  options: verifyRequest.Options,
): Promise<create.Token | undefined> {
  const { request } = options
  const [scheme, accessToken] = (
    request.headers.get('authorization') ?? ''
  ).split(' ')
  if (!scheme || !accessToken) return undefined
  if (!['bearer', 'dpop'].includes(scheme.toLowerCase())) return undefined

  // Behind a proxy that terminates TLS, the proof names the public URL, not `request.url`.
  const url = (() => {
    if (typeof options.url === 'function') return options.url(request)
    if (options.url === undefined) return request.url
    // The request names the path, so a proof of one route does not verify on another. The path
    // joins the origin as text, since a path such as `//host` resolves to another origin.
    const { pathname, search } = new URL(request.url)
    return `${new URL(options.url).origin}${pathname}${search}`
  })()
  try {
    return await verifier.verify({
      accessToken,
      dpop: {
        method: request.method,
        proof: request.headers.get('dpop'),
        scheme,
        url,
      },
    })
  } catch (error) {
    // Another credential in the header, such as an API key, names no token. An outage of the key
    // set throws, since the token can still be valid.
    if (error instanceof InvalidError) return undefined
    throw error
  }
}

export declare namespace verifyRequest {
  type Options = {
    /** The request that carries the access token. */
    request: Request
    /**
     * The public URL of the request, which a DPoP proof names: a function of the request that
     * returns it, or the public origin, to which the path and query of `request.url` apply.
     * Defaults to `request.url`.
     */
    url?: string | ((request: Request) => string) | undefined
  }
}

/**
 * Returns the valid entries of an `access_keys` or `api_access_keys` claim, with checksummed
 * addresses.
 */
function accessKeys(claim: unknown): readonly AccessKey[] {
  if (!Array.isArray(claim)) return []
  return claim.flatMap((value: unknown) => {
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
 * Returns the valid entries of the `compliance` claim, by checksummed address. A token without the
 * claim names no state. An address that two entries name in different letter cases has no state,
 * so neither entry replaces a stricter one.
 */
function compliance(
  claim: unknown,
): Readonly<Partial<Record<`0x${string}`, ScreeningState>>> {
  if (typeof claim !== 'object' || claim === null || Array.isArray(claim))
    return {}
  const entries = Object.entries(claim).flatMap(
    ([address, value]: [string, unknown]) => {
      const state = screeningStates.find((entry) => entry === value)
      if (!state || !Address.validate(address, { strict: false })) return []
      return [[Address.checksum(address), state] as const]
    },
  )
  const counts = new Map<string, number>()
  for (const [address] of entries)
    counts.set(address, (counts.get(address) ?? 0) + 1)
  return Object.fromEntries(
    entries.filter(([address]) => counts.get(address) === 1),
  )
}

/**
 * Verifies the DPoP proof of a request with the DPoP token `accessToken`: its ES256 or EdDSA
 * signature by the key in its header, whose thumbprint is `boundTo`, `typ: dpop+jwt`, the request's
 * method and URL, the token's hash as `ath`, and an `iat` within {@link proofMaxAge}. Returns the
 * proof's `jti`, and when it stops verifying.
 * @throws {InvalidError} For a missing or invalid proof.
 */
async function proof(options: {
  accessToken: string
  boundTo: string
  dpop: create.Proof | undefined
}) {
  const { accessToken, boundTo, dpop } = options
  if (!dpop?.proof)
    throw new InvalidError({
      cause: new Error(
        'Missing DPoP proof: a DPoP key binds the token. Send the request with the DPoP proof.',
      ),
    })
  if (dpop.scheme?.toLowerCase() !== 'dpop')
    throw new InvalidError({
      cause: new Error(
        'Invalid authorization scheme: a DPoP key binds the token. Send the token with the DPoP scheme.',
      ),
    })

  const { payload, protectedHeader } = await jwtVerify(
    dpop.proof,
    EmbeddedJWK,
    {
      algorithms: [...Dpop.algorithms],
      clockTolerance: proofSkew,
      maxTokenAge: proofMaxAge,
      requiredClaims: ['ath', 'htm', 'htu', 'iat', 'jti'],
      typ: 'dpop+jwt',
    },
  ).catch((error: unknown) => {
    throw new InvalidError({ cause: error })
  })
  // A relative URL, such as Node's `req.url`, names no origin, so no proof matches it.
  const url = (() => {
    try {
      return new URL(dpop.url)
    } catch (error) {
      throw new InvalidError({ cause: error })
    }
  })()
  const ath = Base64.fromBytes(Hash.sha256(Bytes.fromString(accessToken)), {
    pad: false,
    url: true,
  })
  if (
    payload.ath !== ath ||
    payload.htm !== dpop.method ||
    payload.htu !== `${url.origin}${url.pathname}` ||
    (await calculateJwkThumbprint(protectedHeader.jwk!)) !== boundTo
  )
    throw new InvalidError({
      cause: new Error(
        'Invalid DPoP proof: the proof names another request, access token, or key. Send a new proof for the request.',
      ),
    })
  return {
    // jose accepts the proof until its age, in whole seconds, exceeds the window and the tolerance.
    expiresAt: ((payload.iat as number) + proofMaxAge + proofSkew + 1) * 1000,
    id: String(payload.jti),
  }
}

/** Returns the `jkt` of a `cnf` claim, the thumbprint of the DPoP key that binds the token. */
function thumbprint(claim: unknown): string | undefined {
  if (typeof claim !== 'object' || claim === null) return undefined
  const { jkt } = claim as { jkt?: unknown }
  return typeof jkt === 'string' ? jkt : undefined
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
