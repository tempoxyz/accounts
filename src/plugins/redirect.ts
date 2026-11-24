/**
 * The plugin of sign-in through a redirect to Tempo ID's pages: in the page's own window, or with
 * `open`, in a system browser on a device.
 * @module
 */
import { Bytes, Hex } from 'ox'
import type * as Accounts from '../Accounts.js'
import { RedirectUriRequiredError, SupersededError } from '../Accounts.js'
import * as RedirectActions from '../actions/redirect.js'
import * as Callback from '../internal/Callback.js'
import type * as Funding from '../internal/Funding.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as SignIn from '../internal/SignIn.js'
import * as StoreValue from '../internal/StoreValue.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in through a redirect to Tempo ID's pages, which adds
 * `redirect.prefetch` and `redirect.signIn`. Tempo ID's pages sign the user in, show the access
 * key's limits for approval, and redirect back with a code. The user approves the access key, so
 * its limits may exceed the
 * [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
 *
 * The plugin runs in one of two modes:
 *
 * | Mode           | `signIn`                                               | Completion                                                  |
 * | -------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
 * | Without `open` | Leaves the page for Tempo ID's sign-in                 | `accounts.session.get()` on the redirect URI's page         |
 * | With `open`    | Shows the URL, such as in a system browser on a device | `signIn` itself, when `open` resolves with the callback URL |
 *
 * With `open`, the system browser keeps its Tempo ID session after the app signs out, also with
 * `everywhere`, since the logout sends the app's cookies, not the browser's. The plugin then sets a
 * flag at the start of `signOut`, in the instance's `store`. The next `signIn` requests
 * `prompt=login`, so Tempo ID shows its sign-in page before it returns to the app. A sign-in
 * without a sign-out before it reuses the browser's session. Each sign-in sends the email of the
 * last signed-in user as `login_hint`, so once the browser's Tempo ID session expires, the sign-in
 * page holds the user's address. The `store` keeps the email after the session expires, and
 * `signOut` removes it. A sign-in's `loginHint` comes before it.
 *
 * Without `open`, the plugin's `restore` hook completes the redirect at the first `session.get()`
 * of a page load. It checks the callback's state, redeems its code once, and removes `code`, `iss`,
 * and `state` from the address bar. An app calls `session.get()` before any routing that reads the
 * URL.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { redirect } from 'accounts/plugins'
 * import * as WebBrowser from 'expo-web-browser'
 *
 * const accounts = Accounts.create({ plugins: [redirect()] })
 *
 * // On every page load, complete a redirect that returned here.
 * const session = await accounts.session.get()
 * if (!session) button.onclick = () => accounts.redirect.signIn()
 *
 * // On a device, `open` shows the URL in a system browser, and `signIn` returns the session.
 * const device = Accounts.create({
 *   plugins: [
 *     redirect({
 *       async open(url, options) {
 *         const result = await WebBrowser.openAuthSessionAsync(url, options.redirectUri)
 *         return result.type === 'success' ? result.url : undefined
 *       },
 *     }),
 *   ],
 *   redirectUri: 'myapp://callback',
 * })
 * ```
 */
export function redirect(options: redirect.Options = {}) {
  const { open, par } = options
  // One configuration with `par` for each instance, so its actions and its hooks share the state
  // that the actions keep by configuration, such as the preloaded frame.
  const configs = new WeakMap<
    Plugin.Context['config'],
    Plugin.Context['config']
  >()
  /** Returns the instance's configuration, with `par` when the plugin sets it. */
  function configOf(context: Plugin.Context) {
    if (par === undefined) return context.config
    let config = configs.get(context.config)
    if (!config)
      configs.set(
        context.config,
        // The copy keeps the getter of `chainId`, so it follows `switchChain`.
        (config = Object.assign(
          Object.defineProperties(
            {},
            Object.getOwnPropertyDescriptors(context.config),
          ) as typeof context.config,
          { par },
        )),
      )
    return config
  }
  // A page load completes each instance's redirect once, so a later `session.get()` never applies it
  // again. Each call that starts before the completion settles receives its refusal, and a later
  // call receives none. An instance's configuration keys it, so instances that share the plugin keep
  // their own.
  const completing = new WeakMap<Plugin.Context['config'], Promise<void>>()
  // The flag of each instance that signed out since its last sign-in through `open`, so a sign-in that
  // starts before the stored flag is written still sends `prompt=login`.
  const signingOut = new WeakMap<Plugin.Context['config'], string>()
  // The number of sign-outs of each instance, so a sign-in removes the flag only when no sign-out
  // started since it read the flag.
  const signOuts = new WeakMap<Plugin.Context['config'], number>()
  // The email that each instance wrote last, so a refresh of the same user's session writes nothing.
  const hinted = new WeakMap<Plugin.Context['config'], string>()
  // The count of each instance's sign-outs in both modes, and its pending write of the email.
  const hintOuts = new WeakMap<Plugin.Context['config'], number>()
  const hintWrites = new WeakMap<Plugin.Context['config'], Promise<void>>()
  // The instances whose last removal of the email failed. They send no stored email until a write.
  const unhinted = new WeakSet<Plugin.Context['config']>()
  // The removal of the email that each instance's own sign-out started, so its `afterSignOut` sends
  // no second removal.
  const removals = new WeakMap<Plugin.Context['config'], Promise<void>>()
  // Removes the stored email. A store that throws or rejects marks the instance as unhinted.
  const unhint = async (context: Plugin.Context) => {
    hinted.delete(context.config)
    try {
      await DefaultStore.get(context.config.store)?.removeItem(
        hintKey(context.config),
      )
    } catch {
      unhinted.add(context.config)
    }
  }

  return Plugin.from({
    actions: (context) => {
      const config = configOf(context)

      return {
        /**
         * Prefetches the scripts and style sheets of Tempo ID's sign-in page, so the page that
         * `redirect.signIn` opens loads them from the browser's cache. Returns their URLs. Outside
         * a browser, it prefetches nothing. Never throws. Only a page on Tempo ID's site gains from
         * it, since a browser partitions its cache by site.
         *
         * @example
         * ```ts
         * void accounts.redirect.prefetch()
         * ```
         */
        prefetch: (): Promise<readonly string[]> =>
          RedirectActions.prefetch(config),
        /**
         * Sends the user to Tempo ID's sign-in. Without `open`, the page leaves, and the promise
         * resolves with `undefined`. If a sign-out runs, such as at a switch of account, the page
         * leaves only after the sign-out revokes its refresh token. With `open`, it builds the URL,
         * redeems the callback, sets the instance's session, and returns it. It returns `undefined`
         * when `open` resolves with no URL, such as for a dismissed browser. The session holds no
         * Tempo Account.
         *
         * With `guest: 'offer'`, the request adds `guest=offer`. A return with `guest=1`, after the
         * user selects "Continue as guest", sets a guest session in place of a redemption: with
         * `open` in the call, else on the callback's page. With `guest: 'auto'`, a call without a
         * session sets the guest session, with no navigation and no request.
         * @throws {Accounts.RedirectUriRequiredError} Before any navigation, outside a browser, such
         *   as in React Native, when the instance names no `redirectUri`. Pass it to `Accounts.create`.
         * @throws {Accounts.RequestError} For a refused sign-in:
         *   - Before any navigation, with status 0 and the `reason`
         *     [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed)
         *     for an `accessKey.expiry` in Unix seconds that has passed,
         *     [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry)
         *     for an `accessKey.expiry` that is not a whole number of seconds or holds milliseconds,
         *     or is `false`,
         *     [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions)
         *     for an `accessKey` without `limits`, or with `scopes: 'any'`, since Tempo ID's page
         *     refuses an access key without bounds,
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
         *   - On a page, without `open`, before any request, with `invalid_request`, the `field` `store`,
         *     and status 0, for a `store` that sets `local`, such as `Store.memory`. The page load
         *     at the return empties such a store. Keep the state in a store that persists across
         *     page loads, such as the default.
         *   - Without `open`, before the navigation, when `par` is `true` and `POST /oauth2/par`
         *     refuses a pushed request, with its `reason`:
         *     [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client),
         *     [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected),
         *     [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field),
         *     [`body_too_large`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#body_too_large),
         *     [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited),
         *     or the reason of a
         *     [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
         *   - With `server_error` and status 0, when a push receives no response, such as offline,
         *     also with `open`.
         *   - With `open`, with `invalid_request`, when the callback's `state` does not match the
         *     pending sign-in. Start the sign-in again. With the `field` `url` and before any
         *     request, the URL that `open` resolves with is not a valid absolute URL, or its scheme,
         *     host, or path is not the redirect URI's. Resolve the full callback URL.
         *   - With `open`, with the callback's `error` and status 0, for a callback without a
         *     `code`, such as `access_denied` after a denial. An access key that Tempo ID refuses
         *     before sign-in returns its own `error`, such as `invalid_authorization_details` for
         *     an access key that breaks a
         *     [rule](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules). Its
         *     `message` is the `error_description`, or without one, a message that states the fault
         *     and the fix. Its `uri` is the `error_uri`.
         *   - With `open`, with `invalid_grant`, when the code was already redeemed, expired, or
         *     carried no key authorization. Only the first redemption, within 10 minutes of the
         *     approval, returns the access key. Start the sign-in again.
         *   - For a refusal of the token response after the code exchange, such as one without a
         *     key authorization, after it revokes the response's refresh token, which no session
         *     holds. Without `open`, `session.get()` on the callback's page revokes it too.
         *   - With `open`, with the `reason`
         *     [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited),
         *     when the redemption of the code exceeded a rate limit. Retry later.
         *   - With `open`, with the `reason`
         *     [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected), for
         *     an unexpected failure of the redemption. Retry the request.
         *
         *   Without `open`, `session.get()` on the callback's page throws the refusals of the
         *   callback and of the redemption instead. It throws `invalid_request` when the store
         *   holds no state of the redirect whose code the tab redeemed, such as after another tab
         *   completed it. If the tab started the redirect with a custom `store` that holds no
         *   state of it, such as one that expired the state, it throws `invalid_request` with
         *   the `field` `state`, and redeems no code. A callback without a `code` of such a
         *   redirect throws its `error`, such as `access_denied` after a denial, and authorizes no
         *   other way. A restart with the same store fails
         *   the same way. Keep the state in a store that persists across page loads, such as the
         *   default.
         * @throws {Accounts.SupersededError} When another sign-in or a sign-out completed while
         *   this sign-in was pending.
         * @throws {TypeError} Without `open`, outside a page, such as in Node or React Native,
         *   before any request or store write. Pass `open`.
         * @throws {Store.InvalidFileError} With `open`, before `open`, when the `Store.file`
         *   file holds no valid JSON object. Remove the file, and sign in again.
         * @throws {Error} With `open`, before `open`, with the store's error, when the reads of
         *   the stored chain selection and of the sign-out flag both fail, such as for a database
         *   that does not respond. The store also holds the session, so its save would fail after
         *   the user signs in. A failed read of the selection alone, or an entry that throws
         *   `Store.InvalidValueError`, keeps the configured chain.
         * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
         *   `Store.redis`, and the call generates an access key. The call throws before any
         *   request.
         *
         * @example
         * ```ts
         * await accounts.redirect.signIn()
         * ```
         */
        async signIn(
          parameters: redirect.signIn.Parameters = {},
        ): Promise<Session.GuestSession | Session.Session | undefined> {
          // Without `open`, the sign-in leaves the page, so outside one, such as in Node, React
          // Native, a Web Worker or Deno with `--location`, it refuses before any read, and the
          // store keeps no PKCE verifier of a redirect that never leaves. An instance without a
          // redirect URI has no redirect at all, so that refusal comes first. React Native sets
          // `window` to its global object, without a document, so only `document` shows a page.
          if (!open && typeof document === 'undefined') {
            if (context.config.redirectUri === undefined)
              throw new RedirectUriRequiredError()
            throw new TypeError(
              'Missing `open`: outside a page, a redirect has no page to leave. Pass `open` to the plugin, to show the sign-in URL, such as in a system browser.',
            )
          }
          if (context.config.guest === 'auto') {
            const started = await SignIn.guestAuto(context)
            if (started) return started
          }
          // The request names the instance's chain, so its access key waits for the stored
          // selection. The reads of the hint and of the sign-out flag need no chain, so they run
          // beside it. A failed read of the selection alone keeps the chain. The change starts at
          // the call, so a sign-out after it overtakes it.
          const loading = context.chain.load()
          const kept = loading.catch(() => undefined)
          const change = open && context.session.change({ loading: kept })
          // The saved session names the user, so once the browser's Tempo ID session expires, the
          // sign-in page holds their address. After a restart, only the store holds it. A refresh
          // that the server refuses erases the session, so the stored email of the last sign-in
          // follows it. A failed read only drops the hint. The app's `loginHint` comes first.
          // The store reads both in one round.
          const hint = async () => {
            if (parameters.loginHint) return parameters.loginHint
            const current = context.session.get() ?? context.session.renewing()
            if (current?.user) return current.user.email
            const [session, email] = await Promise.all([
              context.session.load().catch(() => undefined),
              // A pending write of the email settles first. Without one, the read joins the round.
              (async () => {
                const pending = hintWrites.get(context.config)
                if (pending) await pending
                return DefaultStore.get(context.config.store)?.getItem(
                  hintKey(context.config),
                )
              })().catch(() => undefined),
            ])
            if (session?.user) return session.user.email
            if (unhinted.has(context.config)) return undefined
            return typeof email === 'string' ? email : undefined
          }
          /** Returns the request, on the selected chain. */
          const request = () => ({
            accessKey: SignIn.accessKey(context, parameters.accessKey, {
              challenge: parameters.challenge !== undefined,
            }),
            challenge: parameters.challenge,
            funding: parameters.funding,
            resource: parameters.resource,
          })
          if (!change) {
            // The page leaves at the redirect, which aborts the requests in flight, so a sign-out
            // that runs, such as at a switch of account, revokes its refresh token first. The
            // revocation and the logout each settle within their own deadline.
            const [loginHint] = await Promise.all([
              hint(),
              context.session.ended(),
              kept,
            ])
            // A sign-out that started during the reads holds requests in flight too. Without one,
            // `ended` resolves at once.
            await context.session.ended()
            await RedirectActions.start(config, { ...request(), loginHint })
            return undefined
          }

          // The system browser keeps its Tempo ID session after the app signs out, so the first
          // sign-in after a sign-out asks the user to sign in again, also after a restart of the app.
          // The flag only adds the prompt, so a failed read or removal of it alone never fails the
          // sign-in.
          const store = DefaultStore.get(context.config.store)
          // The session's sign-out starts in the same tick as `signOut`, before the hook of `redirect`
          // sets its flag, so a sign-out that runs at the call keeps `ended` pending. The sign-in
          // opens without waiting for its revocation and logout, and asks for `prompt=login`.
          const ended = context.session.ended()
          const [loginHint, flag, failure] = await Promise.all([
            hint(),
            store?.getItem(signedOutKey(context.config)).then(
              (value) => ({ value }),
              (error: unknown) => ({ error }),
            ),
            loading.then(
              () => undefined,
              (error: unknown) => ({ error }),
            ),
          ])
          // A store that fails the reads of two entries, such as `Store.file` on a file without valid
          // JSON, fails the save of the session too, so the sign-in rejects before the user signs in.
          // A store that parses each entry alone, such as `Store.postgres`, saves the session under
          // its own entry, so an entry that holds no valid value keeps the chain and opens.
          if (
            failure &&
            !(failure.error instanceof StoreValue.InvalidValueError) &&
            flag &&
            'error' in flag &&
            !(flag.error instanceof StoreValue.InvalidValueError)
          ) {
            // The sign-in sent no request, and started no Tempo ID session, so a sign-out that
            // overtook it ended everything already, and the change runs no cleanup of its own.
            if (change.overtaken()) throw new SupersededError()
            await change.fail(failure.error)
          }
          const stored = flag && 'value' in flag ? flag.value : undefined
          // `ended` resolves at once without a sign-out, so it settles before the reads, and the
          // race returns its value. A pending `ended` loses the race to `true`.
          const ending = await Promise.race([ended, Promise.resolve(true)])
          // The count and the flag are read after the reads, so a sign-out whose hook ran during them
          // is the one that this sign-in answers. The change starts before the reads, so a sign-out
          // that starts during them overtakes this sign-in. Each sign-out writes a flag of its own,
          // so a sign-in removes only the flag that it read, not a newer one that another instance on
          // the same store wrote since.
          const started = signOuts.get(context.config) ?? 0
          const own = signingOut.get(context.config)
          // A custom store may return `null` for a missing item.
          const signedOut = ending || own !== undefined || stored != null
          const { pending, url } = await RedirectActions.createUrl(config, {
            ...request(),
            loginHint,
            ...(signedOut ? { prompt: 'login' as const } : {}),
          })
          const callback = await open(url, { redirectUri: pending.redirectUri })
          if (!callback) return undefined
          const result = await (async () => {
            const returned = Callback.url(callback)
            // `open` resolves with any URL that the browser returns, so the code of a URL outside
            // the redirect URI never reaches the token endpoint.
            Callback.checkRedirectUri(callback, {
              redirectUri: pending.redirectUri,
            })
            return RedirectActions.handleCallback(config, {
              pending,
              url: returned,
            })
          })().catch((error: unknown) => {
            // The user selected "Continue as guest", which issues no tokens.
            if (SignIn.guestSelected(context, error)) return undefined
            return change.fail(error)
          })
          const session = result
            ? SignIn.toSession(result)
            : await SignIn.guest(context, { change })
          if (result) await change.commit(session)
          if ((signOuts.get(context.config) ?? 0) !== started) return session
          signingOut.delete(context.config)
          if (!signedOut) return session
          await (async () => {
            const key = signedOutKey(context.config)
            // A store whose `update` is one conditional write, such as `Store.postgres`, removes the flag
            // only while it holds the read value, so another instance's newer flag stays. A sign-out of
            // this instance since the read keeps its flag on any store, also where `update` reads and
            // writes in two calls, such as `Store.redis` on a cluster.
            if (store?.update) {
              await store.update(key, (current) => ({
                result: undefined,
                value:
                  current != null &&
                  (current === stored || current === own) &&
                  (signOuts.get(context.config) ?? 0) === started
                    ? undefined
                    : current,
              }))
              return
            }
            const current = await store?.getItem(key)
            if (current == null) return
            if (current !== stored && current !== own) return
            // A sign-out of this instance during the read writes a newer flag, which stays. Without
            // `update`, the store has no atomic removal, so another instance's sign-out at this moment
            // can still lose its flag.
            if ((signOuts.get(context.config) ?? 0) !== started) return
            await store?.removeItem(key)
          })().catch(() => undefined)
          return session
        },
      }
    },
    hooks: {
      afterSignIn(context, session) {
        // A hook can run during or after a sign-out, such as for a refresh that commits while the
        // sign-out ends the session, or behind an earlier plugin's hook. The write waits until every
        // running sign-out settles, and runs only if no sign-out started since the hook and the
        // session still holds the user. It runs beside the sign-in, since a sign-out can wait for
        // the sign-in's change. A failed write only drops the hint of a later sign-in.
        // A local session names no user, so it leaves the hint of the last sign-in.
        // A sign-in after a sign-out that rejected, which ran no `afterSignOut`, can write the email
        // again, so a later sign-out of another tab removes it.
        removals.delete(context.config)
        if (!session.user) return
        const { email } = session.user
        const started = hintOuts.get(context.config) ?? 0
        const kept = () =>
          (hintOuts.get(context.config) ?? 0) === started &&
          context.session.get()?.user?.email === email
        const store = DefaultStore.get(context.config.store)
        const write = (async () => {
          // The memo is read after the earlier writes settle, since one of them can replace or
          // remove the email that it names.
          await hintWrites.get(context.config)
          await context.session.ended()
          if (!kept() || hinted.get(context.config) === email) return
          // The memo follows a write that succeeds, so a failed write retries at the next sign-in.
          await store?.setItem(hintKey(context.config), email)
          if (kept()) {
            hinted.set(context.config, email)
            unhinted.delete(context.config)
            return
          }
          // A sign-out started during the write. A failed removal marks the instance as unhinted.
          await unhint(context)
        })().catch(() => undefined)
        hintWrites.set(context.config, write)
      },
      async afterSignOut(context) {
        // Another tab's sign-out, also from an instance without this plugin, removes the email too.
        // A sign-in that commits before a delayed hook runs keeps its email.
        if (context.session.get()) return
        // The instance's own sign-out removed the email in `beforeSignOut`. Only a failed removal
        // runs again.
        const removal = removals.get(context.config)
        removals.delete(context.config)
        await removal
        if (removal && !unhinted.has(context.config)) return
        await unhint(context)
      },
      async beforeSignOut(context) {
        // A sign-out removes the stored email, so the next sign-in page holds no address. A failed
        // removal never fails the sign-out, and the instance then sends no stored email.
        hintOuts.set(context.config, (hintOuts.get(context.config) ?? 0) + 1)
        const removed = unhint(context)
        removals.set(context.config, removed)
        // A system browser's Tempo ID session outlives the app's sign-out, also one with
        // `everywhere`, since its logout sends the app's cookies, not the browser's. The flag is set
        // before the sign-out starts, so a sign-in that overlaps the sign-out, or follows a sign-out
        // that rejects, sends `prompt=login`. A failed write of the stored flag never fails the
        // sign-out.
        if (!open) return removed
        const flag = Hex.fromBytes(Bytes.random(16))
        signingOut.set(context.config, flag)
        signOuts.set(context.config, (signOuts.get(context.config) ?? 0) + 1)
        await Promise.all([
          removed,
          (async () => {
            await DefaultStore.get(context.config.store)?.setItem(
              signedOutKey(context.config),
              flag,
            )
          })().catch(() => undefined),
        ])
      },
      restore(context) {
        // Only a page in a window holds a redirect's callback.
        if (open || typeof location === 'undefined') return Promise.resolve()
        const pending = completing.get(context.config)
        if (pending) return pending
        const completion = (async () => {
          const change = context.session.change()
          const config = configOf(context)
          // A page holds one result for each app and chain, a failure too, which applies once.
          const result = await RedirectActions.complete(config).catch(
            (error: unknown) => {
              if (typeof error === 'object' && error !== null) {
                if (applied.has(error)) return undefined
                applied.add(error)
              }
              // The user selected "Continue as guest", which issues no tokens.
              if (SignIn.guestSelected(context, error)) return 'guest' as const
              return change.fail(error)
            },
          )
          if (result === 'guest') {
            await SignIn.guest(context, { change })
            return
          }
          // `undefined` means the page is not a callback. The page holds one result for each app and
          // chain, which applies once, so an instance created after a sign-out restores no session.
          if (!result || applied.has(result)) return
          applied.add(result)
          await change.commit(SignIn.toSession(result))
        })().finally(() => {
          completing.set(context.config, Promise.resolve())
        })
        completing.set(context.config, completion)
        return completion
      },
    },
    id: 'redirect',
  })
}

export declare namespace redirect {
  type Options = {
    /**
     * Shows the sign-in URL, such as in a system browser, and resolves with the callback URL, or with
     * `undefined` when the user dismissed it. `options.redirectUri` is the redirect URI of the URL,
     * at which the callback returns. A callback URL with another scheme, host, or path redeems no
     * code. Absent, the page leaves for the URL, so outside a page, such as
     * in Node or React Native, `redirect.signIn` throws a `TypeError`.
     */
    open?:
      | ((url: string, options: open.Options) => Promise<string | undefined>)
      | undefined
    /**
     * Whether each request goes to `POST /oauth2/par` first
     * ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), so the URL holds only `client_id` and
     * `request_uri`, as
     * [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md)
     * describes. Defaults to the instance's `par`, which is `true` with `clientSecret` or
     * `clientAssertion`, and `false` otherwise.
     */
    par?: boolean | undefined
  }

  namespace open {
    type Options = {
      /**
       * The redirect URI of the sign-in URL: the instance's `redirectUri`, also when an option of
       * `Accounts.create` overrides a preset's, or else the page's origin. A system browser closes
       * at a navigation to it.
       */
      redirectUri: string
    }
  }

  namespace signIn {
    type Parameters = {
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
       * shows the message, from any app, with or without an access key.
       */
      challenge?: string | undefined
      /**
       * The amount that the app needs in the user's Tempo Account. After the approval, an account
       * that holds less opens Tempo ID's funding page before the callback, as
       * [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.
       */
      funding?: Funding.Funding | undefined
      /**
       * The address that Tempo ID's sign-in page fills in its email field, as OpenID Connect's
       * `login_hint`, such as the email of a session whose refresh Tempo ID refused. The field stays
       * editable. Defaults to the saved session's email.
       */
      loginHint?: string | undefined
      /**
       * The [registered resources](https://github.com/tempoxyz/id/blob/main/docs/resources.md)
       * (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`. Each access token
       * names them as `aud`, and each refresh keeps them. A pushed request, with `par`, names at
       * most one. An unknown or disabled resource fails with
       * [`invalid_target`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_target).
       * Defaults to the instance's `resource`, or else Tempo ID's origin.
       */
      resource?: Accounts.Config['resource']
    }
  }
}

/**
 * Returns the store's key of the email of the app's last signed-in user. The key names the
 * deployment and the app, as the session's key does.
 */
function hintKey(config: Plugin.Context['config']) {
  return `tempo-id:login-hint:${JSON.stringify([new URL(config.url).origin, config.clientId])}`
}

/**
 * Returns the store's key of a sign-out in an app that signs in through a system browser. The key
 * names the deployment and the app, as the session's key does.
 */
function signedOutKey(config: Plugin.Context['config']) {
  return `tempo-id:signed-out:${JSON.stringify([new URL(config.url).origin, config.clientId])}`
}

/** The results and failures of `Actions.redirect.complete` that an instance applied, of every instance on the page. */
const applied = new WeakSet<object>()
