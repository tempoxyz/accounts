/**
 * The plugin of sign-in with the device grant (RFC 8628), such as for a CLI.
 * @module
 */
import {
  type Config,
  AccessKeyRequiredError,
  SupersededError,
} from '../Accounts.js'
import * as DeviceActions from '../actions/device.js'
import type * as Funding from '../internal/Funding.js'
import * as SignIn from '../internal/SignIn.js'
import * as StoreValue from '../internal/StoreValue.js'
import * as Plugin from '../Plugin.js'
import type { WithAccount } from '../Permissions.js'
import type * as Session from '../Session.js'

/**
 * The plugin has no `onCode`, so the device grant cannot show its user code. `device.request` and
 * `device.signIn` throw it before any request. The `viem` plugin's retry then rejects with the
 * transaction's own error. Match it by `name`.
 */
export class OnCodeRequiredError extends Error {
  override readonly name = 'Plugins.device.OnCodeRequiredError'

  constructor() {
    super(
      'The device grant has no handler of its user code. Pass `onCode` to `device()`, or use `device.authorize` and `device.poll`.',
    )
  }
}

/**
 * Returns the plugin of sign-in with the
 * [device grant](https://github.com/tempoxyz/id/blob/main/docs/device-grant.md)
 * ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), such as for a CLI, which adds
 * `device.signIn`, `device.authorize`, and `device.poll`. The sign-in passes the user code to
 * `onCode`, waits for the user to approve it on Tempo ID's device page in any browser, sets the
 * instance's session, and returns it. No redirect URI or local server is involved. `authorize` and
 * `poll` run the same grant across requests, such as on a backend, and set no session.
 *
 * The `viem` plugin's retry shows the code of its device grant through `onCode` too, for a
 * transaction above the balance or the limit of the access key.
 *
 * The user approves the limits of the grant's access key, so they may exceed the headless
 * [ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
 * Outside a browser, an instance with a `cli:` client ID keeps the session in the file that every
 * CLI of the user shares, `~/.tempo/id/store.json`. An instance with a registered client ID holds
 * the session only with a `store`, such as `Store.file()`. With `store: false`, a `cli:` instance
 * holds no session either, as a service that signs in many users needs.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { device } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   accessKey: () => ({
 *     expiry: '7d',
 *     limits: [{ limit: '100', token: 'ousd' }],
 *   }),
 *   clientId: 'cli:acme-deploy',
 *   plugins: [
 *     device({
 *       onCode: (code) =>
 *         console.log(
 *           `Open ${code.verificationUriComplete}, and confirm ${code.userCode}.`,
 *         ),
 *     }),
 *   ],
 * })
 *
 * if (!(await accounts.session.get())) await accounts.device.signIn()
 * ```
 */
export function device(options: device.Options = {}) {
  const { onCode } = options
  // The sign-ins in progress of each instance, with whether a completed change overtook each. An
  // instance without a session serves many users, so its sign-outs overtake none.
  const pending = new WeakMap<Config, Set<Entry>>()

  /** Aborts each sign-in of the instance that a completed sign-out overtook. */
  function abort(context: Plugin.Context) {
    for (const entry of pending.get(context.config) ?? [])
      if (entry.overtaken()) entry.controller.abort()
  }

  return Plugin.from({
    actions: (context) => {
      /**
       * Starts the device grant, passes its code to `onCode`, and resolves with the authorization
       * once the user approves the code. An aborted request shows no code.
       */
      async function request(
        parameters: device.request.Parameters,
      ): Promise<device.request.ReturnType> {
        if (!onCode) throw new OnCodeRequiredError()
        const { signal } = parameters
        // The request names the instance's chain, so the stored selection loads first. A failed read
        // keeps the chain.
        await context.chain.load().catch(() => undefined)
        const accessKey = SignIn.accessKey(context, parameters.accessKey, {
          challenge: parameters.challenge !== undefined,
        })
        if (!accessKey && parameters.challenge === undefined)
          throw new AccessKeyRequiredError()

        // An abort rejects the code request and `onCode` at once. The wait lets a poll in flight
        // finish, so an approval that it carries reaches the caller, which revokes its tokens. React
        // Native's `AbortSignal` has no `reason`.
        const reason = () =>
          signal?.reason ??
          Object.assign(new Error('The request was aborted.'), {
            name: 'AbortError',
          })
        if (signal?.aborted) throw reason()
        const aborted = new Promise<never>((_, reject) =>
          signal?.addEventListener('abort', () => reject(reason()), {
            once: true,
          }),
        )
        aborted.catch(() => undefined)
        /** Settles with `promise`, or rejects at once when `signal` aborts. */
        const until = <value>(promise: Promise<value>) =>
          Promise.race([promise, aborted])

        const grant = await until(
          DeviceActions.authorize(context.config, {
            accessKey,
            challenge: parameters.challenge,
            funding: parameters.funding,
            resource: parameters.resource,
          }),
        )
        await until(
          Promise.resolve(
            onCode({
              expiresIn: grant.expiresIn,
              userCode: grant.userCode,
              verificationUri: grant.verificationUri,
              verificationUriComplete: grant.verificationUriComplete,
            }),
          ),
        )
        return await grant.wait({ signal })
      }

      return {
        /**
         * Starts the device grant for an access key, and returns its code and the device code that
         * `poll` redeems. Sets no session, so a backend can start the grant in one request and poll
         * in later ones. Keep `deviceCode` as secret as a session until the code expires.
         *
         * @throws {Accounts.RequestError} When Tempo ID refuses the code request, or the code request
         *   receives no response, as `device.signIn` lists.
         * @throws {Accounts.RequestError} With `invalid_public_key` and status 0, before any request,
         *   when `accessKey.publicKey` holds no uncompressed public key, such as a private key in its
         *   place. The error quotes none of the value.
         *
         * @example
         * ```ts
         * const { deviceCode, verificationUriComplete } = await accounts.device.authorize({
         *   accessKey: {
         *     expiry: '1d',
         *     limits: [{ limit: '10', token: 'ousd' }],
         *     publicKey,
         *   },
         * })
         * ```
         */
        async authorize(
          parameters: device.authorize.Parameters,
        ): Promise<device.authorize.ReturnType> {
          const grant = await DeviceActions.authorize(
            context.config,
            parameters,
          )
          return {
            deviceCode: grant.deviceCode,
            expiresIn: grant.expiresIn,
            interval: grant.interval,
            userCode: grant.userCode,
            verificationUri: grant.verificationUri,
            verificationUriComplete: grant.verificationUriComplete,
          }
        },
        /**
         * Sends one poll of a device code that `authorize` started, as `Actions.device.poll` does.
         * Returns `pending` until the user decides, with `slowDown` when the poll came before the
         * interval, and `approved` with the authorization once. Sets no session.
         *
         * `accessKey` names the same access key as `authorize`, or `false` for a grant that signs a
         * challenge alone. The authorization of such a grant holds the tokens, the user, `address`,
         * and `challengeSignature`. With `accessKey: false`, an approval without `challengeSignature`
         * throws, unless the poll passes `challenged: false` for a grant without a challenge.
         *
         * @throws {Accounts.RequestError} When the token endpoint refuses the poll, with one of these
         *   `code` values:
         *   - `access_denied`: The user denied the code.
         *   - `expired_token`: The code expired.
         *   - `invalid_grant`: The code was already collected, or is unknown.
         * @throws {Accounts.RequestError} For a poll without a decision, after which the code stays
         *   valid. A poll without a response, such as offline, has `server_error` and status 0, and
         *   `cause` holds the platform's error. Poll again.
         * @throws {Accounts.RequestError} With `server_error` and status 200, after the approval, when
         *   the token response holds a key authorization that does not parse, such as of a newer
         *   signature type. The approval redeemed the code, so a later poll fails with
         *   `invalid_grant`. The error quotes none of it. Update the package, then start a new grant.
         * @throws {Accounts.RequestError} With `invalid_public_key` and status 0, before any request,
         *   as `device.authorize` throws it.
         *
         * @example
         * ```ts
         * const result = await accounts.device.poll({
         *   accessKey: { publicKey },
         *   deviceCode,
         * })
         * if (result.status === 'approved') await save(result.authorization.accessKey)
         * ```
         */
        poll<
          const parameters extends device.poll.Parameters =
            device.poll.Parameters,
        >(parameters: parameters): Promise<device.poll.ReturnType<parameters>> {
          return DeviceActions.poll<number, parameters['accessKey']>(
            context.config,
            parameters,
          )
        },
        /**
         * Starts the device grant, and passes its code to `onCode`. It then polls until the user
         * approves the code, and returns the authorization, as `device.poll` returns it. Sets no
         * session, so the caller checks and keeps the authorization, such as the `viem` plugin's
         * retry, which keeps it only for the same user and Tempo Account. It takes the parameters of
         * `device.signIn`, and `signal`, which stops the polls. An aborted call shows no code.
         *
         * @throws {Accounts.AccessKeyRequiredError} As `device.signIn` throws it.
         * @throws {Accounts.RequestError} As `device.signIn` throws it.
         * @throws {Plugins.device.OnCodeRequiredError} Without the plugin's `onCode`.
         *
         * @example
         * ```ts
         * const authorization = await accounts.device.request({
         *   accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
         * })
         * ```
         */
        request,
        /**
         * Starts the device grant, and passes its code to `onCode`. It then polls until the user
         * approves the code, sets the instance's session, and returns it. The session holds no Tempo
         * Account. The grant requests an access key, unless it carries `challenge`, which the account
         * then signs as the session's `challengeSignature`.
         *
         * If a poll fails with a network error, a rate limit, or a server error, the wait doubles
         * until a poll is answered, and the poll continues until the code expires. The code expires
         * after 10 minutes. If the instance signs out first, the sign-in sends no further poll. A
         * poll in flight finishes, and the sign-out revokes the tokens of an approval that it
         * carries. If `signal` aborts, such as at a timeout or a Ctrl+C, the sign-in sends no
         * further poll, changes no session, and rejects with the signal's reason. A poll in flight
         * finishes, and an approval that it carries signs in.
         *
         * @throws {Accounts.AccessKeyRequiredError} Before any request, when neither the call nor the
         *   instance names an access key, or when the call passes `accessKey: false`, unless the call
         *   passes `challenge`.
         * @throws {Accounts.RequestError} When Tempo ID refuses the code request, with one of these
         *   `reason` values, which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md)
         *   describes:
         *   - `rejected`: `clientId` names no enabled public first-party device app.
         *   - `invalid_target`: `resource` names a resource that is not registered, or is disabled.
         *   - `invalid_chain`, `missing_key`, `missing_permissions`, `invalid_public_key`,
         *     `invalid_expiry`, `expiry_passed`, `empty_limits`, `empty_scopes`, `duplicate_limit`,
         *     `unsupported_token`, `invalid_period`, `scope_without_limit`, `unsupported_call`,
         *     `duplicate_scope`, `invalid_recipients`: The access key breaks a
         *     [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
         *   - `invalid_expiry` or `invalid_period` with status 0: `accessKey.expiry` is not a
         *     whole number of seconds or holds milliseconds, or an `accessKey.limits` `period` is fractional, negative,
         *     or above `Number.MAX_SAFE_INTEGER` seconds. The call throws before the request that
         *     carries the access key.
         *   - `invalid_field` with status 0: An `accessKey.limits` entry is negative, or a `funding`
         *     amount, currency, or token is malformed, with the `field`, such as `funding.amount`. The
         *     call throws before the request that carries the access key.
         *   - `empty_limits` or `empty_scopes` with status 0: `accessKey.limits` or
         *     `accessKey.scopes` is empty. The call throws before the request that carries the access
         *     key.
         *   - `duplicate_scope` or `invalid_recipients` with status 0: Two `accessKey.scopes`
         *     name one call on a target, or `spenders` or a scope's `recipients` hold the zero
         *     address or a repeated address. The call throws before the request that carries the
         *     access key.
         *   - `invalid_field`, `rate_limited`, `upstream_unavailable`, `unexpected`: A field is
         *     missing or malformed, or a retry later may succeed.
         * @throws {Accounts.RequestError} With `server_error` and status 0, when the code request
         *   receives no response, such as offline. `cause` holds the platform's error.
         * @throws {Accounts.RequestError} With `redirect_refused` and status 0, before `onCode`, when
         *   `url` answers the code request with a redirect. Set `url` to the origin of Tempo ID.
         * @throws {Accounts.RequestError} While the call polls, with one of the `code` values of
         *   `device.poll` from the token endpoint: `access_denied`, `expired_token`, or
         *   `invalid_grant`.
         * @throws {Accounts.RequestError} With `server_error` and status 200, after the approval, when
         *   the token response holds a key authorization that does not parse, such as of a newer
         *   signature type. The error quotes none of it. Update the package, then sign in again.
         * @throws {Accounts.RequestError} With `expired_token`, when the call polled until
         *   `expiresIn` passed. If the last poll failed with a network error, a rate limit, or a
         *   server error, `cause` holds that error. Request a new code.
         * @throws {Accounts.SupersededError} When another sign-in or a sign-out completed while this
         *   sign-in was pending. A sign-out of the instance throws it once the sign-out completes,
         *   also while the code request or `onCode` is pending, and no poll follows. An instance
         *   without a session, such as a backend's, keeps its sign-ins.
         * @throws {Error} With the reason of `signal` once it aborts, or an `AbortError` where the
         *   platform's `AbortSignal` has no `reason`. An aborted call shows no code.
         * @throws {Store.InvalidFileError} Before the code request, when the `Store.file` file holds
         *   no valid JSON object. Remove the file, and sign in again.
         * @throws {Error} Before the code request, with the store's error, when the read of the store
         *   fails, such as for a database that does not respond. The store also holds the session,
         *   so its save would fail after the user approves the code. A stored chain selection that
         *   throws `Store.InvalidValueError` keeps the configured chain instead.
         * @throws {Plugins.device.OnCodeRequiredError} Without the plugin's `onCode`, since the user
         *   then never sees the code.
         *
         * @example
         * ```ts
         * const { user } = await accounts.device.signIn()
         * ```
         */
        async signIn(
          parameters: device.signIn.Parameters = {},
        ): Promise<Session.Session> {
          if (!onCode) throw new OnCodeRequiredError()
          // The request names the instance's chain, so the stored selection loads first. The store
          // also holds the session, so after a failed read its save fails too, and the sign-in
          // rejects before the user approves a code. An entry that holds no valid value fails its
          // own read only. The change starts at the call, so a sign-out after it overtakes it.
          const loading = context.chain.load()
          const change = context.session.change({
            loading: loading.catch(() => undefined),
          })
          // The sign-in registers before its first await, so a sign-out at any later point ends it.
          const controller = new AbortController()
          // `signal` stops the polls as `device.request` does, and rejects with its reason.
          const { signal } = parameters
          const stop = new AbortController()
          // React Native's `AbortSignal` has no `reason`, and Hermes has no `DOMException`.
          const stopped = new Promise<never>((_, reject) =>
            stop.signal.addEventListener(
              'abort',
              () =>
                reject(
                  stop.signal.reason !== undefined
                    ? stop.signal.reason
                    : Object.assign(new Error('The sign-in was aborted.'), {
                        name: 'AbortError',
                      }),
                ),
              { once: true },
            ),
          )
          stopped.catch(() => undefined)
          const abort_signal = () => stop.abort(signal?.reason)
          controller.signal.addEventListener('abort', () => stop.abort(), {
            once: true,
          })
          if (signal?.aborted) abort_signal()
          else signal?.addEventListener('abort', abort_signal, { once: true })
          const entry = { controller, overtaken: change.overtaken }
          const entries = pending.get(context.config) ?? new Set()
          pending.set(context.config, entries.add(entry))
          // React Native's `AbortSignal` has no `reason`, so the sign-out's error comes from here.
          const cancelled = new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              'abort',
              () => reject(new SupersededError()),
              { once: true },
            ),
          )
          cancelled.catch(() => undefined)
          /** Settles with `promise`, or rejects at once when a sign-out or `signal` ends the sign-in. */
          const until = <value>(promise: Promise<value>) =>
            Promise.race([promise, cancelled, stopped])
          /**
           * Rethrows the error of an abort of `signal`. The app chose its reason, so even a refusal
           * marked `signedIn` runs no cleanup of the session that the sign-in started from.
           */
          const fail = async (error: unknown): Promise<never> => {
            const aborted =
              stop.signal.aborted &&
              (error === stop.signal.reason ||
                (error instanceof Error && error.name === 'AbortError'))
            if (!aborted) return change.fail(error)
            await change.check()
            // The request and its wait replace a `null` reason with an `AbortError`.
            throw stop.signal.reason !== undefined ? stop.signal.reason : error
          }
          try {
            await until(
              loading.catch((error: unknown) => {
                // A store that parses each entry alone, such as `Store.postgres`, saves the session
                // under its own entry, so an invalid selection keeps the configured chain.
                if (error instanceof StoreValue.InvalidValueError)
                  return undefined
                // The sign-out that aborted the sign-in ended the session already, so the change
                // runs no cleanup of its own.
                if (controller.signal.aborted) throw new SupersededError()
                // An abort of `signal` rejected the call already, so a later failure changes nothing.
                if (stop.signal.aborted) return undefined
                return change.fail(error)
              }),
            ).catch((error: unknown) => {
              // A sign-out also aborts `stop`, and either rejection can win the race.
              if (controller.signal.aborted) throw new SupersededError()
              // An abort of `signal` during a read that stalls rejects with its reason.
              if (stop.signal.aborted) return fail(error)
              throw error
            })
            // The request rejects at the abort, except in its wait, which lets a poll in flight
            // finish. So an approval in flight reaches the commit, which revokes its tokens.
            const result = await request({
              ...parameters,
              signal: stop.signal,
            }).catch((error: unknown) => {
              // An aborted sign-in received no tokens, and the sign-out that aborted it ended the
              // session already, so it fails without the cleanup of an overtaken change.
              if (controller.signal.aborted) throw new SupersededError()
              return fail(error)
            })
            const session = SignIn.toSession(result)
            await change.commit(session)
            return session
          } finally {
            signal?.removeEventListener('abort', abort_signal)
            entries.delete(entry)
          }
        },
      }
    },
    hooks: {
      // Another tab's sign-out runs only this hook.
      afterSignOut(context) {
        abort(context)
      },
      // A sign-out that rejects, such as for a revocation without an answer, runs no `afterSignOut`,
      // but it overtakes the sign-ins too. The session's sign-out starts once this hook yields, and
      // `ended` settles with it, also when it rejects.
      beforeSignOut(context) {
        // The wait runs beside the sign-out, so the hooks of later plugins start at once. It never
        // rejects, since `ended` never rejects.
        void (async () => {
          await Promise.resolve()
          await context.session.ended()
          abort(context)
        })()
      },
    },
    id: 'device',
  })
}

/** A sign-in in progress of the device plugin. */
type Entry = {
  /** Aborts the sign-in. */
  controller: AbortController
  /** Returns whether a change that overtakes the sign-in completed. */
  overtaken: () => boolean
}

export declare namespace device {
  type Options = {
    /**
     * Shows the user code and the page to approve it on, such as in a terminal. `device.signIn`
     * needs it, and so does the `viem` plugin's retry outside a page. Absent, only
     * `device.authorize` and `device.poll` run.
     */
    onCode?: ((code: Code) => Promise<void> | void) | undefined
  }

  namespace authorize {
    type Parameters = Omit<DeviceActions.authorize.Options, 'accessKey'> & {
      /**
       * The access key to request: what it may do, and the app's own access key as `account` or
       * `publicKey`, which `poll` names again, such as a public key whose private key the backend
       * holds elsewhere. Defaults to a new access key, which `poll` cannot name. `undefined`
       * requests none, for a grant that signs `challenge` alone.
       */
      accessKey: WithAccount | undefined
    }

    type ReturnType = Omit<DeviceActions.authorize.ReturnType, 'wait'>
  }

  namespace poll {
    type Parameters = DeviceActions.poll.Options

    /** The poll's result, keyed unless `accessKey` is `false`. A union of both stays a union. */
    type ReturnType<parameters extends Parameters = Parameters> =
      DeviceActions.poll.ReturnType<
        number,
        HasAccessKey<parameters['accessKey']>
      >

    /** Whether `accessKey` names an access key, distributed over a union. */
    type HasAccessKey<accessKey> = accessKey extends false ? false : true
  }

  /** A device grant's code. */
  type Code = {
    /** Seconds until the code expires. */
    expiresIn: number
    /** The code that the user enters on the device page, such as `BCDF-GHJK`. */
    userCode: string
    /** The device page. */
    verificationUri: string
    /** The device page with the code filled in. */
    verificationUriComplete: string
  }

  namespace request {
    type Parameters = signIn.Parameters

    type ReturnType = DeviceActions.authorize.Authorized<number, boolean>
  }

  namespace signIn {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`. With `challenge`,
       * `false` requests none, and the account signs the challenge alone.
       */
      accessKey?: SignIn.AccessKeyOption
      /**
       * A message, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md)
       * describes, which `challengeSignature` signs as `address`. Without an access key, the
       * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
       * authorization's `witness` binds that hash, and the signature is the key authorization's.
       * Tempo ID's page shows the message, from any app, with or without an access key.
       */
      challenge?: string | undefined
      /**
       * The amount that the app needs in the user's Tempo Account. After the approval, an account
       * that holds less opens Tempo ID's funding page in place of the approved screen, as
       * [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.
       */
      funding?: Funding.Funding | undefined
      /**
       * The [registered resources](https://github.com/tempoxyz/id/blob/main/docs/resources.md)
       * (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`. Each access token
       * names them as `aud`, and each refresh keeps them. The device code request names each one as
       * its own `resource` parameter, and the poll names none. Defaults to the instance's
       * `resource`, or else Tempo ID's origin. An unknown or disabled resource fails with
       * `invalid_target`.
       */
      resource?: Config['resource']
      /**
       * Stops the polls, and rejects with the signal's reason. An aborted call shows no code. A
       * poll in flight finishes, so an approval that it carries still returns. Absent, the polls
       * end only with the code.
       */
      signal?: AbortSignal | undefined
    }
  }
}
