/**
 * Creates a Tempo ID instance: its configuration, the session of its user, and the namespaces of its
 * plugins.
 *
 * @example
 * ```ts
 * import { Accounts, Plugin } from 'accounts'
 * const accounts = Accounts.create({
 *   accessKey: {
 *     expiry: '1d',
 *     limits: [{ limit: '10', token: 'ousd' }],
 *   },
 *   plugins: [email()],
 * })
 *
 * const session = await accounts.session.get()
 * ```
 * @module
 */
import type * as ClientAssertion from './internal/ClientAssertion.js'
import type * as BackendHandler from './internal/handlers/Backend.js'
import * as BackendOperations from './internal/BackendOperations.js'
import * as AccountActions from './actions/account.js'
import * as AccessKey_internal from './internal/AccessKey.js'
import * as Actions from './internal/Actions.js'
import type * as Connections from './internal/Connections.js'
import * as Handler from './internal/Handler.js'
import type { Dpop } from './internal/Dpop.js'
import * as Api from './internal/Api.js'
import * as Chains from './internal/Chains.js'
import * as ClientId from './internal/ClientId.js'
import * as CliStore from './internal/CliStore.js'
import * as Core from './internal/Core.js'
import * as DefaultStore from './internal/DefaultStore.js'
import * as Hint from './internal/Hint.js'
import * as InstanceChain from './internal/InstanceChain.js'
import * as InternalSession from './internal/Session.js'
import type * as KeySet from './internal/KeySet.js'
import * as Payment from './internal/Payment.js'
import type { Permissions } from './Permissions.js'
import * as Plugin from './Plugin.js'
import type { backend } from './plugins/backend.js'
import type * as React from './react/index.js'
import * as Session from './Session.js'
import type { Store } from './Store.js'
import type * as TempoAccount from './internal/TempoAccount.js'

/**
 * The call needs an access key, but the client's account holds no live access key on the chain:
 * the sign-in requested no access key, its access key expired or the chain holds it revoked, or its
 * access key acts on another chain. Thrown in these cases:
 *
 * - A transaction from the account of a `viem` client whose session holds no access key, outside a
 *   page, or with `retry.accessKey` off for a session with an access key on another chain.
 * - `accounts.viem({ session })` for a session without an access key.
 * - `accounts.pay({ session })` for a session without a live access key on the payment's chain,
 *   unless every access key of the session expired, which throws `Accounts.SignedOutError`.
 * - A charge of `accounts.fetch` or of a payer of `accounts.mpp` that the chain refuses, since it holds
 *   the access key revoked, with the chain's refusal as `cause`.
 */
export class AccessKeyRequiredError extends Error {
  override readonly name = 'Accounts.AccessKeyRequiredError'

  constructor(options: AccessKeyRequiredError.Options = {}) {
    super(
      "The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.",
      { cause: options.cause },
    )
  }
}

export declare namespace AccessKeyRequiredError {
  type Options = {
    /** The chain's refusal of an access key that it holds revoked. Absent otherwise. */
    cause?: unknown
  }
}

/**
 * `switchChain` received a chain ID outside the instance's `chains`, such as a chain that the app
 * does not serve. The call selects nothing.
 */
export class ChainInvalidError extends Error {
  override readonly name = 'Accounts.ChainInvalidError'

  constructor(options: ChainInvalidError.Options) {
    super(
      `Invalid chain ID: ${String(options.chainId)} is not a chain that the instance serves. Pass the ID of a chain in \`chains\`, such as \`tempo.id\`, or add it to \`chains\`.`,
    )
  }
}

export declare namespace ChainInvalidError {
  type Options = {
    /** The chain ID that `switchChain` received. */
    chainId: unknown
  }
}

/**
 * `Accounts.create` or `Accounts.from` received a `chain` that is neither `mainnet`, `testnet`, nor a
 * chain ID, such as the string of an environment variable.
 */
export class ChainNameInvalidError extends Error {
  override readonly name = 'Accounts.ChainNameInvalidError'

  constructor(options: ChainNameInvalidError.Options) {
    super(
      `Invalid chain: ${JSON.stringify(options.chain)} names no chain. Pass \`mainnet\`, \`testnet\`, or the chain's ID as a number.`,
    )
  }
}

export declare namespace ChainNameInvalidError {
  type Options = {
    /** The `chain` that the configuration received. */
    chain: unknown
  }
}

/**
 * Tempo ID lists no chain with the access key's chain ID, so the account of a `viem` client signs
 * no message or typed data on it. Sign in with an access key on a listed chain.
 */
export class ChainUnavailableError extends Error {
  override readonly name = 'Accounts.ChainUnavailableError'

  constructor(options: ChainUnavailableError.Options) {
    super(
      `Tempo ID lists no chain with ID ${options.chainId}, so the account cannot sign on it. Sign in with an access key on a listed chain.`,
    )
  }
}

export declare namespace ChainUnavailableError {
  type Options = {
    /** The access key's chain ID. */
    chainId: number
  }
}

/**
 * `Accounts.create` or `Accounts.from` received no `clientId` outside a browser, where no page's
 * origin can serve as one.
 */
export class ClientIdRequiredError extends Error {
  override readonly name = 'Accounts.ClientIdRequiredError'

  constructor() {
    super(
      "Missing client ID: outside a browser, no page origin can serve as the client ID. Pass `clientId`, from the app's registration.",
    )
  }
}

/**
 * A call of a member of `accounts.connections` on an instance created without the `connections`
 * option. Create the API's instance with `connections: { resource, store }`.
 */
export class ConnectionsRequiredError extends Error {
  override readonly name = 'Accounts.ConnectionsRequiredError'

  constructor() {
    super(
      "Missing `connections`: the instance holds no API access keys. Create the API's instance with `connections: { resource, store }`.",
    )
  }
}

/**
 * A `signOut` with `everywhere` from an app that is not first-party, which Tempo ID refuses to end
 * the user's Tempo ID session for, such as an app whose client ID is an origin, a metadata
 * document's URL, an `app_` ID, or a `cli:` name. The call signs nothing out. Sign out without
 * `everywhere`.
 */
export class EverywhereNotAllowedError extends Error {
  override readonly name = 'Accounts.EverywhereNotAllowedError'

  constructor() {
    super(
      "Invalid sign-out: only a first-party app ends the user's Tempo ID session for every app. Sign out without `everywhere`.",
    )
  }
}

/**
 * Thrown for a call that needs a Tempo ID session, such as `account.get`, `connections`, or a read
 * of the access token, while the instance holds a `local` plugin's session, which Tempo ID issued no
 * tokens for.
 */
export class LocalSessionError extends Error {
  override readonly name = 'Accounts.LocalSessionError'

  constructor() {
    super(
      'The session belongs to a local owner key, which Tempo ID issued no tokens for. Sign in with Tempo ID for this call.',
    )
  }
}

/**
 * A backend's `complete` received a session ID without a redirect in progress, such as a callback
 * that arrived twice, or more than 10 minutes after `start`. Start the sign-in again.
 */
export class PendingNotFoundError extends Error {
  override readonly name = 'Accounts.PendingNotFoundError'

  constructor() {
    super(
      'No sign-in in progress for this session ID, or it started more than 10 minutes ago. Start the sign-in again.',
    )
  }
}

/**
 * A redirect sign-in, such as `backend.start` or `redirect.signIn`, received no `redirectUri` outside
 * a browser, where no page's origin can serve as one. It throws before any request or store write.
 */
export class RedirectUriRequiredError extends Error {
  override readonly name = 'Accounts.RedirectUriRequiredError'

  constructor() {
    super(
      "Missing redirect URI: outside a browser, no page origin can serve as the redirect URI. Pass `redirectUri`, one of the app's registered redirect URIs.",
    )
  }
}

/**
 * A request that Tempo ID refused. Every action and every instance member throws it for a refusal,
 * with the fields of the OAuth error response. Its `message` holds the fault and its fix, from
 * `error_description`. Branch on `reason` instead, since the wording may change.
 *
 * A sign-in that fails after Tempo ID signed the user in empties the instance's session, and
 * revokes the refresh token of the session that it ends. Its error has `signedIn: true`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 *
 * const accounts = Accounts.create()
 *
 * try {
 *   await accounts.authorize()
 * } catch (error) {
 *   if (
 *     error instanceof Accounts.RequestError &&
 *     error.reason === 'limit_exceeds_maximum'
 *   )
 *     showMaximum(error.meta?.maximum)
 * }
 * ```
 */
export class RequestError extends Error {
  override readonly name = 'Accounts.RequestError'
  /**
   * The OAuth error code, such as `invalid_authorization_details`, or `server_error` for a refusal
   * without a JSON body, or for a success response without one. A redirect in place of a response
   * has `redirect_refused`, and a retry meets the same redirect.
   */
  readonly code: string
  /** The request field at fault, as a dotted path, such as `key_authorization.limits.0.limit`. */
  readonly field: string | undefined
  /**
   * The values that the refusal compared, such as `limit` and `maximum`. Base units are decimal
   * strings.
   */
  readonly meta: Readonly<Record<string, number | string>> | undefined
  /**
   * A stable name for the refusal, to branch on, as
   * [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reasons) lists. Errors from
   * the OAuth endpoints at `/oauth2/*` carry none.
   */
  readonly reason: RequestError.Reason | undefined
  /**
   * Whether a sign-in's code or passkey verified before Tempo ID refused the authorization, so the
   * user is signed in. The email and passkey sign-ins set it, and so does the read of the account
   * after a passkey sign-in. An instance empties its session for such an error.
   */
  readonly signedIn: boolean
  /**
   * The HTTP status of Tempo ID's response, or 0 for a request without a response. A redirect in
   * place of a response has status 0, since Tempo ID did not answer the request.
   */
  readonly status: number
  /** The page that explains the error, from `error_uri`. */
  readonly uri: string | undefined

  constructor(options: RequestError.Options) {
    super(options.message, { cause: options.cause })
    this.code = options.code
    this.field = options.field
    this.meta = options.meta
    this.reason = options.reason
    this.signedIn = options.signedIn ?? false
    this.status = options.status
    this.uri = options.uri
  }
}

export declare namespace RequestError {
  type Options = {
    /** The error that caused this one. */
    cause?: unknown
    /** The OAuth `error`. */
    code: string
    /** The request field at fault. */
    field?: string | undefined
    /** The `error_description`. */
    message: string
    /** The values that the refusal compared. */
    meta?: Readonly<Record<string, number | string>> | undefined
    /** The refusal's stable name. Absent from the issuer's own errors. */
    reason?: Reason | undefined
    /** Whether a sign-in verified before the refusal. Defaults to `false`. */
    signedIn?: boolean | undefined
    /** The HTTP status, or 0 without a response. */
    status: number
    /** The `error_uri`. */
    uri?: string | undefined
  }

  /** Each refusal's stable name, as `docs/errors.md` explains. */
  type Reason =
    | 'access_key_changing'
    | 'access_key_endpoint_failed'
    | 'access_key_pending'
    | 'access_key_taken'
    | 'allowance_redeemed'
    | 'already_decided'
    | 'app_exists'
    | 'authorization_expired'
    | 'backend_sign_in_not_permitted'
    | 'body_too_large'
    | 'challenge_not_permitted'
    | 'config_conflict'
    | 'configurable_accounts_disabled'
    | 'connection_mismatch'
    | 'consent_required'
    | 'cross_site_request'
    | 'duplicate_limit'
    | 'duplicate_scope'
    | 'embed_not_permitted'
    | 'employee_required'
    | 'empty_limits'
    | 'empty_scopes'
    | 'expiry_exceeds_maximum'
    | 'expiry_passed'
    | 'foreign_account'
    | 'funding_unavailable'
    | 'google_unavailable'
    | 'insufficient_balance'
    | 'invalid_access_key_endpoint'
    | 'invalid_app'
    | 'invalid_chain'
    | 'invalid_client'
    | 'invalid_client_attestation'
    | 'invalid_client_metadata'
    | 'invalid_code'
    | 'invalid_dpop_proof'
    | 'invalid_expiry'
    | 'invalid_field'
    | 'invalid_id_token_hint'
    | 'invalid_origin'
    | 'invalid_period'
    | 'invalid_public_key'
    | 'invalid_realm'
    | 'invalid_recipients'
    | 'invalid_redirect_uri'
    | 'invalid_resource'
    | 'invalid_scope'
    | 'invalid_target'
    | 'invalid_token'
    | 'limit_exceeds_maximum'
    | 'localhost_not_permitted'
    | 'logout_not_permitted'
    | 'malformed_body'
    | 'missing_key'
    | 'missing_permissions'
    | 'not_configurable'
    | 'origin_required'
    | 'owner_app_taken'
    | 'owner_exists'
    | 'owner_unavailable'
    | 'passkey_limit'
    | 'passkey_link_expired'
    | 'passkey_not_permitted'
    | 'passkey_register_not_permitted'
    | 'payment_declined'
    | 'payment_pending'
    | 'payment_reverted'
    | 'post_logout_redirect_not_permitted'
    | 'public_app'
    | 'pushed_authorization_required'
    | 'quote_changed'
    | 'rate_limited'
    | 'realm_exists'
    | 'realm_in_use'
    | 'recipient_not_permitted'
    | 'registrar_required'
    | 'rejected'
    | 'relying_party_taken'
    | 'resource_exists'
    | 'scope_without_limit'
    | 'session_changed'
    | 'session_required'
    | 'sign_not_permitted'
    | 'sign_out_link_expired'
    | 'signing_key_in_use'
    | 'too_many_signing_keys'
    | 'unexpected'
    | 'unknown_allowance'
    | 'unknown_app'
    | 'unknown_code'
    | 'unknown_endpoint'
    | 'unknown_key'
    | 'unknown_order'
    | 'unknown_realm'
    | 'unknown_resource'
    | 'unknown_screening'
    | 'unknown_session'
    | 'unknown_signing_key'
    | 'unknown_user'
    | 'unsupported_call'
    | 'unsupported_token'
    | 'upgrade_required'
    | 'upstream_unavailable'
    | 'webauthn_rejected'
    | 'webauthn_required'
}

/** A revocation of an access key that the chain holds revoked already. */
export class RevokedError extends Error {
  override readonly name = 'Accounts.RevokedError'

  constructor(options: RevokedError.Options) {
    super(`The access key ${options.accessKey} is already revoked.`)
  }
}

export declare namespace RevokedError {
  type Options = {
    /** The access key's address. */
    accessKey: `0x${string}`
  }
}

/**
 * A Viem client's account read while the instance holds no session, such as by a transaction before
 * the sign-in. Sign in before sending. While the instance reads its saved session, such as in a new
 * run of a CLI, or a sign-in runs, the message names `session.get`. Await it before sending.
 */
export class SignedOutError extends Error {
  override readonly name = 'Accounts.SignedOutError'

  constructor(options: SignedOutError.Options = {}) {
    super(
      options.pending
        ? "The client's account holds no session while the instance reads the saved session or a sign-in runs. Await `session.get()` or the sign-in before sending."
        : "The client's account is signed out. Sign in before sending.",
      { cause: options.cause },
    )
  }
}

export declare namespace SignedOutError {
  type Options = {
    /**
     * The error that ended the session, such as the `Accounts.RequestError` of a refresh token
     * that Tempo ID refuses. Absent otherwise.
     */
    cause?: unknown
    /**
     * Whether the session's status is `pending`: the instance has not read its saved session, or a
     * sign-in runs. Defaults to `false`.
     */
    pending?: boolean | undefined
  }
}

/**
 * A sign-in that another sign-in or a sign-out overtook. The instance keeps the newer session, and
 * the overtaken result is never returned. A sign-in that a sign-out overtook ends the Tempo ID
 * session that it set again.
 */
export class SupersededError extends Error {
  override readonly name = 'Accounts.SupersededError'

  constructor() {
    super(
      'Another sign-in or a sign-out completed while this sign-in was pending. Sign in again.',
    )
  }
}

/**
 * The configuration of an instance, which every action of `Actions` takes. `Accounts.from` returns
 * it with its defaults, and an instance holds it as `accounts.config`.
 */
export type Config = {
  /**
   * `false` signs users in without a Tempo Account: each sign-in requests no access key, and the
   * actions of `Actions` read no Tempo Account, as with their own `account: false`. A page's or a
   * device's sign-in then creates none. A backend's sign-in creates one, unless the app's
   * [first account](https://github.com/tempoxyz/id/blob/main/docs/realms.md#apps-without-a-first-account)
   * is `none`. Absent, each sign-in returns the user's Tempo Account.
   */
  account?: false | undefined
  /** The chain of the app's access keys, unless a sign-in's `accessKey` names another. */
  chainId: number
  /**
   * Signs a new
   * [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions) for
   * each request that authenticates the app, for an app with `private_key_jwt`. Only a backend
   * holds one. Excludes `clientSecret`.
   */
  clientAssertion?: ClientAssertion.Signer | undefined
  /**
   * The app's client ID. In a browser, it defaults to the page's origin. Outside a browser, an
   * instance needs it. It is one of these:
   *
   * - The ID of the app's registration, such as `client_…`, for a registered OAuth app.
   * - The URL of the app's metadata document, for an app that publishes its metadata.
   * - The page's origin, such as `https://app.example`, for a web app without a registration, or a
   *   localhost origin in local development.
   * - `cli:` and the CLI's name, such as `cli:acme-deploy`, for a CLI without a registration, as
   *   [Unregistered CLIs](https://github.com/tempoxyz/id/blob/main/docs/apps.md#unregistered-clis)
   *   describes.
   */
  clientId: string
  /**
   * The app's client secret, which each request that authenticates the app sends. Only a backend
   * holds one. `JSON.stringify` and `util.inspect` of the configuration show it as `[redacted]`.
   */
  clientSecret?: string | undefined
  /**
   * The DPoP key that binds the app's tokens ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)).
   * Each token request sends a proof from it, and Tempo ID issues `DPoP` tokens. Absent, the tokens
   * are Bearer tokens, and an app that
   * [requires DPoP](https://github.com/tempoxyz/id/blob/main/docs/dpop.md#required-proofs) cannot
   * redeem a code. A session's tokens refresh only with the DPoP key that bound them, so a page
   * keeps its DPoP key across loads, as the `dpop` plugin of `accounts/plugins` does in the store.
   * An instance with another DPoP key, or none, refreshes no such session, and its refresh throws
   * `invalid_dpop_proof` without a request. `JSON.stringify` and `util.inspect` of the
   * configuration show only the public members of its `jwk`.
   */
  dpop?: Dpop | undefined
  /** Calls Tempo ID. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch | undefined
  /**
   * Runs the ceremony of a passkey that owns the account, in place of `navigator.credentials.get`,
   * also for a session that the instance restores. The `passkey` plugin sets its own `getFn`.
   */
  getFn?: TempoAccount.deserialize.Options['getFn']
  /**
   * The platform capabilities of the key set that the verifiers of Tempo ID's tokens fetch, such as
   * `AccessToken.create`: a cache that instances share, and a function that keeps background work
   * running. A verifier with `cache` starts from its copy, such as in a new Worker isolate, and
   * fetches the set only without one. `KeySet.cacheApi` of `accounts/cloudflare` returns the
   * capabilities of a Worker. Absent, each verifier keeps the set in memory, and leaves its
   * background fetches to run.
   */
  keySet?: KeySet.Runtime | undefined
  /**
   * Whether a redirect or dialog pushes each authorization request to `POST /oauth2/par`
   * ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), so the browser's URL holds only
   * `client_id` and `request_uri`. `dialog.signIn` pushes it too, and then signs in with a popup.
   * An app that
   * [requires pushed requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md#required-pushed-requests)
   * sets it, or holds a client secret or a client assertion. The plugin of the flow sets it, since
   * `Accounts.create` takes no `par`: the `dialog` and `redirect` plugins take it instead. Defaults
   * to `true` for an instance with `clientSecret` or `clientAssertion`, and to `false` otherwise.
   */
  par?: boolean | undefined
  /**
   * Where Tempo ID redirects back to, such as a mobile app's custom scheme. Register it with the
   * app first. Defaults to the page's origin in a browser. Outside a browser, a redirect sign-in
   * without it throws {@link RedirectUriRequiredError}.
   */
  redirectUri?: string | undefined
  /**
   * The [registered resources](https://github.com/tempoxyz/id/blob/main/docs/resources.md)
   * ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) that each authorization and device code
   * requests, such as an MCP server at `https://mercator.sh/mcp`. Each access token of the grant
   * names them as `aud`. The redemption of the code, each device poll, and each refresh name no
   * `resource`, so their tokens keep the grant's resources. A pushed request names at most one. An
   * unknown or disabled resource fails with
   * [`invalid_target`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_target).
   * Absent, the tokens are for Tempo ID's origin. A sign-in's own `resource` replaces it.
   *
   * Tempo ID's own routes that take an access token, such as `GET /v1/account` and
   * `POST /v1/access-keys/revoke`, refuse a token for a registered resource with
   * [`invalid_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_token), also
   * one whose `aud` names Tempo ID's origin beside it. With `resource`, `account.get` and
   * `connection.get` fail, since they send the session's access token. Use an instance without
   * `resource` for those reads.
   */
  resource?: string | readonly string[] | undefined
  /** The scopes of the app's tokens, always with `openid` and `email`. */
  scope: string
  /**
   * Where the instance keeps its session, and where a redirect keeps its state until Tempo ID
   * redirects back. Defaults to IndexedDB in a browser. Outside a browser, an instance with a
   * `cli:` client ID defaults to the file of `Store.file()`, which every CLI of the user shares:
   * `~/.tempo/id/store.json`, or `id/store.json` in the folder that `TEMPO_HOME` names. Any other
   * instance outside a browser holds a session only with a store, such as on a device or in a CLI
   * with a registered client ID, since a backend's instance serves many users. `Accounts.create`
   * also takes `false`, which refuses the file of a `cli:` client ID.
   *
   * It stores values without serializing them, since a browser access key is a non-extractable
   * `CryptoKey`. With the default, `redirect.signIn` also keeps the PKCE verifier, without the
   * access key, in the tab's `sessionStorage`. A custom `store` holds the whole state of a redirect
   * alone. A popup's item, which its callback page reads, also stays in IndexedDB, which every
   * window of the origin shares, as `dialog.callback` describes. If the browser closes the default
   * store's IndexedDB connection, such as when it deletes the site's data, the next read or write
   * opens a new one. If the store refuses a sign-in's save, the sign-in rejects with the store's
   * error, holds no session, and revokes its refresh token at `POST /oauth2/revoke`. In a browser, a
   * store with `json`, such as `Store.redis`, cannot hold the access key that a sign-in generates,
   * so that sign-in throws a `TypeError` before any request.
   */
  store?: Store | undefined
  /**
   * Where Tempo ID runs, such as `https://id.tempo.xyz` or a self-hosted deployment. The actions
   * call its JSON API under `/v1` and its OAuth endpoints under `/oauth2`.
   */
  url: string
}

/**
 * A Tempo ID instance: its configuration, its session, and the namespace of each plugin. Each
 * plugin's namespace sits beside these members, under the plugin's `id`. No plugin may take the
 * name of a member, or `Accounts.create` throws. The root entry's `Accounts.Accounts` adds the
 * plugins that its `Accounts.create` adds.
 *
 * The members and the plugins' actions throw {@link RequestError} for each refusal of Tempo ID, and
 * the package's other error classes, such as {@link SupersededError} for a sign-in that another
 * sign-in or a sign-out overtook.
 */
export type Accounts<
  plugins extends readonly Plugin.Plugin[] = readonly Plugin.Plugin[],
> = Plugin.Namespaces<plugins> &
  Members<plugins> & {
    /** The user's Tempo Account that Tempo ID selects for the app. */
    account: {
      /**
       * Returns the account on the instance's chain, and creates one for a user who has none in the
       * app's realms, if the app's first realm creates accounts. Outside a browser, such as in a
       * CLI or React Native, the read sends the session's access token, and throws the errors of
       * `session.accessToken`, such as {@link SignedOutError}. There, for a user without an
       * account, it throws `session_required` before the creation request, since only a page's
       * session cookie creates one.
       *
       * A page outside Tempo ID's host sends the session's access token too, since only the browser
       * knows whether the `Lax` session cookie reaches Tempo ID from it. A cross-origin page then
       * sends one CORS preflight. If the session holds no live access token, such as after a
       * refused refresh, or a DPoP token that the instance's `dpop` key does not bind, the page
       * sends the session cookie.
       *
       * A read that the session's access token authenticates, on the instance's chain, saves the
       * account in a session that holds none, such as after a sign-in through a redirect, a dialog,
       * or a device. A later load then restores `session.account` with no request. A session with
       * an access key takes only the account of that access key.
       *
       * @throws {RequestError} When Tempo ID refuses the read, with one of these `reason` values,
       *   which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
       *   - `session_required`: The read sends the session cookie, and the browser holds no Tempo
       *     ID session or withholds the cookie, such as on a page of another site. A page sends the
       *     cookie on Tempo ID's own host, and where its session holds no live access token, or a
       *     DPoP token that the instance's `dpop` key does not bind. Or the user holds no account,
       *     and the instance runs outside a page. The call then throws with status 0, and sends no
       *     creation request.
       *   - `invalid_token`: `accessToken` is expired or revoked, its session ended, or it belongs
       *     to another app. Refresh the tokens, or sign in again.
       *   - `invalid_dpop_proof`: `accessToken` is a DPoP token, and the instance holds no `dpop`
       *     key or another one than the one that bound it. The call sends no request.
       *   - `invalid_field`: The instance's `clientId` is not a valid client ID, `chain` names no
       *     listed chain, or `chainId` is not a listed chain's ID. The call throws the `chainId`
       *     refusal itself, with status 0, before the account request.
       *   - `origin_required`: The request carries no `Origin`, such as from outside a browser, so
       *     it does not prove the app of `clientId`. Call from a page at a redirect URI of the app.
       *   - `rate_limited`: The user exceeded the limit of account reads, or an upstream service
       *     rate limited the request. Retry after `Retry-After` seconds.
       *   - `upstream_unavailable`: An upstream service failed or timed out. Retry later.
       *   - `unexpected`: An unexpected failure. Retry the request.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const account = await accounts.account.get()
       * ```
       */
      get: (
        parameters?: Core.getAccount.Parameters,
      ) => Promise<TempoAccount.TempoAccount | undefined>
      /**
       * Upgrades a wallet.tempo passkey's account to a
       * [configurable account](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md),
       * when a sign-in returns `upgradeAvailable: true`. The session's access key registers first,
       * so it keeps working. The passkey signs once. The session's account then becomes the
       * upgraded account. A cloud wallet's own account from another chain upgrades through
       * `Actions.account.upgrade` with `account` and `chain`. Tempo ID signs that upgrade, so no
       * passkey signs.
       *
       * @throws {RequestError} When Tempo ID refuses the upgrade, with one of these `reason`
       *   values, which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md)
       *   describes:
       *   - `session_required`: The user is not signed in to Tempo ID.
       *   - `configurable_accounts_disabled`: The chain's accounts are not configurable.
       *   - `foreign_account`: The account is not the user's in the app's realms.
       *   - `origin_required`: The request carries no `Origin`, such as from outside a browser, so
       *     it does not prove the app of `clientId`. Call from a page at a redirect URI of the app.
       *   - `owner_exists`: The account is configurable already. With `addOwner`, the account holds
       *     a cloud wallet already.
       *   - `owner_unavailable`: With `addOwner`, the user's cloud wallet holds at least 1 USD on
       *     its own account, or owns another account, or the realm creates none.
       *   - `invalid_field`: The account's passkey did not sign `accessKey`, the access key
       *     expired, no scope of the access key allows a TIP-20 transfer of 0 that registers it, or
       *     the account upgraded before the chain registered the access key.
       *   - `webauthn_required`: The passkey's relying party does not cover the page.
       *   - `webauthn_rejected`: The assertion does not verify, or its step expired. Run the call
       *     again.
       *   - `config_conflict`: The chain holds a configuration that Tempo ID did not send.
       *   - `rate_limited`: The user exceeded the limit of account changes. Retry after
       *     `Retry-After` seconds.
       *   - `upstream_unavailable`: The chain or the sponsor refused or failed a transaction. Retry
       *     later.
       *   - `unexpected`: An unexpected failure. Retry the request.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       * import { email } from 'accounts/plugins'
       *
       * const accounts = Accounts.create({
       *   clientId: 'example-app',
       *   plugins: [email()],
       * })
       * const session = await accounts.email.signIn({ code, email: address })
       * if (session.upgradeAvailable) await accounts.account.upgrade()
       * ```
       */
      upgrade: (
        parameters?: Core.upgradeAccount.Parameters,
      ) => Promise<TempoAccount.TempoAccount>
    }
    /**
     * Requests the app's tokens, and an access key, for the user's Tempo ID session in the
     * browser, with no sign-in. Sets the session, and returns it, or empties it and returns
     * `undefined` when the browser holds no Tempo ID session. If the instance holds no session
     * at the empty result, that result writes nothing to the store, so another tab's sign-in during
     * the call stays.
     * Only a
     * [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps)
     * authorizes this way, and the access key must fit the
     * [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling),
     * unless the app holds `tempo-id:sign`.
     *
     * If neither `Accounts.create` nor the call names an `accessKey`, the renewal of an expired
     * access key that the sign-in named requests its limits, scopes, and lifetime again, for the
     * expired access key's account. The renewal also applies after `session.get` emptied the
     * expired session, in the same instance, until a sign-in or a sign-out. The store no longer
     * holds the expired session, so a later instance, such as after a reload, renews nothing. A
     * renewal never continues without that access key, so in one instance a session with an access
     * key never becomes one without. If Tempo ID refuses that access key, such as for a passkey
     * that must sign it, limits above the headless ceiling, or an account of another user, the
     * authorization throws the refusal, and the session stays empty. The app then shows its
     * sign-in. A refusal of the app, such as `rejected`, a rate limit, and a passkey's ceremony
     * that failed on the page, throw as for any authorization. If the call names another
     * `account`, the renewal requests no such access key. The app's own access key, which the
     * sign-in named by its `publicKey` or as a Viem `account`, renews with no request: the
     * session keeps no signer for it, so the authorization throws `missing_key`, and the app signs
     * in again with its access key.
     *
     * While it runs, `session.status` is `pending`, or `reauthorizing` with the expired session
     * that it renews. If the instance holds a session, or the call renews one, the user most likely
     * holds the browser's Tempo ID session. The call then sends the authorization with no check
     * before it. `session.get` with
     * `reauthorize` restores the saved session and renews it in one call.
     *
     * @throws {RequestError} When Tempo ID refuses the authorization, with one of these `reason`
     *   values, which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
     *   - `foreign_account`: The access key names a Tempo Account that is not the user's.
     *   - `invalid_origin`: The request came from an origin other than the redirect URI's.
     *   - `rejected`: Tempo ID refused the app or its request, or the user holds no Tempo Account
     *     and the app's first realm creates none. A third-party client ID, such as an origin,
     *     rejects with status 400 before any authorization request. Sign in with `dialog.signIn`
     *     or `redirect.signIn`, or from a `cli:` client ID with `device.signIn`.
     *   - `webauthn_required`: A passkey owns the Tempo Account, and the call has no `passkey`,
     *     the passkey's relying party does not cover the page, or the ceremony failed, with its
     *     error as `cause`. Pass `passkey: true`, or authorize through `redirect.signIn`.
     *   - `webauthn_rejected`: The assertion of the passkey step did not verify, or was spent
     *     before.
     * @throws {RequestError} When Tempo ID refuses the access key, with one of these `reason`
     *   values:
     *   - `invalid_chain`, `missing_key`, `missing_permissions`, `invalid_public_key`,
     *     `invalid_expiry`, `expiry_passed`, `empty_limits`, `empty_scopes`, `duplicate_limit`,
     *     `unsupported_token`, `invalid_period`, `scope_without_limit`, `unsupported_call`,
     *     `duplicate_scope`, `invalid_recipients`: The access key breaks a
     *     [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
     *   - `invalid_expiry` or `invalid_period` with status 0: `accessKey.expiry` is not a
     *     whole number of seconds or holds milliseconds, or an `accessKey.limits` `period` is fractional, negative,
     *     or above `Number.MAX_SAFE_INTEGER` seconds. The call throws before any request, also
     *     without a Tempo ID session.
     *   - `invalid_field` with status 0: An `accessKey.limits` entry is negative. The call throws
     *     before any request, also without a Tempo ID session.
     *   - `empty_limits` or `empty_scopes` with status 0: `accessKey.limits` or `accessKey.scopes`
     *     is empty. The call throws before any request, also without a Tempo ID session.
     *   - `expiry_passed`, `duplicate_limit`, or `invalid_public_key` with status 0:
     *     `accessKey.expiry` has passed, two `accessKey.limits` name one token, or
     *     `accessKey.publicKey` holds no uncompressed public key. The call throws before any
     *     request, also without a Tempo ID session.
     *   - `missing_key` with status 0: The renewal of an expired access key that the sign-in named
     *     by its `publicKey` or as a Viem `account` finds no signer in the session. The call throws
     *     before any request. Sign in again with the app's access key.
     *   - `duplicate_scope` or `invalid_recipients` with status 0: Two `accessKey.scopes` name
     *     one call on a target, or `spenders` or a scope's `recipients` hold the zero address or
     *     a repeated address. The call throws before any request, also without a Tempo ID session.
     *   - `expiry_exceeds_maximum`, `limit_exceeds_maximum`: The access key exceeds the headless
     *     [ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An
     *     app with `tempo-id:sign` has no ceiling.
     *   - `access_key_pending`: The access key has a key authorization with other limits or
     *     scopes, which the chain has not registered. Send a new access key.
     *   - `challenge_not_permitted`: The app sent a `challenge` without the `tempo-id:sign` scope.
     * @throws {RequestError} With `invalid_field`, `rate_limited`, `upstream_unavailable`, or
     *   `unexpected`, when a field is missing or malformed, or a retry later may succeed.
     * @throws {RequestError} With `server_error` and status 0, when the check of the browser's
     *   Tempo ID session or the authorization receives no response, such as offline, or the check
     *   receives none within 10 seconds. The session stays as it was. Authorize again.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     *
     * const accounts = Accounts.create()
     * const session = await accounts.authorize()
     * ```
     */
    authorize: (
      parameters?: Core.authorize.Parameters,
    ) => Promise<Core.authorize.ReturnType>
    /**
     * The instance's chain: the configured `chain`, or the chain that `switchChain` selected,
     * also at an earlier load. `get` returns the configured chain until the stored selection
     * loads, which the first read of the session waits for. An email, device, or redirect sign-in
     * waits for it too, and a page starts it at creation. `subscribe` calls `listener` at each
     * change, and returns the function that unsubscribes.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     * import { useSyncExternalStore } from 'react'
     *
     * const accounts = Accounts.create()
     * const chainId = useSyncExternalStore(
     *   accounts.chain.subscribe,
     *   accounts.chain.get,
     * )
     * ```
     */
    chain: Pick<Plugin.Context['chain'], 'get' | 'subscribe'>
    /**
     * The instance's configuration, with its defaults, which every action of `Actions` takes. Its
     * `chainId` returns the instance's chain at each read, so every action and plugin follows
     * `switchChain`.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     *
     * const accounts = Accounts.create()
     * const { chainId, clientId } = accounts.config
     * ```
     */
    config: Config
    /**
     * The connection of the instance's user and app: the app, and the live access keys that the app
     * and the APIs of its connection hold. A member called without a session during an
     * authorization waits for it, as `session.accessToken` does. Each member throws
     * {@link SignedOutError} without a session.
     */
    connection: {
      /**
       * Ends the connection at `POST /v1/connection/disconnect`, with the session's access token:
       * Tempo ID removes the app's consent and tokens, then revokes each live
       * access key of it with the account's cloud wallet, the app's own and those that APIs hold.
       * `remaining` lists each live access key that Tempo ID could not revoke, such as one of an
       * account that only a passkey owns, which the user revokes on Tempo ID's connections page.
       * The instance then signs out, unless a session of another user committed during the request,
       * and keeps the user's Tempo ID session. The sign-out sends no revocation of the refresh token
       * that the disconnection revoked. A revocation of a newer one without an answer rejects
       * nothing, since Tempo ID revoked the app's tokens. A failed erasure of the stored session
       * rejects.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * await accounts.connection.disconnect()
       * ```
       */
      disconnect: () => Promise<AccountActions.disconnect.ReturnType>
      /**
       * Returns the connection at `GET /v1/connection`: the app, and its live access keys, newest
       * first, with each one's `holder`, `{ kind: 'app' }`, or `{ kind: 'api', identifier, name }`
       * for an API that holds it for the connection.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const { accessKeys } = await accounts.connection.get()
       * ```
       */
      get: () => Promise<AccountActions.Connection>
    }
    /**
     * The connections of a
     * [registered resource's](https://github.com/tempoxyz/id/blob/main/docs/resources.md) API,
     * such as a paid MCP server: for each user's connection of an app, the API access key that the
     * API holds. Each member throws
     * {@link ConnectionsRequiredError} on an instance created without `connections`.
     */
    connections: {
      /**
       * Verifies an app's access token for the resource, and returns its claims and its
       * connection, with the
       * [API access keys](https://github.com/tempoxyz/id/blob/main/docs/api-access-keys.md) that
       * the API holds for it. The token verifies by its RS256 signature, `typ: at+jwt`, `iss`, an
       * `aud` of `resource` and nothing else but the `userinfo` URL, `exp`, and a `client_id` of
       * `clientIds`. It claims each access key that
       * the access key endpoint prepared and the token names, and otherwise, without a live access key,
       * redeems the connection's allowance for a new one.
       *
       * The redemption at `POST /v1/access-keys/connect` depends on the resource's access key
       * policy:
       *
       * - With an access key endpoint, the access key endpoint of `handler` prepared the access key
       *   at the approval. The first token of the connection names it in `api_access_keys`, and
       *   the call redeems it with the access key request's `nonce`.
       * - Without one, the call generates a secp256k1 access key, writes its private key to the
       *   store, and redeems the allowance for it.
       *
       * Later calls return the stored access keys without a request. Concurrent calls of one
       * connection redeem once, since the instance serializes them, so one process serves every
       * request of a connection. If a redemption ends without a response, the next call sends the
       * same public key. Tempo ID returns the same key authorization, or refuses the public key
       * with `access_key_pending` if the user approved other limits or scopes since. If the chain
       * does not answer Tempo ID, that refusal is `upstream_unavailable`, and the call keeps the
       * private key for the next call. A token that Tempo ID issues more than a minute after the
       * last redemption names every live access key in `api_access_keys`, so the connection drops
       * the others, as after a revocation. Without a
       * live access key, the call redeems the connection's allowance again. If Tempo ID refuses it
       * with `allowance_redeemed`, the access key that the allowance delivered is live, so the call
       * keeps the stored access keys, whatever the local clock says. If Tempo ID refuses it with
       * `unknown_allowance` or `connection_mismatch`, the call keeps no access key that the token
       * omits, and throws the refusal when none remains.
       *
       * @throws {AccessToken.InvalidError} When the token does not verify, has expired, names
       *   another audience, or belongs to an app outside `clientIds`. The API responds with 401.
       *   Since later calls send no request, the call also refuses each DPoP-bound token, whose
       *   `cnf` names a DPoP key.
       * @throws {RequestError} When Tempo ID refuses the redemption, with one of these `reason`
       *   values, which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md)
       *   describes:
       *   - `access_key_pending`: The access key has a key authorization with other limits or
       *     scopes, which the chain has not registered. The next call sends a new one.
       *   - `access_key_taken`: Another app or connection holds the access key. The next call
       *     sends a new one.
       *   - `allowance_redeemed`: The allowance was redeemed for another access key, or another
       *     request signs it. Retry after a minute.
       *   - `connection_mismatch`: The `nonce` or public key of a prepared access key does not
       *     match the allowance, such as after a new approval. The call discards that access key,
       *     and redeems the next one.
       *   - `invalid_client`: The client authentication fails, or names another OAuth app than the
       *     policy. Without `clientSecret` or `clientAssertion`, the call throws it before any
       *     request.
       *   - `invalid_token`: Tempo ID refuses the token, such as a DPoP token.
       *   - `rate_limited`: Too many requests from the API or for the user. Retry later.
       *   - `unknown_allowance`: The user approved no connection, the approval expired, or the
       *     app's grant ended. The app authorizes again.
       *   - `upstream_unavailable`: A service that Tempo ID depends on failed, such as the chain.
       *     The call keeps the private key that it sent. Retry later.
       *   - `webauthn_required`: Only a passkey owns the account, which cannot approve a
       *     connection.
       * @throws {RequestError} With status 0, when the issuer's key set cannot be fetched, as
       *   during an outage.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       * import { mpp } from 'accounts/mpp'
       *
       * const accounts = Accounts.create({
       *   clientId,
       *   clientSecret,
       *   connections: { resource: 'https://api.example/mcp', store },
       *   plugins: [mpp()],
       * })
       * const { connection, token } = await accounts.connections.connect({
       *   accessToken,
       * })
       * await accounts.mpp({ session: connection }).fetch(upstream)
       * ```
       */
      connect: (
        parameters: Connections.attach.connect.Parameters,
      ) => Promise<Connections.attach.connect.ReturnType>
      /**
       * Returns the stored connection of the app `clientId` and the user `userId`, without a token
       * and without a request, such as for a payment outside a request. Returns `undefined`
       * without a live access key.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create({
       *   clientId,
       *   clientSecret,
       *   connections: { resource: 'https://api.example/mcp', store },
       * })
       * const connection = await accounts.connections.get({ clientId, userId })
       * ```
       */
      get: Connections.attach.ReturnType['get']
      /**
       * Revokes every access key of the connection on its chain at `POST /v1/access-keys/revoke`,
       * with the API's client authentication and no user token, then deletes the connection.
       * Returns the receipts of the revoking transactions. An access key that Tempo ID holds no
       * longer sends none. If a revocation fails, its access key stays, and the call throws.
       *
       * @throws {RequestError} When Tempo ID refuses a revocation, with a `reason` that
       *   `connections.connect` lists, such as `invalid_client`. A refusal with `unknown_key`
       *   throws nothing, since the call counts that access key as revoked.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create({
       *   clientId,
       *   clientSecret,
       *   connections: { resource: 'https://api.example/mcp', store },
       * })
       * await accounts.connections.revoke({
       *   clientId: token.clientId,
       *   userId: token.userId,
       * })
       * ```
       */
      revoke: Connections.attach.ReturnType['revoke']
      /**
       * Revokes one access key of the connection on its chain, and removes it from the connection.
       * Returns the receipt, or `null` when the connection holds no such access key, or Tempo ID
       * holds it no longer. Throws {@link RequestError} for a refusal, as `connections.revoke`
       * does.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create({
       *   clientId,
       *   clientSecret,
       *   connections: { resource: 'https://api.example/mcp', store },
       * })
       * await accounts.connections.revokeAccessKey({
       *   accessKey: connection.accessKey.keyAuthorization.keyId,
       *   clientId,
       *   userId,
       * })
       * ```
       */
      revokeAccessKey: Connections.attach.ReturnType['revokeAccessKey']
    }
    /**
     * The handler of the instance's server routes, as a function of the Fetch API, under the
     * `handler` option's `basePath`: `POST /access-keys`, the access key endpoint of a policy, with
     * `connections`, `GET /client.json`, the app's metadata document, with `connections.metadata`,
     * `/auth/login`, `/auth/callback`, `POST /auth/logout`, and
     * `GET /auth/session` with the `backend` plugin, `POST /auth/siwe/challenge`,
     * `POST /auth/siwe`, and `POST /auth/siwe/verify` with the `siwe` plugin, and `POST /relay` with the `relay` plugin
     * and `handler.relay`. Any other request receives 404. Mount it on the app's server, such as
     * `app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))`. With `connections.metadata`, it
     * also serves the protected resource metadata at `/.well-known/oauth-protected-resource` and the
     * resource's path, outside `basePath`, so the app routes that path to it too. The metadata's
     * policy names the handler's `/access-keys` route as its access key endpoint.
     *
     * It runs in any server that serves Fetch requests, such as Hono, a Worker, or Bun. One mount
     * routes each request. Each route matches its exact path only, without a trailing slash, so a
     * guard of the host's router on the same path runs for each request that the route serves. The
     * router loads at the first request, so a page's bundle holds none of it.
     *
     * The relay accepts each signed-in user of the app, so each one can spend the fee payer's
     * balance. Limit callers with the `relay` plugin's `authorize`. With `verify: false`, the relay
     * checks no caller. Tempo ID calls `/access-keys` without the app's session, so then guard the
     * exact `/relay` path, such as with `app.use('/accounts/relay', requireSession)`.
     *
     * The
     * [access key endpoint](https://github.com/tempoxyz/id/blob/main/docs/api-access-keys.md#access-key-endpoint)
     * verifies the access key request token with the issuer's signing keys: its RS256 signature,
     * `typ: access-key-request+jwt`, `iss`, an `aud` of `resource` alone, and `exp`. It refuses a
     * repeated `jti` or `nonce` with 401. It then generates a secp256k1 access key, keeps it under
     * the token's app until a redemption claims it or `pendingLifetime` passes, and returns
     * `{ key_type, public_key }`. A key set that cannot be fetched receives 503. The policy's
     * `accessKeyEndpoint` is the route's URL, such as `https://api.example/accounts/access-keys`.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     *
     * const accounts = Accounts.create({
     *   clientId,
     *   clientSecret,
     *   connections: { resource: 'https://api.example/mcp', store },
     *   handler: { basePath: '/accounts' },
     * })
     *
     * app.all('/accounts/*', (c) => accounts.handler.fetch(c.req.raw))
     * ```
     */
    handler: Handler.Handler
    /**
     * Requests one payment from the user's Tempo Account on Tempo ID's payment page, in a frame in
     * a dialog or in a popup window, and resolves with the hash of the transaction once the chain
     * includes the transfer. The account's owner signs on the page, and Tempo ID's sponsor pays the
     * network fee. With the `viem` plugin, the session's access key sends the transfer in place of
     * the page, if it signs on the chain, acts for the account, and its limits hold the amount. The
     * access key's transaction pays its own fee, or the plugin's relay sponsors it. Its own fee
     * spends the limit of the fee token, so a payment in the fee token or in a `USD` stablecoin other than MACH leaves 0.1 of its limit for the fee, on a page. In a frame, the
     * payment page loads in a hidden dialog while the access key's transfer runs, so a transfer that
     * lands shows no dialog. On a page, a transfer that the chain refuses for a low balance opens the
     * deposit page, unless the plugin's `retry` turns off `balance`, and the access key sends again
     * once the deposit arrives. A close of the deposit page rejects with
     * `Plugins.viem.RetryClosedError`. On a page, the payment page shows after a transfer that the
     * chain refuses for the access key, such as for its scopes or a spent limit, or for a balance
     * that is still low after the deposit. Without `account`, the session's account on the chain pays. The
     * instance reads the stored session first, and Tempo ID only if the session holds no account.
     * A third-party client ID, such as an origin, sends no read, and the payment page picks the
     * account. So does a session that signed in without a Tempo Account on an instance with
     * `account: false`, so the read creates no account. Outside a page, a call without a session throws {@link SignedOutError} before any request.
     * Call it in a click handler, with `account` for a popup on another chain than the instance's,
     * since a popup opens only before any read. Throws the
     * errors of `Actions.account.pay`, and {@link SignedOutError} without an account.
     *
     * With `challenge`, a sign-in message from the app's server, such as from `siwe.start`, the
     * payment needs no session: the page signs the user in if needed, pays from the account
     * selected for the app or the user's oldest without `account`, and Pay also has the account sign the message. The access key
     * never sends such a payment. The call resolves with `address` and `challengeSignature`
     * beside `transaction`, which the server verifies with `siwe.complete`. A function
     * `challenge` runs at the call, so its request runs while the dialog or the popup opens.
     *
     * With the `siwe` plugin's `auth`, a payment without `account`, while the instance holds no
     * session, signs the user in to the app's routes in the same way, and the call
     * resolves with the verify route's result as `auth`, such as `{ token }`. A failed
     * verification resolves with `authError` in place of `auth`, since the transfer landed.
     *
     * With `session`, a fixed session such as the one that `session.get(request)` returns on a
     * backend, that session's access key sends the payment with the `viem` plugin, in place of the
     * instance's session. The access key on the payment's chain names the account, so the call reads
     * neither the store nor Tempo ID. Outside a page, a payment that the access key does not send,
     * such as one above its limits, throws `Actions.account.PageRequiredError` once the access key's
     * attempt ends. A payment above what is left of a limit, which only the node knows, throws it
     * with the node's refusal as its `cause`. On an instance without a plugin that sends a payment,
     * such as `viem`, it throws at once outside a page, with a message that names the missing plugin.
     * A session whose every access key expired throws {@link SignedOutError} before any request, as
     * its `viem` client and `mpp` payer do. A session without a live access key on the payment's
     * chain otherwise throws {@link AccessKeyRequiredError} before any request. Both apply also with
     * `account`. An `account` other than
     * that access key's account throws {@link RequestError} with the reason `invalid_field` and the
     * field `account`. With `challenge`, the call ignores `session`.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     *
     * const accounts = Accounts.create()
     *
     * button.onclick = async () => {
     *   const { transaction } = await accounts.pay({
     *     amount: '50',
     *     memo: 'order-123',
     *     note: 'Pro plan, November',
     *     to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
     *     token: 'ousd',
     *   })
     *
     *   const { message } = await (await fetch('/api/auth/siwe/challenge', { method: 'POST' })).json()
     *   const { address, challengeSignature } = await accounts.pay({
     *     amount: '1',
     *     challenge: message,
     *     to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
     *     token: 'ousd',
     *   })
     * }
     *
     * // On a backend, the access key of the request's session pays.
     * const session = await accounts.session.get(request)
     * if (session?.method === 'tempo-id')
     *   await accounts.pay({
     *     amount: '1',
     *     session,
     *     to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
     *     token: 'ousd',
     *   })
     * ```
     */
    pay: <
      const parameters extends AccountActions.pay.Parameters &
        Pick<Payment.Payment, 'session'>,
    >(
      parameters: parameters,
    ) => Promise<AccountActions.pay.ReturnType<parameters> & PayAuth<plugins>>
    /** The session of the instance's user. */
    session: {
      /**
       * Returns a live access token of the session, such as for a request that `session.fetch`
       * does not send. If the access token expires within 30 seconds, the tokens refresh beside
       * the call, as `session.refresh` does, and the call returns the current access token. Only a
       * token that expires within 5 seconds waits for the refresh, and throws its errors.
       * Concurrent calls share one refresh. A call without a session during an authorization, such
       * as the renewal of an expired access key while the status is `reauthorizing`, waits for its
       * session.
       *
       * A call from a function `reauthorize` or a plugin's `restore` hook waits for no
       * authorization, since that authorization waits for it. The instance cannot tell such a call
       * from another one. While the callback runs, every call waits only for the authorizations
       * that the callback starts, such as `authorize`, and throws {@link SignedOutError} otherwise.
       *
       * @throws {SignedOutError} Without a session, when the access token expires within 5 seconds
       *   and the session holds no refresh token, such as after a sign-in without `offline_access`,
       *   when Tempo ID refuses the refresh token of an expired access token, such as a revoked one,
       *   with its `RequestError` as `cause`, when the refresh finds another user's session or
       *   none, and when the renewal signs in another user.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const accessToken = await accounts.session.accessToken()
       * ```
       */
      accessToken: () => Promise<string>
      /**
       * The XState actor of the session, or `undefined` for an instance without a session, such as
       * a backend's. Its snapshot's `value` is the status, `pending`, `reauthorizing`, `signedIn`,
       * or `signedOut`, and its `context.session` is the session. Read it, and send it no event: the
       * instance's actions change the session. Its `subscribe` calls its observer at each change,
       * such as for `useSelector` from `@xstate/react`.
       *
       * ```mermaid
       * stateDiagram-v2
       *   [*] --> pending
       *   pending --> signedIn: saved session, or sign-in
       *   pending --> reauthorizing: saved session expired, authorization runs
       *   pending --> signedOut: no session
       *   reauthorizing --> signedIn: authorization returns a session
       *   reauthorizing --> signedOut: no Tempo ID session
       *   signedOut --> pending: authorization starts
       *   signedOut --> signedIn: sign-in
       *   signedIn --> signedOut: signOut, or the access key expires
       * ```
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const subscription = accounts.session.actor!.subscribe((snapshot) => {
       *   if (snapshot.matches('signedOut')) showSignIn()
       * })
       * ```
       */
      actor: InternalSession.machines.session.Actor | undefined
      /**
       * Sends a request with the session's access token, as `Actions.fetch` does: with the `DPoP`
       * scheme and a new proof of the instance's `dpop` key for the request's method and URL, for a
       * DPoP token, and the Bearer scheme otherwise. If the access token expires within 30
       * seconds, the tokens refresh beside the request, and only an access token that expires
       * within 5 seconds waits for the refresh, and throws its errors. A call without a session
       * during an authorization, such as the renewal of an expired access key, waits for its
       * session. An abort of `init.signal` rejects at once, also during that wait, with the
       * signal's `reason`, or an `AbortError` without one, as with React Native's `AbortSignal`.
       * The access token step runs first, so a refresh or {@link SignedOutError} can come before
       * the `TypeError` of a relative `url` outside a page. A browser tab's sign-out that waits for
       * the refresh revokes its new tokens after the request.
       *
       * With the `backend` plugin, `fetch(request, parameters)` sends the request with the access
       * token of the session that the server request's session cookie names, after a refresh if
       * necessary. It returns `undefined` without that session, and for a SIWE session, which holds
       * no access token.
       *
       * @throws {SignedOutError} Without a session, when the access token expires within 5 seconds
       *   and the session holds no refresh token, and when Tempo ID refuses the refresh token of an
       *   expired access token, such as a revoked one, with Tempo ID's `RequestError` as `cause`. The call sends
       *   no request to the API. The refresh reads the store first, so it also throws when another
       *   context, such as another tab, signed out or signed in another user before that read.
       * @throws {RequestError} With `invalid_dpop_proof` and status 400, when the access token is a
       *   DPoP token, and the instance holds no `dpop` key or another one than the one that bound
       *   it. The call sends no request.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const response = await accounts.session.fetch({ url: 'https://api.example/me' })
       * ```
       */
      fetch: SessionFetch<plugins>
      /**
       * Returns the session. The first call reads the saved session, and each call first runs the
       * plugins' `restore` hooks, such as the `redirect` plugin's, which completes a redirect's
       * callback. Returns `undefined`, empties the session, and revokes its refresh token at
       * `POST /oauth2/revoke`, when the saved access key expired. The revocation runs beside a
       * renewal, and a failed one rejects nothing. If that revocation receives no response, such
       * as offline, the store keeps the refresh token, or the instance when the store refuses it,
       * and the next `signOut` revokes it. A call that finds no session while an authorization
       * runs, such as `authorize` beside a sign-in, waits for it and returns its session. Makes no
       * other request unless a hook does.
       *
       * With `reauthorize`, a call that finds no session, or an expired one, authorizes the
       * browser's Tempo ID session, as `authorize` does, unless a sign-out without `everywhere`
       * followed the last sign-in, since the Tempo ID session stays. A `signedOut` status then
       * stays `signedOut` through the call. An authorization that runs already returns its session
       * first, so the call sends no second one. Overlapping calls with `reauthorize: true` share
       * one call, so they send one authorization, and each returns its session. A call with an
       * object or a function runs its own authorization. `true` uses the instance's `accessKey`.
       * An object passes the parameters of `authorize`, and a function runs as the authorization.
       * One authorization spans the restore, so `session.status` is `pending` throughout, or
       * `reauthorizing` with the expired session. The result holds no `upgradeAvailable`. A
       * function can call `authorize` itself to read it.
       *
       * With `true` or an object, a refusal that only an interactive sign-in resolves
       * (`upgrade_required` or `webauthn_required`) returns `undefined`, so the page shows its
       * sign-in. A third-party client ID, such as an origin, also returns `undefined`, with no
       * authorization request, since it signs in only on an approval page. So does an instance
       * outside a browser without `redirectUri`, such as a CLI's. Tempo ID accepts no redirect URI
       * for its headless authorization, so it signs in again with the device grant. A
       * `webauthn_required`
       * from a passkey's ceremony that ran on the page and failed, such as a dismissed prompt with
       * `passkey: true`, throws with the ceremony's error as its `cause`. A function receives every
       * refusal itself, from its call of `authorize`.
       *
       * The renewal of an expired access key requests it again, as `authorize` describes. If Tempo
       * ID refuses that access key, the call returns `undefined`, and the status becomes
       * `signedOut`, so the page shows its sign-in. A refusal that the access key does not cause,
       * such as `rejected` for the app, throws, as for a call without a renewal.
       *
       * With the `backend` plugin, `get(request)` returns the session of a server request: the
       * Tempo ID or SIWE session that its session cookie names, after a refresh if its access token
       * expires within 30 seconds. Without that session, and with the plugin's `accessToken`, it
       * returns the session of the access token in the `Authorization` header. Returns `undefined`
       * without either. `method` names how the user signed in.
       *
       * @throws {RequestError} On the callback's page of a redirect sign-in, when the callback
       *   carries no valid code, or the token endpoint refuses the code, with the codes that
       *   `redirect.signIn` lists.
       * @throws {Error} The store's error, when the first read of the saved session fails, such
       *   as a device's secure store while the device is locked, before any change sets a session.
       *   The status stays `pending`, and the next call reads the store again. A saved record that
       *   holds no valid session, or a stored entry without valid JSON, returns `undefined`.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const session = await accounts.session.get({ reauthorize: true })
       * if (!session) showSignIn()
       * ```
       */
      get: SessionGet<plugins>
      /**
       * Refreshes the session's tokens with its refresh token, saves them, and returns the session.
       * Returns `undefined` without a session or a refresh token. Overlapping calls on one store,
       * also in other tabs, send one request, and each returns the same session, unless its access
       * token expired while the call waited.
       *
       * @throws {RequestError} When the token endpoint refuses the request:
       *   - `invalid_grant`: The refresh token was revoked, expired, or used more than 30 seconds
       *     earlier. Sign in again. This code carries no `reason`. In a browser, the lock
       *     serializes the refreshes of the store across every tab, so the first refusal throws.
       *     So does a lock in a process on a store of that process alone, such as `Store.memory`,
       *     also without Web Locks, as in React Native.
       *     Elsewhere, the lock spans one process only. Another process on the store, such as a
       *     second run of a CLI on one `Store.file`, can rotate the same refresh token at once.
       *     Tempo ID then refuses the token until that rotation returns. After the first
       *     `invalid_grant`, the refresh reads the store again. If the store holds other tokens,
       *     the refresh returns that session. Otherwise it sends the same refresh token again
       *     after one second, and receives that rotation's tokens. A second refusal throws.
       *   - `invalid_dpop_proof`: The session's tokens are
       *     [DPoP tokens](https://github.com/tempoxyz/id/blob/main/docs/dpop.md), and the instance
       *     holds no DPoP key or another DPoP key than the one that bound them. The refresh sends
       *     no request, and throws with status 400, since no refresh with this instance succeeds.
       *     The session stays, since another tab can hold the DPoP key that bound it. Sign in
       *     again. Its `reason` is `invalid_dpop_proof`.
       *   - `rate_limited`: The request exceeded a rate limit. Retry later.
       *   - `unexpected`: An unexpected failure. Retry the request.
       * @throws {RequestError} With `server_error` and status 0, when no attempt receives a
       *   response, such as offline. The session stays. Refresh again.
       * @throws {RequestError} With `server_error` and status 200, when the response holds no access
       *   token or no lifetime, such as a page of a proxy at `url`. The session stays.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const session = await accounts.session.refresh()
       * ```
       */
      refresh: () => Promise<Session.Of<plugins> | undefined>
      /**
       * The status of the session, `pending`, `reauthorizing`, `signedIn`, or `signedOut`, with
       * the session to show: `get` returns it, and `subscribe` calls its listener with each new
       * status and the one before it, and returns the function that unsubscribes. `signedOut` for
       * an instance without a session, such as a backend's, which never calls the listener. `get`
       * returns the same object while the status is unchanged, so the pair fits
       * `useSyncExternalStore` as it is. `accounts.useSession()` reads it in React.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const { session, status } = accounts.session.status.get()
       *
       * const unsubscribe = accounts.session.status.subscribe((status, previous) => {
       *   if (status.status === 'reauthorizing') showRenewing(status.session.user)
       *   if (previous.status === 'signedIn' && status.status === 'signedOut')
       *     showSignIn()
       * })
       * ```
       */
      status: InternalSession.Status<Session.Of<plugins>>
      /**
       * Calls `listener` with each new session and the one before it, at each sign-in and
       * sign-out. Returns the function that unsubscribes. An instance without a session never
       * calls it. A saved session whose access key expired, which `get` empties, calls it for
       * neither.
       *
       * @example
       * ```ts
       * import { Accounts } from 'accounts'
       *
       * const accounts = Accounts.create()
       * const unsubscribe = accounts.session.subscribe((session) => render(session))
       * ```
       */
      subscribe: (
        listener: (
          session: Session.Of<plugins> | undefined,
          previous: Session.Of<plugins> | undefined,
        ) => void,
      ) => () => void
    }
    /**
     * Empties the session at once, also when the request fails, deletes the saved session, and
     * revokes its refresh token at `POST /oauth2/revoke`. The user's Tempo ID session, and every
     * other app's session, stay signed in. The instance saves a signed-out mark, so `session.get`
     * with `reauthorize`, and the `react` plugin's first render, sign the user in again only
     * after the next sign-in, such as through `authorize`. Access tokens work until they expire,
     * at most 5 minutes, and the access key until its `expiry`, but the instance forgets both. A
     * sign-in over a session revoked the refresh token of the session that it replaced already.
     *
     * With `everywhere`, a first-party app also ends the user's Tempo ID session with
     * `POST /v1/auth/logout`, which signs the user out of every app that relies on it. Tempo ID
     * accepts that request only from an enabled first-party app's origin, or from its own. The
     * logout ends only the session whose cookie the instance's requests send, so a native app's
     * sign-out with the `redirect` plugin and `open` leaves the system browser's session. The
     * store holds a signed-out mark of the logout until its answer, so a reload of the page during
     * the logout authorizes nothing. A logout that ends the Tempo ID session then clears the mark.
     * After a reload during the logout, the mark stays until the next sign-in, since the page
     * cannot know whether the logout ended the Tempo ID session. The instance's other tabs empty
     * their session at once, also a tab whose store is local, such as `Store.memory`, which then
     * empties its own copy, since the logout revoked its tokens too.
     *
     * Outside a page, the sign-out rejects when Tempo ID does not answer the revocation. It also
     * rejects when a refresh in progress had an attempt that received no answer, since that
     * refresh may have rotated the token, so the sign-out does not revoke it. On a page, both
     * reject only when no logout runs. The session stays empty in both cases. The store keeps the
     * refresh token of a revocation without an answer, and the next `signOut` revokes it beside
     * its own. If that revocation receives no answer again, a `signOut` without a session, such as
     * the retry, rejects too. A store that rejects its reads and writes, such as a Redis that is
     * down, still holds the session, so the sign-out revokes the instance's refresh token, and
     * rejects with the store's error.
     *
     * @throws {EverywhereNotAllowedError} For `everywhere` from an app that is not first-party.
     *   The call signs nothing out.
     * @throws {RequestError} With `unexpected`, which
     *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes, when Tempo ID
     *   fails. Retry the request.
     * @throws {RequestError} With `server_error` and status 0, when the revocation, or the logout
     *   of `everywhere`, receives no response, such as offline. A revocation still without a
     *   response after 10 seconds counts as answered, since it can have reached Tempo ID, and a
     *   second revocation counts as a reuse. A logout still without a response after 10 seconds
     *   throws, so the sign-out settles. The session stays empty, and the next `signOut` revokes
     *   the refresh token. Sign out again.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     *
     * const accounts = Accounts.create()
     *
     * // Signs out of this app only.
     * await accounts.signOut()
     *
     * // Signs out of every app on the user's Tempo ID session.
     * await accounts.signOut({ everywhere: true })
     * ```
     */
    signOut: (parameters?: {
      /** Whether the user's Tempo ID session ends too, for a first-party app. Defaults to `false`. */
      everywhere?: boolean | undefined
    }) => Promise<void>
    /**
     * Selects the instance's chain, which `config.chainId` then returns, and saves the selection to
     * `store`, so a later load starts on it. Every sign-in, client, and deposit then uses that
     * chain by default. The `viem` plugin's object-form options stay on the configured `chainId`.
     * Switches run one at a time, in call order, so the last call wins.
     *
     * An access key belongs to one chain. The session's access key on that chain becomes its
     * `accessKey`, and its other access keys move to `accessKeys`. A session without an access key
     * on the selected chain reads its account there before the selection, with the session's access
     * token, since an account's owners, and its address, can differ by chain. A third-party client ID,
     * such as an origin, sends no read, since Tempo ID returns the account only to a first-party app. A failed read rejects
     * with its error, and selects nothing. A sign-in that a switch overtook keeps its access key in
     * `accessKeys`, and drops an account without one. A sign-in whose `accessKey` names another
     * chain on purpose keeps that access key as `accessKey`. If a stored selection no longer
     * restores, such as after `chains` narrows, the restored session uses its access key on the
     * configured chain when it holds one. Otherwise it stays on its access key's chain until the
     * next switch or sign-in. A new sign-in replaces the session, with its access keys on every
     * chain.
     *
     * On a chain without an access key, the account's owner signs messages and typed data. On a
     * page, the `viem` plugin's first transaction there opens the dialog, which requests an access
     * key on that chain, then sends the transaction. The request takes the instance's `accessKey`,
     * or else the limits, scopes, and lifetime of the session's access key on another chain.
     *
     * A stored selection outside `chains` never restores. The selection applies once `store` saves
     * it, so a failed save rejects with the store's error and selects nothing. If a sign-in
     * replaces the session during the save of the moved session, the selection stays, with that
     * sign-in.
     *
     * Each instance reads the stored selection once. If another tab switches, this instance stays
     * on its chain until the next load. A session that another tab saves with the same access keys
     * on the same chains, such as at a refresh, keeps this instance's choice of `accessKey` and its
     * account, with the saved tokens and access key authorizations. Any other session that the
     * instance reads from the store holds its access key on the instance's chain as `accessKey`
     * when it has one, and drops the account of the other chain.
     *
     * If `from` is set, the switch selects `chainId` only if the selected chain is still `from`
     * when the switch runs, after the earlier switches. Otherwise it resolves and selects nothing.
     *
     * @throws {ChainInvalidError} For a chain ID outside the instance's `chains`. The call selects
     *   nothing.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     * import { viem } from 'accounts/plugins'
     * import { tempoModerato } from 'viem/tempo/chains'
     *
     * const accounts = Accounts.create({ plugins: [viem()] })
     * await accounts.switchChain({ chainId: tempoModerato.id })
     *
     * // Opens the dialog for an access key on Tempo testnet, then sends.
     * await accounts.token.transferSync({ amount, to, token })
     * ```
     */
    switchChain: (parameters: {
      /** The ID of the chain to select. */
      chainId: number
      /** The ID of the chain that the switch replaces. Absent for a switch from any chain. */
      from?: number | undefined
    }) => Promise<void>
  }

/**
 * Returns the configuration that every action of `Actions` takes, with its defaults, and no session
 * or plugin: `chainId`, `clientId`, `scope`, and `url` are filled in. `Accounts.create` builds its
 * own with it, and takes the same parameters. The scope always holds `openid` and `email`, since
 * every authorization reads the user from the ID token.
 *
 * @throws {ClientIdRequiredError} Outside a browser without `clientId`, where no page's origin can
 *   serve as one.
 * @throws {ChainNameInvalidError} For a `chain` that is neither `mainnet`, `testnet`, nor a chain
 *   ID.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 *
 * const config = Accounts.from({
 *   clientId: process.env.CLIENT_ID!,
 *   clientSecret: process.env.CLIENT_SECRET!,
 * })
 * const { scope, url } = config
 * ```
 */
export function from(options: from.Options = {}): Config {
  const { chain, scope = 'offline_access', url, ...rest } = options

  const clientId = (() => {
    if (rest.clientId) return rest.clientId
    // An app on an `https` page can use its origin as its client ID, with no registration. A runtime
    // with a `location` but no page, such as Deno with `--location`, has no such origin.
    if (typeof document !== 'undefined' && typeof location !== 'undefined')
      return location.origin
    throw new ClientIdRequiredError()
  })()

  // Every authorization reads the user from the ID token, which needs `openid` and `email`.
  const scopes = scope.split(' ').filter(Boolean)
  // A `chain` from an untyped source, such as an environment variable, can name no chain, and an
  // instance without a chain ID fails only at its first request.
  const chainId = (() => {
    if (typeof chain === 'number' && Number.isSafeInteger(chain) && chain > 0)
      return chain
    if (chain === undefined || chain === null) return Chains.ids.mainnet
    if (Object.hasOwn(Chains.ids, chain as string))
      return Chains.ids[chain as keyof typeof Chains.ids]
    throw new ChainNameInvalidError({ chain })
  })()
  const config: Config = {
    ...rest,
    chainId,
    clientId,
    scope: [...new Set(['openid', 'email', ...scopes])].join(' '),
    url: url ?? defaultUrl,
  }

  // A server can log a configuration, or an instance that holds it. `JSON.stringify` and
  // `util.inspect` of it show `clientSecret` redacted, and `dpop.jwk` with only its public members,
  // since a JWK can hold the private scalar `d`. Each hook reads its receiver, so a descriptor copy
  // of the configuration, or a `clientSecret` set later, redacts its own values. The hooks are not
  // enumerable, so a spread of the configuration copies neither of them, and a plugin can replace
  // them.
  Object.defineProperties(config, {
    [Symbol.for('nodejs.util.inspect.custom')]: {
      configurable: true,
      value: redactThis,
      writable: true,
    },
    toJSON: { configurable: true, value: redactThis, writable: true },
  })
  return config
}

/**
 * Returns the receiver configuration for a log or JSON, or a copy with `clientSecret` redacted and
 * only the public members of `dpop.jwk` if it holds either. `JSON.stringify` and `util.inspect`
 * call it with the configuration as `this`. The copy replaces each reference to the receiver with
 * itself, so their cycle checks still detect a configuration that reaches itself.
 */
function redactThis(this: Config) {
  if (this.clientSecret === undefined && this.dpop === undefined) return this

  // Each member is an own data property, so a key such as `__proto__` sets no prototype.
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(this)) {
    const projected = (() => {
      if ((value as unknown) === this) return copy
      if (key === 'clientSecret' && value !== undefined) return '[redacted]'
      if (key !== 'dpop' || !value) return value
      const dpop = value as Dpop
      const { crv, kty, x, y } = dpop.jwk
      return { jwk: { crv, kty, x, y }, privateKey: dpop.privateKey }
    })()
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: projected,
      writable: true,
    })
  }
  return copy
}

export declare namespace from {
  type Options = Omit<Partial<Config>, 'chainId' | 'scope' | 'url'> & {
    /**
     * The chain that the app's access keys act on, unless a sign-in's `accessKey.chainId` names
     * another: Tempo mainnet, `4217`, or Tempo testnet, `42431`, by its name, or any other chain by
     * its ID. Defaults to `mainnet`. The returned configuration holds its ID as `chainId`.
     */
    chain?: 'mainnet' | 'testnet' | number | undefined
    /**
     * Never an option, since `chain` selects the chain. The type refuses a spread of a resolved
     * configuration, whose `chainId` the returned configuration would not hold.
     */
    chainId?: never
    /**
     * The space-separated scopes of the app's tokens beyond `openid` and `email`. Defaults to
     * `offline_access`, for a refresh token.
     */
    scope?: string | undefined
    /** Defaults to `https://id.tempo.xyz`. */
    url?: string | undefined
  }
}

/**
 * Creates an instance: its configuration, the session of its user, and one namespace for each
 * plugin in `plugins`. Each plugin adds a sign-in method or another set of actions, such as `email`
 * or `viem`, under its own name, such as `accounts.email`. `create` takes the options of
 * `Accounts.from` but `par`, which each plugin of a redirect or a dialog sets. `accounts/lite`
 * exports it as `Accounts.create`, which adds no plugin, so an app bundles only the plugins that it
 * names. The root entry's `Accounts.create` adds the `dialog`, `funding`, and `mpp` plugins that
 * `plugins` lacks. An instance without a sign-in plugin signs in only through `authorize`.
 *
 * In a browser, the instance holds the session of its user and saves it to `store`, which
 * defaults to IndexedDB. Elsewhere, an instance with a `cli:` client ID saves it to the file of
 * `Store.file()`, which every CLI of the user shares, in a runtime with Node's file system
 * modules. Any other instance holds a session only with a `store`, such as `Store.file()` in a CLI
 * with a registered client ID. Without one, it holds none, since a backend's instance serves many
 * users. A service that signs in many users with a `cli:` client ID passes `store: false`, and
 * holds none either. An instance without a session runs its plugins' actions, and returns their
 * results, but keeps nothing. A backend keeps each user's session with the `backend` plugin
 * instead.
 *
 * Without `accessKey`, each sign-in without a challenge requests an access key that may transfer up
 * to 5 OUSD, and expires a day after the sign-in. `accessKey: false` requests none. `account: false`
 * signs users in without a Tempo Account and without an access key.
 *
 * @throws {TypeError} For `accessKey` beside `account: false`.
 *
 * @throws {ClientIdRequiredError} Outside a browser without `clientId`, where no page's origin can
 *   serve as one.
 * @throws {ChainNameInvalidError} For a `chain` that is neither `mainnet`, `testnet`, nor a chain
 *   ID.
 * @throws {Error} For a plugin whose `id` is a member of every instance: `account`, `authorize`,
 *   `chain`, `config`, `connection`, `connections`, `handler`, `session`, `signOut`, or
 *   `switchChain`.
 * @throws {Error} With `connections.metadata`, for `clientAssertion`, `clientId`, or
 *   `clientSecret`, for a `connections.resource` with a query or a fragment, and for a `basePath`
 *   that does not start with `/` or sits inside `/.well-known/oauth-protected-resource`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts/lite'
 * import { dialog, viem } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ plugins: [dialog(), viem()] })
 *
 * await accounts.dialog.signIn()
 * ```
 */
export function create<const plugins extends readonly Plugin.Option[] = []>(
  options: create.Options<plugins> = {},
): Accounts<Plugin.Flatten<plugins>> {
  const {
    accessKey: accessKey_option,
    chains,
    connections: connectionsOptions,
    handler: handlerOptions = {},
    hint,
    plugins: entries = [],
    store: store_option,
    ...rest
  } = options
  // The instance resolves a plain object again at each sign-in, so a duration expiry counts from
  // that sign-in. An access key without `expiry` expires a day after the sign-in.
  const accessKey = () => {
    const value = (() => {
      if (accessKey_option === false) return undefined
      if (typeof accessKey_option === 'function') return accessKey_option()
      return accessKey_option
    })()
    if (!value || value.expiry !== undefined) return value
    return { ...value, expiry: AccessKey_internal.defaultExpiry }
  }
  const named = Plugin.flatten(entries)
  // The plugins' options apply first, in order, and the options that `create` receives win.
  const given = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  )
  const merged = Object.assign(
    {},
    ...named.map((plugin) => plugin.config?.()),
    given,
  ) as from.Options
  // An access key acts for a Tempo Account, which an instance with `account: false` holds none of.
  if (merged.account === false && accessKey_option !== undefined)
    throw new TypeError(
      'Conflicting options: `accessKey` describes an access key for a Tempo Account, which `account: false` creates none of. Remove `accessKey`, or remove `account`.',
    )
  // A `cli:` client ID names a program of one user, so its instance without a store keeps its
  // session in the file that the user's CLIs share. Every reader of `config.store` then reads it.
  // `false` refuses the file, and a plugin's store with it, for an instance of many users.
  if (store_option === false) delete merged.store
  else if (store_option) merged.store = store_option
  else merged.store ??= CliStore.get(merged.clientId)
  // An API that Tempo ID discovers authenticates as the app of the document that the handler
  // serves, with the document's key. The signer loads at its first call, so a page's bundle holds
  // no signing code.
  // The document advertises `private_key_jwt` with the metadata's key at a path of the handler, so
  // other credentials, or another client ID, would contradict it.
  const metadata = connectionsOptions?.metadata
  if (metadata) {
    if (merged.clientAssertion || merged.clientId || merged.clientSecret)
      throw new Error(
        'Conflicting credentials: `connections.metadata` names the app and signs its client assertions with its `privateKey`. Remove `clientAssertion`, `clientId`, and `clientSecret`.',
      )
    // Tempo ID discovers no identifier with a query or a fragment, even an empty one.
    if (/[?#]/.test(connectionsOptions.resource))
      throw new Error(
        `Invalid \`connections.resource\`: ${connectionsOptions.resource} holds a query or a fragment, which Tempo ID discovers no resource with. Remove them.`,
      )
    const resource = new URL(connectionsOptions.resource)
    // The paths join the origin as text, so a `basePath` without a leading `/` would join the
    // host. A `basePath` inside the metadata's path would share a path with the metadata.
    const base = (handlerOptions.basePath ?? Handler.basePath).replace(
      /\/+$/,
      '',
    )
    if (
      (base && !base.startsWith('/')) ||
      `${base}/`.startsWith('/.well-known/oauth-protected-resource/')
    )
      throw new Error(
        `Invalid \`handler.basePath\`: ${base} does not start with /, or sits inside /.well-known/oauth-protected-resource, where the handler serves the resource's metadata. Use another \`basePath\`, such as /api.`,
      )
    merged.clientId = `${resource.origin}${base}/client.json`
    // Tempo ID accepts only its issuer as the audience, so an instance that reaches it at another
    // address signs for `connections.issuer`.
    const issuer = connectionsOptions.issuer
    merged.clientAssertion = async (context) =>
      (await import('./internal/ClientAssertion.js')).sign({
        ...context,
        ...(issuer ? { audience: issuer.replace(/\/+$/, '') } : {}),
        privateKey: metadata.privateKey,
      })
  }
  const config = from(merged)
  const plugins: readonly Plugin.Plugin[] = named
  // A store of one user's, a CLI's shared file, or a browser's IndexedDB holds the session. A
  // backend's instance passes no store, since it serves many users.
  const enabled = merged.store !== undefined || typeof indexedDB !== 'undefined'

  const ids = new Set<string>()
  for (const plugin of plugins) {
    if (reserved.has(plugin.id))
      throw new Error(
        `Invalid plugin ID: ${plugin.id} is a member of every instance. Give the plugin another \`id\`.`,
      )
    // Each namespace has one plugin, so a preset and its caller never both run one plugin's hooks.
    if (ids.has(plugin.id))
      throw new Error(
        `Invalid plugin ID: ${plugin.id} names two plugins. Pass the plugin once, such as by leaving it out of the preset's list.`,
      )
    ids.add(plugin.id)
  }

  // A session belongs to one deployment, app, and configured chain, so another one never restores
  // it. The JSON tuple keeps the key unique, since an origin and a client ID can both hold a colon.
  // Its `[` keeps the name apart from the `backend` plugin's sessions in a shared store, whose keys
  // follow the same prefix with a session ID, which holds no bracket.
  const name = `tempo-id:session:${JSON.stringify([new URL(config.url).origin, config.clientId, config.chainId])}`
  const store = DefaultStore.get(config.store)
  const chain = InstanceChain.create({
    chainId: config.chainId,
    chains,
    name,
    store: enabled ? store : undefined,
  })
  // `config.chainId` reads the instance's chain at each use, so every action and plugin follows
  // `switchChain`.
  Object.defineProperty(config, 'chainId', { enumerable: true, get: chain.get })
  Object.defineProperty(config, InstanceChain.configured, {
    value: chain.configured,
  })
  // A page reads the selection with the instance, so its first sign-in uses the selected chain.
  if (enabled && typeof document !== 'undefined')
    chain.load().catch(() => undefined)
  // The calls of `switchChain`, one at a time, so the last call's chain wins.
  const switches = { last: Promise.resolve() }
  // The errors of sign-out revocations without an answer, so `connection.disconnect` tells them
  // from a failed erasure of the stored session, which can reject with the same class.
  const unanswered = new WeakSet<object>()

  const session = InternalSession.create({
    chainId: chain.get,
    enabled,
    getFn: config.getFn,
    loadChain: chain.load,
    name,
    onMoved: readMoved,
    async onSignIn(session) {
      for (const plugin of plugins)
        await plugin.hooks?.afterSignIn?.(context, session)
    },
    async onSignOut() {
      for (const plugin of plugins) await plugin.hooks?.afterSignOut?.(context)
    },
    // The revocation ends the app's session, and keeps the user's Tempo ID session unless `logout`.
    // It runs before the logout, since a revocation of a token that the logout already revoked
    // counts as a reuse, which revokes the app's tokens of the user's other sessions. A refused
    // revocation, such as of an expired token, leaves the sign-out complete. Without a logout, the
    // revocation is the only end of the session, so one that received no answer throws, after any
    // logout. A JSON body keeps the logout out of the CSRF check for form posts.
    signOut: async (ended, options = {}) => {
      const {
        logout = true,
        onLoggedOut,
        onLogoutUnknown,
        onRevoked,
        pending = [],
        restored,
        unrevoked,
      } = options
      /** Revokes `refreshToken`, and returns the error when Tempo ID sent no answer. */
      const revoke = (
        refreshToken: string,
        onAnswer: (() => Promise<void>) | undefined,
      ) =>
        Api.revoke(config, { refreshToken }).then(
          async () => {
            await onAnswer?.()
            return undefined
          },
          async (error: unknown) => {
            // A rate limit, like no answer, leaves the token live, so a later sign-out sends it again.
            const unanswered =
              !(error instanceof RequestError) ||
              error.status === 0 ||
              error.status === 429 ||
              error.status >= 500
            if (unanswered) return { error }
            await onAnswer?.()
            return undefined
          },
        )
      // A sign-out that revokes nothing, or whose revocation received no answer, rejects with that
      // error after the logout, outside a page. On a page, a logout ends the Tempo ID session. The
      // revocations of earlier sign-outs run beside it, before the logout, and reject nothing.
      const [failure] = await Promise.all([
        (async () => {
          if (unrevoked) return unrevoked
          if (!ended?.refreshToken) return undefined
          // The logout of a first-party app's Tempo ID session revokes the tokens that it issued, and
          // a revocation of a revoked token counts as a reuse, which revokes the app's tokens on the
          // user's other devices.
          if (restored && !ClientId.thirdParty(config.clientId))
            return undefined
          return revoke(ended.refreshToken, onRevoked)
        })(),
        ...pending.map(async (entry) => {
          const result = await revoke(entry.refreshToken, entry.onRevoked)
          if (result) {
            // A disconnection ignores it, as it does the sign-out's own.
            if (typeof result.error === 'object' && result.error)
              unanswered.add(result.error)
            entry.onUnanswered?.(result.error)
          }
          return undefined
        }),
      ])
      // A third-party app has no CORS grant for the logout, and the Tempo ID session is the user's,
      // which such an app does not end. Its client ID shows it: an origin, a metadata document's
      // URL, a registrar's `app_` ID, or a CLI's `cli:` name.
      const loggedOut = logout && !ClientId.thirdParty(config.clientId)
      if (loggedOut) {
        // A logout without a response, such as offline, throws as a revocation without one does. A
        // timer ends a stalled logout, also in its body, so the sign-out settles, and a redirect
        // that waits for it leaves the page. React Native's `AbortSignal` has no `timeout`. A
        // logout that the timer aborts throws too, since it may not have ended the Tempo ID session
        // or its tokens, so the next sign-out revokes them.
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Api.logoutTimeout)
        const unanswered = (error: unknown) =>
          new RequestError({
            cause: error,
            code: 'server_error',
            message:
              'The logout received no response. Check the connection, and sign out again.',
            status: 0,
          })
        try {
          const response = await Api.post(config, '/v1/auth/logout', {
            json: {},
            signal: controller.signal,
          }).catch((error: unknown) => {
            throw unanswered(error)
          })
          await Api.json(response).catch((error: unknown) => {
            if (controller.signal.aborted) throw unanswered(error)
            throw error
          })
        } catch (error) {
          // Only a refusal, which Tempo ID sends before it ends the session, or a refused redirect,
          // leaves the session and its tokens. A logout without an answer, or with a server error,
          // can have ended them.
          const refused =
            error instanceof RequestError &&
            (Api.redirectRefused(error) ||
              (error.status >= 400 && error.status < 500))
          if (!refused) onLogoutUnknown?.()
          throw error
        } finally {
          clearTimeout(timer)
        }
        // The logout succeeded, also when the revocation's failure throws below.
        onLoggedOut?.()
      }
      // A page's logout ends the tokens that its Tempo ID session issued, so a later revocation of a
      // pending token counts as a reuse.
      if (loggedOut && typeof document !== 'undefined')
        await Promise.all(pending.map((entry) => entry.onRevoked()))
      // Only the logout of a page ends the token that the failure left, so without one the sign-out
      // rejects there too.
      if (failure && (typeof document === 'undefined' || !loggedOut)) {
        if (typeof failure.error === 'object' && failure.error)
          unanswered.add(failure.error)
        throw failure.error
      }
    },
    store,
  })

  // A page reads the hint at startup, before the instance reads IndexedDB, which has no synchronous
  // read. A restore without a session, such as after an expired access key, removes it.
  if (hint && typeof document !== 'undefined') {
    const cookie = hint.cookie === true ? Hint.cookie : hint.cookie
    session.status.subscribe((status) => {
      if (status.status === 'signedIn')
        document.cookie = Hint.serialize({ cookie })
      if (status.status === 'signedOut')
        document.cookie = Hint.expire({ cookie })
    })
  }

  const context: Plugin.Context = {
    accessKey,
    defaultAccessKey: () =>
      accessKey_option === undefined && merged.account !== false
        ? defaultAccessKey()
        : undefined,
    chain: {
      configured: chain.configured,
      get: chain.get,
      load: chain.load,
      subscribe: chain.subscribe,
    },
    challenge() {
      for (const plugin of plugins) {
        const value = plugin.hooks?.challenge?.(context)
        if (value) return value
      }
      return undefined
    },
    config,
    session: {
      authorize: session.authorize,
      change: session.change,
      discard: session.discard,
      ended: session.ended,
      exclusive: session.exclusive,
      get: session.get,
      // The stored chain loads beside the stored session, so a restored session reads its chain.
      load: async (options) => {
        const [loaded] = await Promise.all([
          session.load(options),
          chain.load().catch(() => undefined),
        ])
        return loaded
      },
      reload: session.reload,
      renewing: session.renewing,
      rotations: session.rotations,
      settled: session.settled,
      signedOut: session.signedOut,
      status: session.status,
    },
  }

  const namespaces: Record<string, unknown> = {}
  for (const plugin of plugins) {
    // An own property, so an ID such as `__proto__` names a namespace and sets no prototype.
    if (plugin.actions)
      Object.defineProperty(namespaces, plugin.id, {
        configurable: true,
        enumerable: true,
        value: plugin.actions(context),
        writable: true,
      })
    plugin.setup?.(context)
  }

  // The refresh in progress for an access token that expires, which every caller in the meantime
  // awaits, so concurrent requests rotate the refresh token once.
  let refreshing: Promise<Session.Any | undefined> | undefined
  // The `session.refresh` call in progress, which every overlapping call awaits, so they send one
  // request, also before the instance first reads the store, or while that refresh saves its tokens.
  let rotating: Promise<Session.Any | undefined> | undefined
  // The `session.get` call with `reauthorize: true` in progress, which every overlapping call
  // with `reauthorize: true` awaits, so a page that restores from two places sends one authorization.
  let restoring: Promise<Session.Any | undefined> | undefined
  /**
   * Returns the access token that authenticates a read of the user's own data, such as
   * `account.get`, in place of the session cookie. Tempo ID's own pages send its session cookie, with
   * no preflight. Any other page or worker sends the access token, as a CLI does, since only the
   * browser knows whether the `Lax` cookie reaches Tempo ID from it. A cross-origin page then sends one
   * CORS preflight. A DPoP token that the instance's key does not bind, such as in a worker that
   * shares the page's session without its DPoP key, leaves the read to the cookie, as does a page whose
   * session holds no live access token. Returns `undefined` then, and for an instance without a session.
   */
  async function ownAccessToken() {
    const page = Api.page()
    if (page !== undefined && Api.sameHost(config, { page })) return undefined
    await context.session.load()
    const current = context.session.get()
    if (!current) return undefined
    // Tempo ID holds no account of a local session, so a read without its token never reaches it.
    if (Session.local(current)) throw new LocalSessionError()
    if (
      page !== undefined &&
      Api.unbound(config, { accessToken: current.accessToken })
    )
      return undefined
    if (page === undefined) return accessToken()
    // A page without a live access token, such as after a refused, failed, or unanswered refresh,
    // still reads with any session cookie that reaches Tempo ID. The session reports the refresh's
    // failure itself.
    return accessToken().catch(() => undefined)
  }

  /**
   * Returns a live access token of the instance's session. A token that expires within 30 seconds
   * serves while a refresh runs beside it, and one that expires within 5 seconds waits for it.
   * Throws `SignedOutError` when the refresh reads a store that another context emptied, or that
   * holds another user's session, and for an expired access token without a refresh token.
   */
  async function accessToken() {
    await context.session.load()
    const renewing = context.session.renewing()
    // An authorization in progress, such as the renewal of an expired access key, sets the session,
    // so a read without a session waits for it, as `session.get` does. A call from a callback
    // inside the authorization, such as a function `reauthorize`, waits for no authorization that
    // waits for it.
    if (!context.session.get() && (await session.idle()))
      await context.session.load()
    const current = context.session.get()
    if (!current) throw new SignedOutError()
    // A renewal that signs in another user sends none of that user's tokens to a call that started
    // for the renewed user.
    if (renewing && Session.subject(current) !== Session.subject(renewing))
      throw new SignedOutError()
    if (Session.local(current)) throw new LocalSessionError()
    const token = await (async () => {
      if (current.expiresAt - 30_000 > Date.now()) return current.accessToken
      refreshing ??= Core.refresh(context, { margin: 30_000 }).finally(() => {
        refreshing = undefined
      })
      // A token that stays valid for the request serves it while the refresh runs beside it, so no
      // call waits for the refresh's round trip. Its failure surfaces at the next call that waits.
      if (current.expiresAt - 5_000 > Date.now()) {
        refreshing.catch(() => undefined)
        return current.accessToken
      }
      // The refresh reloads the store, so without new tokens the instance holds the session that
      // another context saved there, or none after its sign-out.
      const latest =
        (await refreshing.catch((error: unknown) => {
          // A refused refresh token, such as a revoked one, empties the session, so the call throws
          // as it throws without a session, also before the next call reads the empty session.
          // Any other failure, such as a store that refuses the empty session, keeps its own error.
          if (
            error instanceof RequestError &&
            error.code === 'invalid_grant' &&
            !context.session.get()
          )
            throw new SignedOutError({ cause: error })
          throw error
        })) ?? context.session.get()
      if (!latest) throw new SignedOutError()
      // A call that started for one user never sends the token of another user that another
      // context signed in.
      if (Session.subject(latest) !== Session.subject(current))
        throw new SignedOutError()
      if (Session.local(latest)) throw new LocalSessionError()
      // A session without a refresh token keeps its access token until its expiry. A token that
      // expires within 5 seconds can expire before the request arrives, so the call sends none.
      // A refreshed session keeps the token that Tempo ID issued, whatever its lifetime.
      const margin = latest.refreshToken ? 0 : 5_000
      if (latest.expiresAt - margin <= Date.now()) throw new SignedOutError()
      return latest.accessToken
    })()

    // Every API refuses a token that another DPoP key binds, so the call sends no request. A session
    // without a refresh token returns its own token near expiry, so the check covers it too.
    Api.checkBound(config, { accessToken: token })
    return token
  }

  // The connections load at their first call, so a page's bundle holds no token verifier.
  let attached: Promise<Connections.attach.ReturnType> | undefined
  function connections() {
    if (!connectionsOptions)
      return Promise.reject(new ConnectionsRequiredError())
    attached ??= import('./internal/Connections.js').then((module) =>
      module.attach(config, connectionsOptions),
    )
    return attached
  }

  // The router loads at the first request, so a page's bundle holds none of it.
  let server: Promise<Handler.Handler> | undefined
  const relaying = plugins.some((plugin) => plugin.id === 'relay')

  /** Returns the user's Tempo Account, and saves one that the session's access token read. */
  const getAccount = async (parameters: Core.getAccount.Parameters = {}) => {
    const accessToken = parameters.accessToken ?? (await ownAccessToken())
    // The default resolves after the token, whose read loads the stored chain.
    const chainId = parameters.chainId ?? chain.get()
    const account = await Core.getAccount(context, {
      ...parameters,
      accessToken,
      chainId,
    })
    if (account && accessToken) keepAccount(account, { accessToken, chainId })
    return account
  }

  const instance: Record<string, unknown> = {
    ...namespaces,
    account: {
      get: getAccount,
      upgrade: (parameters?: Core.upgradeAccount.Parameters) =>
        Core.upgradeAccount(context, parameters),
    },
    authorize: (parameters?: Core.authorize.Parameters) =>
      Core.authorize(context, {
        ...parameters,
        renew: accessKey_option === undefined && merged.account !== false,
      }),
    chain: { get: chain.get, subscribe: chain.subscribe },
    config,
    connection: {
      async disconnect() {
        const token = await accessToken()
        const started = context.session.get()
        // Only the session that holds the sent access token lost its tokens at the disconnection.
        // Another user's sign-in that commits before the read keeps its refresh token live.
        const revoked =
          started && started.accessToken === token
            ? started.refreshToken
            : undefined
        const result = await AccountActions.disconnect(config, {
          accessToken: token,
        })
        // Tempo ID revoked every token of the app for the user, so a session of the user ends here
        // too. A session of another user, which a sign-in committed during the request, stays. A
        // session that a refused refresh emptied during the request signs out too, so the
        // signed-out mark stops a later `reauthorize`. Tempo ID revoked the app's tokens already,
        // so a revocation without an answer keeps `remaining`. A failed erasure of the stored
        // session rejects, since the store still holds its access key. The disconnection revoked
        // the refresh token that it read, so the sign-out sends no revocation of it.
        const current = context.session.get()
        if (!current || Session.same(started, current))
          await signOut({ revoked }).catch((error: unknown) => {
            if (typeof error === 'object' && error && unanswered.has(error))
              return
            throw error
          })
        return result
      },
      get: async () =>
        AccountActions.connection(config, { accessToken: await accessToken() }),
    },
    connections: {
      connect: async (parameters: Connections.attach.connect.Parameters) =>
        (await connections()).connect(parameters),
      get: async (parameters: Connections.create.get.Options) =>
        (await connections()).get(parameters),
      revoke: async (parameters: Connections.create.get.Options) =>
        (await connections()).revoke(parameters),
      revokeAccessKey: async (
        parameters: Connections.create.revokeAccessKey.Options,
      ) => (await connections()).revokeAccessKey(parameters),
    },
    handler: {
      async fetch(request: Request) {
        server ??= import('./internal/handlers/Server.js').then((module) =>
          module.create({
            accessKeys: connectionsOptions
              ? async () => (await connections()).accessKeyEndpoint
              : undefined,
            // The `backend` plugin's actions sit on the instance under its `id`.
            backend: (instance as { backend?: BackendHandler.create.Actions })
              .backend,
            basePath: handlerOptions.basePath,
            metadata: metadata && {
              ...metadata,
              authorizationServer:
                connectionsOptions?.issuer ?? new URL(config.url).origin,
              chainId: config.chainId,
              clientId: config.clientId,
              resource: connectionsOptions.resource,
            },
            redirectUri: config.redirectUri,
            // The relay spends the fee payer's balance, so it is served only on request. The `relay` plugin's
            // `extend` adds its route to the instance after this object.
            relay:
              handlerOptions.relay && relaying
                ? () => (instance as { relay: Handler.Handler }).relay
                : undefined,
            // The `siwe` plugin's `extend` adds its actions to the instance after this object.
            siwe: (instance as { siwe?: BackendHandler.create.Siwe }).siwe,
          }),
        )
        return (await server).fetch(request)
      },
    },
    pay: async (
      options: AccountActions.pay.Parameters & Pick<Payment.Payment, 'session'>,
    ) => {
      const { session: fixed, ...parameters } = options
      // A load of the stored session also loads the stored chain, so the default chain resolves
      // again after it.
      const chainOf = () => parameters.chainId ?? chain.get()
      // An invalid amount, recipient, or memo rejects before a read of the account, and before a
      // plugin sends.
      Payment.amount(parameters.amount)
      Payment.to(parameters.to)
      const memo =
        parameters.memo === undefined
          ? undefined
          : Payment.memo(parameters.memo)
      // Only the account's owner signs a challenge, on the page, so no plugin sends the payment. The
      // page picks the account, with no read, so a popup still opens within the gesture.
      if (parameters.challenge !== undefined)
        return await AccountActions.pay(config, {
          ...parameters,
          chainId: chainOf(),
          memo,
        })
      // A fixed session's access key names the account, so the call reads neither the store nor
      // Tempo ID, whose read would send the instance's own token.
      const named = () => {
        if (!fixed) return undefined
        const chainId = chainOf()
        // An expired access key sends nothing, and outside a page no page takes the payment instead.
        const key = [fixed.accessKey, ...(fixed.accessKeys ?? [])].find(
          (entry) =>
            entry &&
            Number(entry.chainId) === chainId &&
            !AccessKey_internal.expired(entry),
        )
        if (!key) {
          // As a client of the fixed session refuses it, a session whose every access key expired
          // can no longer act, and a session with a live access key on another chain needs one here.
          const held = [fixed.accessKey, ...(fixed.accessKeys ?? [])].filter(
            (entry) => entry !== undefined,
          )
          if (
            held.length > 0 &&
            held.every((entry) => AccessKey_internal.expired(entry))
          )
            throw new SignedOutError()
          throw new AccessKeyRequiredError()
        }
        // Only the session's access key sends, so another account could only reach the payment page.
        if (
          parameters.account !== undefined &&
          parameters.account.toLowerCase() !== key.account.toLowerCase()
        )
          throw new RequestError({
            code: 'invalid_request',
            field: 'account',
            message:
              'Invalid `account`: the access key of `session` acts for another account. Pass the account of that access key, or no `account`.',
            reason: 'invalid_field',
            status: 0,
          })
        return key.account
      }
      // The session's account and access key belong to the instance's chain. A held account opens
      // the page with no read, so a popup still opens within the gesture.
      const own = () => {
        const held = context.session.get()
        const chainId = chainOf()
        if (chainId !== chain.get()) return undefined
        // A parked access key of another chain can act for another account, so only the access
        // key of the payment's chain names one.
        return (
          held?.account?.address ??
          [held?.accessKey, ...(held?.accessKeys ?? [])].find(
            (entry) => entry && Number(entry.chainId) === chainId,
          )?.account
        )
      }
      // A plugin's challenge, such as the `siwe` plugin's, signs the user in to the app with a
      // payment that names no account, while the instance holds no session and the call names none,
      // so a user that signed in signs no second message. The reads are synchronous, so a popup
      // still opens within the gesture.
      const source =
        parameters.account === undefined &&
        !fixed &&
        !own() &&
        !context.session.get()
          ? context.challenge()
          : undefined
      if (source) {
        let message: string | undefined
        const paid = await AccountActions.pay(config, {
          ...parameters,
          challenge: async (signal) =>
            (message = await source.message({ chainId: chainOf(), signal })),
          chainId: chainOf(),
          memo,
        })
        // The transfer landed, so a failed sign-in resolves with the transaction and `authError`.
        try {
          if (!paid.challengeSignature)
            throw new RequestError({
              code: 'invalid_request',
              field: 'challenge_signature',
              message:
                'Missing `challenge_signature` in the return URL: the payment landed, but Tempo ID returned no signature of the message. Sign the user in with `dialog.signIn`.',
              status: 0,
            })
          const auth = await source.settle({
            address: paid.address,
            message: message!,
            signature: paid.challengeSignature,
          })
          return { ...paid, auth }
        } catch (error) {
          return { ...paid, authError: error }
        }
      }
      const held = named() ?? parameters.account ?? own()
      const resolved = held
        ? { account: held, chainId: chainOf() }
        : await (async () => {
            // A stored session, such as on a server after a restart, holds the account, so the
            // store read comes before a read of Tempo ID.
            await context.session.load()
            const chainId = chainOf()
            const loaded = own()
            if (loaded) return { account: loaded, chainId }
            // Outside a page, only the session's access token reads the account, so without a
            // session the read sends no request.
            if (!context.session.get() && Api.page() === undefined)
              throw new SignedOutError()
            // Tempo ID returns the account only to a first-party app, and the page of a
            // third-party app has no CORS grant for the read, so the payment page picks it. A
            // session that signed in without a Tempo Account reads none either, since a page's read
            // would create one, so the payment page picks it too.
            const current = context.session.get()
            if (
              ClientId.thirdParty(config.clientId) ||
              (current && !withAccount(current))
            )
              return undefined
            return {
              account: (await getAccount({ chainId }))?.address,
              chainId,
            }
          })()
      if (!resolved)
        return await AccountActions.pay(config, {
          ...parameters,
          chainId: chainOf(),
          memo,
        })
      const { account, chainId } = resolved
      if (!account) throw new SignedOutError()

      const payment = { ...parameters, account, chainId, memo, session: fixed }
      /**
       * Starts the sends of the plugins from `index`, in order, such as `viem` with the session's
       * access key, and resolves with the first payment that one sent. Returns `undefined` at once
       * if no plugin takes the payment, so a popup still opens within the gesture.
       */
      const send = (index: number): AccountActions.pay.Options['attempt'] => {
        for (let next = index; next < plugins.length; next++) {
          const attempt = plugins[next]?.hooks?.pay?.(context, payment)
          if (attempt)
            return attempt.then((sent) =>
              sent ? { ...sent, address: account } : send(next + 1),
            )
        }
        return undefined
      }
      // Outside a page, only a plugin sends the payment, so an instance without one names that fix
      // rather than a sign-in, which would send nothing either.
      if (
        typeof document === 'undefined' &&
        !plugins.some((plugin) => plugin.hooks?.pay)
      )
        throw new AccountActions.PageRequiredError({
          payment: true,
          sender: false,
        })
      // The payment page loads in a hidden dialog while a plugin sends, and shows only if none sent.
      return await AccountActions.pay(config, { ...payment, attempt: send(0) })
    },
    session: {
      accessToken,
      actor: session.actor,
      async fetch(
        parameters: Actions.fetch.Parameters | Request,
        options?: Actions.fetch.Parameters,
      ) {
        if (parameters instanceof Request)
          return backendOf().fetch(parameters, options!)
        // An aborted request rejects at once, also while the call waits for an authorization or a
        // refresh, as `fetch` rejects at the abort.
        const signal = parameters.init?.signal ?? undefined
        if (signal?.aborted) throw aborted(signal)
        const token = await (() => {
          if (!signal) return accessToken()
          return new Promise<string>((resolve, reject) => {
            const abort = () => reject(aborted(signal))
            signal.addEventListener('abort', abort, { once: true })
            accessToken()
              .then(resolve, reject)
              .finally(() => signal.removeEventListener('abort', abort))
          })
        })()
        return Actions.fetch(config, { ...parameters, accessToken: token })
      },
      get: (parameters: Core.getSession.Parameters | Request = {}) => {
        if (parameters instanceof Request)
          return backendOf().get(parameters, {
            // Only the `siwe` plugin's token mode hands a session's ID to a page as a bearer token.
            token:
              (
                (instance as { siwe?: Record<symbol, unknown> }).siwe?.[
                  BackendOperations.siwe
                ] as { token?: boolean } | undefined
              )?.token === true,
          })
        const read = (reauthorize: Core.getSession.Parameters['reauthorize']) =>
          Core.getSession(context, {
            ...parameters,
            declined: () =>
              session.actor !== undefined &&
              InternalSession.machines.declined(session.actor.getSnapshot()),
            delegate: session.delegate,
            reauthorize,
            renew: accessKey_option === undefined && merged.account !== false,
            async restore() {
              // A restore, such as a redirect's callback, completes on the selected chain, so the
              // stored selection loads first. A failed read runs no hook, so a later read restores.
              // The stored session reads beside it, so a restore waits for one round trip of the
              // store. A hook's change keeps its session over the read's.
              const [loaded] = await Promise.all([
                chain.load().then(
                  () => true,
                  () => false,
                ),
                session.preload(),
              ])
              if (!loaded) return
              for (const plugin of plugins)
                await plugin.hooks?.restore?.(context)
            },
            signedOut: session.signedOut,
          })
        // Only calls with `reauthorize: true` share, since another call's own parameters or
        // function decide its authorization. An instance without a session, such as a backend's,
        // serves many users, so each of its calls authorizes on its own.
        if (parameters.reauthorize !== true || !session.actor)
          return read(parameters.reauthorize)
        // A sign-in or a sign-out can complete while the shared call runs, so its result can be
        // stale. A joining call then reads the current session, without a second authorization.
        if (restoring)
          return restoring.then(
            () => read(undefined),
            (error: unknown) => {
              if (error instanceof SupersededError) return read(undefined)
              throw error
            },
          )
        return (restoring = read(true).finally(() => {
          restoring = undefined
        }))
      },
      refresh: () =>
        (rotating ??= Core.refresh(context).finally(() => {
          rotating = undefined
        })),
      status: session.status,
      subscribe: session.subscribe,
    },
    signOut: (parameters?: NonNullable<Parameters<Accounts['signOut']>[0]>) =>
      signOut({ everywhere: parameters?.everywhere }),
    switchChain,
  }

  /** Returns the `backend` plugin's reads of a server request's session. */
  function backendOf() {
    // The `backend` plugin's actions sit on the instance under its `id`.
    const held = (instance as { backend?: Record<symbol, unknown> }).backend
    if (!held)
      throw new Error(
        'Invalid call: `session.get(request)` and `session.fetch(request, parameters)` read the sessions of the backend plugin, which `plugins` lacks. Add `backend({ store })` or `backend({ sessions })`.',
      )
    return held[BackendOperations.key] as backend.Operations
  }

  /**
   * Saves `account`, which `account.get` read on `options.chainId`, in a session that holds none,
   * such as after a sign-in through a redirect, a dialog, or a device, so a later load restores the
   * account with no request. The session's own access token authenticated the read, so the account
   * is the session user's, never the account of another user's Tempo ID cookie. The account belongs
   * to the session's access key, or without one to the instance's chain. Another context, such as a
   * tab, can have selected another chain in the store, which a later load selects, so the save
   * needs the stored selection to name the chain of the read. A failed save keeps the account in
   * the instance, and the session's next save, such as a refresh, stores it.
   */
  function keepAccount(
    account: TempoAccount.TempoAccount,
    options: { accessToken: string; chainId: number },
  ) {
    const { accessToken, chainId } = options
    const keeps = (held: Session.Any | undefined) =>
      InternalSession.machines.keepsAccount({
        accessToken,
        account,
        chainId,
        selected: chain.get(),
        session: held,
      })
    if (!keeps(session.get())) return
    void session
      .exclusive(async () => {
        const [latest, stored] = await Promise.all([
          session.reload(),
          chain.stored(),
        ])
        if (!latest || !keeps(latest)) return
        if (stored !== chainId) return
        await session.change({ update: true }).commit({ ...latest, account })
      })
      .catch(() => undefined)
  }

  /**
   * Returns whether `held` signed in with a Tempo Account: always on an instance without
   * `account: false`, else for a session that holds an account or an access key.
   */
  function withAccount(held: Session.Any) {
    return (
      config.account !== false ||
      !!held.account ||
      !!held.accessKey ||
      !!held.accessKeys?.length
    )
  }

  /**
   * Reads the account of a session that a switch left without an access key or an account on the
   * instance's chain, and sets it there, beside the sign-in. A failed read leaves the first
   * signature to read it.
   */
  function readMoved(moved: Session.Any) {
    // A third-party app reads no account, as `switchChain` describes. A session that signed in
    // without a Tempo Account reads none either, so a page's read creates none.
    if (ClientId.thirdParty(config.clientId) || !withAccount(moved)) return
    const chainId = chain.get()
    void (async () => {
      const account = await Core.getAccount(context, {
        accessToken: moved.accessToken,
        chainId,
      })
      if (!account) return
      await session.exclusive(async () => {
        const latest = await session.reload()
        if (
          !latest ||
          Session.subject(latest) !== Session.subject(moved) ||
          latest.account ||
          latest.accessKey ||
          chain.get() !== chainId
        )
          return
        await session.change({ update: true }).commit({ ...latest, account })
      })
    })().catch(() => undefined)
  }

  /** Selects `parameters.chainId`, as `accounts.switchChain` does. */
  function switchChain(parameters: {
    chainId: number
    from?: number | undefined
  }) {
    const { chainId, from } = parameters
    if (!chain.serves(chainId))
      return Promise.reject(new ChainInvalidError({ chainId }))
    const run = switches.last
      .catch(() => undefined)
      .then(async () => {
        await chain.load().catch(() => undefined)
        const previous = chain.get()
        // A conditional switch runs after the earlier switches, so it never replaces their chains.
        if (from !== undefined && previous !== from) return
        // A session without an access key on the selected chain reads its account there before the
        // selection, since an account's address can differ by chain. The read sends the session's
        // access token, so it returns the session user's account, never the account of another
        // user's Tempo ID cookie. A failed read rejects, and selects nothing.
        const held = previous === chainId ? undefined : await session.load()
        // Tempo ID returns the account only for a first-party app's access token, and the page of a
        // third-party app has no CORS grant for the read, so the switch sends no read.
        const account =
          held &&
          // A local session's account is the owner key's on every chain, so Tempo ID reads none.
          !Session.local(held) &&
          !InternalSession.toChain(held, { chainId }).accessKey &&
          !ClientId.thirdParty(config.clientId) &&
          // A session that signed in without a Tempo Account holds none to read.
          withAccount(held)
            ? await Core.getAccount(context, {
                accessToken: await accessToken(),
                chainId,
              })
            : undefined
        await chain.set(chainId)
        if (previous === chainId) return
        // The kept session whose access key expired moves too, so a renewal requests its access key
        // on the selected chain.
        session.move(chainId)
        // The session moves under the lock that a refresh holds, from the latest stored copy. A
        // sign-in that commits later moves its own access key at its commit. A failed save of the
        // moved session restores the earlier selection, so the store never pairs the selected chain
        // with the earlier chain's session.
        await session
          .exclusive(async () => {
            const latest = await session.reload()
            if (!latest) return
            const moved = InternalSession.toChain(latest, { chainId })
            // A session without access keys holds no account of another chain, also when the read
            // found none.
            const next = (() => {
              if (moved.accessKey) return moved
              if (account && Session.same(held, latest))
                return { ...moved, account }
              if (moved.account && !moved.accessKeys?.length) {
                const { account: _, ...rest } = moved
                return rest
              }
              return moved
            })()
            if (next === latest) return
            await session
              .change({ update: true })
              .commit(next)
              .catch(async (error: unknown) => {
                // A session that replaced the moved one during the save, such as a sign-in, holds
                // the selected chain, so the selection stays with it.
                const current = session.get()
                if (
                  !current ||
                  current.accessToken !== next.accessToken ||
                  current.accessKey?.keyAuthorization.keyId !==
                    next.accessKey?.keyAuthorization.keyId
                )
                  return
                // The commit sets the moved session before its save, so the instance takes the
                // earlier session back, beside the earlier selection.
                await session
                  .change({ update: true })
                  .commit(latest)
                  .catch(() => undefined)
                throw error
              })
            // A sign-in that committed during the switch held no account that the switch read.
            if (
              !next.accessKey &&
              !('account' in next && next.account) &&
              latest.account
            )
              readMoved(next)
          })
          .catch(async (error: unknown) => {
            await chain.set(previous).catch(() => undefined)
            // The kept expired session follows the selection that holds after the rollback, which
            // stays on the switch's chain when the rollback fails.
            session.move(chain.get())
            throw error
          })
      })
    switches.last = run
    return run
  }

  /**
   * Signs out, as `signOut` does. `options.revoked` names a refresh token that Tempo ID revoked
   * already, which the sign-out sends no revocation of.
   */
  async function signOut(
    options: {
      everywhere?: boolean | undefined
      revoked?: string | undefined
    } = {},
  ) {
    // Tempo ID refuses the logout from any other app's origin. The check runs first, so a refused
    // call ends no session.
    if (options.everywhere && ClientId.thirdParty(config.clientId))
      throw new EverywhereNotAllowedError()
    // The hooks start before the session's sign-out, which starts at once, so a sign-in that starts
    // after this call meets both. The sign-out's own rejection wins over a hook's.
    const before = (async () => {
      for (const plugin of plugins) await plugin.hooks?.beforeSignOut?.(context)
    })()
    before.catch(() => undefined)
    // The hooks settle before `signOut` settles, also when the session's sign-out rejects.
    try {
      await session.signOut(options)
    } catch (error) {
      await before.catch(() => undefined)
      throw error
    }
    await before
    for (const plugin of plugins) await plugin.hooks?.afterSignOut?.(context)
  }

  for (const plugin of plugins) {
    if (!plugin.extend) continue
    const members = plugin.extend(instance as Accounts, context) as Record<
      string,
      unknown
    >
    // Every own member is copied below, a non-enumerable or symbol one too, so each is checked.
    for (const name of Reflect.ownKeys(members))
      if (name in instance)
        throw new Error(
          `Invalid plugin member: ${String(name)} is a member of the instance already. Give the member of the ${plugin.id} plugin another name.`,
        )
    // A member can be a getter that reads the instance at each use, such as `viem`'s actions.
    Object.defineProperties(instance, Object.getOwnPropertyDescriptors(members))
  }

  return instance as Accounts<Plugin.Flatten<plugins>>
}

export declare namespace create {
  type Options<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = Omit<from.Options, 'account' | 'par' | 'store'> &
    Account & {
      /**
       * The IDs of the chains that `switchChain` may select, and that a stored selection may restore.
       * Defaults to Tempo's built-in chains: mainnet, testnet, devnet, and a local node. The
       * configured `chain` is always one of them. The wagmi connector passes its config's chains.
       */
      chains?: readonly number[] | undefined
      /**
       * The connections of a registered resource's API, for `connections.connect`: its `resource`,
       * the apps whose tokens it accepts, and the `store` that holds each connection's API access
       * key, or the `adapter` that reaches it. Only the API's server sets it, with `clientSecret` or
       * `clientAssertion` of the OAuth app that the resource's access key policy names. With
       * `metadata`, Tempo ID discovers the API from the metadata that `handler` serves, the client ID
       * is the handler's `/client.json` on the resource's origin, and the instance signs its
       * client assertions with `metadata.privateKey`. `create` then throws for `clientAssertion`,
       * `clientId`, `clientSecret`, or a resource with a query or a fragment. The instance
       * loads the connections' code at the first call, so a page's bundle holds none of it. Defaults
       * to none. Absent, `accounts.connections` throws `Accounts.ConnectionsRequiredError`.
       */
      connections?: Connections.Options | undefined
      /** The options of `accounts.handler`, the instance's server routes. Defaults to `{}`. */
      handler?:
        | {
            /**
             * The path that the routes sit under, such as `/accounts`, for an app that mounts the
             * handler under another prefix. Defaults to `/api`. `''` serves the routes at the root.
             * With `connections.metadata`, the default client ID sits under it, so a new path makes a
             * new app, which holds none of the earlier app's connections.
             */
            basePath?: string | undefined
            /**
             * Whether the handler serves the `relay` plugin's route at `/relay`. The relay accepts each
             * signed-in user of the app, and spends the fee payer's balance, so it is off unless set.
             * Defaults to `false`.
             */
            relay?: boolean | undefined
          }
        | undefined
      /**
       * The session hint, a cookie that a page reads synchronously at startup, so it loads the
       * instance only for a returning visitor. `Hint.has` of `accounts/hint` reads it. A session in
       * IndexedDB has no synchronous read. In a browser, the instance sets the cookie for 30 days at
       * each sign-in or restore, and removes it at each sign-out, and when it reads no saved session.
       * The cookie holds only `1`, on the path `/`, and no token. `cookie: true` names it
       * `tempo_session`. Defaults to no hint.
       */
      hint?:
        | {
            /** The cookie's name, or `true` for `tempo_session`. */
            cookie: string | true
          }
        | undefined
      /**
       * The plugins, each of which adds a namespace with its `id`. An entry can be a list, such as a
       * preset that combines plugins, or a falsy value, which adds nothing. Defaults to none. The
       * root entry's `Accounts.create` adds the `dialog`, `funding`, and `mpp` plugins that it lacks.
       * The built-in plugins come from `accounts/plugins`, and `Plugin.from` defines another. Each
       * plugin's `setup` runs once, in the order of `plugins`.
       *
       * - `backend`, as `accounts.backend`: a backend's sessions, one for each user.
       * - `device`, as `accounts.device`: the device grant, such as in a CLI.
       * - `dialog`, as `accounts.dialog`: Tempo ID's sign-in in a dialog or popup.
       * - `email`, as `accounts.email`: an emailed code in the app's own UI.
       * - `funding`, as `accounts.funding`: Tempo ID's deposit page.
       * - `mpp`, from `accounts/mpp`, as `accounts.fetch` and `accounts.mpp`: the payments of MPP
       *   endpoints.
       * - `passkey`, as `accounts.passkey`: a passkey in the app's own UI.
       * - `redirect`, as `accounts.redirect`: a redirect to Tempo ID's pages.
       * - `viem`, as `accounts.viem`: a Viem client with the session's access key.
       */
      plugins?: plugins | undefined
      /**
       * The store of `Accounts.from`, with its defaults: IndexedDB in a browser, and the file of
       * `Store.file()` for a `cli:` client ID elsewhere. `false` refuses that file, so the instance
       * holds no session and writes nothing, as a backend's. Pass it in a service that signs in many
       * users with a `cli:` client ID, such as a bot, so that each sign-in only returns its session.
       * In a browser, `false` keeps IndexedDB, which a page's sign-in needs.
       */
      store?: Store | false | undefined
    }

  /**
   * What each sign-in returns beside the user: a Tempo Account, and an access key for it. An
   * instance with `account: false` takes no `accessKey`, else the type refuses it and `create`
   * throws a `TypeError`.
   */
  type Account =
    | {
        /**
         * The access key of each sign-in that names none: what it may do, a function that the
         * instance calls at each sign-in to return it, or `false` for no access key. A duration
         * expiry, such as `'7d'`, counts from the sign-in. Without an expiry, the access key
         * expires a day after the sign-in, as one of a sign-in's own `accessKey` does. Defaults to
         * an access key that may transfer up to 5 OUSD, and expires a day after the sign-in. The
         * default applies to no sign-in with a challenge, whose signature stays an EIP-191
         * signature, and to no page whose `store` has `json`, which cannot keep the access key.
         */
        accessKey?:
          | Permissions
          | false
          | (() => Permissions | undefined)
          | undefined
        /** Absent, each sign-in returns the user's Tempo Account. See `Config.account`. */
        account?: undefined
      }
    | {
        /** Never an option, since the instance's sign-ins hold no Tempo Account. */
        accessKey?: undefined
        /** Signs users in without a Tempo Account and without an access key. See `Config.account`. */
        account: false
      }
}

/**
 * The members that `plugins` add to the instance, with `useSession` of the `react` plugin typed by
 * the instance's session: `Session.Any` with the `local` plugin, else `Session.Session`.
 */
export type Members<plugins extends readonly Plugin.Plugin[]> =
  Plugin.Members<plugins> extends { useSession(): unknown }
    ? Omit<Plugin.Members<plugins>, 'useSession'> & {
        useSession(): React.useSession.ReturnType<Session.Of<plugins>>
      }
    : Plugin.Members<plugins>

/**
 * The sign-in to the app that `pay` of an instance of `plugins` returns with the `siwe` plugin on a
 * page: the verify route's result as `auth`, or the reason that the sign-in failed after the transfer
 * as `authError`. Both are absent for a payment that signed no one in.
 */
export type PayAuth<plugins extends readonly Plugin.Plugin[]> =
  'siwe' extends plugins[number]['id']
    ? {
        /** The verify route's JSON object, such as `{ token }`. */
        auth?: Plugin.Challenge.Result | undefined
        /**
         * Why the sign-in failed after the transfer landed, such as the verify route's refusal as
         * `Accounts.RequestError`. Sign the user in again, such as with `dialog.signIn`.
         */
        authError?: unknown
      }
    : unknown

/**
 * `session.fetch` of an instance of `plugins`: the page's, and, with the `backend` plugin, the send
 * with the session of a server request.
 */
export type SessionFetch<plugins extends readonly Plugin.Plugin[]> =
  ('backend' extends plugins[number]['id']
    ? (
        request: Request,
        parameters: Actions.fetch.Parameters,
      ) => Promise<Response | undefined>
    : unknown) &
    ((parameters: Actions.fetch.Parameters) => Promise<Response>)

/**
 * `session.get` of an instance of `plugins`: the page's, and, with the `backend` plugin, the read
 * of a server request's session.
 */
export type SessionGet<plugins extends readonly Plugin.Plugin[]> =
  ('backend' extends plugins[number]['id']
    ? (request: Request) => Promise<backend.Session | undefined>
    : unknown) &
    ((
      parameters?: Core.getSession.Parameters,
    ) => Promise<Session.Of<plugins> | undefined>)

/**
 * Returns the access key of each sign-in of an instance without `accessKey`. A function, since a
 * module that imports `AccessKey` first evaluates this module before `AccessKey`'s constants.
 */
function defaultAccessKey(): Permissions {
  return {
    expiry: AccessKey_internal.defaultExpiry,
    limits: [{ limit: '5', token: 'ousd' }],
  }
}

/** Where Tempo ID runs unless `create` receives a `url`. */
const defaultUrl = 'https://id.tempo.xyz'

/** The members of every instance, which no plugin's `id` may take. */
const reserved = new Set([
  'account',
  'authorize',
  'chain',
  'config',
  'connection',
  'connections',
  'handler',
  'pay',
  'session',
  'signOut',
  'switchChain',
])

/**
 * Returns the error of an aborted `signal`: its `reason`, or an `AbortError`. React Native's
 * `AbortSignal` holds no `reason`, and its `fetch` rejects an abort with an `AbortError` too.
 */
function aborted(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
