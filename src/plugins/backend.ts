/**
 * The plugin of a backend's sessions: one for each of its users, under a session ID that the
 * browser holds in a cookie. The sessions live in a `Store`, or outside the process, where a
 * `backend.Sessions.Adapter` reaches them. A Tempo ID sign-in or, with the `siwe` plugin, a signed message
 * creates each.
 * @module
 */
import { Base64, Bytes } from 'ox'
import type * as Accounts from '../Accounts.js'
import { LocalSessionError } from '../Accounts.js'
import * as AccessToken from '../AccessToken.js'
import type * as AccessToken_ from '../AccessToken.js'
import type * as Funding from '../internal/Funding.js'
import * as Api from '../internal/Api.js'
import * as BackendCookie from '../internal/BackendCookie.js'
import * as BackendOperations from '../internal/BackendOperations.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as LogoutToken from '../LogoutToken.js'
import * as SignIn from '../internal/SignIn.js'
import * as Plugin from '../Plugin.js'
import * as Session_ from '../Session.js'
import type { Store } from '../Store.js'

/**
 * Returns the plugin of a backend's sessions: one for each of its users, under an opaque session ID
 * that the browser holds in an `HttpOnly` cookie. It adds `backend.start`, `backend.complete`,
 * `backend.save`, `backend.get`, `backend.fetch`, and `backend.end` by session ID, the reads of a
 * request's session `session.get(request)` and `session.fetch(request, options)`, and the sign-in
 * routes of `accounts.handler`, for a redirect or the dialog: `/auth/login`, `/auth/callback`,
 * `/auth/logout`, and `/auth/session`, and the back-channel logout route
 * `/auth/backchannel-logout`. The handler serves them under `/auth` of the `handler`
 * option's `basePath`, so under `/api/auth` by default, apart from its other routes, such as
 * `/relay`. An app with routes of its own calls `backend.start`, `backend.complete`, and
 * `backend.get` instead. The tokens and the access key stay on the server, so an XSS on the app's
 * pages cannot copy one.
 *
 * The `siwe` plugin stores the sessions of a signed message (EIP-4361) here too, under the same
 * cookie, so `session.get(request)` returns the session of either sign-in. Each session names how
 * the user signed in as `method`:
 *
 * | `method` | Created by | Holds |
 * | --- | --- | --- |
 * | `tempo-id` | A Tempo ID sign-in: `complete`, `save`, or the routes | A `backend.Session.TempoId`: the access token, the user, any access key |
 * | `siwe` | The `siwe` plugin | A `backend.Session.Siwe`: the account and the signed message |
 * | `access-token` | An access token of the app in the request, with `accessToken` | The verified token's claims, as `tokens.verifyAccessToken` of the `tokens` plugin returns them |
 *
 * Concurrent requests of one session share one refresh. A
 * [reused refresh token](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#token-refresh)
 * fails with `invalid_grant`, and revokes every refresh token of the app for the user. The plugin
 * holds the refreshes in progress, so one process serves every request of a session. The plugin
 * takes one of `store` and `sessions`:
 *
 * | Option | Sessions live in | One process for each |
 * | --- | --- | --- |
 * | `store` | A `Store`, such as Postgres or Redis | Server, or replica with session affinity |
 * | `sessions` | Outside the process, such as in one Durable Object for each session ID, through `Sessions.durableObject` | Session ID |
 *
 * A backend's instance holds no session of its own, since it serves many users. With `store`, the
 * plugin holds the refreshes in progress, so create the instance once for the process. With
 * `sessions`, the process of each session holds them, so a Worker creates the instance in each
 * request.
 *
 * A backend without a client secret uses its origin, such as `https://app.example`, as `clientId`.
 * Tempo ID then treats it as a third-party app: the user approves it on the approval page. A
 * backend that publishes a metadata document with `private_key_jwt` uses the document's URL as
 * `clientId`, and signs each token request with `clientAssertion`, so a refresh token alone
 * refreshes no session.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { backend } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: process.env.CLIENT_ID!,
 *   clientSecret: process.env.CLIENT_SECRET!,
 *   plugins: [backend({ store: Store.redis(redis) })],
 * })
 *
 * // GET /api/auth/login, GET /api/auth/callback, POST /api/auth/logout, GET /api/auth/session
 * app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
 * // Any later request
 * const session = await accounts.session.get(c.req.raw)
 * if (session?.method !== 'tempo-id')
 *   return c.json({ error: 'invalid_token' }, 401)
 * ```
 */
export function backend(options: backend.Options) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      const sessions = (() => {
        if (options.store)
          return local(
            // Several processes, such as replicas, can share a store.
            BackendSessions.create(config, {
              shared: true,
              store: options.store,
            }),
          )
        return options.sessions({
          clientId: config.clientId,
          scope: config.scope,
          url: config.url,
        })
      })()
      // The `viem` actions keep their marks of registered access keys in the store, also those that
      // another plugin builds, such as `mpp`. A backend's instance has no `store` of its own.
      const store = options.store ?? sessions.store
      if (store)
        Object.defineProperty(config, BackendOperations.store, {
          value: store,
        })
      // The verifiers share the configuration's key set, so the instance holds one of each.
      const logoutTokens = LogoutToken.create(config, options.logoutToken)
      const { url, ...verifierOptions } =
        typeof options.accessToken === 'object' ? options.accessToken : {}
      const verifier = options.accessToken
        ? AccessToken.create(config, verifierOptions)
        : undefined

      /**
       * Returns the session of the access token in the request's `Authorization` header, or
       * `undefined` without one, or for a token that does not verify.
       */
      async function bearer(
        request: Request,
      ): Promise<backend.Session.AccessToken | undefined> {
        if (!verifier) return undefined
        const token = await AccessToken.verifyRequest(verifier, {
          request,
          url,
        })
        return token && { method: 'access-token', token }
      }

      const namespace = {
        /**
         * Redeems the callback of `start` for the session `id`, and stores the session. A second
         * callback for the same ID redeems no code. A callback with a missing or mismatched `state`
         * keeps the pending sign-in. A matching callback consumes it before the token exchange,
         * also when that exchange fails.
         * @throws {Accounts.PendingNotFoundError} Without a redirect in progress for the session
         *   ID. This happens for a callback that arrives twice, even at the same time, or more than
         *   10 minutes after `start`, or 20 with `funding`. Start the sign-in again. Also for the
         *   callback of a redirect that an instance of another Tempo ID origin started in a shared
         *   store, which the call keeps.
         * @throws {Accounts.RequestError} With `invalid_request` and the `field` `url`, before any
         *   request, for a URL that is not a valid absolute URL, such as a request's path. Also for
         *   a forged `state` or a refused code, as the errors of `redirect.signIn` list.
         *
         * @example
         * ```ts
         * const session = await accounts.backend.complete({ id, url: c.req.url })
         * ```
         */
        complete: (
          parameters: backend.complete.Parameters,
        ): Promise<backend.Session.TempoId> =>
          redeem({ id: parameters.id, url: parameters.url }),
        /**
         * Revokes the session's refresh token at Tempo ID's `POST /oauth2/revoke`, then deletes the
         * session. A refresh or a `complete` in progress finishes first, so `end` revokes the token
         * that it stored. A SIWE session holds no refresh token, so `end` deletes it without a
         * request. With `revoke: false`, `end` deletes the session without a request. Use it for a
         * session that Tempo ID ended, such as one that a
         * [logout token](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#back-channel-logout)
         * names.
         * @throws {Accounts.RequestError} When the revocation fails, with `server_error` and status
         *   0 when it receives no response. The session stays, so a later `end` revokes it again.
         *
         * @example
         * ```ts
         * await accounts.backend.end({ id })
         * await accounts.backend.end({ id, revoke: false })
         * ```
         */
        end: (parameters: backend.end.Parameters): Promise<void> =>
          sessions.end(parameters),
        /**
         * Sends a request with the session's access token, as `Actions.fetch` does, after a refresh
         * if necessary. Returns `undefined` without a session, and for a SIWE session, which holds
         * no access token, and sends no request. If the response has status 401 and `WWW-Authenticate`
         * names `invalid_token`, such as after Tempo ID ended the user's session, the call refreshes
         * the session once. New tokens send the request again, if its body reads twice, such as a
         * string or a `Blob`. A stream body, a refresh that fails or that Tempo ID refuses, and a
         * second refusal of the token that such a refresh issued return the first response. A refused
         * refresh token ends the session.
         * @throws {Accounts.RequestError} With `invalid_dpop_proof` and status 400, if another DPoP
         *   key, or no key, binds the access token. The call sends no request. Also when a refresh
         *   fails, as `get` describes.
         * @throws {TypeError} When `url` is not a valid absolute URL. The message never names the
         *   URL, and the call sends no request.
         *
         * @example
         * ```ts
         * const response = await accounts.backend.fetch({
         *   id,
         *   url: 'https://api.example.com/me',
         * })
         * ```
         */
        async fetch(
          parameters: backend.fetch.Parameters,
        ): Promise<Response | undefined> {
          const { init = {} } = parameters
          const url = (() => {
            try {
              return new URL(parameters.url)
            } catch {
              // The parse error holds the whole URL in `input`, whose userinfo, query, or fragment
              // can hold a token, and an app logs the error, so the error never names the URL.
              throw new TypeError(
                'Invalid URL: the URL is malformed. Pass a valid absolute URL.',
              )
            }
          })()
          const method = (init.method ?? 'GET').toUpperCase()
          const send = (tokenHeaders: Record<string, string>) =>
            (config.fetch ?? globalThis.fetch)(url, {
              ...init,
              headers: Api.requestHeaders(init.headers, { tokenHeaders }),
              method,
            })
          // The sessions sign the request with the configuration that redeemed the tokens, such as a
          // Durable Object's, whose DPoP key bound them.
          const tokenHeaders = await sessions.headers({
            id: parameters.id,
            method,
            url: url.href,
          })
          if (!tokenHeaders) return undefined
          const response = await send(tokenHeaders)
          if (!refusesToken(response)) return response

          // The API refused a token that the session still holds, so the session refreshes once. The
          // request already reached the API, so a failed refresh returns its response. Sessions that
          // ignore `refused` return the same token, and the call returns the first response.
          const refused = accessTokenOf(tokenHeaders)
          const renewed = await sessions
            .headers({ id: parameters.id, method, refused, url: url.href })
            .catch(() => undefined)
          if (
            !renewed ||
            accessTokenOf(renewed) === refused ||
            !resendable(init.body)
          )
            return response
          await response.body?.cancel()
          return send(renewed)
        },
        /**
         * Returns the session, after a refresh if its access token expires within 30 seconds, or
         * `undefined` if it never existed, ended, or its refresh token was refused. Under an `id`
         * of other characters than `save` accepts, such as the value of a crafted cookie, `get`,
         * `fetch`, and `end` serve only a session that an earlier release stored, and the store
         * keeps any other entry. A session
         * without a refresh token, from a sign-in without `offline_access`, lasts until its access
         * token expires. A session whose access key expired ends without a refresh: the store
         * deletes it, Tempo ID revokes its refresh token, and `get` returns `undefined`. A store
         * that expires entries deletes the session one day after the access key's expiry. A `get`
         * within that day still revokes the refresh token, and a later one returns `undefined`
         * without a revocation. A SIWE session returns until its `expiresAt`, without a refresh,
         * and then `undefined`.
         *
         * With a `store` that has `lock`, such as `Store.file` or `Store.redis`, the instances on
         * the store refresh a session one at a time, so they send one refresh. With `store`, if
         * Tempo ID refuses the refresh with `invalid_grant`, `get` sends it once more after one
         * second. Another process that shares the store can refresh the same token
         * at once, and the second refresh receives its tokens. If the other refresh takes longer
         * than one second, the session still ends, so replicas keep session affinity. With
         * `sessions`, such as `Sessions.durableObject`, one object holds each session, so a refusal
         * is final.
         * @throws {Accounts.RequestError} When a refresh fails for a reason other than
         *   `invalid_grant`. A refusal with a 4xx status keeps the session for the next request. A
         *   failure without a response, or with a 5xx status, ends the session, since Tempo ID may
         *   have rotated the refresh token. If another DPoP key, or no key, binds the session's
         *   tokens, a read that needs a refresh throws `invalid_dpop_proof` with status 400, sends
         *   no refresh, and keeps the session.
         *
         * @example
         * ```ts
         * const session = await accounts.backend.get({ id })
         * if (session?.method !== 'tempo-id') return c.redirect('/api/auth/login')
         * ```
         */
        get: (parameters: {
          id: string
        }): Promise<backend.Session.Cookie | undefined> =>
          sessions.get(parameters),
        /**
         * Verifies a
         * [logout token](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#back-channel-logout)
         * that Tempo ID posts when a Tempo ID session ends, and ends each session that the token's
         * `sid` signed in, without a revocation, as `end` with `revoke: false` does. A session whose
         * tokens Tempo ID issued after the token, such as a sign-in again after the app's
         * disconnection, which keeps the Tempo ID session, stays. Tempo ID
         * revoked their refresh tokens already, and reads a second revocation as reuse, which
         * revokes the user's other sessions of the app. `complete` and `save` index each session
         * by its `sid`. `POST /auth/backchannel-logout` of `accounts.handler` calls it. Returns
         * the token's claims.
         * @throws {LogoutToken.InvalidError} For a token that does not verify, or that names another
         *   app. Respond with 400.
         * @throws {Accounts.RequestError} With status 0, when Tempo ID's key set cannot be fetched.
         *
         * @example
         * ```ts
         * const form = await c.req.formData()
         * await accounts.backend.logout({
         *   logoutToken: String(form.get('logout_token')),
         * })
         * ```
         */
        async logout(
          parameters: backend.logout.Parameters,
        ): Promise<backend.logout.ReturnType> {
          const token = await logoutTokens.verify(parameters)
          const sid = token.sessionId
          if (!sessions.close || !sessions.unlink)
            throw new Error(
              'Invalid sessions: the adapter has no `close` or `unlink`, so no logout token finds its sessions. Add `close`, `link`, and `unlink` to the adapter.',
            )
          // The index keeps each session ID until it ends, so a retry of the token, which Tempo ID
          // sends after a failure, finds the rest. A sign-in of the `sid` that links later finds the
          // index closed, and ends its session, unless Tempo ID issued its tokens after the token.
          const entries = await sessions.close({
            issuedAt: token.issuedAt,
            sid,
          })
          // A session that another sign-in replaced under its ID names another `sid`, or holds tokens
          // that Tempo ID issued after the token, and stays.
          const results = await Promise.allSettled(
            entries.map((entry) =>
              sessions.end({
                id: entry.id,
                issuedAt: token.issuedAt,
                revoke: false,
                sid,
              }),
            ),
          )
          const ended = entries.filter(
            (_, index) => results[index]!.status === 'fulfilled',
          )
          if (ended.length > 0)
            await sessions.unlink({
              ids: ended.map((entry) => entry.id),
              issuedAt: token.issuedAt,
              sid,
            })
          const failure = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected',
          )
          if (failure) throw failure.reason
          return token
        },
        /**
         * Stores a session from a sign-in without a redirect, such as the `email` plugin's
         * [backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md),
         * under a new session ID or `id`, and returns the ID with the session's `sid`, which a
         * logout token names.
         * @throws {Accounts.RequestError} With `invalid_request` and the `field` `id`, for an `id`
         *   that is not 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. The call stores
         *   nothing.
         *
         * @example
         * ```ts
         * const session = await accounts.email.signIn({ code, email: address, userIp })
         * const { id, sid } = await accounts.backend.save({ session })
         * ```
         */
        async save(
          parameters: backend.save.Parameters,
        ): Promise<backend.save.ReturnType> {
          // A local session holds no tokens for the backend to keep. Its account signs in through
          // `siwe` instead.
          if (Session_.local(parameters.session)) throw new LocalSessionError()
          const id = parameters.id ?? newId()
          BackendSessions.checkId(id)
          const saved = await sessions.save({ id, session: parameters.session })
          if (saved.sid)
            await link({
              expiresAt: BackendSessions.expiresAt(parameters.session),
              id: saved.id,
              issuedAt: issuedAt(parameters.session),
              sid: saved.sid,
            })
          return saved
        },
        /**
         * Starts a redirect sign-in, and stores its state for 10 minutes. Returns the session ID,
         * for an `HttpOnly` cookie, and the URL to redirect to.
         * @throws {Accounts.RedirectUriRequiredError} Before any request or store write, when neither
         *   the call nor the instance names a `redirectUri`.
         * @throws {Accounts.RequestError} With `invalid_field`, status 0, and the `field`, such as
         *   `funding.amount`, before any request or store write, for a `funding` amount that is not
         *   a decimal string above 0 with at most 18 digits and 18 decimals, a currency that is not three capital letters, or an empty
         *   token.
         * @throws {Accounts.RequestError} With `server_error` and status 0, when the instance
         *   pushes its requests and `POST /oauth2/par` receives no response, such as offline. With
         *   `invalid_request` and the `field` `id`, before any request, for an `id` that is not 1
         *   to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`.
         *
         * @example
         * ```ts
         * const { id, url } = await accounts.backend.start({
         *   redirectUri: new URL('/callback', c.req.url).href,
         * })
         * setCookie(c, 'sid', id, { httpOnly: true, path: '/', sameSite: 'Lax' })
         * return c.redirect(url, 302)
         * ```
         */
        start(
          parameters: backend.start.Parameters = {},
        ): Promise<{ id: string; url: string }> {
          const accessKey = SignIn.accessKey(context, parameters.accessKey)
          const id = parameters.id ?? newId()
          try {
            BackendSessions.checkId(id)
          } catch (error) {
            return Promise.reject(error)
          }
          // A Durable Object builds a configuration of its own, without the instance's chain and
          // redirect URI, so the request names both.
          return sessions.start({
            accessKey: accessKey && {
              ...accessKey,
              chainId: accessKey.chainId ?? config.chainId,
            },
            display: parameters.display,
            funding: parameters.funding,
            id,
            loginHint: parameters.loginHint,
            par: parameters.par,
            prompt: parameters.prompt,
            redirectUri: parameters.redirectUri ?? config.redirectUri,
            resource: parameters.resource ?? config.resource,
          })
        },
      }
      /**
       * Indexes the session `id` by its `sid`, so a logout token ends it. A failed write, or an
       * adapter without `link`, keeps the sign-in, since Tempo ID revokes the refresh token at the
       * logout, and the session then ends at its next refresh.
       */
      async function link(options: BackendSessions.link.Options) {
        // The function also catches an adapter's synchronous throw.
        const linked = await Promise.resolve()
          .then(() => sessions.link?.(options))
          .catch(() => undefined)
        // A logout token of the `sid` arrived during the sign-in, so its session ends. Tempo ID
        // revoked its refresh token, and reads a second revocation as reuse.
        // The closed index keeps the ID until then, so a retry of the token finds it after a failure.
        if (linked?.closed) {
          await sessions.end({
            id: options.id,
            revoke: false,
            sid: options.sid,
          })
          await Promise.resolve()
            .then(() =>
              sessions.unlink?.({ ids: [options.id], sid: options.sid }),
            )
            .catch(() => undefined)
        }
      }

      /**
       * Redeems the callback of the session `parameters.id`, then indexes the session by its `sid`
       * and runs `parameters.replace` together, since neither reads the result of the other.
       */
      async function redeem(
        parameters: Parameters<backend.Operations['complete']>[0],
      ) {
        const { id, replace, url } = parameters
        const session = await sessions.complete({ id, url })
        await Promise.all([
          session.sid
            ? link({
                expiresAt: BackendSessions.expiresAt(session),
                id,
                issuedAt: issuedAt(session),
                sid: session.sid,
              })
            : undefined,
          replace?.(),
        ])
        return session
      }

      /** Returns when Tempo ID issued the session's tokens, from its access token, or `undefined`. */
      function issuedAt(session: object) {
        return 'accessToken' in session &&
          typeof session.accessToken === 'string'
          ? BackendSessions.issuedAt(session.accessToken)
          : undefined
      }

      /** Returns the session ID that the request's session cookie names. */
      function idOf(request: Request) {
        return BackendCookie.get(request, { name: BackendCookie.names.session })
      }

      // The operations stay off the namespace's enumerable members, so the instance's type omits them.
      Object.defineProperty(namespace, BackendOperations.key, {
        value: {
          complete: redeem,
          async fetch(request, options) {
            const id = idOf(request)
            if (!id) return undefined
            return namespace.fetch({ ...options, id })
          },
          async get(request, options = {}) {
            const id = idOf(request)
            const current = id ? await sessions.get({ id }) : undefined
            if (current) return current
            // The `siwe` plugin's token mode hands a SIWE session's ID to the page, which sends it as
            // a bearer token. A Tempo ID session reads only from its cookie.
            const token = options.token
              ? BackendCookie.bearer(request)
              : undefined
            const held = token ? await sessions.get({ id: token }) : undefined
            if (held?.method === 'siwe') return held
            return bearer(request)
          },
          issue: sessions.issue,
          save: sessions.save,
          take: sessions.take,
        } satisfies backend.Operations,
      })
      return namespace
    },
    id: 'backend',
  })
}

export declare namespace backend {
  /**
   * A backend's session, by how the user signed in, as `method` names it: through Tempo ID, with a
   * signed message, or with an access token in the request's `Authorization` header.
   */
  type Session = Session.AccessToken | Session.Cookie

  namespace Session {
    /**
     * The session of an access token of the app, which `session` verified as
     * `tokens.verifyAccessToken` of the `tokens` plugin does. The app's page or CLI holds the token,
     * so the session holds no session ID.
     */
    type AccessToken = {
      /** How the user signed in: with an access token in the request. */
      method: 'access-token'
      /** The verified token's claims. Refuse a repeated DPoP proof, its `proof`, once used. */
      token: AccessToken_.create.Token
    }

    /** The session that a session ID names: a Tempo ID session, or a SIWE session. */
    type Cookie = Siwe | TempoId

    /** The session of a signed message (EIP-4361), which the `siwe` plugin verified. It holds no tokens. */
    type Siwe = BackendSessions.SiweSession

    /** The session of a Tempo ID sign-in, without its ID token and refresh token, and with its `sid`. */
    type TempoId = BackendSessions.BackendSession
  }

  /**
   * The operations of the sessions that the `siwe` plugin calls, by session ID, and the reads of a
   * request's session that the instance's `session` calls.
   */
  type Operations = Pick<Sessions, 'issue' | 'save' | 'take'> & {
    /**
     * Redeems the callback as `complete` does. `replace` runs after the redemption, beside the
     * index write of the new session's `sid`, so the `/auth/callback` route deletes the session
     * that the new one replaces in the same round.
     *
     * @example
     * ```ts
     * const session = await operations.complete({ id, replace: () => end(previous), url })
     * ```
     */
    complete: (
      parameters: complete.Parameters & {
        /** Deletes the session that the new session replaces. Absent, nothing runs beside the index write. */
        replace?: (() => Promise<void>) | undefined
      },
    ) => Promise<Session.TempoId>
    /**
     * Sends a request with the access token of the session that the request's
     * `__Host-tempo-id.sid` cookie names, as `fetch` does. Returns `undefined` without the cookie's
     * session, and for a SIWE session, and sends no request. An access token in the request's
     * `Authorization` header sends nothing either, since the app's page or CLI holds that token.
     * The instance calls it as `session.fetch(request, parameters)`.
     *
     * @example
     * ```ts
     * const response = await accounts.session.fetch(c.req.raw, {
     *   url: 'https://api.example.com/me',
     * })
     * if (!response) return c.json({ error: 'invalid_token' }, 401)
     * ```
     */
    fetch: (
      request: Request,
      options: Omit<fetch.Parameters, 'id'>,
    ) => Promise<Response | undefined>
    /**
     * Returns the session that the request's `__Host-tempo-id.sid` cookie names, as `get` does: a
     * Tempo ID session or a SIWE session. The `/auth/callback` route and the `siwe` plugin's
     * `/auth/siwe/verify` route set the cookie. Without the cookie's session, returns the SIWE
     * session whose token of the `siwe` plugin's token mode is in the `Authorization: Bearer`
     * header. Without either, and with
     * `accessToken`, verifies an access token of the app in the `Authorization` header, and returns
     * `{ method: 'access-token', token }`. A header that holds no valid token, such as an API key,
     * returns `undefined`. Returns `undefined` without either. The instance calls it as
     * `session.get(request)`, beside the form without a request.
     * @throws {Accounts.RequestError} With status 0, when the key set of the access token's
     *   verifier cannot be fetched.
     *
     * @example
     * ```ts
     * const session = await accounts.session.get(c.req.raw)
     * if (!session) return c.json({ error: 'invalid_token' }, 401)
     * if (session.method === 'siwe') return c.json({ account: session.address })
     * ```
     */
    get: (
      request: Request,
      options?: {
        /** Whether a bearer token names a SIWE session, in the `siwe` plugin's token mode. Defaults to `false`. */
        token?: boolean | undefined
      },
    ) => Promise<Session | undefined>
  }

  type Options = (
    | {
        sessions?: undefined
        /**
         * Where the sessions and the redirects in progress live, unserialized, such as
         * `Store.postgres` or `Store.redis`. Keep it on the server, since each value holds an
         * access key's private key and a refresh token. Each key starts with `tempo-id:session:`,
         * `tempo-id:pending:`, `tempo-id:sid:` for the index of a `sid`, `tempo-id:logout:` for the
         * logout of a `sid`, or, with the `siwe`
         * plugin, `tempo-id:challenge:` or `tempo-id:approval:`. A session ID holds only `A-Z`,
         * `a-z`, `0-9`, `-`, and `_`, so no session's key names the session of an instance that
         * shares the store, whose keys start with `tempo-id:session:[`. A session that an earlier
         * release stored under another `id` still reads and ends. If the instance has no `store`, the store also holds the `viem`
         * plugin's marks of registered access keys, under `tempo-id:registered:`. A redirect in
         * progress passes `expiresAt` to `setItem`, so the
         * store deletes an abandoned sign-in after 10 minutes, or 20 with `funding`. A session
         * passes one day after its access key's expiry, so the store deletes an abandoned session
         * with its access key and refresh token. A session without an access key, or with one that
         * never expires, passes none.
         */
        store: Store
      }
    | {
        /**
         * The sessions that live outside the process, one process for each session ID, in place of
         * `store`, such as `Sessions.durableObject` of `accounts/cloudflare` returns for a Durable
         * Object namespace. The plugin calls it once with the instance's `clientId`, and calls the
         * returned `backend.Sessions` for each session. If the instance has no `store`, the `store`
         * of the returned `backend.Sessions` holds the `viem` plugin's marks of registered access
         * keys. Without either, the marks live only in the instance, so each new instance attaches
         * the key authorization again, and the node refuses it.
         */
        sessions: Sessions.Adapter
        store?: undefined
      }
  ) & {
    /**
     * Whether `session.get(request)` also accepts an access token of the app in the request's
     * `Authorization` header, with the `Bearer` or `DPoP` scheme, or the options of its verifier,
     * as the `tokens` plugin takes them, such as `issuer`. The verifier accepts only the app's own
     * client ID by default, and checks a DPoP token's proof against the request's method and URL.
     * Behind a proxy that terminates TLS, `request.url` is the internal URL, so `url` names the
     * public origin, or returns the public URL that the proof names. A request with a session
     * cookie reads the cookie's session first. Absent, `session.get(request)` reads only the
     * cookie.
     */
    accessToken?:
      | true
      | (AccessToken_.create.Options & {
          /**
           * The public URL of a request, which its DPoP proof names: a function of the request
           * that returns it, or the public origin, such as `https://api.example`, to which the path
           * and query of `request.url` apply. Defaults to `request.url`.
           */
          url?: string | ((request: Request) => string) | undefined
        })
      | undefined
    /**
     * The options of the verifier of `logout`, as `LogoutToken.create` takes them, such as
     * `issuer` for an instance whose `url` reaches Tempo ID at another address. Defaults to the
     * instance's own app, and the origin of the instance's `url` as the issuer.
     */
    logoutToken?: LogoutToken.create.Options | undefined
  }

  /** The operations of the sessions, with the session ID that each takes. */
  type Sessions = {
    /** Redeems the callback of the session's redirect, and stores the session. */
    complete: (options: complete.Parameters) => Promise<Session.TempoId>
    /** Revokes the session's refresh token, then deletes the session, or only deletes it. */
    end: (options: end.Parameters) => Promise<void>
    /** Returns the session, after a refresh if necessary, or `undefined` without one. */
    get: (options: { id: string }) => Promise<Session.Cookie | undefined>
    /**
     * Returns the headers that send the session's access token for a request, or `undefined`
     * without a Tempo ID session.
     */
    headers: (
      options: BackendSessions.headers.Options,
    ) => Promise<Record<string, string> | undefined>
    /** Stores a challenge of the session: its SIWE sign-in's, or an approval's. */
    issue: (options: BackendSessions.issue.Options) => Promise<void>
    /**
     * Closes the index of a `sid` at its logout token, and returns its session IDs with their
     * expiries and issues. The index keeps each until `unlink` removes it. Absent, `logout` throws.
     */
    close?:
      | ((
          options: BackendSessions.close.Options,
        ) => Promise<readonly BackendSessions.Entry[]>)
      | undefined
    /**
     * Adds the session ID to the index of its `sid`, which `close` reads at a logout token, and
     * returns `closed: true` when a logout token that Tempo ID issued no earlier than the session's
     * tokens already closed it, so the session ends. Absent, the
     * sign-ins index nothing.
     */
    link?:
      | ((
          options: BackendSessions.link.Options,
        ) => Promise<BackendSessions.link.ReturnType | void>)
      | undefined
    /** Stores a session from a sign-in without a redirect, such as a SIWE session. */
    save: (options: {
      id: string
      session: save.Session
    }) => Promise<save.ReturnType>
    /** Starts the session's redirect sign-in, and returns the URL of Tempo ID's page. */
    start: (
      options: BackendSessions.start.Options & { id: string },
    ) => Promise<{ id: string; url: string }>
    /**
     * The store that every process of the app shares, which holds the `viem` plugin's marks of
     * registered access keys, unless the instance has a `store`. Absent, the marks live only in the
     * instance, so the first transaction of a session in each new instance attaches the key
     * authorization again, and the node refuses it.
     */
    store?: Store | undefined
    /** Deletes a challenge of the session, and returns it, once. */
    take: (
      options: BackendSessions.take.Options,
    ) => Promise<BackendSessions.Challenge | undefined>
    /** Removes the session IDs that ended from the index of a `sid`. Absent, `logout` throws. */
    unlink?:
      | ((options: BackendSessions.unlink.Options) => Promise<void>)
      | undefined
  }

  namespace Sessions {
    /**
     * Returns the sessions of the app `clientId` that live outside the process. Every call of one
     * session ID reaches one process, so concurrent reads of a session share one refresh.
     */
    type Adapter = (options: Adapter.Options) => Sessions

    namespace Adapter {
      type Options = {
        /** The client ID of the instance's app. */
        clientId: string
        /**
         * The scopes of the instance's tokens, separated by spaces, such as
         * `openid email offline_access`. A sign-in requests them.
         */
        scope: string
        /** Where the instance's Tempo ID runs, such as `https://id.tempo.xyz`. */
        url: string
      }
    }
  }

  namespace complete {
    type Parameters = {
      /** The session ID that `start` returned. */
      id: string
      /** The callback URL that Tempo ID redirected to. */
      url: string
    }
  }

  namespace end {
    type Parameters = BackendSessions.end.Options
  }

  namespace fetch {
    type Parameters = {
      /** The session ID. */
      id: string
      /** The request's other options. Its `Authorization` and `DPoP` headers are replaced. */
      init?: RequestInit | undefined
      /** The request's URL. */
      url: string | URL
    }
  }

  namespace logout {
    type Parameters = {
      /** The `logout_token` of the request's form body. */
      logoutToken: string
    }

    /** The verified logout token's claims. */
    type ReturnType = LogoutToken.create.Token
  }

  namespace save {
    type Parameters = {
      /**
       * The session ID: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. Defaults to 32
       * random bytes in URL-safe Base64.
       */
      id?: string | undefined
      /** The session that a sign-in returned. */
      session: Session_.Any
    }

    /** The session ID and the session's `sid`. */
    type ReturnType = BackendSessions.save.ReturnType

    /** A session that the sessions store: a sign-in's, or a SIWE session without its ID. */
    type Session = BackendSessions.save.Options['session']
  }

  namespace start {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. The user approves the access key, so it may exceed the
       * headless ceiling. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /**
       * `popup` requests the compact screens of a popup, as OpenID Connect's `display=popup` does.
       * Tempo ID's last page then posts the callback to the popup's opener. `POST /auth/login` sets
       * it for the dialog. Absent, Tempo ID shows its full pages.
       */
      display?: 'popup' | undefined
      /**
       * The amount that the app needs in the user's Tempo Account, which opens the funding page, as
       * [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.
       */
      funding?: Funding.Funding | undefined
      /**
       * The session ID: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. Defaults to 32
       * random bytes in URL-safe Base64.
       */
      id?: string | undefined
      /**
       * The address that Tempo ID's sign-in page fills in its email field, as OpenID Connect's
       * `login_hint`, such as the address of an invitation. The field stays editable. Absent, the
       * field is empty.
       */
      loginHint?: string | undefined
      /**
       * Whether the request goes to `POST /oauth2/par` first
       * ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)). The dialog's frame takes only a
       * request that is not pushed, so `POST /auth/login` sets `false`. Defaults to the instance's
       * `par`: `true` with `clientSecret` or `clientAssertion`, and `false` otherwise.
       */
      par?: boolean | undefined
      /**
       * `login` requests a new sign-in of a user whom the browser holds signed in, as OpenID
       * Connect's `prompt=login`, such as to sign in to another account. Absent, Tempo ID reuses
       * a session that the browser holds.
       */
      prompt?: 'login' | undefined
      /** Where Tempo ID redirects back to. Defaults to the instance's `redirectUri`. */
      redirectUri?: string | undefined
      /**
       * The [registered resources](https://github.com/tempoxyz/id/blob/main/docs/resources.md)
       * (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`. Each access token
       * names them as `aud`, and each refresh keeps them. A pushed request, which an instance with
       * a client secret or a client assertion sends, names at most one. An unknown or disabled
       * resource fails with
       * [`invalid_target`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_target).
       * Defaults to the instance's `resource`, or else Tempo ID's origin.
       */
      resource?: Accounts.Config['resource']
    }
  }
}

/** Returns the sessions of a store in this process. */
function local(sessions: BackendSessions.create.ReturnType): backend.Sessions {
  return {
    close: sessions.close,
    complete: sessions.complete,
    end: sessions.end,
    get: sessions.get,
    headers: sessions.headers,
    issue: sessions.issue,
    link: sessions.link,
    save: sessions.save,
    start: sessions.start,
    take: sessions.take,
    unlink: sessions.unlink,
  }
}

/**
 * Returns the access token of the headers that send it: the credentials of `Authorization`, in any
 * case of the header's name.
 */
function accessTokenOf(headers: Record<string, string>) {
  return new Headers(headers).get('authorization')?.split(' ')[1]
}

/**
 * Returns whether the response refuses its request's access token: status 401, with a
 * `WWW-Authenticate` challenge that names `invalid_token` (RFC 6750 §3.1).
 */
function refusesToken(response: Response) {
  if (response.status !== 401) return false
  const challenge = response.headers.get('www-authenticate') ?? ''
  return /\berror="?invalid_token"?/i.test(challenge)
}

/**
 * Returns whether a request body reads the same at a second send: absent, a string, a `Blob`, an
 * `ArrayBuffer` or a view of one, `FormData`, or `URLSearchParams`. A stream or an iterable reads
 * once.
 */
function resendable(body: RequestInit['body']) {
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  )
}

/** Returns a new session ID: 32 random bytes in unpadded URL-safe Base64. */
function newId() {
  return Base64.fromBytes(Bytes.random(32), { pad: false, url: true })
}
