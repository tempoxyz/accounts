/**
 * The plugin of sign-in in a dialog on the page, a frame of Tempo ID's sign-in, or in a popup.
 * @module
 */
/* istanbul ignore file -- Each action needs a browser window, for the dialog or the popup. */
import * as Accounts from '../Accounts.js'
import * as AccountActions from '../actions/account.js'
import * as DialogActions from '../actions/dialog.js'
import * as Api from '../internal/Api.js'
import * as FrameTrust from '../internal/FrameTrust.js'
import type * as Funding from '../internal/Funding.js'
import * as Handler from '../internal/Handler.js'
import type { PageSession } from '../internal/handlers/Backend.js'
import * as Popup from '../internal/Popup.js'
import { pushes } from '../internal/Request.js'
import * as SignIn from '../internal/SignIn.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import {
  type ActorRefFrom,
  createActor,
  assign,
  type DoneActorEvent,
  enqueueActions,
  type ErrorActorEvent,
  fromPromise,
  setup,
  type SnapshotFrom,
  spawnChild,
  stopChild,
  waitFor,
} from 'xstate'

/**
 * The time in milliseconds after the preload's read settles for which the first `session` call takes
 * its result, since a sign-out or a sign-in through the app's own routes changes the session.
 */
const heldFor = 10_000

/**
 * Returns the plugin of sign-in on Tempo ID's pages without leaving the app's page. It adds
 * `dialog.callback`, `dialog.signIn`, and `dialog.signMessage`, and `dialog.updateAccessKey` and
 * `dialog.revokeAccessKey`, which open Tempo ID's
 * [approval pages](https://github.com/tempoxyz/id/blob/main/docs/access-keys.md#approval-pages-in-a-frame)
 * of the app's own access key in the same dialog, and `dialog.session`, which returns the session
 * that the page shows. By default, the sign-in shows Tempo ID's
 * [embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md) in a dialog
 * on the page. With `mode: 'popup'`, it runs the redirect sign-in in a popup window instead. The
 * user approves the access key on Tempo ID's page, so its limits may exceed the
 * [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
 *
 * A browser page without a session, or with an expired one, loads the dialog's frame, hidden, as
 * the instance is created, so the first sign-in shows at once. Every page without `backend` loads it
 * once its session ends. A page without a saved session that an authorization in progress restores
 * loads none, nor does one whose expired session that authorization renews, such as at the mount
 * of `react`, since the renewal shows no sign-in. With `backend`, the page reads `GET {backend}/auth/session` once, and loads the frame
 * only if the backend holds no session for its cookie, or the read fails. The plugin sees no end of
 * a backend's session, so a sign-in after a sign-out without a reload loads the frame at the click. A
 * browser without IntersectionObserver v2 loads it on every page, since it frames the sign-in and
 * the approval pages, such as the payment's, only for an app that the loaded frame reports as
 * trusted. With `preload: false` or `mode: 'popup'`, no
 * page loads it. A page on `http:`, such as `http://localhost`, loads none either, and each sign-in
 * there runs in a popup, unless Tempo ID is on `http:` itself. The page must be on the redirect
 * URI's origin, since the callback reaches only a page of that origin.
 *
 * An instance without a sign-in plugin receives this plugin with its default options. Its code then
 * loads on demand, so `Accounts.create()` alone offers `accounts.dialog.signIn()`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { dialog } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ plugins: [dialog()] })
 *
 * button.onclick = () => accounts.dialog.signIn()
 * ```
 */
export function dialog<const options extends dialog.Options = {}>(
  options: options = {} as options,
) {
  const { backend, crossOriginOpenerPolicy, par, preload = true } = options
  const popup = options.mode === 'popup'
  // One configuration with `par` for each instance, so its actions and its hooks share the state
  // that the actions keep by configuration, such as the preloaded frame.
  const configs = new WeakMap<
    Plugin.Context['config'],
    Plugin.Context['config']
  >()
  // The page's sign-ins in progress of each instance, with whether a completed change overtook each.
  const pending = new WeakMap<Plugin.Context['config'], Set<Entry>>()
  // The preload of each instance with `backend`, whose read a sign-in cancels.
  const preloading = new WeakMap<
    Plugin.Context['config'],
    machines.preload.Actor
  >()
  // The machine of each instance with `backend` that runs its sign-ins and `session` reads.
  const backends = new WeakMap<
    Plugin.Context['config'],
    machines.backend.Actor
  >()

  /** Returns the machine of the instance's sign-ins and `session` reads through `backend`. */
  function backendOf(
    context: Plugin.Context,
    options: { backend: string | true },
  ) {
    const existing = backends.get(context.config)
    if (existing) return existing

    const actor = createActor(
      machines.backend.provide({
        actors: {
          read: machines.read.provide({
            actors: {
              read: fromPromise(({ signal }) =>
                pageSession(configOf(context), {
                  backend: options.backend,
                  signal,
                }),
              ),
            },
          }),
        },
      }),
    ).start()
    backends.set(context.config, actor)
    return actor
  }

  /** Aborts each sign-in of the instance that a completed sign-out overtook, which closes its dialog. */
  function abort(context: Plugin.Context) {
    for (const entry of pending.get(context.config) ?? [])
      if (entry.overtaken())
        entry.controller.abort(new Accounts.SupersededError())
  }
  /** Returns whether a browser page loads the frame of the next sign-in before it starts. */
  const preloads = () => !popup && preload && typeof document !== 'undefined'
  /**
   * Returns the redirect URI of a sign-in through `backend`, the backend's callback route, or
   * `undefined` without `backend`.
   */
  const backendRedirectUri = (config: Plugin.Context['config']) => {
    if (backend === undefined) return undefined
    const basePath = backend === true ? Handler.basePath : backend
    return (
      config.redirectUri ??
      `${window.location.origin}${basePath.replace(/\/+$/, '')}${Handler.authPath}/callback`
    )
  }
  /** Returns the instance's configuration, with `par` when the plugin sets it. */
  function configOf(context: Plugin.Context) {
    if (par === undefined) return context.config
    const found = configs.get(context.config)
    if (found) return found
    // The copy keeps the getter of `chainId`, so it follows `switchChain`.
    const config = Object.assign(
      Object.defineProperties(
        {},
        Object.getOwnPropertyDescriptors(context.config),
      ) as typeof context.config,
      { par },
    )
    configs.set(context.config, config)
    // `accounts.pay` approves with the instance's configuration, and the copy holds the preloaded
    // frame, so the instance's configuration reads the copy's trust.
    FrameTrust.register(context.config, {
      read: () => FrameTrust.read(config),
    })
    return config
  }

  return Plugin.from({
    actions: (context) => {
      const config = configOf(context)
      /**
       * Returns the access key that an approval names, with its account and chain. Each absent
       * member takes the session's access key on the named chain, or of the named access key, from
       * `accessKey` or `accessKeys`, of `session`. The session's own access key is the default.
       */
      const target = (
        session: Session.Any | undefined,
        parameters: dialog.AccessKeyTarget,
      ) => {
        const entries = [
          session?.accessKey,
          ...(session?.accessKeys ?? []),
        ].filter(
          (entry) =>
            entry !== undefined &&
            (parameters.accessKey === undefined ||
              entry.keyAuthorization.keyId.toLowerCase() ===
                parameters.accessKey.toLowerCase()) &&
            (parameters.account === undefined ||
              entry.account.toLowerCase() === parameters.account.toLowerCase()),
        )
        // The access key is the one on the given chain, or on the instance's. A named access key on
        // no such chain is its only entry. One on several other chains resolves to none, so the
        // approval names the instance's chain, which Tempo ID refuses, and changes no other chain.
        const entry =
          entries.find(
            (entry) =>
              Number(entry!.chainId) === (parameters.chainId ?? config.chainId),
          ) ??
          (parameters.chainId === undefined &&
          parameters.accessKey !== undefined &&
          entries.length === 1
            ? entries[0]
            : undefined)
        const accessKey = parameters.accessKey ?? entry?.keyAuthorization.keyId
        const account = parameters.account ?? entry?.account
        const chainId =
          parameters.chainId ??
          (entry ? Number(entry.chainId) : undefined) ??
          config.chainId
        if (accessKey && account) return { accessKey, account, chainId }
        const { status } = context.session.status.get()
        if (status === 'pending' || status === 'reauthorizing')
          throw new Accounts.SignedOutError({ pending: true })
        if (session && !Session.expired(session))
          throw new Accounts.AccessKeyRequiredError()
        throw new Accounts.SignedOutError()
      }
      /**
       * Returns the stored session, which no call has read yet, for an approval that does not name its
       * access key, account, and chain. A call with a loaded session never awaits it, so it opens its popup
       * within the click.
       */
      const sessionOf = async (parameters: dialog.AccessKeyTarget) => {
        if (
          parameters.accessKey &&
          parameters.account &&
          parameters.chainId !== undefined
        )
          return undefined
        return await context.session.load()
      }
      /**
       * Returns the mode of an approval: the given one, or the plugin's. A page that severs the popup's
       * handle defaults to the frame, since a popup's approval there never posts its result.
       */
      const modeOf = (mode: 'iframe' | 'popup' | undefined) =>
        mode ?? (popup && !crossOriginOpenerPolicy ? 'popup' : 'iframe')

      /** The implementation of `signIn`, whose overloads `dialog.signIn.Fn` declares. */
      async function signIn(
        parameters: dialog.signIn.Parameters<options> = {},
      ): Promise<unknown> {
        if (backend !== undefined) {
          const { method, mode, signal } = parameters as dialog.signIn.Backend
          // The sign-in changes the backend's session, so the preload releases its read, and a later
          // `session` reads it again.
          preloading.get(context.config)?.send({ type: 'signIn.start' })
          // The machine cancels each `session` read, and refuses new ones until the sign-in ends.
          const coordinator = backendOf(context, { backend })
          coordinator.send({ type: 'signIn.start' })
          try {
            return await DialogActions.signIn(config, {
              backend,
              crossOriginOpenerPolicy,
              method,
              mode: mode ?? (popup ? 'popup' : 'iframe'),
              signal,
            })
          } finally {
            coordinator.send({ type: 'signIn.end' })
          }
        }

        // Without `backend`, the parameters are the page's own.
        const page: dialog.signIn.WithPage = parameters
        const change = context.session.change()
        // The sign-in registers before its first await, so a sign-out here or in another tab closes
        // its dialog once that sign-out completes, before the user approves a sign-in that the commit
        // would discard.
        const controller = new AbortController()
        const entry = { controller, overtaken: change.overtaken }
        const entries = pending.get(context.config) ?? new Set()
        pending.set(context.config, entries.add(entry))
        try {
          // A plugin's challenge, such as the `siwe` plugin's, signs the user in to the app too. Its
          // message arrives after the dialog or the popup opens.
          const source =
            page.challenge === undefined ? context.challenge() : undefined
          const accessKey = SignIn.accessKey(context, page.accessKey, {
            challenge: page.challenge !== undefined || source !== undefined,
          })
          let message: string | undefined
          const result = await DialogActions.signIn(config, {
            accessKey,
            challenge: source
              ? async (signal) =>
                  (message = await source.message({
                    chainId: context.config.chainId,
                    signal,
                  }))
              : page.challenge,
            crossOriginOpenerPolicy,
            // The plugin's challenge comes from the app's server, so the dialog shows at the click.
            deferred: source !== undefined,
            funding: page.funding,
            loginHint: page.loginHint,
            mode: page.mode ?? (popup ? 'popup' : 'iframe'),
            resource: page.resource,
            // A sign-out cancels only the wait for the approval. Tokens that Tempo ID issued before
            // it reach the commit, whose cleanup of the overtaken change revokes them.
            cancel: controller.signal,
            signal: page.signal,
          }).catch((error: unknown) => {
            // A sign-in that a sign-out cancelled received no tokens, and that sign-out ended the
            // session already, so it fails without the cleanup of an overtaken change, which would
            // send a second logout after a sign-out with `everywhere`.
            if (controller.signal.aborted && error === controller.signal.reason)
              throw error
            return change.fail(error)
          })
          const session = SignIn.toSession(result)
          // A refused verification fails the sign-in, and revokes the refresh token that no change
          // saves.
          const auth =
            source &&
            (await source
              .settle({
                // With an access key, the account signs the key authorization, whose witness binds
                // the message, in the same passkey prompt.
                ...(session.accessKey && session.accessToken
                  ? {
                      accessKey: {
                        accessToken: session.accessToken,
                        keyAuthorization: session.accessKey.keyAuthorization,
                      },
                    }
                  : {}),
                address: session.address!,
                message: message!,
                signature: session.challengeSignature!,
              })
              .catch((error: unknown) => {
                context.session.discard(session)
                return change.fail(error)
              }))
          // The caller's signal also ends the verification, after which the call sets no session.
          if (page.signal?.aborted) {
            context.session.discard(session)
            return change.fail(page.signal.reason)
          }
          await change.commit(session)
          return auth ? { ...session, auth } : session
        } finally {
          entries.delete(entry)
        }
      }

      return {
        /**
         * Completes a popup's sign-in on the page of the redirect URI, and closes the popup.
         * Returns whether the page was the callback of a popup. Tempo ID's page in the popup posts
         * the callback to the opening page itself, so only an app whose page sends
         * `Cross-Origin-Opener-Policy: same-origin` needs it.
         *
         * The page reads the sign-in's item from IndexedDB, which every window of the origin
         * shares, whatever the instance's `store`, such as `Store.memory`. The item stays in the
         * instance's `store` too, and the page reads both. So IndexedDB that is missing, refuses
         * the item, or stalls fails no sign-in.
         *
         * @example
         * ```ts
         * if (await accounts.dialog.callback()) return
         * ```
         */
        callback: (): Promise<boolean> => DialogActions.callback(config),
        /**
         * Revokes the app's own access key on Tempo ID's approval page, in the dialog or, with
         * `mode: 'popup'`, in a popup window. The account's owner signs on the page, a passkey
         * included. Returns the hash of the revoking transaction, or `null` for an access key that
         * the chain held revoked already. Defaults to the session's access key, and takes
         * `accessKey`, `account`, and `chainId` for another of the app's access keys, such as one
         * that the app's server holds. Call it in a click handler, since a popup opens only within
         * the gesture. The instance's session stays as it is.
         *
         * It runs `Actions.account.revokeAccessKey` with `mode: 'iframe'` or `mode: 'popup'`. A
         * frame without a Tempo ID session, or one that the app's page covers, offers a popup,
         * which opens from the user's click. A page that sends
         * `Cross-Origin-Opener-Policy: same-origin` severs its handle to the popup. A popup's call
         * there stays pending until `signal` aborts, as `funding.open` does.
         * @throws {Accounts.RequestError} With the page's return and status 0: `access_denied` when
         *   the user selects Cancel, `login_required` without a Tempo ID session, or the page's
         *   refusal, such as
         *   [`unknown_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unknown_key) for
         *   an access key that Tempo ID did not sign for the app.
         * @throws {Accounts.AccessKeyRequiredError} Without `accessKey` and `account`, when the
         *   session holds no access key on the chain, such as after a sign-in with `accessKey:
         *   false`.
         * @throws {Accounts.SignedOutError} Without `accessKey` and `account`, when the instance
         *   holds no session, such as with `backend`. While the instance reads the saved session or
         *   a sign-in runs, the error says so.
         * @throws {Actions.account.BlockedError} When the browser blocks the popup, since the call
         *   ran outside a user gesture.
         * @throws {Actions.account.OriginError} When the redirect URI is on another origin than the
         *   page.
         * @throws {DOMException} With the name `AbortError`, when the user closes the dialog or the
         *   popup.
         *
         * @example
         * ```ts
         * button.onclick = async () => {
         *   const { transaction } = await accounts.dialog.revokeAccessKey({
         *     accessKey: '0x9f10…0f08',
         *   })
         * }
         * ```
         */
        // An async member rejects every failure, and still opens a popup within the click, since it
        // runs at once up to its first `await`.
        revokeAccessKey: async (
          parameters: dialog.revokeAccessKey.Parameters = {},
        ): Promise<dialog.revokeAccessKey.ReturnType> =>
          AccountActions.revokeAccessKey(config, {
            ...target(
              context.session.get() ?? (await sessionOf(parameters)),
              parameters,
            ),
            mode: modeOf(parameters.mode),
            redirectUri: parameters.redirectUri ?? backendRedirectUri(config),
            signal: parameters.signal,
          }),
        /**
         * Returns the session that the page shows, for a page that restores a returning user's
         * session on load. With `backend`, it is the session that the backend's
         * `GET /auth/session` returns for the page's cookie, or `null`. The first call takes the
         * read that the page's preload started as the instance was created, so the page reads the
         * route once, also for a signed-out page. The first call takes it only while it is pending,
         * or for 10 seconds after it settles, since a sign-out or a sign-in through the app's own
         * routes changes the session that it read. Each later call, and a call after a sign-in started, reads it again. Without
         * `backend`, it is the instance's stored Tempo ID session, or `null`, also for a `local` plugin's session.
         * @throws {Accounts.RequestError} With `backend`, for a failed read, such as a 503
         *   `temporarily_unavailable`, or a `server_error` for a session without its method or account.
         * @throws {DOMException} With the name `AbortError`, if a sign-in is in progress at the call
         *   or starts during the read. The sign-in returns the session.
         *
         * @example
         * ```ts
         * const session = await accounts.dialog.session()
         * if (!session) button.onclick = () => accounts.dialog.signIn()
         * ```
         */
        session: (async () => {
          if (backend === undefined) {
            // The dialog shows a Tempo ID session, not a `local` plugin's beside it.
            const stored = await context.session.load()
            return stored && !Session.local(stored) ? stored : null
          }
          const coordinator = backendOf(context, { backend })
          if (machines.signingIn(coordinator.getSnapshot()))
            throw machines.cancelled()

          const preload = preloading.get(context.config)
          if (preload) {
            await waitFor(preload, (state) => !state.matches('reading'))
            // A sign-in can start during the wait, and cancels the preload's read.
            if (machines.signingIn(coordinator.getSnapshot()))
              throw machines.cancelled()
            // Each wait reads the current snapshot, so of two calls only the first takes the read.
            const snapshot = preload.getSnapshot()
            if (machines.held(snapshot, { now: performance.now() })) {
              preload.send({ type: 'session.take' })
              if (snapshot.matches('failed')) throw snapshot.context.error
              return snapshot.context.session
            }
          }

          const id = crypto.randomUUID()
          coordinator.send({ id, type: 'session.read' })
          const actor = machines.reader(coordinator.getSnapshot(), { id })
          const snapshot = await waitFor(
            actor,
            (state) => state.status === 'done',
          )
          coordinator.send({ id, type: 'session.done' })
          return machines.session(snapshot)
        }) as () => Promise<dialog.session.ReturnType<options>>,
        /**
         * Signs the user in, sets the instance's session, and returns it. Call it in a click
         * handler, before any `await`, since a popup opens only within the gesture. The session
         * holds no Tempo Account, so read it with `accounts.account.get` if necessary.
         *
         * With the `siwe` plugin's `auth`, and without `challenge`, the sign-in also signs the user
         * in to the app: the dialog opens, then requests the message from the app's challenge
         * route, and the account signs it. The call posts the signature to the verify route before
         * it sets the session, and returns the route's result as the session's `auth`, such as
         * `{ token }`. A refused verification rejects the call, and sets no session. The sign-in
         * requests no access key: with one, the call rejects with `invalid_request` before the
         * dialog opens, since its signature is the key authorization's.
         *
         * With `backend`, the backend keeps the session, and the call returns the session that the
         * page reads. It is `{ account, method: 'tempo-id', user }`, the session that the backend's
         * `GET /auth/session` returns. The call then sets no session of the instance, and takes
         * only `method`, `mode`, and `signal`.
         *
         * With `backend` and `method: 'siwe'`, it signs in with a message of the backend's `siwe`
         * plugin, and returns `{ account, method: 'siwe' }`, a SIWE session that the plugin's
         * routes verify. The dialog opens, then requests the message from
         * `POST /auth/siwe/challenge`. The account signs it as `signMessage` does, and
         * `POST /auth/siwe/verify` sets the session cookie.
         * @throws {Accounts.RequestError} For a refused sign-in:
         *   - Before the popup or the dialog opens, with status 0 and the `reason`
         *     [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed)
         *     for an `accessKey.expiry` in Unix seconds that has passed,
         *     [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry)
         *     for an `accessKey.expiry` that is not a whole number of seconds or holds milliseconds,
         *     [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period)
         *     for an `accessKey.limits` `period` that is fractional, negative, or above
         *     `Number.MAX_SAFE_INTEGER` seconds,
         *     [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field)
         *     for a negative `accessKey.limits` entry, or for a `funding` amount, currency, or token
         *     that Tempo ID refuses, with the `field`, such as `funding.amount`,
         *     [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit)
         *     for two `accessKey.limits` on one token, such as by its symbol and by its address,
         *     [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope)
         *     for two `accessKey.scopes` of one call on a target,
         *     [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients)
         *     for the zero address or a repeated address in `spenders` or a scope's `recipients`, or
         *     [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits)
         *     or
         *     [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes)
         *     for an empty `accessKey.limits` or `accessKey.scopes`.
         *   - With `server_error` and status 0, when the instance pushes its requests, with `par`,
         *     and `POST /oauth2/par` receives no response, such as offline.
         *   - With `invalid_request`, when the `state` of the callback or of the posted
         *     authorization does not match the pending sign-in. Start the sign-in again.
         *   - With the callback's `error` and status 0, for a callback without a `code`, such as
         *     `access_denied` when the user denies the approval page. An access key that Tempo ID
         *     refuses before sign-in returns its own `error`, such as
         *     `invalid_authorization_details` for an access key that breaks a
         *     [rule](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules). Its
         *     `message` is the `error_description`, or without one, a message that states the fault
         *     and the fix.
         *   - With `invalid_grant`, when the code was already redeemed, expired, or carried no key
         *     authorization. Only the first redemption, within 10 minutes of the approval, returns
         *     the access key. Start the sign-in again.
         *   - With the `reason`
         *     [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited),
         *     when the redemption of the code exceeded a rate limit. Retry later.
         *   - With the `reason`
         *     [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected), for
         *     an unexpected failure of the redemption. Retry the request.
         *   - With `backend`, with the `error` that `POST {backend}/auth/login` or
         *     `POST {backend}/auth/callback` returns, and its HTTP status, such as
         *     `invalid_request` for a sign-in that expired. With `method: 'siwe'`, for a refusal of
         *     either SIWE route.
         *   - With `backend`, with `server_error` and status 0, when `POST {backend}/auth/login`,
         *     `POST {backend}/auth/callback`, or with `method: 'siwe'` either SIWE route, receives
         *     no response, such as offline. The callback's error has `signedIn`, since the user
         *     signed in on Tempo ID before it.
         * @throws {DOMException} With the name `AbortError`, when the user closes the dialog or the
         *   popup, or when the next sign-in of the instance replaces a pending one. If the call ends
         *   while the page redeems the code, it revokes the refresh token that the redemption returns.
         * @throws {Actions.dialog.BlockedError} When the browser blocks the popup, since the call
         *   ran outside a user gesture.
         * @throws {Actions.dialog.OriginError} When the redirect URI is on another origin than the
         *   page.
         * @throws {Accounts.SupersededError} When another sign-in or a sign-out completed while
         *   this sign-in was pending. A sign-out here or in another tab rejects the sign-in once
         *   the sign-out completes, after its revocation and logout requests, and closes its dialog
         *   or its popup. A page that sends `Cross-Origin-Opener-Policy: same-origin` cannot close
         *   the popup, but the instance redeems no approval from it.
         * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
         *   `Store.redis`, and the call generates an access key. The call throws before any
         *   request.
         *
         * @example
         * ```ts
         * button.onclick = async () => {
         *   const session = await accounts.dialog.signIn()
         * }
         * ```
         */
        signIn: signIn as dialog.signIn.Fn<options>,
        /**
         * Asks the user's Tempo Account to sign `message`, such as a SIWE message that the app's
         * backend issued, and returns the account, the message, and its signature. Call it in the
         * click handler, before any `await`, so a popup opens within the click's gesture.
         *
         * The dialog runs a sign-in with `message` as its `challenge`, without an access key. The
         * call sets no session of the instance, also with `backend`. Its sign-in requests no
         * `offline_access`, so Tempo ID issues no refresh token. It takes `mode` and `signal` as
         * `signIn` does, and throws its errors.
         *
         * With `backend`, its redirect URI is the backend's callback route, which the app
         * registers. If the page's `Cross-Origin-Opener-Policy` severs the popup's handle, that
         * route posts the callback to the page, since no redirect sign-in of the browser started
         * it.
         *
         * @example
         * ```ts
         * button.onclick = async () => {
         *   const { message, signature } = await accounts.dialog.signMessage({
         *     message: async (signal) => {
         *       const response = await fetch('/v1/notes/clear/challenge', {
         *         method: 'POST',
         *         signal,
         *       })
         *       return ((await response.json()) as { message: string }).message
         *     },
         *   })
         *   await fetch('/v1/notes/clear', {
         *     body: JSON.stringify({ message, signature }),
         *     method: 'POST',
         *   })
         * }
         * ```
         */
        signMessage: (
          parameters: dialog.signMessage.Parameters,
        ): Promise<dialog.signMessage.ReturnType> =>
          DialogActions.signMessage(config, {
            crossOriginOpenerPolicy,
            message: parameters.message,
            mode: parameters.mode ?? (popup ? 'popup' : 'iframe'),
            // With `backend`, the sign-in takes the frame that the plugin preloads for its callback
            // route, which is also the redirect URI that the app registers.
            redirectUri: backendRedirectUri(config),
            signal: parameters.signal,
          }),
        /**
         * Changes the limits, the scopes, or both of the app's own access key on Tempo ID's approval
         * page, in the dialog or a popup, and returns the hash of the transaction. Defaults to the
         * session's access key. The page shows the change, and the account's owner signs on it, a
         * passkey included, so any app changes its own access key without `tempo-id:sign`. It takes
         * the parameters of `revokeAccessKey`, with `limits` and `scopes` as `viem.accessKey` names
         * them, and throws the errors of `revokeAccessKey`.
         *
         * @example
         * ```ts
         * button.onclick = async () => {
         *   const { transaction } = await accounts.dialog.updateAccessKey({
         *     accessKey: '0x9f10…0f08',
         *     limits: [
         *       {
         *         limit: 20_000_000n,
         *         token: '0x20c0000000000000000000000000000000000000',
         *       },
         *     ],
         *   })
         * }
         * ```
         */
        updateAccessKey: async (
          parameters: dialog.updateAccessKey.Parameters,
        ): Promise<dialog.updateAccessKey.ReturnType> =>
          AccountActions.updateAccessKey(config, {
            ...target(
              context.session.get() ?? (await sessionOf(parameters)),
              parameters,
            ),
            limits: parameters.limits,
            mode: modeOf(parameters.mode),
            redirectUri: parameters.redirectUri ?? backendRedirectUri(config),
            scopes: parameters.scopes,
            signal: parameters.signal,
          }),
      }
    },
    // The plugin adds no member. It reads the instance's status, which only `extend` receives.
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      // The instance can be created outside a browser, such as on a server that renders the page.
      if (!preloads()) return {}
      const load = () => {
        const config = configOf(context)
        const redirectUri = backendRedirectUri(config)
        DialogActions.preload(config, redirectUri ? { redirectUri } : {})
      }

      // A browser without IntersectionObserver v2 frames the sign-in only for an app whose loaded
      // frame reports Tempo ID's trust, so every page loads the frame there, also with a session.
      if (!visibility()) load()
      // With `backend`, the backend holds the session and the instance none, so the backend's
      // session route tells whether the page shows a sign-in. A signed-in page loads no frame, and
      // a failed read loads it. The instance's status follows no sign-in of the backend, so the
      // plugin reads none. The preload is an optimization, so the instance waits for no read.
      else if (backend !== undefined) {
        // A page that frames no sign-in loads no frame, so it reads no session either.
        if (!framed(configOf(context))) return {}
        const actor = createActor(
          machines.preload.provide({
            actions: { load },
            actors: {
              read: fromPromise<machines.preload.Read>(({ signal }) =>
                pageSession(configOf(context), { backend, signal }).then(
                  (session) => ({ at: performance.now(), session }),
                  (error: unknown) => {
                    if (signal.aborted) throw error
                    return { at: performance.now(), error }
                  },
                ),
              ),
            },
          }),
        ).start()
        preloading.set(context.config, actor)
        return {}
      }
      // A page that restores a session shows no sign-in, so it loads no frame. A failed read loads
      // it, since the page then shows a sign-in. The preload is an optimization, so the instance
      // waits for no read.
      else
        void context.session.reload().then(async (session) => {
          if (session && !Session.expired(session)) return
          // An authorization of the browser's Tempo ID session, such as the one of `react` or of a
          // `session.get` with `reauthorize` at mount, restores a session without one, and renews
          // an expired one without a sign-in, so the frame waits for an authorization that runs. The
          // page starts it as it renders, after this read, so the frame waits for the page first.
          await rendered()
          await context.session.settled()
          // Without an authorization, the instance can keep the expired session, which shows a
          // sign-in.
          const current = context.session.get()
          if (!current || Session.expired(current)) load()
        }, load)

      // Each end of the session shows a sign-in: a sign-out here or in another tab, a refused
      // token, or an expired access key that no authorization renews. A renewal, at
      // `reauthorizing`, is a request of the page, so it loads no frame. A held frame stays, so a
      // repeated status loads nothing. The first read of a store without a session ends none: the
      // page's authorization at mount can still restore one, so the read above decides.
      instance.session.status.subscribe((status, previous) => {
        if (status.status !== 'signedOut') return
        if (
          previous.status === 'signedIn' ||
          previous.status === 'reauthorizing'
        )
          load()
      })
      return {}
    },
    hooks: {
      // Another tab's sign-out runs only this hook.
      afterSignOut(context) {
        abort(context)
      },
      // A sign-out that rejects, such as for a revocation without an answer, runs no `afterSignOut`,
      // but it overtakes the sign-ins too. The wait runs beside the sign-out, so the hooks of later
      // plugins start at once. It never rejects, since `ended` never rejects.
      beforeSignOut(context) {
        void (async () => {
          await Promise.resolve()
          await context.session.ended()
          abort(context)
        })()
      },
    },
    id: 'dialog',
  })
}

/** A sign-in in progress of the dialog plugin on the page. */
type Entry = {
  /** Aborts the sign-in, and closes its dialog or its popup. */
  controller: AbortController
  /** Returns whether a change that overtakes the sign-in completed. */
  overtaken: () => boolean
}

export declare namespace dialog {
  type Options = {
    /**
     * The path where the app mounts `accounts.handler` on the page's origin: the server's
     * `handler.basePath`, under whose `/auth` the `backend` plugin serves its sign-in routes.
     * `true` names the default, `/api`. The backend then builds each request, redeems its code, and
     * sets the session cookie, so the page holds no token. `signIn` returns the session that the
     * page reads, and sets no session of the instance. Absent, the page holds the session.
     *
     * Each sign-in runs through the backend:
     *
     * 1. `POST {backend}/auth/login` builds the request, and returns its URL. The backend keeps the
     *    PKCE verifier.
     * 2. The frame or the popup shows the request.
     * 3. The page sends the callback URL to `POST {backend}/auth/callback`, which redeems the code
     *    and sets the session cookie.
     *
     * The page's instance names the backend's `clientId`, since the frame shows the requests of
     * that app. The redirect URI is the instance's `redirectUri`, or else
     * `{backend}/auth/callback`. If the page's `Cross-Origin-Opener-Policy` severs the popup's
     * handle, the popup returns to `GET {backend}/auth/callback`, whose page posts the callback to
     * the page. The page reads the session from `GET {backend}/auth/session`, and calls its API
     * with the cookie.
     *
     * The backend never pushes the dialog's request, since the dialog chooses the frame or the
     * popup before the request exists. An app that
     * [requires pushed requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md#required-pushed-requests)
     * signs in through the backend's `GET /auth/login` redirect instead.
     *
     * The backend's instance names the request's `resource`, after the dialog chooses the frame or
     * the popup. Tempo ID's frame issues tokens for its own origin alone. So if the backend's
     * instance names a `resource`, the page's instance names the same `resource`, and the sign-in
     * runs in a popup.
     */
    backend?: string | true | undefined
    /**
     * `same-origin` for an app whose pages send `Cross-Origin-Opener-Policy: same-origin`, which
     * severs the popup's handle to the page, so the popup cannot post the authorization. Each
     * sign-in then sends a PKCE challenge, and the page redeems the code at `/oauth2/token`.
     * Absent, each sign-in asks for the
     * [web message mode](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#web-message-mode):
     * Tempo ID redeems the code, and its page in the frame or the popup posts the authorization,
     * which saves the page's token request.
     *
     * An instance with `dpop` or `par`, and a sign-in with `funding`, always redeem on the page. A
     * page that severs the handle without this option receives `web_message_unavailable`, and the
     * sign-in starts again with `same-origin`. A sign-in through `backend` with `method: 'siwe'`,
     * and `signMessage`, take the option too.
     */
    crossOriginOpenerPolicy?: 'same-origin' | undefined
    /**
     * Whether each request goes to `POST /oauth2/par` first
     * ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), as
     * [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md)
     * describes. A pushed request signs in with a popup only. Defaults to the instance's `par`,
     * which is `true` with `clientSecret` or `clientAssertion`, and `false` otherwise.
     */
    par?: boolean | undefined
  } & (Options.Iframe | Options.Popup)

  namespace Options {
    /** The options of a plugin whose sign-ins show in a frame in a dialog on the page. */
    type Iframe = {
      /**
       * Each sign-in shows in a frame in a dialog on the page, unless its own `mode` names the
       * popup. The default.
       */
      mode?: 'iframe' | undefined
      /**
       * Whether a browser page loads the dialog's frame, hidden, before a sign-in. A page without a
       * saved session, or with an expired one, first waits for an authorization in progress, such
       * as the one of `react` at mount, and loads it only if no live session follows. A page that
       * restores a session loads it once the session ends: at a sign-out here or in another tab, a
       * refused token, or an expired access key that no authorization renews. With
       * `backend`, a page loads it only if `GET {backend}/auth/session` returns no session, and a
       * sign-in after a sign-out without a reload loads it at the click. A page
       * that holds a frame that has not failed, such as one that a sign-in kept, loads no other.
       * Defaults to `true`.
       */
      preload?: boolean | undefined
    }

    /** The options of a plugin whose sign-ins show in a popup window, which loads no frame. */
    type Popup = {
      /** Each sign-in shows in a popup window, unless its own `mode` names the frame. */
      mode: 'popup'
      /** Absent, since a page preloads no frame for a popup. Only the `iframe` `mode` takes it. */
      preload?: undefined
    }
  }

  namespace signMessage {
    type Parameters = Pick<signIn.WithPage, 'mode' | 'signal'> & {
      /**
       * The message to sign, such as a SIWE message, or a function that returns it, such as from a
       * request to the app's backend. The function runs after the dialog opens, so a popup opens
       * within the gesture, which iOS requires. The account signs the EIP-191 hash, as
       * `personal_sign` does, on the instance's chain. Tempo ID's page shows the message. The
       * function's signal aborts once the sign-in ends, such as when a later sign-in replaces it.
       */
      message: string | ((signal: AbortSignal) => Promise<string>)
    }

    type ReturnType = {
      /** The Tempo Account that signed. */
      address: `0x${string}`
      /** The message that the account signed, also when a function returned it. */
      message: string
      /** The account's signature of the message, which Viem's `verifyMessage` verifies on the instance's chain. */
      signature: `0x${string}`
    }
  }

  /**
   * The access key that an approval page changes or revokes. Each absent member takes the session's
   * access key on `chainId`, or the session's entry of `accessKey`, from `accessKey` or `accessKeys`.
   */
  type AccessKeyTarget = {
    /**
     * The address of one of the app's own access keys, one that Tempo ID signed for the app's
     * client ID. Another app's access key reads as `unknown_key`. Defaults to the session's access
     * key on `chainId`, or on the instance's chain. With `backend`, the page holds no access key,
     * so each call names `accessKey`, `account`, and `chainId`.
     */
    accessKey?: `0x${string}` | undefined
    /**
     * The Tempo Account that the access key acts for. Defaults to the account of the session's
     * access key.
     */
    account?: `0x${string}` | undefined
    /**
     * The access key's chain ID. Defaults to the instance's chain, or for `accessKey` with no entry
     * there, the chain of its only entry in the session, of `account` when given. An access key on
     * several other chains needs `chainId`, else Tempo ID refuses the approval on the instance's
     * chain.
     */
    chainId?: number | undefined
  }

  namespace revokeAccessKey {
    type Parameters = AccessKeyTarget & {
      /**
       * Whether the approval page shows in a frame or in a popup window. Defaults to the plugin's
       * `mode`, or to the frame with `crossOriginOpenerPolicy`. A popup opens only within a click.
       */
      mode?: AccountActions.revokeAccessKey.Dialog | undefined
      /**
       * One of the app's registered redirect URIs, on the page's origin, since Tempo ID posts the
       * page's return only to its origin. Defaults to the instance's, or with `backend`, to the
       * backend's callback route, as `signIn` uses.
       */
      redirectUri?: string | undefined
      /** Rejects the revocation with the signal's reason, and closes the dialog or the popup. */
      signal?: AbortSignal | undefined
    }

    /** The hash of the revoking transaction, or `null` for an access key revoked already. */
    type ReturnType =
      AccountActions.revokeAccessKey.ReturnType<AccountActions.revokeAccessKey.Dialog>
  }

  namespace session {
    /**
     * With `backend`, the session that the backend's `GET /auth/session` returns, or `null`.
     * Without it, the instance's stored session, or `null`.
     */
    type ReturnType<options extends Options = {}> = options extends {
      backend: string | true
    }
      ? PageSession | null
      : options extends { backend?: undefined }
        ? Session.Session | null
        : // A widened `backend`, such as of `dialog.Options`, can hold either.
          PageSession | Session.Session | null
  }

  namespace signIn {
    type Parameters<options extends Options = {}> = options extends {
      backend: string | true
    }
      ? Backend
      : WithPage

    /**
     * The session, or with `backend`, the Tempo ID session that the page reads. With a plugin's
     * challenge, such as the `siwe` plugin's `auth`, the session holds the verification's result as
     * `auth`, which the instance does not store.
     */
    type ReturnType<options extends Options = {}> = options extends {
      backend: string | true
    }
      ? PageSession.TempoId
      : Session.Session & {
          /** The verify route's JSON object, such as `{ token }`. Absent without a plugin's challenge. */
          auth?: Plugin.Challenge.Result | undefined
        }

    /**
     * `signIn`, whose sign-in through `backend` returns the session that the page reads: a SIWE
     * session with `method: 'siwe'`, a Tempo ID session by default, and either for a `method` that
     * the type does not name. The last signature is the general one, which `ReturnType` reads.
     */
    type Fn<options extends Options = {}> = {
      (
        parameters: options extends { backend: string | true }
          ? Backend & { method: 'siwe' }
          : never,
      ): Promise<PageSession.Siwe>
      (
        parameters: options extends { backend: string | true }
          ? Backend & { method?: 'tempo-id' | undefined }
          : never,
      ): Promise<PageSession.TempoId>
      (
        parameters: options extends { backend: string | true }
          ? Backend
          : never,
      ): Promise<PageSession>
      (parameters?: Parameters<options>): Promise<ReturnType<options>>
    }

    /** The parameters of a sign-in whose backend holds the session. */
    type Backend = Pick<WithPage, 'mode' | 'signal'> & {
      /**
       * `siwe` to sign in with a SIWE message of the backend's `siwe` plugin: the dialog requests
       * the message from `POST /siwe/challenge` after it opens, the account signs it, and
       * `POST /siwe/verify` sets the session cookie. Defaults to `tempo-id`. A `method` whose type
       * is `'siwe' | 'tempo-id'` returns either session, so a read of `user` needs a narrowing on
       * `method` first.
       */
      method?: 'siwe' | 'tempo-id' | undefined
    }

    /** The parameters of a sign-in whose page holds the session. */
    type WithPage = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /**
       * A message, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md)
       * describes, which the session's `challengeSignature` signs as `address`. Without an access
       * key, the signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
       * authorization's `witness` binds that hash, and the signature is the key authorization's,
       * also for an access key that another party holds, named by its `address`. Tempo ID's page
       * shows the message, from any app, with or without an access key. A function returns the
       * message, such as from the app's server, and runs after the dialog or the popup opens. Its
       * signal aborts once the call ends. Absent, a plugin's challenge, such as the `siwe`
       * plugin's `auth`, signs the user in to the app too.
       */
      challenge?:
        | string
        | ((signal: AbortSignal) => Promise<string>)
        | undefined
      /**
       * The amount that the app needs in the user's Tempo Account. After the approval, an account
       * that holds less opens Tempo ID's funding page before the callback, as
       * [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#popup-and-embedded-sign-in)
       * describes. In the frame, the sign-in completes first. The deposit page then opens in a
       * frame, as `funding.open` does, and the call resolves once that page returns or closes.
       *
       * For a hint of `MACH` on Tempo mainnet, the frame shows Buy MACH's amount step, and Pay by
       * card continues in a popup from that click. On iOS and iPadOS, whose Apple Pay runs only on
       * a top-level page, that sign-in runs in a popup.
       */
      funding?: Funding.Funding | undefined
      /**
       * The address that Tempo ID's sign-in fills in its email field, as OpenID Connect's
       * `login_hint`, such as the email of a session whose refresh Tempo ID refused. The field stays
       * editable. A browser with a Tempo ID session ignores it.
       */
      loginHint?: string | undefined
      /**
       * Whether the sign-in shows in a frame or in a popup window. Defaults to the plugin's `mode`.
       * A popup opens only within a click. Outside a secure context, on a page on `http:` such as
       * `http://localhost`, for a pushed request, for a request with a `resource`, and with `funding`
       * for a hint of `MACH` on Tempo mainnet on iOS or iPadOS, `iframe` runs as `popup`. A page on
       * `http:` keeps the frame only for a Tempo ID on `http:`, such as a local one.
       */
      mode?: 'iframe' | 'popup' | undefined
      /**
       * The [registered resources](https://github.com/tempoxyz/id/blob/main/docs/resources.md)
       * (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`. Each access token
       * names them as `aud`, and each refresh keeps them. A pushed request, with `par`, names at
       * most one. An unknown or disabled resource fails with
       * [`invalid_target`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_target).
       * Tempo ID's frame issues tokens for its own origin alone, so a sign-in with a resource runs
       * in a popup. Defaults to the instance's `resource`, or else Tempo ID's origin.
       */
      resource?: Accounts.Config['resource']
      /**
       * Rejects the sign-in with the signal's reason, such as on a cancel button, and closes the
       * dialog or the popup.
       */
      signal?: AbortSignal | undefined
    }
  }

  namespace updateAccessKey {
    type Parameters = AccessKeyTarget &
      Pick<AccountActions.updateAccessKey.Options, 'limits' | 'scopes'> & {
        /**
         * Whether the approval page shows in a frame or in a popup window. Defaults to the plugin's
         * `mode`, or to the frame with `crossOriginOpenerPolicy`. A popup opens only within a click.
         */
        mode?: AccountActions.updateAccessKey.Dialog | undefined
        /**
         * One of the app's registered redirect URIs, on the page's origin, since Tempo ID posts the
         * page's return only to its origin. Defaults to the instance's, or with `backend`, to the
         * backend's callback route, as `signIn` uses.
         */
        redirectUri?: string | undefined
        /** Rejects the change with the signal's reason, and closes the dialog or the popup. */
        signal?: AbortSignal | undefined
      }

    /** The hash of the transaction that changed the access key. */
    type ReturnType =
      AccountActions.updateAccessKey.ReturnType<AccountActions.updateAccessKey.Dialog>
  }
}

/**
 * Returns the session that the backend's `GET /auth/session` returns for the page's cookie, or
 * `null`.
 * @throws {Accounts.RequestError} For a failed read, such as a 503 `temporarily_unavailable`.
 * @throws {DOMException} With the name `AbortError`, when `signal` aborts, such as at a sign-in.
 */
async function pageSession(
  config: Plugin.Context['config'],
  options: { backend: string | true; signal?: AbortSignal | undefined },
): Promise<PageSession | null> {
  const basePath = (
    options.backend === true ? Handler.basePath : options.backend
  ).replace(/\/+$/, '')
  const response = await (config.fetch ?? fetch)(
    new URL(`${basePath}${Handler.authPath}/session`, window.location.origin),
    { credentials: 'same-origin', signal: options.signal ?? null },
  ).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error
    throw new Accounts.RequestError({
      cause: error,
      code: 'server_error',
      message:
        'The session read received no response. Check the connection, and read the session again.',
      status: 0,
    })
  })
  const body = await Api.json<unknown>(response).catch((error: unknown) => {
    // An abort while the body arrives rejects the parse, which reads as the abort.
    if (options.signal?.aborted) throw options.signal.reason
    throw error
  })
  // A body without a session, such as one of an app's own route or `null`, reads as signed out.
  const session =
    typeof body === 'object' && body !== null && 'session' in body
      ? body.session
      : null
  if (session === null || session === undefined) return null
  if (isPageSession(session)) return session
  throw new Accounts.RequestError({
    code: 'server_error',
    message:
      'The session route returned a session without its method or account. Return the session of the session route of the backend.',
    status: response.status,
  })
}

/** Returns whether `value` holds the members of a `PageSession`. */
function isPageSession(value: unknown): value is PageSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const session = value as Record<string, unknown>
  if (session.method === 'siwe') return typeof session.account === 'string'
  if (session.method !== 'tempo-id') return false
  const user = session.user as Record<string, unknown> | null | undefined
  return (
    (typeof session.account === 'string' || session.account === null) &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.email === 'string' &&
    typeof user.id === 'string'
  )
}

/**
 * Returns whether the page frames Tempo ID's sign-in, as `Actions.dialog.preload` checks before it
 * loads a frame: a secure context on the redirect URI's origin, not on `http:` for a Tempo ID on
 * `https:`, for an instance that pushes no request.
 */
function framed(config: Plugin.Context['config']) {
  const redirectUri = config.redirectUri ?? `${window.location.origin}/`
  return (
    window.isSecureContext &&
    new URL(redirectUri, window.location.origin).origin ===
      window.location.origin &&
    !Popup.http({ page: window.location.href, url: config.url }) &&
    !pushes(config)
  )
}

/**
 * Resolves once the page loaded and its main thread is idle, so the authorizations that the page
 * starts as it renders, such as a restore at mount, already run.
 */
async function rendered() {
  if (document.readyState !== 'complete')
    await new Promise((resolve) =>
      window.addEventListener('load', resolve, { once: true }),
    )
  await new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === 'function')
      requestIdleCallback(() => resolve(), { timeout: 1_000 })
    else setTimeout(resolve, 0)
  })
}

/**
 * Returns whether the browser reports whether anything covers an element, with IntersectionObserver
 * v2, which the frame of an app that Tempo ID does not trust needs.
 */
function visibility() {
  return (
    typeof IntersectionObserverEntry !== 'undefined' &&
    'isVisible' in IntersectionObserverEntry.prototype
  )
}

export namespace machines {
  /**
   * The preload of a page with `backend`. The page reads the backend's session, and loads the frame
   * only if the backend holds none, or the read fails. A response of the read deletes the cookie of
   * an ended session, so a sign-in cancels the read, and a late response deletes no newer cookie.
   *
   * The page loads no frame for a session. It holds the read's session, its `null`, or its error for
   * the first `session` call for 10 seconds, since a sign-out or a sign-in through the app's own
   * routes changes the session that it read.
   *
   * | State       | Meaning                                                                    |
   * | ----------- | -------------------------------------------------------------------------- |
   * | `reading`   | The read of the backend's session runs.                                    |
   * | `signedIn`  | The backend holds a session, which the page holds. The page loads no frame. |
   * | `released`  | A `session` call took the session, its time ran out, or a sign-in started. |
   * | `signedOut` | The backend holds no session, which the page holds. The frame loads.        |
   * | `failed`    | The read failed, and the page holds its error. The frame loads.            |
   * | `loaded`    | The page released `signedOut` or `failed`. The frame loaded.                |
   * | `cancelled` | A sign-in started during the read, and loads its own frame.                |
   */
  export const preload = setup({
    actions: {
      /** Drops the held result. */
      drop: assign({ at: undefined, error: undefined, session: null }),
      /** Holds the error of the read, and the time at which it settled. */
      fail: assign({
        at: (args) =>
          (args.event as unknown as DoneActorEvent<preload.Read>).output.at,
        error: (args) => {
          const output = (args.event as unknown as DoneActorEvent<preload.Read>)
            .output
          return 'error' in output ? output.error : undefined
        },
      }),
      /** Holds the session that the read returns, or its `null`, and the time at which it settled. */
      hold: assign({
        at: (args) =>
          (args.event as unknown as DoneActorEvent<preload.Read>).output.at,
        session: (args) => {
          const output = (args.event as unknown as DoneActorEvent<preload.Read>)
            .output
          return 'session' in output ? output.session : null
        },
      }),
      /** Loads the hidden frame. `dialog` provides it. */
      load: () => {},
    },
    actors: {
      /**
       * Returns the read's session or error, and the time at which it settled. `dialog` provides it.
       * It rejects only at an abort.
       */
      read: fromPromise<preload.Read>(() =>
        Promise.resolve({ at: 0, session: null }),
      ),
    },
    delays: {
      /** The time in milliseconds for which the page holds the read's result. */
      heldFor,
    },
    guards: {
      /** Whether the read failed. */
      failed: (args) =>
        'error' in
        (args.event as unknown as DoneActorEvent<preload.Read>).output,
      /** Whether the read found a session of the backend. */
      signedIn: (args) => {
        const output = (args.event as unknown as DoneActorEvent<preload.Read>)
          .output
        return 'session' in output && output.session !== null
      },
    },
    types: {
      context: {} as preload.Context,
      events: {} as preload.Event,
    },
  }).createMachine({
    context: { at: undefined, error: undefined, session: null },
    id: 'preload',
    initial: 'reading',
    states: {
      cancelled: { type: 'final' },
      // The first `session` call takes the read's error too, so a failed read sends no second
      // request. A later call reads again.
      failed: {
        after: { heldFor: { actions: 'drop', target: 'loaded' } },
        on: {
          'session.take': { actions: 'drop', target: 'loaded' },
          'signIn.start': { actions: 'drop', target: 'loaded' },
        },
        tags: ['held'],
      },
      loaded: { type: 'final' },
      reading: {
        invoke: {
          onDone: [
            { actions: ['fail', 'load'], guard: 'failed', target: 'failed' },
            { actions: 'hold', guard: 'signedIn', target: 'signedIn' },
            { actions: ['hold', 'load'], target: 'signedOut' },
          ],
          id: 'read',
          // The read rejects only at an abort, which a sign-in's transition starts.
          onError: { actions: 'load', target: 'loaded' },
          src: 'read',
        },
        // The transition stops the invoked read, which aborts its request.
        on: { 'signIn.start': { target: 'cancelled' } },
      },
      released: { type: 'final' },
      signedIn: {
        after: { heldFor: { actions: 'drop', target: 'released' } },
        on: {
          'session.take': { actions: 'drop', target: 'released' },
          'signIn.start': { actions: 'drop', target: 'released' },
        },
        tags: ['held'],
      },
      // The first `session` call takes the read's `null` too, so a signed-out page reads once.
      signedOut: {
        after: { heldFor: { actions: 'drop', target: 'loaded' } },
        on: {
          'session.take': { actions: 'drop', target: 'loaded' },
          'signIn.start': { actions: 'drop', target: 'loaded' },
        },
        tags: ['held'],
      },
    },
  })

  /**
   * The read of the backend's session that a `session` call starts. A sign-in that starts during
   * the read cancels it, which aborts its request.
   */
  export const read = setup({
    actions: {
      /** Holds the error of the read. */
      fail: assign({
        error: (args) => (args.event as unknown as ErrorActorEvent).error,
      }),
      /** Holds the session that the read returns. */
      resolve: assign({
        session: (args) =>
          (args.event as unknown as DoneActorEvent<PageSession | null>).output,
      }),
    },
    actors: {
      /** Returns the backend's session, or `null`. `dialog` provides it. */
      read: fromPromise<PageSession | null>(() => Promise.resolve(null)),
    },
    types: {
      context: {} as read.Context,
      events: {} as read.Event,
    },
  }).createMachine({
    context: { error: undefined, session: null },
    id: 'read',
    initial: 'reading',
    states: {
      cancelled: { type: 'final' },
      failed: { type: 'final' },
      reading: {
        invoke: {
          id: 'read',
          onDone: { actions: 'resolve', target: 'resolved' },
          onError: { actions: 'fail', target: 'failed' },
          src: 'read',
        },
        // The transition stops the invoked read, which aborts its request.
        on: { 'signIn.start': { target: 'cancelled' } },
      },
      resolved: { type: 'final' },
    },
  })

  export namespace read {
    /** The machine's context. */
    export type Context = {
      /** The error of a failed read. Absent until the read fails. */
      error: unknown
      /** The session that the read returns, or `null` without one. */
      session: PageSession | null
    }

    /** The events of the machine. */
    export type Event = {
      /** A sign-in through the backend started. */
      type: 'signIn.start'
    }

    /** The running machine. */
    export type Actor = ActorRefFrom<typeof read>

    /** A snapshot of the machine. */
    export type Snapshot = SnapshotFrom<typeof read>
  }

  /**
   * The sign-ins and `session` reads of an instance with `backend`. Each `session` call reads through
   * a child `read`. A sign-in that starts cancels each read, since a read that the sign-in overtakes
   * can clear the cookie that the sign-in sets, and the machine refuses reads until every sign-in
   * ends.
   *
   * | State       | Meaning                                                        |
   * | ----------- | -------------------------------------------------------------- |
   * | `idle`      | No sign-in runs. A `session` call starts a child read.          |
   * | `signingIn` | At least one sign-in runs. A `session` call is refused.         |
   */
  export const backend = setup({
    actions: {
      /** Counts a sign-in that started. */
      begin: assign({ signIns: (args) => args.context.signIns + 1 }),
      /** Cancels each child read, which aborts its request. */
      cancel: enqueueActions((args) => {
        for (const id of args.context.reads)
          args.enqueue.sendTo(id, { type: 'signIn.start' })
      }),
      /** Counts a sign-in that ended. */
      end: assign({ signIns: (args) => args.context.signIns - 1 }),
      /** Stops the child read that ended. */
      release: stopChild(
        (args) =>
          (args.event as Extract<backend.Event, { type: 'session.done' }>).id,
      ),
      /** Drops the ID of the child read that ended. */
      forget: assign({
        reads: (args) => {
          const event = args.event as Extract<
            backend.Event,
            { type: 'session.done' }
          >
          return args.context.reads.filter((id) => id !== event.id)
        },
      }),
      /** Holds the ID of the child read that starts. */
      remember: assign({
        reads: (args) => [
          ...args.context.reads,
          (args.event as Extract<backend.Event, { type: 'session.read' }>).id,
        ],
      }),
      /** Starts a child read with the event's ID. */
      spawn: spawnChild('read', {
        id: (args) =>
          (args.event as Extract<backend.Event, { type: 'session.read' }>).id,
      }),
    },
    actors: {
      /** The read of a `session` call. `dialog` provides its `read`. */
      read,
    },
    guards: {
      /** Whether the sign-in that ends is the last that runs. */
      last: (args) => args.context.signIns === 1,
    },
    types: {
      context: {} as backend.Context,
      events: {} as backend.Event,
    },
  }).createMachine({
    context: { reads: [], signIns: 0 },
    id: 'backend',
    initial: 'idle',
    states: {
      idle: {
        on: {
          'session.done': { actions: ['release', 'forget'] },
          'session.read': { actions: ['spawn', 'remember'] },
          'signIn.start': { actions: ['begin', 'cancel'], target: 'signingIn' },
        },
      },
      signingIn: {
        on: {
          'session.done': { actions: ['release', 'forget'] },
          'signIn.end': [
            { actions: 'end', guard: 'last', target: 'idle' },
            { actions: 'end' },
          ],
          'signIn.start': { actions: ['begin', 'cancel'] },
        },
      },
    },
  })

  export namespace backend {
    /** The machine's context. */
    export type Context = {
      /** The IDs of the child reads that run. */
      reads: readonly string[]
      /** The number of sign-ins that run. `0` in `idle`. */
      signIns: number
    }

    /** The events of the machine. */
    export type Event =
      | {
          /** The ID of the child read that ended. */
          id: string
          /** A `session` call's read ended, and the call took its result. */
          type: 'session.done'
        }
      | {
          /** The ID of the child read to start. */
          id: string
          /** A `session` call starts a read. */
          type: 'session.read'
        }
      | {
          /** A sign-in through the backend ended. */
          type: 'signIn.end'
        }
      | {
          /** A sign-in through the backend started. */
          type: 'signIn.start'
        }

    /** The running machine. */
    export type Actor = ActorRefFrom<typeof backend>

    /** A snapshot of the machine. */
    export type Snapshot = SnapshotFrom<typeof backend>
  }

  /** Returns the child read with `id`. */
  export function reader(snapshot: backend.Snapshot, options: { id: string }) {
    return snapshot.children[options.id] as read.Actor
  }

  /** Returns whether a sign-in runs, so the machine refuses a `session` read. */
  export function signingIn(snapshot: backend.Snapshot) {
    return snapshot.matches('signingIn')
  }

  /**
   * Returns the session of a read that ended.
   * @throws {Accounts.RequestError} For a failed read.
   * @throws {DOMException} With the name `AbortError`, for a read that a sign-in cancelled.
   */
  export function session(snapshot: read.Snapshot) {
    if (snapshot.matches('failed')) throw snapshot.context.error
    if (snapshot.matches('cancelled')) throw cancelled()
    return snapshot.context.session
  }

  /**
   * Returns whether the preload holds a result for the first `session` call at `now`, in
   * milliseconds of `performance.now()`. The monotonic clock moves with no change of the wall
   * clock, and a late timer, such as of a background tab, extends no held result.
   */
  export function held(snapshot: preload.Snapshot, options: { now: number }) {
    const at = snapshot.context.at
    return (
      snapshot.hasTag('held') && at !== undefined && options.now - at < heldFor
    )
  }

  /** Returns the error of a `session` read that a sign-in stops. */
  export function cancelled() {
    return new DOMException(
      'The session read stopped at a sign-in. Read the session after the sign-in.',
      'AbortError',
    )
  }

  export namespace preload {
    /** The machine's context. */
    export type Context = {
      /** The time of `performance.now()` at which the held read settled. Absent outside a held state. */
      at: number | undefined
      /** The error of the read, which `failed` holds. Absent in every other state. */
      error: unknown
      /** The session that the read returns, which `signedIn` holds. `null` in every other state. */
      session: PageSession | null
    }

    /** The result of the read, with the time of `performance.now()` at which it settled. */
    export type Read =
      | {
          /** The time at which the read settled. */
          at: number
          /** The error of the failed read. */
          error: unknown
        }
      | {
          /** The time at which the read settled. */
          at: number
          /** The backend's session, or `null` without one. */
          session: PageSession | null
        }

    /** The events of the machine. */
    export type Event =
      | {
          /** A `session` call took the held result. */
          type: 'session.take'
        }
      | {
          /** A sign-in through the backend started. */
          type: 'signIn.start'
        }

    /** The running machine. */
    export type Actor = ActorRefFrom<typeof preload>

    /** A snapshot of the machine. */
    export type Snapshot = SnapshotFrom<typeof preload>
  }
}
