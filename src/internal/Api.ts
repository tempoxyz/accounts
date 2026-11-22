/**
 * Calls Tempo ID's API, and reads its responses into what the actions return.
 * @module
 */
import { Address, Base64, PublicKey } from 'ox'
import type { KeyAuthorization } from 'ox/tempo'
import { Account } from 'viem/tempo'
import type * as Accounts from '../Accounts.js'
import { RequestError } from '../Accounts.js'
import type { Authorization } from './Authorization.js'
import * as Dpop from './Dpop.js'
import * as AccessKey from './AccessKey.js'
import * as TempoAccount from './TempoAccount.js'
import type { Tokens } from './Tokens.js'
import type { User } from './User.js'

/**
 * Builds an authorization from Tempo ID's response and the sign-in's access key: generated material, or
 * the app's `accessKey`. Throws `server_error` for a response without the key authorization.
 */
export function authorization<chainId extends number = number>(
  body: Omit<Headless, 'type'>,
  options: {
    /** Whether the request sent a challenge, whose signature the response then carries. */
    challenged?: boolean | undefined
    material: AccessKey.Material
    /** When the request that issued the tokens started, in milliseconds, as for {@link tokens}. */
    sentAt?: number | undefined
    signer?: Account.Account | undefined
  },
): Authorization<chainId> {
  const { material, sentAt, signer } = options
  // A response to a request with an access key always carries one, so its absence is a fault.
  if (!body.account || !body.key_authorization)
    throw new RequestError({
      code: 'server_error',
      message:
        'Missing key authorization in the response to a request with an access key. Sign in again.',
      status: 200,
    })
  const accessKey = AccessKey.from<chainId>({
    ...material,
    account: body.account,
    keyAuthorization: body.key_authorization,
  })
  const tokens_ =
    'accessToken' in body.tokens ? body.tokens : tokens(body.tokens, { sentAt })
  return {
    ...tokens_,
    signer: AccessKey.toAccount(accessKey, { signer }),
    ...challengeSignature(body, { challenged: options.challenged }),
    accessKey,
    user: user(tokens_),
  }
}

/**
 * Returns the account's signature of the request's challenge from Tempo ID's response, as
 * `challengeSignature`, with the account that signed as `address`, or nothing for a request without
 * a challenge. Throws `server_error` for a request with a challenge whose response carries no
 * signature, so a sign-in never succeeds without the proof that it asked for.
 */
export function challengeSignature(
  body: {
    account?: `0x${string}` | undefined
    challenge_signature?: `0x${string}` | undefined
  },
  options: challengeSignature.Options = {},
): { address?: `0x${string}`; challengeSignature?: `0x${string}` } {
  if (body.account && body.challenge_signature)
    return {
      address: body.account,
      challengeSignature: body.challenge_signature,
    }
  if (options.challenged)
    throw new RequestError({
      code: 'server_error',
      message:
        'Missing challenge signature in the response to a request with a challenge. Update Tempo ID, or sign in without the challenge.',
      signedIn: true,
      status: 200,
    })
  return {}
}

export declare namespace challengeSignature {
  type Options = {
    /** Whether the request sent a challenge, whose signature the response must carry. Defaults to `false`. */
    challenged?: boolean | undefined
  }
}

/** What the headless API returns for an authorization. */
export type Headless = {
  /**
   * The Tempo Account the access key acts for, or that signed the challenge, present for a request
   * with either.
   */
  account?: AccessKey.AccessKey['account'] | undefined
  /** The account's signature of the request's challenge, serialized. */
  challenge_signature?: `0x${string}` | undefined
  /** The signed key authorization, in RPC format, present for a request with an access key. */
  key_authorization?: KeyAuthorization.Rpc | undefined
  /**
   * The user's Tempo Accounts on the chain of the access key, the account that the access key acts
   * for first. Present in the response of `POST /v1/authorize` to a request with an access key.
   */
  tempo?: readonly TempoAccountResponse[] | undefined
  /** The issued tokens, raw from the token endpoint or already read into `Tokens`. */
  tokens: TokenResponse | Tokens
  /**
   * The kind of authorization. Always `tokens`, since a headless request sends no code challenge,
   * so Tempo ID redeems the code.
   */
  type: 'tokens'
  /** Present when the access key's account waits for its upgrade, so the access key signed as its own. */
  upgrade_available?: true | undefined
}

/**
 * Reads a JSON response, and throws a {@link RequestError} for a refusal. A success response
 * without JSON, such as a page of a proxy, throws `server_error`. A success response whose body
 * does not arrive, such as on a dropped connection, throws `server_error` with status 0.
 */
export async function json<value = unknown>(
  response: Response,
): Promise<value> {
  // A request to the issuer sets `redirect: 'manual'`, so a redirect ends it here. React
  // Native's `fetch` ignores the option and follows the redirect, so this check never runs there.
  if (
    response.type === 'opaqueredirect' ||
    Math.trunc(response.status / 100) === 3
  ) {
    // A body that errors before the cancel changes nothing, so the refusal always throws.
    await response.body?.cancel().catch(() => undefined)
    throw new RequestError({
      code: 'redirect_refused',
      message:
        "Refused redirect: the request goes only to the issuer's origin. Set `url` to the issuer's origin.",
      // The issuer did not answer the request, as a browser's opaque redirect reports. Status 0 keeps a
      // refused revocation unanswered in every runtime, so a sign-out does not treat its token as revoked.
      // The code tells it from a network error, since a retry meets the same redirect.
      status: 0,
    })
  }

  // A body that does not arrive is no answer, so retries and transient checks see status 0.
  const text = await response.text().catch(() => undefined)
  if (text === undefined && response.ok)
    throw new RequestError({
      code: 'server_error',
      message:
        'The response ended before its body arrived. Check the connection, then retry the request.',
      status: 0,
    })

  // Some refusals, such as the CSRF check's, return plain text. Every success returns JSON. The
  // parser's error can quote the body, which can hold a token, so the error has no `cause`.
  const body = (() => {
    try {
      return JSON.parse(text ?? '') as value & Partial<ErrorBody>
    } catch {
      return undefined
    }
  })()
  if (!response.ok) throw error(body ?? {}, { status: response.status })
  if (body === undefined)
    throw new RequestError({
      code: 'server_error',
      message:
        "Invalid response: the success response holds no JSON. Check the instance's `url`, then retry the request.",
      status: response.status,
    })
  return body
}

/**
 * Returns whether `error` is the refusal of a redirect that {@link json} throws. Only that refusal has
 * status 0 with the code `redirect_refused`, since an error response from the server keeps its own
 * status, so a server that sends the code in its body does not pass as a refused redirect.
 */
export function redirectRefused(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === 'redirect_refused' &&
    error.status === 0
  )
}

/** An OAuth error response, with Tempo ID's extension members. */
export type ErrorBody = {
  /** The OAuth error code, which `reason` determines. */
  error: string
  /** The fault and its fix. Its wording may change. */
  error_description?: string | undefined
  /** The errors page, at the refusal's `reason`. */
  error_uri?: string | undefined
  /** The request field at fault, as a dotted path. */
  field?: string | undefined
  /** The values the refusal compared. Base units are decimal strings. */
  meta?: Readonly<Record<string, number | string>> | undefined
  /** A stable name for the refusal. The issuer's own errors carry none. */
  reason?: RequestError.Reason | undefined
  /** Whether the refusal followed the user's sign-in, as a backend's `POST /callback` answers. */
  signed_in?: boolean | undefined
}

/** Returns a {@link RequestError} for an OAuth error response, or a refusal without a body. */
export function error(body: Partial<ErrorBody>, options: { status: number }) {
  return new RequestError({
    code: body.error ?? 'server_error',
    field: body.field,
    message:
      body.error_description ??
      body.error ??
      `Request failed with status ${options.status}.`,
    meta: body.meta,
    reason: body.reason,
    signedIn: body.signed_in === true,
    status: options.status,
    uri: body.error_uri,
  })
}

/**
 * Posts JSON to Tempo ID's API with the session cookie, and any other `headers`. With
 * `credentials: 'omit'`, the request sends no cookie, as a route that an access token authenticates
 * needs, since its CORS response admits any origin without credentials.
 */
export function post(
  auth: Accounts.Config,
  path: string,
  options: {
    credentials?: 'include' | 'omit' | undefined
    headers?: Record<string, string> | undefined
    json: unknown
    /** Aborts the request, such as at a deadline. */
    signal?: AbortSignal | undefined
  },
) {
  return (auth.fetch ?? fetch)(new URL(path, auth.url), {
    body: JSON.stringify(options.json),
    credentials: options.credentials ?? 'include',
    headers: { ...options.headers, 'content-type': 'application/json' },
    method: 'POST',
    // A redirect would send the body, such as a code or the client authentication, to another origin.
    redirect: 'manual',
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

/**
 * Returns `auth` with a `fetch` that throws {@link RequestError} with status 0 and `message`
 * when the request receives no response, such as offline. The original error is its `cause`. A sign-in
 * uses it only before the user signs in, so a later failure keeps the `signedIn` error of {@link signedIn}.
 */
export function answered(
  auth: Accounts.Config,
  options: answered.Options,
): Accounts.Config {
  return {
    ...auth,
    fetch: ((input, init) =>
      (auth.fetch ?? globalThis.fetch)(input, init).catch((error: unknown) => {
        throw new RequestError({
          cause: error,
          code: 'server_error',
          message: options.message,
          status: 0,
        })
      })) satisfies typeof globalThis.fetch,
  }
}

export declare namespace answered {
  type Options = {
    /** The message of the error for a request without a response: the fault, then the fix. */
    message: string
  }
}

/**
 * Returns the client authentication fields of the instance: a new client assertion, the client
 * secret, or none for a public app. The issuer, Tempo ID's URL, is the assertion's `aud`, which
 * every endpoint accepts.
 */
export async function clientAuthentication(
  auth: Accounts.Config,
): Promise<Record<string, string>> {
  if (auth.clientAssertion)
    return {
      client_assertion: await auth.clientAssertion({
        audience: auth.url.replace(/\/+$/, ''),
        clientId: auth.clientId,
      }),
      client_assertion_type: clientAssertionType,
    }
  if (auth.clientSecret) return { client_secret: auth.clientSecret }
  return {}
}

/** Milliseconds that a sign-out's logout waits for its response, so a stalled request settles. */
export const logoutTimeout = 10_000

/** Milliseconds that a revocation waits for a response, so a stalled request settles. */
export const revokeTimeout = 10_000

/**
 * Milliseconds that an authorization's check of the browser's Tempo ID session waits for its
 * response, so a stalled check settles, and a page that restores its session leaves `pending`.
 */
export const sessionTimeout = 10_000

/**
 * Revokes a refresh token at `/oauth2/revoke` (RFC 7009), with the app's client authentication. A
 * revocation without a response, such as offline, throws `Accounts.RequestError` with status 0. One
 * still without a response after {@link revokeTimeout} resolves, since it can have reached Tempo ID.
 */
export async function revoke(
  auth: Accounts.Config,
  options: { refreshToken: string },
): Promise<void> {
  const body = new URLSearchParams({
    client_id: auth.clientId,
    token: options.refreshToken,
    token_type_hint: 'refresh_token',
    ...(await clientAuthentication(auth)),
  })
  // React Native's `AbortSignal` has no `timeout`, so a timer aborts the controller. The timer covers
  // the response's body too, so a refusal whose body stalls settles, and it stops once the
  // revocation settles, so it never keeps a process alive.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), revokeTimeout)
  try {
    // Only a fetch that rejects is a revocation without a response. A fault before it, such as in
    // the client assertion, keeps its own error.
    const response = await (auth.fetch ?? fetch)(
      new URL('/oauth2/revoke', auth.url),
      {
        body,
        // A session cookie fails the issuer's origin check, and the revocation needs none.
        credentials: 'omit',
        method: 'POST',
        // A redirect would send the refresh token and the client authentication to another origin.
        redirect: 'manual',
        signal: controller.signal,
      },
    ).catch((error: unknown) => {
      // A revocation that the timer aborts can have reached Tempo ID, and a second revocation counts
      // as a reuse, which revokes the app's tokens on the user's other devices. It counts as
      // answered, as one that a page's unload aborts does.
      if (controller.signal.aborted) return undefined
      throw new RequestError({
        cause: error,
        code: 'server_error',
        message:
          'The revocation received no response. Check the connection, and sign out again.',
        status: 0,
      })
    })
    if (!response) return
    if (response.ok) {
      await response.body?.cancel()
      return
    }
    // An aborted body reads as empty, so the refusal keeps its status.
    await json(response)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A JWT segment: unpadded base64url (RFC 7515 §2). The check runs before a decode, whose padding
 * strip takes quadratic time on a long run of `=` that another character follows.
 */
const segment = /^[\w-]*$/

/** The `client_assertion_type` of a JWT assertion (RFC 7523 §2.2). */
const clientAssertionType =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

/**
 * Returns the headers that send `accessToken` to `url`: the `DPoP` scheme and a new proof for a
 * DPoP token (RFC 9449 §7.1), and the Bearer scheme otherwise. The token's own `cnf` decides, so a
 * Bearer token from before the instance held a key still works. Throws `invalid_dpop_proof` for a
 * DPoP token that the instance's key does not bind, which every API refuses, as {@link checkBound}
 * does, so the caller sends no request.
 */
export async function tokenHeaders(
  auth: Accounts.Config,
  options: { accessToken: string; method: string; url: string | URL },
): Promise<Record<string, string>> {
  const { accessToken, method, url } = options
  checkBound(auth, { accessToken })
  if (!auth.dpop || !bound(accessToken))
    return { authorization: `Bearer ${accessToken}` }
  return {
    authorization: `DPoP ${accessToken}`,
    dpop: await Dpop.proof(auth.dpop, {
      accessToken,
      // Tempo ID's own routes refuse a fast clock's `iat`, and other APIs keep their own window.
      issuer: new URL(url).origin === new URL(auth.url).origin,
      method,
      url,
    }),
  }
}

/**
 * Returns the headers of a request that sends an access token: the headers of `init`, without its
 * `DPoP` header, and with `tokenHeaders`, which {@link tokenHeaders} returns. A Bearer request sends
 * no proof, so a proof in `init` never reaches the API beside it.
 */
export function requestHeaders(
  init: HeadersInit | undefined,
  options: requestHeaders.Options,
): Headers {
  const headers = new Headers(init)
  headers.delete('dpop')
  for (const [name, value] of Object.entries(options.tokenHeaders))
    headers.set(name, value)
  return headers
}

export declare namespace requestHeaders {
  type Options = {
    /** The headers that send the access token, as {@link tokenHeaders} returns them. */
    tokenHeaders: Readonly<Record<string, string>>
  }
}

/**
 * Returns the URL of the page or the worker that runs the instance, or `undefined` outside a
 * browser, such as in Node or React Native. A `location` getter that throws, as in Deno without
 * `--location`, counts as no page.
 */
export function page(): string | undefined {
  // A worker has a `location` but no `document`. React Native has neither.
  if (typeof document === 'undefined' && !('WorkerGlobalScope' in globalThis))
    return undefined
  try {
    return globalThis.location?.href
  } catch {
    return undefined
  }
}

/**
 * Returns whether `page` is on Tempo ID's own scheme and host, such as Tempo ID's own pages. Only there
 * the `Lax` session cookie reaches Tempo ID for certain. A site depends on the public suffix list, and
 * on any frame around the page, which only the browser knows.
 */
export function sameHost(
  auth: Pick<Accounts.Config, 'url'>,
  options: sameHost.Options,
): boolean {
  const own = new URL(auth.url)
  const url = new URL(options.page)
  return url.protocol === own.protocol && url.hostname === own.hostname
}

export declare namespace sameHost {
  type Options = {
    /** The URL of the page or the worker, as {@link page} returns it. */
    page: string
  }
}

/** Returns whether the access token `token` is a DPoP token, whose `cnf` names a key. */
export function bound(token: string) {
  return jkt(token) !== undefined
}

/**
 * Returns the lifetime of the access token `token`, its `exp` after its `iat`, in milliseconds, or
 * `undefined` for a token without both claims.
 */
export function lifetime(token: string) {
  try {
    const payload = token.split('.')[1] ?? ''
    if (!segment.test(payload)) return undefined
    const claims = JSON.parse(Base64.toString(payload)) as {
      exp?: unknown
      iat?: unknown
    }
    if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number')
      return undefined
    return (claims.exp - claims.iat) * 1000
  } catch {
    // A token that does not decode has no known lifetime.
    return undefined
  }
}

/** Returns the thumbprint of the DPoP key that binds the access token `token`, or `undefined` for any other token. */
export function jkt(token: string) {
  try {
    const payload = token.split('.')[1] ?? ''
    if (!segment.test(payload)) return undefined
    const claims = JSON.parse(Base64.toString(payload)) as {
      cnf?: { jkt?: unknown } | undefined
    }
    return typeof claims.cnf?.jkt === 'string' ? claims.cnf.jkt : undefined
  } catch {
    // A token that does not decode is no DPoP token, and the issuer refuses it.
    return undefined
  }
}

/**
 * Milliseconds past a token's `exp` before `expired` returns `true`. A verifier accepts a token up
 * to 60 seconds past `exp`, so a device clock that runs fast keeps the token as long.
 */
const expirySkew = 60_000

/**
 * Returns whether the JWT `token` names an `exp` that passed more than `expirySkew` ago. A token
 * without one that decodes returns `false`, so the caller still sends it, and the issuer or API
 * decides.
 */
export function expired(token: string) {
  try {
    const payload = token.split('.')[1] ?? ''
    if (!segment.test(payload)) return false
    const { exp } = JSON.parse(Base64.toString(payload)) as { exp?: unknown }
    return typeof exp === 'number' && exp * 1_000 + expirySkew <= Date.now()
  } catch {
    return false
  }
}

/**
 * Throws `invalid_dpop_proof` for a DPoP token that the instance's `dpop` key does not bind: the
 * instance holds no key, or another key. Tempo ID and APIs refuse each request with such a token,
 * so the caller sends none.
 */
export function checkBound(
  auth: Accounts.Config,
  options: { accessToken: string },
) {
  if (!unbound(auth, options)) return
  throw new RequestError({
    code: 'invalid_dpop_proof',
    message: auth.dpop
      ? 'Invalid DPoP key: another DPoP key binds the access token. Set `dpop` to the key that bound it, or sign in again.'
      : 'Missing DPoP key: a DPoP key binds the access token. Set `dpop` to the key that bound it, or sign in again.',
    reason: 'invalid_dpop_proof',
    status: 400,
  })
}

/**
 * Returns whether the access token `accessToken` is a DPoP token that the instance's `dpop` key does
 * not bind: the instance holds no key, or another key.
 */
export function unbound(
  auth: Accounts.Config,
  options: { accessToken: string },
) {
  const bound = jkt(options.accessToken)
  if (bound === undefined) return false
  return !auth.dpop || bound !== Dpop.thumbprint(auth.dpop)
}

/**
 * Returns the `DPoP` header of a request to `path` with the instance's DPoP key, or no header
 * without one.
 */
export async function dpop(
  auth: Accounts.Config,
  options: { accessToken?: string | undefined; method: string; path: string },
): Promise<Record<string, string>> {
  if (!auth.dpop) return {}
  return {
    dpop: await Dpop.proof(auth.dpop, {
      accessToken: options.accessToken,
      issuer: true,
      method: options.method,
      url: new URL(options.path, auth.url),
    }),
  }
}

/**
 * Pushes the authorization request `parameters` to `/oauth2/par` (RFC 9126), with any client
 * authentication, and returns the `request_uri` that `/oauth2/authorize` takes in their place. A push
 * without a response, such as offline, throws `Accounts.RequestError` with status 0.
 */
export async function par(auth: Accounts.Config, parameters: URLSearchParams) {
  const body = new URLSearchParams(parameters)
  for (const [name, value] of Object.entries(await clientAuthentication(auth)))
    body.set(name, value)

  // Only a fetch that rejects is a push without a response. A fault in the client assertion keeps
  // its own error.
  const response = await (auth.fetch ?? fetch)(
    new URL('/oauth2/par', auth.url),
    // A redirect would send the client authentication to another origin.
    { body, method: 'POST', redirect: 'manual' },
  ).catch((error: unknown) => {
    throw new RequestError({
      cause: error,
      code: 'server_error',
      message:
        'The authorization request received no response. Check the connection, and sign in again.',
      status: 0,
    })
  })
  return json<{ expires_in: number; request_uri: string }>(response)
}

/**
 * Posts a form to the token endpoint, with the client ID, any client authentication, and a DPoP proof
 * when the instance holds a key. A redirect in place of a response throws `server_error`. The returned
 * `expires_in` counts from the request's start, not from its response.
 */
export async function token(
  auth: Accounts.Config,
  body: Record<string, string>,
) {
  const form = await clientAuthentication(auth)
  // The proof is signed after the client assertion, so a slow signer never ages its `iat`.
  const headers = await dpop(auth, { method: 'POST', path: '/oauth2/token' })
  // Tempo ID issues the token after the request starts, so its lifetime counts from then. A slow
  // response then never extends the session's `expiresAt` past the token's `exp`.
  const sentAt = Date.now()
  const response = await json<TokenResponse>(
    await (auth.fetch ?? fetch)(new URL('/oauth2/token', auth.url), {
      body: new URLSearchParams({
        ...body,
        client_id: auth.clientId,
        ...form,
      }),
      headers,
      method: 'POST',
      // A redirect would send the grant, such as a refresh token, and the client authentication to
      // another origin.
      redirect: 'manual',
    }),
  )
  if (typeof response.expires_in !== 'number') return response
  return {
    ...response,
    // A wall clock that steps back during the request never lengthens the lifetime.
    expires_in: response.expires_in - Math.max(0, Date.now() - sentAt) / 1000,
  }
}

/**
 * Exchanges a refresh token for new tokens with one request to the token endpoint, and sends no
 * retry. A refresh without a response, such as offline, throws `Accounts.RequestError` with status 0.
 */
export async function refresh(
  auth: Accounts.Config,
  options: refresh.Options,
): Promise<Tokens> {
  // Only a fetch that rejects is a refresh without a response. A fault before it, such as in the
  // client assertion or the DPoP proof, keeps its own error.
  const config = {
    ...auth,
    fetch: ((input, init) =>
      (auth.fetch ?? globalThis.fetch)(input, init).catch((error: unknown) => {
        throw new RequestError({
          cause: error,
          code: 'server_error',
          message:
            'The refresh received no response. Check the connection, and refresh again.',
          status: 0,
        })
      })) satisfies typeof globalThis.fetch,
  }
  return tokens(
    await token(config, {
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
    }),
  )
}

export declare namespace refresh {
  type Options = {
    /** The latest refresh token. */
    refreshToken: string
  }
}

/**
 * Builds the Viem account of a Tempo Account from Tempo ID's response, with its keys, the type of
 * the owner that signs its access keys, and its realm. On a chain with configurable accounts, a passkey of
 * the user's signs as an owner, through `getFn`. Elsewhere, the account holds its address alone.
 * Throws `server_error` for a configuration that does not derive the account's address.
 */
export function tempoAccount(
  account: TempoAccountResponse,
  options: tempoAccount.Options = {},
): TempoAccount.TempoAccount {
  // A configuration sorts its owners by address. A cloud wallet signs the account's access keys whenever it
  // is an owner, so it names the account's owner before a passkey does.
  const owner =
    account.config.owners.find((entry) => entry.type !== 'webAuthn') ??
    account.config.owners[0]
  const keys = account.config.owners.map((entry) => ({
    address: entry.owner,
    // A credential whose key derives another address signs for no owner.
    ...(entry.credential && matches(entry.credential, entry.owner)
      ? { credential: entry.credential }
      : {}),
    type: entry.type,
  }))
  const { chainId, owners, salt, threshold, version } = account.config
  try {
    return TempoAccount.deserialize(
      {
        address: account.address,
        // The configuration applies only on a chain with configurable accounts.
        ...(chainId !== undefined
          ? {
              config: {
                owners: owners.map((entry) => ({
                  owner: entry.owner,
                  weight: entry.weight,
                })),
                salt,
                threshold,
                version,
              },
            }
          : {}),
        keys,
        owner: owner.type,
        realm: { id: account.realm.id, name: account.realm.name },
      },
      { getFn: options.getFn },
    )
  } catch (error) {
    if (!(error instanceof TempoAccount.AddressMismatchError)) throw error
    throw new RequestError({
      code: 'server_error',
      message: `Invalid account configuration: it derives ${error.derived}, not ${account.address}. Retry the request.`,
      status: 0,
    })
  }
}

export declare namespace tempoAccount {
  type Options = {
    /** Runs the ceremony of a passkey owner in place of `navigator.credentials.get`. */
    getFn?: Account.fromWebAuthnP256.Options['getFn'] | undefined
  }
}

/** Returns whether the public key of `credential` derives `owner`. */
function matches(
  credential: TempoAccount.TempoAccount.Key.Credential,
  owner: `0x${string}`,
) {
  return Address.isEqual(
    Address.fromPublicKey(PublicKey.fromHex(credential.publicKey)),
    owner,
  )
}

/** A Tempo Account as the API returns it, with the fields that the package reads. */
export type TempoAccountResponse = {
  /** The account's address on the chain of the request. */
  address: `0x${string}`
  /** The account's configuration. */
  config: {
    /** The chain where the configuration applies. Absent where the account is not configurable. */
    chainId?: number | undefined
    /** The owners in the API's order, each with its address and owner type, such as `privy`. */
    owners: readonly [Owner, ...Owner[]]
    /** The 32-byte salt, hex. */
    salt: `0x${string}`
    /** The total owner weight that a signature needs. */
    threshold: number
    /** The configuration version, as a hex quantity. */
    version: `0x${string}`
  }
  /** The account's realm. */
  realm: {
    /** `default`, or a realm that an app's settings name, such as `tempo-cash`. */
    id: string
    /** The display name, such as `Tempo Cash`. */
    name: string
  }
}

/** What the token endpoint returns. A redirect's code adds its key authorization. */
export type TokenResponse = {
  /** The access token for the app's API requests. */
  access_token: string
  /**
   * The Tempo Account the access key acts for, or that signed the challenge, present with
   * `key_authorization` or `challenge_signature`.
   */
  account?: AccessKey.AccessKey['account'] | undefined
  /** The account's signature of the request's challenge, serialized, if any. */
  challenge_signature?: `0x${string}` | undefined
  /** The access token's lifetime, in seconds. */
  expires_in: number
  /** The OIDC ID token, which names the user. A refresh may omit it. */
  id_token?: string | undefined
  /** The signed key authorization that the user approved, if any. */
  key_authorization?: KeyAuthorization.Rpc | undefined
  /** Exchanges for new tokens through `Actions.refresh`. It rotates on every refresh. */
  refresh_token?: string | undefined
}

/**
 * Reads the signed-in user from the ID token of `tokens`. An ID token whose claims do not parse
 * throws `server_error` with status 200, since the response arrived.
 */
export function user(tokens: Tokens): User {
  // The parser's error quotes the claims, which are part of the token, so the refusal quotes none
  // of them and has no `cause`.
  const claims = (() => {
    const refusal = () =>
      new RequestError({
        code: 'server_error',
        message:
          'Invalid ID token: the response holds no ID token whose claims parse. Sign in again.',
        status: 200,
      })
    const payload = tokens.idToken?.split('.')[1] ?? ''
    if (!segment.test(payload)) throw refusal()
    const parsed = (() => {
      try {
        return JSON.parse(Base64.toString(payload)) as unknown
      } catch {
        throw refusal()
      }
    })()
    // Claims that parse, such as `null`, name no user without a string `sub`.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { sub?: unknown }).sub !== 'string'
    )
      throw refusal()
    return parsed as { email: string; sub: string }
  })()
  return { email: claims.email, id: claims.sub }
}

/**
 * Reads a token response into `Tokens`. Its `expires_in` counts from `options.sentAt`, the start of
 * the request that issued the tokens, or from the read without it. A response without a string
 * `access_token` or a finite `expires_in` throws `server_error` with status 200.
 */
export function tokens(
  response: TokenResponse,
  options: tokens.Options = {},
): Tokens {
  // A success response without an access token or a lifetime, such as from a proxy, would save a
  // session that sends no credential and never expires. The refusal quotes none of the response,
  // which can hold a token, and has no `cause`.
  if (
    typeof response.access_token !== 'string' ||
    response.access_token === '' ||
    typeof response.expires_in !== 'number' ||
    !Number.isFinite(response.expires_in)
  )
    throw new RequestError({
      code: 'server_error',
      message:
        "Invalid response: the token response holds no access token or no lifetime. Check the instance's `url`, then retry the request.",
      status: 200,
    })
  const receivedAt = Date.now()
  // A wall clock that steps back during the request never lengthens the lifetime.
  const start = Math.min(options.sentAt ?? receivedAt, receivedAt)
  return {
    accessToken: response.access_token,
    expiresAt: start + response.expires_in * 1000,
    idToken: response.id_token,
    receivedAt,
    refreshToken: response.refresh_token,
  }
}

export declare namespace tokens {
  type Options = {
    /**
     * When the request that issued the tokens started, in milliseconds. Tempo ID issues them during
     * the request, so a slow response never extends `expiresAt` past the token's `exp`. Defaults
     * to the time of the read.
     */
    sentAt?: number | undefined
  }
}

/**
 * Rethrows an error after a sign-in verified as a {@link RequestError} marked `signedIn`. An error
 * without a response, such as a network error, has status 0 and the original as its `cause`.
 */
export function signedIn(
  error: unknown,
  options: signedIn.Options = {},
): never {
  const {
    message = 'Authorization failed after the sign-in, with no response from Tempo ID. The user is signed in, so authorize again.',
  } = options
  if (!(error instanceof RequestError))
    throw new RequestError({
      cause: error,
      code: 'server_error',
      message,
      signedIn: true,
      status: 0,
    })
  throw new RequestError({
    cause: error.cause,
    code: error.code,
    field: error.field,
    message: error.message,
    meta: error.meta,
    reason: error.reason,
    signedIn: true,
    status: error.status,
    uri: error.uri,
  })
}

export declare namespace signedIn {
  type Options = {
    /** The message of an error without a response. Defaults to a message about a failed authorization. */
    message?: string | undefined
  }
}

/**
 * Reads an authorization without an access key: the tokens, the user, and the challenge's signature
 * for a request with one. The tokens' lifetime counts from `options.sentAt`, as for {@link tokens}.
 */
export function withoutAccessKey(
  body: Omit<Headless, 'type'>,
  options: challengeSignature.Options & tokens.Options = {},
): WithoutAccessKey {
  const tokens_ =
    'accessToken' in body.tokens
      ? body.tokens
      : tokens(body.tokens, { sentAt: options.sentAt })
  return {
    ...tokens_,
    ...challengeSignature(body, options),
    user: user(tokens_),
  }
}

/** An authorization without an access key: the tokens and the user. */
export type WithoutAccessKey = Omit<Authorization, 'accessKey' | 'signer'>

/** One owner of a Tempo Account, as the API returns it. */
type Owner = {
  /** The passkey that holds a `webAuthn` owner key of the user's. */
  credential?: TempoAccount.TempoAccount.Key.Credential | undefined
  /** The address of the owner key. */
  owner: `0x${string}`
  /** The owner type, such as `privy` or `webAuthn`. */
  type: string
  /** The owner's signing weight. */
  weight: number
}
