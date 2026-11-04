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
import type { Dpop } from './internal/Dpop.js'
import * as Api from './internal/api.js'
import * as Chains from './internal/chains.js'
import * as ClientId from './internal/clientId.js'
import * as Core from './internal/core.js'
import * as DefaultDialog from './internal/defaultDialog.js'
import * as DefaultStore from './internal/defaultStore.js'
import * as InternalSession from './internal/session.js'
import type { Permissions } from './Permissions.js'
import * as Plugin from './Plugin.js'
import { funding } from './plugins/funding.js'
import type * as Session from './Session.js'
import type { Store } from './Store.js'
import type * as TempoAccount from './internal/TempoAccount.js'

/** Tempo ID lists no chain with the access key's chain ID, so the client's account signs no message on it. */
export class ChainUnavailableError extends Error {
  override readonly name = 'Accounts.ChainUnavailableError'

  constructor(options: ChainUnavailableError.Options) {
    super(
      `Tempo ID lists no chain with ID ${options.chainId}, so the account cannot sign on it. Sign in with a key on a listed chain.`,
    )
  }
}

export declare namespace ChainUnavailableError {
  type Options = {
    /** The access key's chain ID. */
    chainId: number
  }
}

/** An action received a `challenge` without `accessKey`. A challenge rides in an access key. */
export class ChallengeWithoutKeyError extends Error {
  override readonly name = 'Accounts.ChallengeWithoutKeyError'

  constructor() {
    super(
      'A challenge rides in the key authorization, so a sign-in without `accessKey` takes none. Remove `challenge`, or pass `accessKey` to request an access key.',
    )
  }
}

/** `Accounts.create` received no `clientId` outside a browser, where no page's origin can serve as one. */
export class ClientIdRequiredError extends Error {
  override readonly name = 'Accounts.ClientIdRequiredError'

  constructor() {
    super(
      "Missing client ID: outside a browser, no page origin can serve as the client ID. Pass `clientId`, from the app's registration.",
    )
  }
}

/**
 * A `signOut` with `everywhere` from an app that is not first-party, which Tempo ID refuses to end
 * the user's Tempo ID session for.
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
 * The client's account signs messages and typed data only, since its sign-in requested no access key, so
 * it sends no transaction.
 */
export class KeyRequiredError extends Error {
  override readonly name = 'Accounts.KeyRequiredError'

  constructor() {
    super(
      "The client's account signs messages and typed data only, since its sign-in requested no key. Sign in with a key to send transactions.",
    )
  }
}

/**
 * A backend's `complete` received a session ID without a redirect in progress, such as a callback
 * that arrived twice, or after 10 minutes.
 */
export class PendingNotFoundError extends Error {
  override readonly name = 'Accounts.PendingNotFoundError'

  constructor() {
    super(
      'No sign-in in progress for this session ID, or it started more than 10 minutes ago. Start the sign-in again.',
    )
  }
}

/** A request that Tempo ID refused. */
export class RequestError extends Error {
  override readonly name = 'Accounts.RequestError'
  /** The OAuth error code, such as `invalid_authorization_details`. */
  readonly code: string
  /** The request field at fault, as a dotted path. */
  readonly field: string | undefined
  /** The values that the refusal compared, such as `maximum`. Base units are decimal strings. */
  readonly meta: Readonly<Record<string, number | string>> | undefined
  /** A stable name for the refusal, to branch on. */
  readonly reason: RequestError.Reason | undefined
  /** Whether a sign-in verified before the refusal, so the user is signed in. */
  readonly signedIn: boolean
  /** The HTTP status, or 0 for a request without a response. */
  readonly status: number
  /** The page that explains the error. */
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
    | 'access_key_taken'
    | 'already_decided'
    | 'app_exists'
    | 'authorization_expired'
    | 'backend_sign_in_not_permitted'
    | 'body_too_large'
    | 'challenge_not_permitted'
    | 'config_conflict'
    | 'configurable_accounts_disabled'
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
    | 'foreign_origin'
    | 'funding_unavailable'
    | 'insufficient_balance'
    | 'invalid_app'
    | 'invalid_chain'
    | 'invalid_client'
    | 'invalid_client_attestation'
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
    | 'invalid_token'
    | 'limit_exceeds_maximum'
    | 'localhost_not_permitted'
    | 'logout_not_permitted'
    | 'malformed_body'
    | 'missing_code_challenge'
    | 'missing_key'
    | 'missing_permissions'
    | 'missing_recipients'
    | 'not_configurable'
    | 'origin_required'
    | 'owner_exists'
    | 'owner_unavailable'
    | 'passkey_limit'
    | 'passkey_link_expired'
    | 'passkey_not_permitted'
    | 'passkey_register_not_permitted'
    | 'payment_declined'
    | 'post_logout_redirect_not_permitted'
    | 'privy_app_taken'
    | 'public_app'
    | 'pushed_authorization_required'
    | 'rate_limited'
    | 'realm_exists'
    | 'realm_in_use'
    | 'reauthentication_required'
    | 'registrar_required'
    | 'rejected'
    | 'relying_party_taken'
    | 'scope_without_limit'
    | 'session_changed'
    | 'session_required'
    | 'sign_not_permitted'
    | 'sign_out_link_expired'
    | 'sign_up_not_permitted'
    | 'signing_key_in_use'
    | 'too_many_signing_keys'
    | 'unexpected'
    | 'unknown_app'
    | 'unknown_code'
    | 'unknown_endpoint'
    | 'unknown_key'
    | 'unknown_order'
    | 'unknown_realm'
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

/** A Viem client's account read while the instance holds no session. */
export class SignedOutError extends Error {
  override readonly name = 'Accounts.SignedOutError'

  constructor() {
    super("The client's account is signed out. Sign in before sending.")
  }
}

/**
 * A sign-in that another sign-in or a sign-out overtook. The instance keeps the newer session, and
 * the overtaken result is never returned.
 */
export class SupersededError extends Error {
  override readonly name = 'Accounts.SupersededError'

  constructor() {
    super(
      'Another sign-in or a sign-out completed while this sign-in was pending. Sign in again.',
    )
  }
}

/** The configuration of an instance, which every action of `Actions` takes. */
export type Config = {
  /** The chain of the app's access keys, unless a sign-in's `accessKey` names another. */
  chainId: number
  /**
   * Signs a client assertion for each request that authenticates the app, for an app with
   * `private_key_jwt`. Only a backend holds one. Excludes `clientSecret`.
   */
  clientAssertion?: ClientAssertion.Signer | undefined
  /**
   * The app's client ID: from its registration as an OAuth app, the URL of its metadata document,
   * its origin, such as `https://app.example` or a localhost origin in local development, or, for a
   * CLI without a registration, `cli:` and its name, such as `cli:acme-deploy`. In a browser, it
   * defaults to the page's origin.
   */
  clientId: string
  /** The app's client secret. Only a backend holds one. */
  clientSecret?: string | undefined
  /**
   * The key that binds the app's tokens (RFC 9449). Each token request sends a proof from it, and
   * Tempo ID issues `DPoP` tokens. Absent, the tokens are Bearer tokens, unless the app requires DPoP.
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
   * Whether a redirect or dialog pushes each authorization request to `/oauth2/par` (RFC 9126). The
   * plugin of the flow sets it. Defaults to `true` for an instance with `clientSecret` or
   * `clientAssertion`, and to `false` otherwise.
   */
  par?: boolean | undefined
  /** Where Tempo ID redirects back to. Defaults to the page's origin in a browser. */
  redirectUri?: string | undefined
  /** The scopes of the app's tokens, always with `openid` and `email`. */
  scope: string
  /**
   * Where the instance keeps its session and each redirect's state. Defaults to IndexedDB in a
   * browser. Outside a browser, the instance holds a session only with a store, such as on a device
   * or in a CLI, since a backend's instance serves many users.
   */
  store?: Store | undefined
  /** Where Tempo ID runs, such as `https://id.tempo.xyz`. */
  url: string
}

/**
 * A Tempo ID instance: its configuration, its session, and the namespace of each plugin. An instance
 * without a sign-in plugin holds the `dialog` plugin, and an instance without the `funding` plugin
 * holds it with its default options.
 */
export type Accounts<
  plugins extends readonly Plugin.Plugin[] = readonly Plugin.Plugin[],
> = Plugin.Namespaces<WithFunding<WithSignIn<plugins>>> &
  Plugin.Members<plugins> & {
    /** The user's Tempo Account that Tempo ID selects for the app. */
    account: {
      /**
       * Returns the account on the instance's chain, and creates one for a user who has none in the
       * app's realms.
       */
      get: (
        parameters?: Core.getAccount.Parameters,
      ) => Promise<TempoAccount.TempoAccount | undefined>
      /**
       * Upgrades a wallet.tempo passkey's account to a configurable account, when a sign-in returns
       * `upgradeAvailable: true`. The session's access key keeps working, and the session's account becomes
       * the upgraded account.
       */
      upgrade: (
        parameters?: Core.upgradeAccount.Parameters,
      ) => Promise<TempoAccount.TempoAccount>
    }
    /**
     * Requests the app's tokens, and an access key, for the user's Tempo ID session in the
     * browser, with no sign-in. Sets the session, and returns it, or empties it and returns
     * `undefined` when the browser holds no Tempo ID session.
     */
    authorize: (
      parameters?: Core.authorize.Parameters,
    ) => Promise<Core.authorize.ReturnType>
    /** The instance's configuration, which every action of `Actions` takes. */
    config: Config
    /** The session of the instance's user. */
    session: {
      /**
       * The XState actor of the session, or `undefined` for an instance without a session, such as
       * a backend's. Its snapshot's `value` is the status, `pending`, `reauthorizing`, `signedIn`,
       * or `signedOut`, and its `context.session` is the session. Read it, and send it no event: the
       * instance's actions change the session.
       */
      actor: InternalSession.machines.session.Actor | undefined
      /**
       * Returns the session. The first call reads the saved session, and each call first runs the
       * plugins' `restore` hooks, such as a redirect's callback. Returns `undefined`, and empties
       * the session, when the saved access key expired. Makes no request unless a hook does. With
       * `reauthorize`, a call that finds no session, or an expired one, authorizes the browser's Tempo
       * ID session, as `authorize` does, unless a sign-out without `everywhere` followed the last
       * sign-in.
       */
      get: (
        parameters?: Core.getSession.Parameters,
      ) => Promise<Session.Session | undefined>
      /**
       * Refreshes the session's tokens with its refresh token, saves them, and returns the session.
       * Returns `undefined` without a session or a refresh token.
       */
      refresh: () => Promise<Session.Session | undefined>
      /**
       * The status of the session, with the session to show: `get` returns it, and `subscribe`
       * calls its listener with each new status and the one before it. `signedOut` for an instance
       * without a session, such as a backend's.
       */
      status: InternalSession.Status
      /** Calls `listener` with each new session and the one before it. Returns the unsubscribe. */
      subscribe: (
        listener: (
          session: Session.Session | undefined,
          previous: Session.Session | undefined,
        ) => void,
      ) => () => void
    }
    /**
     * Empties the session at once, also when the request fails, deletes the saved session, and
     * revokes its refresh token. With `everywhere`, a first-party app also ends the user's Tempo ID
     * session, which signs the user out of every app that relies on it. Without it, `session.get`
     * with `reauthorize` signs the user in again only after the next sign-in. Throws
     * {@link EverywhereNotAllowedError} for `everywhere` from any other app, and signs nothing out.
     */
    signOut: (parameters?: {
      /** Whether the user's Tempo ID session ends too, for a first-party app. Defaults to `false`. */
      everywhere?: boolean | undefined
    }) => Promise<void>
  }

/**
 * Returns the configuration that every action of `Actions` takes, with its defaults, and no session
 * or plugin. `Accounts.create` builds its own with it. Throws {@link ClientIdRequiredError} outside a
 * browser without `clientId`.
 *
 * @example
 * ```ts
 * const config = Accounts.from({ clientId: 'client_…', clientSecret })
 * const tokens = await Actions.refresh(config, { refreshToken })
 * ```
 */
export function from(options: from.Options = {}): Config {
  const { chainId, dev, scope = 'offline_access', url, ...rest } = options

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
  return {
    ...rest,
    chainId: chainId ?? (dev ? Chains.ids.testnet : Chains.ids.mainnet),
    clientId,
    scope: [...new Set(['openid', 'email', ...scopes])].join(' '),
    url: url ?? defaultUrl,
  }
}

export declare namespace from {
  type Options = Omit<Partial<Config>, 'chainId' | 'scope' | 'url'> & {
    /** The chain of the app's access keys. Defaults to Tempo mainnet, or Tempo testnet with `dev`. */
    chainId?: number | undefined
    /** Whether to use Tempo testnet. Defaults to `false`. */
    dev?: boolean | undefined
    /** Scopes beyond `openid` and `email`. Defaults to `offline_access`, for a refresh token. */
    scope?: string | undefined
    /** Defaults to `https://id.tempo.xyz`. */
    url?: string | undefined
  }
}

/**
 * Creates an instance. In a browser, the instance holds the session of its user and saves it to
 * `store`, which defaults to IndexedDB. Elsewhere, it holds a session only with a `store`, such as
 * `Store.file` in a CLI.
 * Throws {@link ClientIdRequiredError} outside a browser without `clientId`.
 *
 * @example
 * ```ts
 * const accounts = Accounts.create({ plugins: [dialog()] })
 * ```
 */
export function create<const plugins extends readonly Plugin.Option[] = []>(
  options: create.Options<plugins> = {},
): Accounts<Plugin.Flatten<plugins>> {
  const {
    accessKey: accessKey_option,
    plugins: entries = [],
    ...rest
  } = options
  // The instance resolves a plain object again at each sign-in, so a duration expiry counts from
  // that sign-in.
  const accessKey =
    typeof accessKey_option === 'function'
      ? accessKey_option
      : () => accessKey_option
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
  const config = from(merged)
  // An instance without a sign-in plugin signs in with the dialog, which loads on demand. Every
  // instance opens the deposit page, so one without the `funding` plugin receives it.
  const plugins: readonly Plugin.Plugin[] = (() => {
    const signIn = named.some((plugin) =>
      DefaultDialog.signInIds.has(plugin.id),
    )
    const withFunding = named.some((plugin) => plugin.id === 'funding')
      ? named
      : [...named, funding()]
    return signIn ? withFunding : [...withFunding, DefaultDialog.plugin()]
  })()
  // A store of one user's, or a browser's IndexedDB, holds the session. A backend's instance passes
  // none, since it serves many users.
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

  // A session belongs to one deployment, app, and chain, so another one never restores it. The
  // JSON tuple keeps the key unique, since an origin and a client ID can both hold a colon.
  const name = `tempo-id:session:${JSON.stringify([new URL(config.url).origin, config.clientId, config.chainId])}`
  const store = DefaultStore.get(config.store)

  const session = InternalSession.create({
    enabled,
    getFn: config.getFn,
    name,
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
      const { logout = true, onRevoked, restored, unrevoked } = options
      // A sign-out that revokes nothing, or whose revocation received no answer, rejects with that
      // error after the logout, outside a page. On a page, a logout ends the Tempo ID session.
      const failure = await (async () => {
        if (unrevoked) return unrevoked
        if (!ended?.refreshToken) return undefined
        // The logout of a first-party app's Tempo ID session revokes the tokens that it issued, and
        // a revocation of a revoked token counts as a reuse, which revokes the app's tokens on the
        // user's other devices.
        if (restored && !ClientId.thirdParty(config.clientId)) return undefined
        return Api.revoke(config, { refreshToken: ended.refreshToken }).then(
          async () => {
            await onRevoked?.()
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
            await onRevoked?.()
            return undefined
          },
        )
      })()
      // A third-party app has no CORS grant for the logout, and the Tempo ID session is the user's,
      // which such an app does not end. Its client ID shows it: an origin, a metadata document's
      // URL, a registrar's `app_` ID, or a CLI's `cli:` name.
      const loggedOut = logout && !ClientId.thirdParty(config.clientId)
      if (loggedOut)
        await Api.json(await Api.post(config, '/v1/auth/logout', { json: {} }))
      // Only the logout of a page ends the token that the failure left, so without one the sign-out
      // rejects there too.
      if (failure && (typeof document === 'undefined' || !loggedOut))
        throw failure.error
    },
    store,
  })

  const context: Plugin.Context = {
    accessKey,
    config,
    session: {
      authorize: session.authorize,
      change: session.change,
      exclusive: session.exclusive,
      get: session.get,
      load: session.load,
      reload: session.reload,
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

  const instance: Record<string, unknown> = {
    ...namespaces,
    account: {
      get: (parameters?: Core.getAccount.Parameters) =>
        Core.getAccount(context, parameters),
      upgrade: (parameters?: Core.upgradeAccount.Parameters) =>
        Core.upgradeAccount(context, parameters),
    },
    authorize: (parameters?: Core.authorize.Parameters) =>
      Core.authorize(context, parameters),
    config,
    session: {
      actor: session.actor,
      get: (parameters: Core.getSession.Parameters = {}) =>
        Core.getSession(context, {
          ...parameters,
          async restore() {
            for (const plugin of plugins) await plugin.hooks?.restore?.(context)
          },
          signedOut: session.signedOut,
        }),
      refresh: () => Core.refresh(context),
      status: session.status,
      subscribe: session.subscribe,
    },
    async signOut(
      parameters: NonNullable<Parameters<Accounts['signOut']>[0]> = {},
    ) {
      // Tempo ID refuses the logout from any other app's origin. The check runs first, so a refused
      // call ends no session.
      if (parameters.everywhere && ClientId.thirdParty(config.clientId))
        throw new EverywhereNotAllowedError()
      // The hooks start before the session's sign-out, which starts at once, so a sign-in that starts
      // after this call meets both. The sign-out's own rejection wins over a hook's.
      const before = (async () => {
        for (const plugin of plugins)
          await plugin.hooks?.beforeSignOut?.(context)
      })()
      before.catch(() => undefined)
      // The hooks settle before `signOut` settles, also when the session's sign-out rejects.
      try {
        await session.signOut(parameters)
      } catch (error) {
        await before.catch(() => undefined)
        throw error
      }
      await before
      for (const plugin of plugins) await plugin.hooks?.afterSignOut?.(context)
    },
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
  > = Omit<from.Options, 'par'> & {
    /**
     * The access key of each sign-in that names none: what it may do, or a function that the
     * instance calls at each sign-in to return it. A duration expiry, such as `'7d'`, counts from
     * the sign-in. Without an expiry, Tempo ID fills it with the app's refresh token lifetime.
     * Absent, a sign-in without `accessKey` requests no access key.
     */
    accessKey?: Permissions | (() => Permissions | undefined) | undefined
    /**
     * The plugins, each of which adds a namespace with its `id`. An entry can be a list, such as a
     * preset that combines plugins, or a falsy value, which adds nothing. Defaults to none.
     */
    plugins?: plugins | undefined
  }
}

/** `plugins`, with the `dialog` plugin when none of them signs the user in. */
export type WithSignIn<plugins extends readonly Plugin.Plugin[]> =
  // A list whose IDs the type does not name, such as a widened `Plugin.Plugin[]`, may hold a
  // sign-in plugin, so its type promises no dialog.
  string extends plugins[number]['id']
    ? plugins
    : [Extract<plugins[number]['id'], DefaultDialog.SignInId>] extends [never]
      ? readonly [...plugins, DefaultDialog.Dialog]
      : plugins

/** `plugins`, with the `funding` plugin and its default options when none of them is `funding`. */
export type WithFunding<plugins extends readonly Plugin.Plugin[]> =
  // A list whose IDs the type does not name may hold the plugin, so its type promises none.
  string extends plugins[number]['id']
    ? plugins
    : 'funding' extends plugins[number]['id']
      ? plugins
      : readonly [...plugins, ReturnType<typeof funding>]

/** Where Tempo ID runs unless `create` receives a `url`. */
const defaultUrl = 'https://id.tempo.xyz'

/** The members of every instance, which no plugin's `id` may take. */
const reserved = new Set([
  'account',
  'authorize',
  'config',
  'session',
  'signOut',
])
