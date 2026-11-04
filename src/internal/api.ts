/**
 * Calls Tempo ID's API, and reads its responses into what the actions return.
 * @module
 */
import { Address, Base64, PublicKey } from 'ox'
import type { KeyAuthorization } from 'ox/tempo'
import { Account } from 'viem/tempo'
import type * as Accounts from '../Accounts.js'
import { RequestError } from '../Accounts.js'
import type { Authorization } from '../Authorization.js'
import * as Dpop from '../Dpop.js'
import * as AccessKey from '../AccessKey.js'
import * as TempoAccount from '../TempoAccount.js'
import type { Tokens } from '../Tokens.js'
import type { User } from '../User.js'

/**
 * Builds an authorization from Tempo ID's response and the sign-in's access key: generated material, or
 * the app's `accessKey`. Throws `server_error` for a response without the key authorization.
 */
export function authorization<chainId extends number = number>(
  body: Headless,
  options: {
    accessKey?: Account.Account | undefined
    material: AccessKey.Material
  },
): Authorization<chainId> {
  const { accessKey, material } = options
  // A response to a request with an access key always carries one, so its absence is a fault.
  if (!body.account || !body.key_authorization)
    throw new RequestError({
      code: 'server_error',
      message:
        'Missing key authorization in the response to a request with a key. Sign in again.',
      status: 200,
    })
  const key = AccessKey.from<chainId>({
    ...material,
    account: body.account,
    keyAuthorization: body.key_authorization,
  })
  const tokens_ =
    'accessToken' in body.tokens ? body.tokens : tokens(body.tokens)
  return {
    ...tokens_,
    accessKey: AccessKey.toAccount(key, { accessKey }),
    key,
    user: user(tokens_),
  }
}

/** What the headless API returns for an authorization. */
export type Headless = {
  /** The Tempo Account the access key acts for, present for a request with an access key. */
  account?: AccessKey.AccessKey['account'] | undefined
  /** The signed key authorization, in RPC format, present for a request with a key. */
  key_authorization?: KeyAuthorization.Rpc | undefined
  /**
   * The user's Tempo Accounts on the chain of the access key, the account that the access key acts
   * for first. Present in the response of `POST /v1/authorize` to a request with an access key.
   */
  tempo?: readonly TempoAccountResponse[] | undefined
  /** The issued tokens, raw from the token endpoint or already read into `Tokens`. */
  tokens: TokenResponse | Tokens
  /** Present when the access key's account waits for its upgrade, so the access key signed as its own. */
  upgrade_available?: true | undefined
}

/** Reads a JSON response, and throws a {@link RequestError} for a refusal. */
export async function json<value = unknown>(
  response: Response,
): Promise<value> {
  // Some refusals, such as the CSRF check's, return plain text.
  const body = (await response.json().catch(() => ({}))) as value &
    Partial<ErrorBody>
  if (!response.ok) throw error(body, { status: response.status })
  return body
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
  },
) {
  return (auth.fetch ?? fetch)(new URL(path, auth.url), {
    body: JSON.stringify(options.json),
    credentials: options.credentials ?? 'include',
    headers: { ...options.headers, 'content-type': 'application/json' },
    method: 'POST',
  })
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

/** Revokes a refresh token at `/oauth2/revoke` (RFC 7009), with the app's client authentication. */
export async function revoke(
  auth: Accounts.Config,
  options: { refreshToken: string },
): Promise<void> {
  const response = await (auth.fetch ?? fetch)(
    new URL('/oauth2/revoke', auth.url),
    {
      body: new URLSearchParams({
        client_id: auth.clientId,
        token: options.refreshToken,
        token_type_hint: 'refresh_token',
        ...(await clientAuthentication(auth)),
      }),
      // A session cookie fails the issuer's origin check, and the revocation needs none.
      credentials: 'omit',
      method: 'POST',
    },
  )
  if (response.ok) {
    await response.body?.cancel()
    return
  }
  await json(response)
}

/** The `client_assertion_type` of a JWT assertion (RFC 7523 §2.2). */
const clientAssertionType =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

/**
 * Returns the headers that send `accessToken` to `url`: the `DPoP` scheme and a new proof for a
 * DPoP token from an instance with a key (RFC 9449 §7.1), and the Bearer scheme otherwise. The
 * token's own `cnf` decides, so a Bearer token from before the instance held a key still works.
 */
export async function tokenHeaders(
  auth: Accounts.Config,
  options: { accessToken: string; method: string; url: string | URL },
): Promise<Record<string, string>> {
  const { accessToken, method, url } = options
  if (!auth.dpop || !bound(accessToken))
    return { authorization: `Bearer ${accessToken}` }
  return {
    authorization: `DPoP ${accessToken}`,
    dpop: await Dpop.proof(auth.dpop, { accessToken, method, url }),
  }
}

/** Returns whether the access token `token` is a DPoP token, whose `cnf` names a key. */
export function bound(token: string) {
  try {
    const claims = JSON.parse(Base64.toString(token.split('.')[1] ?? '')) as {
      cnf?: { jkt?: unknown } | undefined
    }
    return typeof claims.cnf?.jkt === 'string'
  } catch {
    // A token that does not decode is no DPoP token, and the issuer refuses it.
    return false
  }
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
      method: options.method,
      url: new URL(options.path, auth.url),
    }),
  }
}

/**
 * Pushes the authorization request `parameters` to `/oauth2/par` (RFC 9126), with any client
 * authentication, and returns the `request_uri` that `/oauth2/authorize` takes in their place.
 */
export async function par(auth: Accounts.Config, parameters: URLSearchParams) {
  const body = new URLSearchParams(parameters)
  for (const [name, value] of Object.entries(await clientAuthentication(auth)))
    body.set(name, value)
  return json<{ expires_in: number; request_uri: string }>(
    await (auth.fetch ?? fetch)(new URL('/oauth2/par', auth.url), {
      body,
      method: 'POST',
    }),
  )
}

/**
 * Posts a form to the token endpoint, with the client ID, any client authentication, and a DPoP proof
 * when
 * the instance holds a key.
 */
export async function token(
  auth: Accounts.Config,
  body: Record<string, string>,
) {
  return json<TokenResponse>(
    await (auth.fetch ?? fetch)(new URL('/oauth2/token', auth.url), {
      body: new URLSearchParams({
        ...body,
        client_id: auth.clientId,
        ...(await clientAuthentication(auth)),
      }),
      headers: await dpop(auth, { method: 'POST', path: '/oauth2/token' }),
      method: 'POST',
    }),
  )
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
    /** The owners in the API's order, each with its address and key type, such as `privy`. */
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
  /** The Tempo Account the access key acts for, present with `key_authorization`. */
  account?: AccessKey.AccessKey['account'] | undefined
  /** The access token's lifetime, in seconds. */
  expires_in: number
  /** The OIDC ID token, which names the user. A refresh may omit it. */
  id_token?: string | undefined
  /** The signed key authorization that the user approved, if any. */
  key_authorization?: KeyAuthorization.Rpc | undefined
  /** Exchanges for new tokens through `Actions.refresh`. It rotates on every refresh. */
  refresh_token?: string | undefined
}

/** Reads the signed-in user from the ID token of `tokens`. */
export function user(tokens: Tokens): User {
  const claims = JSON.parse(
    Base64.toString(tokens.idToken!.split('.')[1]!),
  ) as { email: string; sub: string }
  return { email: claims.email, id: claims.sub }
}

/** Reads a token response into `Tokens`. */
export function tokens(response: TokenResponse): Tokens {
  return {
    accessToken: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    idToken: response.id_token,
    refreshToken: response.refresh_token,
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

/** Reads an authorization without an access key: the tokens and the user. */
export function withoutKey(body: Headless): WithoutKey {
  const tokens_ =
    'accessToken' in body.tokens ? body.tokens : tokens(body.tokens)
  return { ...tokens_, user: user(tokens_) }
}

/** An authorization without an access key: the tokens and the user. */
export type WithoutKey = Omit<Authorization, 'accessKey' | 'key'>

/** One owner of a Tempo Account, as the API returns it. */
type Owner = {
  /** The passkey that holds a `webAuthn` owner key of the user's. */
  credential?: TempoAccount.TempoAccount.Key.Credential | undefined
  /** The address of the owner key. */
  owner: `0x${string}`
  /** The kind of key that holds it, such as `privy` or `webAuthn`. */
  type: string
  /** The owner's signing weight. */
  weight: number
}
