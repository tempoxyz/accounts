/**
 * The plugin of sign-in with an emailed code. On an instance with `clientSecret` or
 * `clientAssertion`, which only a backend holds, it calls the backend's routes.
 * @module
 */
import * as EmailActions from '../actions/email.js'
import type * as Api from '../internal/Api.js'
import * as SignIn from '../internal/SignIn.js'
import type * as TempoAccount from '../internal/TempoAccount.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/** The milliseconds that Tempo ID's refusal of an unlisted chain holds for later sign-ins. */
const unlistedTtl = 10 * 60_000

/**
 * Returns the plugin of sign-in with an emailed code, which adds `email.sendCode` and `email.signIn`.
 * An app renders its own form, and Tempo ID emails a 6-digit code to the address. On a page, only a
 * [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs
 * in this way, at the origin of one of its redirect URIs. Unless the app holds `tempo-id:sign`, the
 * access key must fit the headless
 * [ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
 *
 * On an instance with `clientSecret` or `clientAssertion`, the plugin calls the backend's routes
 * instead, as [Backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md)
 * describes. A backend's instance holds no session, so it saves the result with `backend.save`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { email } from 'accounts/plugins'
 *
 * // A first-party app's registration ID. A page origin names a third-party app.
 * const accounts = Accounts.create({ clientId: 'example-app', plugins: [email()] })
 *
 * await accounts.email.sendCode({ email: 'user@example.com' })
 * const session = await accounts.email.signIn({
 *   code: '123456',
 *   email: 'user@example.com',
 * })
 * ```
 */
export function email(options: email.Options = {}) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      // Only a backend holds the app's client authentication.
      const backend = Boolean(config.clientSecret || config.clientAssertion)
      // The time in milliseconds until which each chain counts as unlisted, after Tempo ID refused
      // its account view. A later sign-in on it sends no chain, and no second request. The refusal
      // expires, so a chain that Tempo ID lists later returns its Tempo Account again.
      const unlisted = new Map<number, number>()

      return {
        /**
         * Emails a sign-in code to `email`. The response is the same for every address, so it
         * reveals no account. Tempo ID emails the code after its response, so the call does not
         * report a failed send.
         *
         * @throws {Accounts.RequestError} When Tempo ID refuses the request, with one of these
         *   `reason` values, which
         *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
         *   - `invalid_field`: A field is missing or malformed, such as `userIp` on a backend.
         *   - `rate_limited`: The request exceeded a rate limit. Retry later.
         *   - `unexpected`: An unexpected failure. Retry the request.
         *   - `invalid_client`: On a backend, the app is unknown or disabled, or its secret or keys
         *     refuse the request.
         *   - `backend_sign_in_not_permitted`: On a backend, the app has no client secret or keys,
         *     or does not hold backend sign-in.
         * @throws {Accounts.RequestError} With `rejected` and status 400, when `clientId` names a
         *   third-party app, such as an origin, without client authentication. The call sends no
         *   request.
         * @throws {Accounts.RequestError} With `server_error` and `status` 0, when the request
         *   receives no response, such as offline.
         *
         * @example
         * ```ts
         * await accounts.email.sendCode({ email: 'user@example.com' })
         * ```
         */
        async sendCode(parameters: email.sendCode.Parameters): Promise<void> {
          if (backend) {
            // Only a backend calls these routes, so a page's bundle loads them on demand.
            const BackendEmail = await import('../actions/backend/email.js')
            return BackendEmail.sendCode(config, {
              email: parameters.email,
              userIp: parameters.userIp,
            })
          }
          return EmailActions.sendCode(config, { email: parameters.email })
        },
        /**
         * Signs the user in with the emailed code, sets the instance's session, and returns it.
         * With an access key, the session holds it. On a browser page, the session holds the
         * user's Tempo Account from the sign-in's own response, with no request after it. A chain
         * that Tempo ID does not list leaves the account out.
         *
         * A new user of an app whose first account is a passkey holds no account to sign the access
         * key. On the page of an app with `tempo-id:sign`, Tempo ID then returns the passkey
         * account's registration in place of the authorization. The call registers the passkey
         * there: its creation, then its proof, which signs the access key, as `passkey.register`
         * with `accessKey` does. The proof signs a `challenge` too, as the access key's witness. A
         * Tempo ID that binds its own witness signs the challenge's EIP-191 hash in a third
         * ceremony. If that ceremony fails, the session still holds the passkey's account and its
         * access key, and the call throws the failure.
         *
         * With `account: false`, of the instance or of the call, the sign-in requests no access key
         * and reads no Tempo Account, and the session holds none. Tempo ID then creates no Tempo
         * Account on the page's sign-in. A backend's sign-in creates one, unless the app's first
         * account is `none`.
         *
         * A refusal of Tempo ID after the sign-in has `signedIn: true`, and empties the session. On a
         * page, a response that the call refuses after the sign-in, such as one without the
         * challenge's signature, has `signedIn: true` too, and the call revokes the refresh token
         * of the sign-in's authorization. A backend, and the registration of a new user's passkey
         * account, revoke none.
         * [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes each
         * `reason`.
         *
         * @throws {Accounts.RequestError} With `rejected` and status 400, when `clientId` names a
         *   third-party app, such as an origin, without client authentication. The call sends no
         *   request.
         * @throws {Accounts.RequestError} With `invalid_field`, the field `code`, and status 0,
         *   when `code` holds other than 6 digits. The call sends no request, and prompts for no
         *   passkey, so the code stays valid.
         * @throws {Accounts.RequestError} When Tempo ID refuses the sign-in. After a refusal of a
         *   `link`, the code stays valid, so call again without `link`.
         *   - `invalid_code`: The code is wrong or expired. On a backend, also when the code is
         *     used, or the address has no code. Request a new code.
         *   - `passkey_link_expired`: The `link` expired, or the browser holds no link cookie for
         *     it.
         *   - `passkey_not_permitted`: The passkey's relying party does not cover the app's realms
         *     or page.
         *   - `invalid_origin`: With `link`, the page's origin is no redirect URI's origin.
         *   - `webauthn_rejected`: The assertion of the passkey that `link` names did not verify.
         *   - `invalid_client`: On a backend, the app is unknown or disabled, or its secret or keys
         *     refuse the request.
         *   - `backend_sign_in_not_permitted`: On a backend, the app has no client secret or keys,
         *     or does not hold backend sign-in.
         * @throws {Accounts.RequestError} When Tempo ID refuses the authorization request. Tempo ID
         *   checks it before the code, so the code stays valid, and `signedIn` is `false`.
         *   - `invalid_origin`: The request came from an origin other than the redirect URI's.
         *   - `rejected`: Tempo ID refused the app or its request.
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
         *   - `empty_limits` or `empty_scopes` with status 0: `accessKey.limits` or
         *     `accessKey.scopes` is empty. The call throws before the request that carries the
         *     access key.
         *   - `duplicate_scope` or `invalid_recipients` with status 0: Two `accessKey.scopes`
         *     name one call on a target, or `spenders` or a scope's `recipients` hold the zero
         *     address or a repeated address. The call throws before the request that carries the
         *     access key.
         *   - `expiry_exceeds_maximum`, `limit_exceeds_maximum`: The access key exceeds the
         *     headless
         *     [ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling).
         *     On a page, an app with `tempo-id:sign` has no ceiling.
         *   - `access_key_pending`: The access key has a key authorization with other limits or
         *     scopes, which the chain has not registered. Send a new access key.
         *   - `challenge_not_permitted`: The app sent a `challenge` without the `tempo-id:sign`
         *     scope.
         * @throws {Accounts.RequestError} On a page, when Tempo ID refuses the authorization. The
         *   user is signed in, and `signedIn` is `true`.
         *   - `foreign_account`: The access key names a Tempo Account that is not the user's.
         *   - `rejected`: The user holds no Tempo Account, and the app's first realm creates none.
         *   - `upgrade_required`: The call cannot run a passkey ceremony, and the access key waits
         *     for a wallet.tempo passkey's upgrade. For a user without an account,
         *     `meta.credentialId` names the email's passkey.
         *   - `session_changed`: Only from a server that returns no authorization with the sign-in.
         *     Another sign-in replaced the session after this one verified. Sign in again.
         *   - `webauthn_required`: A passkey owns the Tempo Account, and the call cannot run its
         *     ceremony. There is no browser or `getFn`, the passkey's relying party does not cover
         *     the page, or the ceremony failed, such as when the user dismisses the prompt. A
         *     failed ceremony's error is the `cause`. Sign in through `redirect.signIn`.
         *   - `webauthn_rejected`: The assertion of the passkey step did not verify, or was spent
         *     before.
         * @throws {Accounts.RequestError} On a backend, when Tempo ID refuses the access key. It
         *   returns the key rule, negative limit, empty limits or scopes, headless ceiling, and
         *   `challenge_not_permitted` refusals of the authorization request, and these `reason`
         *   values:
         *   - `foreign_account`: The access key names an account that is not the user's.
         *   - `webauthn_required`: A passkey owns the access key's account, and no page signs its
         *     access key.
         *   - `rejected`: No account can sign the access key, or the app has no redirect URI.
         * @throws {Accounts.RequestError} When the registration of a new user's passkey account
         *   fails. The user is signed in without an account, and `signedIn` is `true`. If a
         *   ceremony failed, `passkey.register` of the `passkey` plugin, with `accessKey`,
         *   creates the passkey and the account, with no new code. Pass it the sign-in's
         *   `challenge` and the plugin's `createFn`, which it does not read from this plugin.
         *   - `server_error` with status 0: The creation or proof ceremony failed, such as when the
         *     user dismisses the prompt.
         *   - `passkey_limit`, `passkey_not_permitted`, `webauthn_rejected`: Tempo ID refused the
         *     registration, as for `passkey.register`.
         *   - `session_changed`: The registration signed in another user than the code's.
         * @throws {Accounts.RequestError} With `invalid_field`, `rate_limited`,
         *   `upstream_unavailable`, or `unexpected`, when a field is missing or malformed, or a
         *   retry later may succeed.
         * @throws {Accounts.RequestError} With `server_error` and `status` 0, when a request
         *   receives no response, such as offline. Before the code verifies, `signedIn` is `false`
         *   and the session does not change. The request may have spent the code, so if Tempo ID
         *   refuses it with `invalid_code`, request a new code.
         * @throws {Error} Named `AbortError`, when the user closes the prompt of the passkey that
         *   `link` names, or lets it time out. The code stays valid.
         * @throws {Authentication.SignFailedError} From `ox/webauthn`, when that ceremony fails
         *   otherwise. The code stays valid.
         * @throws {Accounts.SupersededError} When another sign-in or a sign-out completed while
         *   this sign-in was pending.
         * @throws {TypeError} On a page, when the instance's `store` has `json`, such as
         *   `Store.redis`, and the call generates an access key. The call throws before any
         *   request, so the code stays valid.
         *
         * @example
         * ```ts
         * const session = await accounts.email.signIn({ code, email: address })
         * if (session.accounts.length > 1) {
         *   const [, other] = session.accounts
         *   await accounts.authorize({ account: other!.address, passkey: true })
         * }
         * ```
         */
        async signIn(
          parameters: email.signIn.Parameters,
        ): Promise<email.signIn.ReturnType> {
          // The request names the instance's chain, so the stored selection loads first. A failed read
          // keeps the chain. The change starts at the call, so a sign-out after it overtakes it.
          const loading = context.chain.load().catch(() => undefined)
          const change = context.session.change({ loading })
          await loading
          const { challenge, code, link, userIp } = parameters
          const accessKey = SignIn.accessKey(context, parameters.accessKey, {
            account: parameters.account,
            challenge: challenge !== undefined,
          })
          // Without a Tempo Account, the sign-in reads none, so Tempo ID creates none on the read.
          const account = SignIn.withAccount(context, parameters)
          const getFn = options.getFn ?? config.getFn
          const { createFn } = options

          const result = await (async () => {
            if (backend) {
              // Only a backend calls these routes, so a page's bundle loads them on demand.
              const BackendEmail = await import('../actions/backend/email.js')
              return {
                ...(await BackendEmail.signIn(config, {
                  accessKey,
                  challenge,
                  code,
                  email: parameters.email,
                  userIp,
                })),
                upgradeAvailable: false,
              }
            }
            const chain = accessKey?.chainId ?? config.chainId
            const skipped = (unlisted.get(chain) ?? 0) > Date.now()
            const request = {
              accessKey,
              account,
              chainId: config.chainId,
              ...(skipped ? { chainListed: false as const } : {}),
              challenge,
              code,
              createFn,
              email: parameters.email,
              getFn,
              link,
              registration: parameters.registration,
            }
            const result = await EmailActions.signIn(config, request)
            // Only a refusal that Tempo ID returned starts the deadline. A sign-in that sent no chain
            // keeps it, so the refusal expires on time.
            if (
              !skipped &&
              'chainListed' in result &&
              result.chainListed === false
            )
              unlisted.set(chain, Date.now() + unlistedTtl)
            return result
          })().catch(change.fail)

          // The sign-in's own response holds the accounts. A browser sign-in without an access key
          // against a Tempo ID that predates them reads the account once. A refused read leaves the
          // session without the account, since the user is signed in.
          const userId = result.user.id
          const fallback = await (async () => {
            if (
              backend ||
              !account ||
              'account' in result ||
              'accessKey' in result
            )
              return undefined
            return await SignIn.account(config, { getFn, userId }).catch(
              () => undefined,
            )
          })()
          const session = SignIn.toSession(
            fallback ? { ...result, account: fallback } : result,
          )
          await change.commit(session)
          // A new user's passkey account and its access key stand, so the session holds them, and the
          // call reports the challenge's failure on its own, as `passkey.register` does.
          if ('challengeError' in result && result.challengeError)
            throw result.challengeError
          return {
            ...session,
            accounts:
              ('accounts' in result && result.accounts) ||
              (fallback ? [fallback] : []),
            ...('registration' in result && result.registration
              ? { registration: result.registration }
              : {}),
            upgradeAvailable: result.upgradeAvailable,
          }
        },
      }
    },
    // The instance's `getFn` also runs the ceremonies of a restored session's account.
    config: () => (options.getFn ? { getFn: options.getFn } : {}),
    id: 'email',
  })
}

export declare namespace email {
  type Options = {
    /**
     * Runs the creation ceremony of a new user's passkey account in place of
     * `navigator.credentials.create`.
     */
    createFn?: EmailActions.signIn.Options['createFn'] | undefined
    /**
     * Runs the ceremony of the passkey that a sign-in's `link` names, of the passkey that owns the
     * account, or of a new user's passkey account's proof, in place of `navigator.credentials.get`.
     */
    getFn?: Api.tempoAccount.Options['getFn'] | undefined
  }

  namespace sendCode {
    /** The parameters of a backend's request, or of a page's. */
    type Parameters = Backend | Page

    /** The parameters on a backend, which an instance with `clientSecret` or `clientAssertion` is. */
    type Backend = Shared & {
      /** The end user's IP address, which rate limits count in place of the backend's. */
      userIp?: string | undefined
    }

    /** The parameters on the app's page. */
    type Page = Shared & {
      userIp?: undefined
    }

    /** The parameters of both modes. */
    type Shared = {
      /** The user's email address. */
      email: string
    }
  }

  namespace signIn {
    /**
     * The parameters of a backend's sign-in, or of a page's. A call that mixes the two sets does
     * not compile. The instance's `clientSecret` or `clientAssertion` selects the mode at run time.
     */
    type Parameters = Backend | Page

    /** The parameters on a backend, which an instance with `clientSecret` or `clientAssertion` is. */
    type Backend = Shared & {
      link?: undefined
      registration?: undefined
      /** The end user's IP address, which rate limits count in place of the backend's. */
      userIp?: string | undefined
    }

    /** The parameters on the app's page. */
    type Page = Shared & {
      /**
       * The `link` from the email step of `passkey.signIn`, which links that passkey to the user.
       * The call first runs the passkey's ceremony. If the ceremony fails or the link expires, the
       * code stays valid, so call again without `link`.
       */
      link?: string | undefined
      /**
       * Whether to return passkey registration options as `registration`, in the same request as
       * the sign-in, which `passkey.register` takes. Defaults to `false`.
       */
      registration?: boolean | undefined
      userIp?: undefined
    }

    /** The parameters of both modes. */
    type Shared = SignIn.AccountOption<SignIn.AccessKeyOption_external> & {
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
       * authorization's `witness` binds that hash, and the signature is the key authorization's, a
       * new user's passkey account's too. A sign-in on the app's page needs the `tempo-id:sign`
       * scope.
       */
      challenge?: string | undefined
      /**
       * The 6-digit code that Tempo ID emailed. The call drops each character other than a digit,
       * such as the spaces of a pasted code.
       */
      code: string
      /** The address that received the code. */
      email: string
    }

    type ReturnType = Session.Session & {
      /**
       * Every Tempo Account of the user in the app's realms, on the instance's chain: the session's
       * account first, then oldest first. Empty on a backend, and where the session holds no account.
       * The access key acts for the first account. With more than one, the app asks the user, then
       * calls `accounts.authorize` with the chosen `account`.
       */
      accounts: readonly TempoAccount.TempoAccount[]
      /**
       * The options of a passkey registration, for `passkey.register`'s `registration`, which save
       * its options request. Absent without `registration`, and where the options request would
       * refuse them.
       */
      registration?: EmailActions.signIn.ReturnType['registration']
      /**
       * Whether the account is a wallet.tempo passkey's that waits for its upgrade on the access key's
       * chain. `account.upgrade` runs the upgrade.
       */
      upgradeAvailable: boolean
    }
  }
}
