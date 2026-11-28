/**
 * The plugin of sign-in with a passkey, and of the registration of one.
 * @module
 */
import * as Accounts from '../Accounts.js'
import * as PasskeyActions from '../actions/passkey.js'
import type * as Api from '../internal/Api.js'
import * as SignIn from '../internal/SignIn.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'

/**
 * How long concurrent calls of `passkey.available` share one read, in milliseconds. A call after it
 * sends a new request, so a read without a response holds no later call.
 */
const sharedReadLifetime = 5_000

/**
 * Returns the plugin of sign-in with a passkey, and of the registration of one, which adds
 * `passkey.available`, `passkey.prepare`, `passkey.register`, and `passkey.signIn`. The browser
 * offers every passkey of the relying party of the app's realms, so the form needs no email. Only a
 * [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs
 * in this way, on a page that the relying party covers.
 *
 * A wallet.tempo passkey that no account knows yet returns the email step. The `email` plugin's
 * `signIn` with the step's `link` then links the passkey, so an instance with this plugin usually
 * holds `email` too.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { email, passkey } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ plugins: [passkey(), email()] })
 *
 * const result = await accounts.passkey.signIn()
 * if ('next' in result) showEmailForm({ link: result.next.link })
 *
 * // After an emailed-code sign-in, one passkey assertion registers the passkey and signs the access key:
 * const session = await accounts.passkey.register({ accessKey: { expiry: '1h' } })
 * ```
 */
export function passkey(options: passkey.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      const getFn = options.getFn ?? config.getFn
      // The read that runs, which concurrent calls of `available` and `prepare` share. A settled read
      // clears it, so a later call reads the realms again.
      let reading: { promise: Promise<boolean>; startedAt: number } | undefined

      // Returns the read of `GET /v1/realms` that runs, or starts one.
      function read(): Promise<boolean> {
        // A request without a response never settles, so a call after `sharedReadLifetime`
        // sends its own request, and a stalled read holds no later call.
        const startedAt = Date.now()
        if (reading && startedAt - reading.startedAt < sharedReadLifetime)
          return reading.promise

        const entry = {
          promise: PasskeyActions.available(config),
          startedAt,
        }
        reading = entry
        // A `fetch` that throws at once rejects the read. The cleanup handles both outcomes, so it
        // adds no unhandled rejection, and the caller receives the rejection.
        const clear = () => {
          if (reading === entry) reading = undefined
        }
        void entry.promise.then(clear, clear)
        return entry.promise
      }

      // Returns the ceremony of a sign-in or of a registration's proof, whose first call throws once
      // a sign-out overtakes the sign-in, also during the prompt. Its commit would throw and revoke
      // the tokens, so an overtaken sign-in shows no prompt, sends no assertion, and `change.fail`
      // throws `SupersededError`. The first call is the sign-in's assertion. The session's account keeps
      // the function for its own signatures, which no later sign-out refuses.
      function ceremony(
        change: ReturnType<Plugin.Context['session']['change']>,
      ): NonNullable<passkey.Options['getFn']> {
        let call: 'account' | 'assertion' = 'assertion'
        return async (parameters) => {
          const checked = call === 'assertion'
          call = 'account'
          if (checked && change.overtaken())
            throw new Accounts.SupersededError()
          const credential = getFn
            ? await getFn(parameters)
            : await navigator.credentials.get(parameters as never)
          if (checked && change.overtaken())
            throw new Accounts.SupersededError()
          return credential as never
        }
      }

      // Returns the creation ceremony of a registration, which throws `SupersededError` before the
      // prompt once a sign-out overtakes the registration. The proof's `ceremony` checks again
      // around its prompt, so an overtaken registration sends no verify request, and Tempo ID stores
      // no passkey for the user who signed out.
      function creation(
        change: ReturnType<Plugin.Context['session']['change']>,
        createFn: PasskeyActions.register.Options['createFn'],
      ): NonNullable<PasskeyActions.register.Options['createFn']> {
        return async (parameters) => {
          if (change.overtaken()) throw new Accounts.SupersededError()
          const credential = createFn
            ? await createFn(parameters)
            : await navigator.credentials.create(parameters as never)
          return credential as never
        }
      }

      // Commits the session of a sign-in's result. The email step leaves the session as it is.
      async function finish(
        change: ReturnType<Plugin.Context['session']['change']>,
        result: PasskeyActions.signIn.ReturnType,
        withAccount: boolean,
      ): Promise<passkey.signIn.ReturnType> {
        if ('next' in result) {
          await change.check()
          return result
        }

        // The sign-in's own response holds the account that Tempo ID selects for the app. A server
        // that predates it is read once, unless an access key names the account. A sign-in without
        // a Tempo Account reads none.
        const account = await (async () => {
          if ('account' in result) return result.account
          if (!withAccount || 'accessKey' in result) return undefined
          // A refused read leaves the session without the account, since the user is signed in.
          return await SignIn.account(config, {
            getFn,
            userId: result.user.id,
          }).catch(() => undefined)
        })()
        const session = SignIn.toSession({ ...result, account })
        await change.commit(session)
        return { ...session, upgradeAvailable: result.upgradeAvailable }
      }

      // Returns whether the browser offers every passkey. A sign-out without `everywhere` keeps the
      // browser's Tempo ID session, for whose user alone Tempo ID offers passkeys, so another user of
      // the page could pick none. Until the next sign-in, the browser thus offers every passkey.
      async function select(
        parameters: passkey.signIn.Parameters,
      ): Promise<boolean | undefined> {
        if (parameters.select !== undefined) return parameters.select
        // `credentialId` names the passkeys to offer, which `select` would replace.
        if (parameters.credentialId !== undefined) return undefined
        if (context.session.get()) return undefined
        return (await context.session.signedOut()) || undefined
      }

      return {
        /**
         * Returns whether a passkey sign-in runs on this page, from `GET /v1/realms`. Never rejects.
         * Concurrent calls, such as the two effects of a React StrictMode mount, share one request
         * for up to 5 seconds after it starts, also with `passkey.prepare`.
         *
         * @example
         * ```ts
         * if (await accounts.passkey.available()) showPasskeyButton()
         * ```
         */
        available(): Promise<boolean> {
          return read()
        },
        /**
         * Registers a new passkey for the signed-in user, with the plugin's `getFn`, and returns
         * its `address` and `id`. On a chain whose accounts are configurable, the passkey joins the
         * account of `existingAccessKey` as an owner. Leaves the session as it is. Call it from a
         * click, since the user approves two prompts.
         *
         * After a `signOut` without `everywhere`, or one with it that rejects or whose logout has
         * no answer yet, such as after a reload during it, and before the next sign-in, the call throws `session_required` before any request or prompt, also in a new
         * instance on the same store, and in one that holds the session from before the sign-out,
         * such as a replica on the same `Store.postgres` table. The call reads the store for the
         * sign-out once. Such a sign-out can keep the browser's Tempo ID session, so the
         * passkey would join the account of the user who signed out. A sign-in in another instance
         * on the same store, such as another tab, is the next sign-in. The call reads the stored
         * session, and sets it as the instance's session. While a sign-out runs in the instance,
         * the call throws without that read.
         *
         * With `accessKey`, the proof's one assertion also signs the access key for the account
         * that the new passkey owns. The call then sets the instance's session and returns it, as
         * `passkey.signIn` does, with `address`, `id`, and `upgradeAvailable`. The user approves
         * two prompts: the creation, then the proof. On a chain whose accounts are configurable,
         * the access key's digest binds the account that the new passkey owns. The call then
         * derives the proof's challenge from the new passkey's public key, with the same prompts
         * and requests.
         *
         * With `challenge` too, the access key's witness is the challenge's EIP-191 hash, so the
         * proof signs it, and the session holds its `challengeSignature`. A Tempo ID that binds its
         * own witness signs its EIP-191 hash in a third prompt. If that prompt fails, the session
         * still holds the registration's access key, and the call throws the failure.
         *
         * @throws {Accounts.RequestError} With `invalid_request`, the field `account`, and status 0,
         *   before any request, on an instance with `account: false`, since a new passkey owns a
         *   Tempo Account.
         * @throws {Accounts.RequestError} When Tempo ID refuses the registration, with one of these
         *   `reason` values, which
         *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
         *   - `session_required`: The user is not signed in to Tempo ID. With `status` 0 and no
         *     request, the user signed out of the app with `signOut` without `everywhere`, or with
         *     `everywhere` and a rejection or a logout without an answer yet, and did not sign in again.
         *   - `passkey_limit`: The user holds 10 passkeys.
         *   - `passkey_register_not_permitted`: No app at the page's origin holds the
         *     `tempo-id:sign` scope.
         *   - `passkey_not_permitted`: The `default` realm's relying party does not cover the page
         *     and Tempo ID.
         *   - `webauthn_rejected`: The credential or the proof does not verify, its step expired,
         *     or Tempo ID or wallet.tempo stores the credential ID. Run the action again.
         *   - `configurable_accounts_disabled`: The chain's accounts are not configurable.
         *   - `foreign_account`: `account` is not the user's in the `default` realm.
         *   - `not_configurable`: `account` is not configurable yet.
         *   - `owner_exists`: A passkey owns `account` already.
         *   - `config_conflict`: The chain holds a configuration that Tempo ID did not send.
         *   - `rate_limited`: The user exceeded the limit of account changes. Retry after
         *     `Retry-After` seconds.
         *   - `upstream_unavailable`: wallet.tempo or the chain failed. Retry later.
         *   - `unexpected`: An unexpected failure. Retry the request.
         * @throws {Accounts.RequestError} With `accessKey`, also for these refusals. The options
         *   request returns the authorization and access key refusals of `passkey.signIn`, before
         *   any prompt. A refusal after the store keeps the passkey on the device.
         *   - `code: 'invalid_request'` and `field: 'accessKey'`, without a `reason`: `accessKey`
         *     came with `account`, `chain`, or `existingAccessKey`. The call throws before any
         *     request.
         *   - `invalid_origin`: The page's origin is missing, or is no redirect URI's origin.
         *   - `invalid_field`: The access key names an account.
         *   - `passkey_register_not_permitted`: The instance's app does not hold the
         *     `tempo-id:sign` scope.
         *   - `foreign_account`: The app's realms do not reach the new passkey's account, after the
         *     store.
         *   - `code: 'server_error'`, without a `reason`, after the store: Tempo ID returned no
         *     authorization, or one for another account, whose refresh token the call revokes.
         *     Sign in with the new passkey.
         * @throws {Accounts.RequestError} With `server_error` and `status` 0, when a request
         *   receives no response, such as offline. If the last request receives no response, Tempo
         *   ID can hold the passkey, so the authenticator keeps it.
         * @throws {Error} Named `AbortError`, when the user closes the passkey prompt, or
         *   lets it time out. The session does not change.
         * @throws {Error} Named `InvalidStateError`, when the authenticator already holds one of
         *   the user's passkeys, before any request after the options. Offer a sign-in with that
         *   passkey. The session does not change.
         * @throws {Accounts.SupersededError} When a sign-out completes during the call, before the
         *   proof's assertion. If it completes before the creation prompt, the call shows no prompt.
         *   If it completes later, the call sends no verify request, so Tempo ID stores no passkey,
         *   and the authenticator drops the new passkey. With `accessKey`, a sign-out that completes
         *   after the proof's assertion also throws it. Tempo ID then holds the passkey, and the call
         *   revokes the new tokens, so the user can sign in with the new passkey.
         * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
         *   `Store.redis`, and the call generates an access key. The call throws before any
         *   request.
         *
         * @example
         * ```ts
         * const session = await accounts.email.signIn({ code, email: address })
         * await accounts.passkey.register({ existingAccessKey: session.accessKey })
         *
         * // A user who holds no account after the emailed code:
         * const signedIn = await accounts.passkey.register({ accessKey: permissions })
         * ```
         */
        async register<
          const parameters extends passkey.register.Parameters =
            passkey.register.Parameters,
        >(
          parameters: parameters = {} as parameters,
        ): Promise<passkey.register.ReturnType<parameters>> {
          // A sign-out without `everywhere` keeps the browser's Tempo ID session, which would
          // receive the passkey, so the user who signed out would hold it. A sign-in in another
          // instance on the same store clears the mark, as `signedOut` reads it. An instance that
          // holds a session reads the mark too, since another process on the store, such as a
          // replica on one `Store.postgres` table, posts it no message of its sign-out.
          // A new passkey always owns a Tempo Account, which an instance with `account: false` holds
          // none of.
          if (config.account === false)
            throw new Accounts.RequestError({
              code: 'invalid_request',
              field: 'account',
              message:
                'Invalid account: a passkey registration creates a Tempo Account, which `account: false` creates none of. Create the instance without `account`.',
              status: 0,
            })
          // The change starts before the read of the mark, so a sign-out that completes during the
          // read or a prompt overtakes the registration.
          const change = context.session.change()
          if (await context.session.signedOut())
            throw new Accounts.RequestError({
              code: 'login_required',
              message:
                'The user signed out of the app, so the passkey would join the account of the user who signed out. Sign in before the registration.',
              reason: 'session_required',
              status: 0,
            })

          // The type parameter follows the caller's parameters. The union narrows on `accessKey`.
          const input: passkey.register.Parameters = parameters
          const ceremonies = {
            createFn: creation(change, input.createFn),
            getFn: ceremony(change),
          }
          // A registration without an access key commits no session, so only its rejection reports
          // the sign-out that overtook it.
          const superseded = (error: unknown): never => {
            if (change.overtaken()) throw new Accounts.SupersededError()
            throw error
          }
          if (input.accessKey === undefined)
            return (await PasskeyActions.register(config, {
              ...input,
              ...ceremonies,
            }).catch(superseded)) as passkey.register.ReturnType<parameters>

          const { accessKey: requested, ...rest } = input
          const accessKey = SignIn.accessKey(context, requested)
          // A function that returns no access key registers without one, as the action checks.
          if (!accessKey)
            return (await PasskeyActions.register(config, {
              ...rest,
              ...ceremonies,
            } as PasskeyActions.register.Options<undefined>).catch(
              superseded,
            )) as passkey.register.ReturnType<parameters>

          const result = await PasskeyActions.register(config, {
            ...rest,
            accessKey,
            ...ceremonies,
          }).catch(change.fail)
          // The registration's response lists the new passkey's account, so the session holds it.
          const session = SignIn.toSession({
            ...result.authorization,
            ...(result.account ? { account: result.account } : {}),
          })
          await change.commit(session)
          // The registration and its access key stand, so the session holds them, and the call
          // reports the challenge's failure on its own.
          if (result.challengeError) throw result.challengeError
          return {
            ...session,
            address: result.address,
            id: result.id,
            upgradeAvailable: result.authorization.upgradeAvailable,
          } as passkey.register.ReturnType<parameters>
        },
        /**
         * Prepares a passkey sign-in ahead of the user's gesture, such as when the form shows, as
         * `Actions.passkey.prepare` does, and returns its handle. The handle's `signIn` starts the
         * ceremony without a request, except as below, and sets the instance's session as
         * `passkey.signIn` does. Never throws. If Tempo ID refuses the options request, the handle's
         * next `signIn` within 4 minutes, on the same chain, throws that refusal without a request.
         * Create a new handle when `accessKey` changes. If the signed-in user changes, or a
         * `signOut` completes here or in another tab, after the options request, the handle's next
         * `signIn` requests options of its own before the ceremony. Their `select` defaults as
         * `passkey.signIn` defaults it, so after a `signOut` without `everywhere` they offer
         * every passkey. Prepare a new handle after a `signOut` to keep that request out of the
         * gesture. A `signIn` during the passkey prompt of the handle's sign-in, such as at a double
         * click, returns that sign-in's promise, with no request or prompt of its own.
         *
         * @example
         * ```ts
         * const prepared = accounts.passkey.prepare()
         * if (await prepared.available) showPasskeyButton()
         *
         * // On the passkey button:
         * const result = await prepared.signIn()
         * ```
         */
        prepare(
          parameters: passkey.prepare.Parameters = {},
        ): passkey.prepare.ReturnType {
          const { chainId } = config
          // A refused access key, such as for a store with `json` on a page, prepares no options, and
          // the handle's `signIn` throws it, so the call itself never throws.
          const resolved = (() => {
            try {
              return {
                accessKey: SignIn.accessKey(context, parameters.accessKey, {
                  account: parameters.account,
                  challenge: parameters.challenge !== undefined,
                }),
                account: SignIn.withAccount(context, parameters),
              }
            } catch (error) {
              return { error }
            }
          })()
          if ('error' in resolved)
            return {
              available: Promise.resolve(parameters.available ?? read()).catch(
                () => false,
              ),
              signIn: () => Promise.reject(resolved.error),
            }
          // The options of a signed-in user name only that user's passkeys, and a sign-out without
          // `everywhere` makes `select` offer every passkey. The handle compares the user and the
          // sign-outs in memory, so a sign-in with no change since reads nothing. `select: true` and
          // `credentialId` name the passkeys alone.
          const fixed =
            parameters.select === true || parameters.credentialId !== undefined
          const subject = () => {
            const session = context.session.get()
            return session ? Session.subject(session) : undefined
          }
          const request = (available: boolean | Promise<boolean>) => {
            const requested = subject()
            // The change commits nothing. It reports a sign-out since the request, here or in
            // another tab, also one between a sign-in and now, whose user before and after is none.
            const { overtaken } = context.session.change()
            return {
              handle: PasskeyActions.prepare(config, {
                accessKey: resolved.accessKey,
                account: resolved.account,
                available,
                chainId,
                challenge: parameters.challenge,
                credentialId: parameters.credentialId,
                mediation: parameters.mediation,
                // The read of the mark runs beside the realms read, and only the options request
                // awaits it, so the handle keeps the chain of the call for its first request.
                select: select(parameters),
              }),
              // The handle's own later requests, such as after its options expire, keep this
              // request's `select`, so a change since then needs a new handle.
              stale: () => subject() !== requested || overtaken(),
            }
          }
          // Without `available`, the handle shares the read of `available` that runs, such as the
          // sign-in form's read for its passkey button.
          let prepared = request(parameters.available ?? read())
          // The sign-in whose ceremony runs, which a call during the ceremony, such as a double
          // click, joins. The browser refuses a second ceremony while one runs, so that call's own
          // options request and prompt would only fail. A call during a request starts its own
          // sign-in, so a stalled request holds no retry.
          let running: Promise<passkey.signIn.ReturnType> | undefined
          return {
            available: prepared.handle.available,
            signIn() {
              if (running) return running
              const current = (async (): Promise<passkey.signIn.ReturnType> => {
                // The prepared request names its chain, which a switch since can leave.
                const change = context.session.change({ chainId })
                if (!fixed && prepared.stale())
                  // The realms read of the handle answered already, so the new options need none.
                  prepared = request(await prepared.handle.available)
                const getFn = ceremony(change)
                let call: 'account' | 'assertion' = 'assertion'
                const result = await prepared.handle
                  .signIn({
                    getFn: async (parameters) => {
                      // Only the assertion is the sign-in's ceremony. The session's account keeps
                      // the function for its own signatures.
                      if (call === 'account') return await getFn(parameters)
                      call = 'account'
                      running = current
                      try {
                        return await getFn(parameters)
                      } finally {
                        if (running === current) running = undefined
                      }
                    },
                  })
                  .catch(change.fail)
                return finish(change, result, resolved.account)
              })()
              return current
            },
          }
        },
        /**
         * Signs the user in with a passkey, sets the instance's session, and returns it with
         * `upgradeAvailable`. Returns the email step as the next action,
         * `{ next: { link, type: 'email' } }`, with no change to the session, for a passkey that no
         * account knows yet. The session holds the user's Tempo Account from the sign-in's own
         * response, with no request after it: the account that the access key names, else the one
         * that Tempo ID selects for the app. Without an access key, a Tempo ID that predates the
         * account in that response is read once more.
         *
         * A refusal of Tempo ID after the sign-in has `signedIn: true`, and empties the session. A
         * response that the call refuses after the sign-in, such as one without the challenge's
         * signature, has `signedIn: true` too, and the call revokes the refresh token of its
         * authorization.
         *
         * @throws {Accounts.RequestError} When Tempo ID refuses the sign-in, with one of these
         *   `reason` values, which
         *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
         *   - `webauthn_rejected`: Tempo ID refused the passkey or its challenge. Sign in again.
         *   - `passkey_not_permitted`: No realm's relying party covers both the page and Tempo ID.
         *   - `invalid_origin`: The page's origin is missing, or is no redirect URI's origin.
         *   - `rejected`: The app is not a first-party app, or is a native app, which signs in
         *     through `redirect.signIn`.
         * @throws {Accounts.RequestError} When Tempo ID refuses the authorization. The user is
         *   signed in, and `signedIn` is `true`.
         *   - `foreign_account`: The access key names a Tempo Account that is not the user's.
         *   - `invalid_origin`: The request came from an origin other than the redirect URI's.
         *   - `rejected`: Tempo ID refused the app or its request, or the user holds no Tempo
         *     Account.
         *   - `webauthn_required`: Another passkey owns the Tempo Account. Authorize through
         *     `redirect.signIn`.
         * @throws {Accounts.RequestError} When Tempo ID refuses the access key.
         *   - `invalid_chain`, `missing_key`, `missing_permissions`, `invalid_public_key`,
         *     `invalid_expiry`, `expiry_passed`, `empty_limits`, `empty_scopes`, `duplicate_limit`,
         *     `unsupported_token`, `invalid_period`, `scope_without_limit`, `unsupported_call`,
         *     `duplicate_scope`, `invalid_recipients`: The access key breaks a
         *     [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
         *   - `invalid_expiry` or `invalid_period` with status 0: `accessKey.expiry` is not a
         *     whole number of seconds or holds milliseconds, or an `accessKey.limits` `period` is fractional, negative,
         *     or above `Number.MAX_SAFE_INTEGER` seconds. The call throws before the request that
         *     carries the access key.
         *   - `invalid_field` with status 0: An `accessKey.limits` entry is negative. The call
         *     throws before the request that carries the access key.
         *   - `duplicate_scope` or `invalid_recipients` with status 0: Two `accessKey.scopes`
         *     name one call on a target, or `spenders` or a scope's `recipients` hold the zero
         *     address or a repeated address. The call throws before the request that carries the
         *     access key.
         *   - `expiry_exceeds_maximum`, `limit_exceeds_maximum`: The access key exceeds the
         *     headless
         *     [ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling).
         *     An app with `tempo-id:sign` has no ceiling. These return before the ceremony, so the
         *     user is not signed in.
         *   - `access_key_pending`: The access key has a key authorization with other limits or
         *     scopes, which the chain has not registered. Send a new access key.
         *   - `challenge_not_permitted`: The app sent a `challenge` without the `tempo-id:sign`
         *     scope.
         * @throws {Accounts.RequestError} With `invalid_field`, `rate_limited`,
         *   `upstream_unavailable`, or `unexpected`, when a field is missing or malformed, such as
         *   a padded `credentialId`, or a retry later may succeed.
         * @throws {Accounts.RequestError} With `server_error` and `status` 0, when a request
         *   receives no response, such as offline. Before the sign-in verifies, `signedIn` is
         *   `false` and the session does not change.
         * @throws {Error} Named `AbortError`, when the user closes the passkey prompt, or
         *   lets it time out. The session does not change.
         * @throws {Accounts.SupersededError} When another sign-in or a sign-out completed while
         *   this sign-in was pending, also after the email step. If a sign-out completes before
         *   the passkey prompt, the call shows no prompt. If it completes during the prompt, the
         *   call sends no assertion.
         * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
         *   `Store.redis`, and the call generates an access key. The call throws before any
         *   request.
         *
         * @example
         * ```ts
         * const result = await accounts.passkey.signIn({ mediation: 'conditional' })
         * ```
         */
        async signIn(
          parameters: passkey.signIn.Parameters = {},
        ): Promise<passkey.signIn.ReturnType> {
          // The change starts first, so a sign-out that starts during the read of the mark
          // supersedes the sign-in. The options request awaits the read beside the access key.
          const change = context.session.change()
          const account = SignIn.withAccount(context, parameters)
          const result = await PasskeyActions.signIn(config, {
            accessKey: SignIn.accessKey(context, parameters.accessKey, {
              account: parameters.account,
              challenge: parameters.challenge !== undefined,
            }),
            account,
            chainId: config.chainId,
            challenge: parameters.challenge,
            credentialId: parameters.credentialId,
            getFn: ceremony(change),
            mediation: parameters.mediation,
            select: select(parameters),
          }).catch(change.fail)
          return finish(change, result, account)
        },
      }
    },
    // The instance's `getFn` also runs the ceremonies of a restored session's account.
    config: () => (options.getFn ? { getFn: options.getFn } : {}),
    id: 'passkey',
  })
}

export declare namespace passkey {
  type Options = {
    /**
     * Runs the passkey ceremony in place of `navigator.credentials.get`, such as on a device. Its
     * assertion must report the page's origin. It is also the instance's default `getFn`, which a
     * restored session's account uses.
     */
    getFn?: Api.tempoAccount.Options['getFn'] | undefined
  }

  namespace prepare {
    /** The parameters of `passkey.signIn`, and `available`. */
    type Parameters = signIn.Parameters & {
      /**
       * Whether a passkey sign-in runs on this page, if the app knows it, such as a first-party app
       * on its own origin. The handle then sends no `GET /v1/realms`. With `true`, it requests the
       * options at once. With `false`, it requests no options until its `signIn`. Absent, the
       * handle shares the read of `passkey.available`, also one that runs.
       */
      available?: boolean | undefined
    }

    /** The prepared sign-in's handle. */
    type ReturnType = {
      /** Whether a passkey sign-in runs on this page. Never rejects. */
      available: Promise<boolean>
      /**
       * Signs in as `passkey.signIn` does, with the handle's options, and sets the instance's
       * session. Requests new options if the handle holds none, or if they are older than 4 minutes. A
       * call during the passkey prompt of the handle's sign-in returns that sign-in's promise.
       *
       * @throws {Accounts.RequestError} With `server_error` and `status` 0, when a request receives
       *   no response, as `passkey.signIn` throws it.
       * @throws {Error} Named `AbortError`, when the user closes the passkey prompt, as
       *   `passkey.signIn` throws it.
       * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
       *   `Store.redis`, and the sign-in generates an access key. The handle sends no request.
       */
      signIn: () => Promise<signIn.ReturnType>
    }
  }

  namespace register {
    /**
     * The parameters of a registration, one of two sets, which the types keep apart. A registration
     * with `accessKey` takes `challenge`, and no `account`, `chain`, or `existingAccessKey`. A
     * registration without `accessKey` takes `account`, `chain`, and `existingAccessKey`, and no
     * `challenge`. Both take `createFn` and `registration`.
     */
    type Parameters = Pick<
      PasskeyActions.register.Options,
      'createFn' | 'registration'
    > &
      (Parameters.WithAccessKey | Parameters.WithoutAccessKey)

    namespace Parameters {
      /**
       * The parameters of a registration that signs an access key for the account that the new
       * passkey owns, and sets the session.
       */
      type WithAccessKey = Omit<
        PasskeyActions.register.Options.WithAccessKey,
        'accessKey'
      > & {
        /**
         * The access key to request, or a function that returns it. The proof's assertion signs it
         * for the new passkey's account, as a
         * [sign-in with key signature](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#registration-with-an-access-key)
         * does, and the call sets the session. It fits the headless ceiling, unless the app holds
         * `tempo-id:sign`. Absent, the registration authorizes no access key, and the instance's
         * `accessKey` does not apply. Options from `email.signIn` with `registration: true` are not
         * used. With `challenge`, a function that returns no access key throws `invalid_request`
         * before any prompt.
         */
        accessKey: Exclude<SignIn.AccessKeyOption_external, false | undefined>
      }

      /**
       * The parameters of a registration that authorizes no access key, and leaves the session as
       * it is.
       */
      type WithoutAccessKey = PasskeyActions.register.Options.WithoutAccessKey
    }

    /**
     * The new passkey and the account that it owns. With `accessKey`, also the instance's new
     * session, and whether its account can upgrade.
     */
    type ReturnType<parameters extends Parameters = Parameters> =
      parameters extends { accessKey: infer value }
        ? undefined extends Resolved<value>
          ? // A function that can return no access key registers without one.
            Signed | PasskeyActions.register.ReturnType
          : Signed
        : PasskeyActions.register.ReturnType

    /** The access key that `accessKey` resolves to: a function's result, or the value itself. */
    type Resolved<value> = value extends () => infer permissions
      ? permissions
      : value

    /** The new passkey, the account that it owns, and the instance's new session. */
    type Signed = PasskeyActions.register.ReturnType &
      Session.Session & {
        /**
         * Whether the account is a wallet.tempo passkey's that waits for its upgrade on the access
         * key's chain.
         */
        upgradeAvailable: boolean
      }
  }

  namespace signIn {
    type Parameters = SignIn.AccountOption<SignIn.AccessKeyOption_external> & {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       *
       * With `publicKey`, the sign-in authorizes another app's access key, whose private key that
       * app holds, such as the access key of an app whose dialog a wallet shows. The session then
       * holds its key authorization. The account's owner signs the session's messages and typed
       * data, since the session cannot sign with that access key. A transaction throws
       * `Accounts.AccessKeyRequiredError`. A `publicKey` that holds no uncompressed public key,
       * such as a private key in its place, throws `invalid_public_key` before any request, and the
       * error quotes none of it.
       */
      accessKey?: SignIn.AccessKeyOption_external
      /**
       * A message, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md)
       * describes, which `challengeSignature` signs as `address`. Without an access key, the
       * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
       * authorization's `witness` binds that hash, and the signature is the key authorization's.
       * A sign-in on the app's page needs the `tempo-id:sign` scope.
       */
      challenge?: string | undefined
      /** The credential ID, or up to 16 IDs, that the browser offers. Defaults to every passkey. */
      credentialId?: readonly string[] | string | undefined
      /** The browser's mediation, such as `conditional` for autofill. Defaults to its own. */
      mediation?: 'conditional' | 'optional' | 'required' | 'silent' | undefined
      /**
       * Whether the browser offers every passkey of the relying party, such as to switch accounts.
       * Defaults to `true` after a `signOut` without `everywhere` and before the next sign-in,
       * also in a new instance on the same store, unless `credentialId` names passkeys. Defaults to
       * `false` otherwise. With `false` and a Tempo ID session in the browser, the browser offers
       * only the passkeys of that session's user.
       */
      select?: boolean | undefined
    }

    type ReturnType =
      | (Session.Session & {
          /**
           * Whether the account is a wallet.tempo passkey's that waits for its upgrade on the access key's
           * chain.
           */
          upgradeAvailable: boolean
        })
      | {
          /**
           * The next action, the email step: the passkey's user verifies an email, which links
           * the passkey.
           */
          next: PasskeyActions.signIn.EmailStep
        }
  }
}
