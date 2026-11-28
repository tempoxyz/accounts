/**
 * Tempo ID's actions outside a sign-in flow, each of which takes an instance from `Accounts.create`:
 * `authorize`, `fetch`, `refresh`, and `signOut`. `accounts/internal` exports them under `Actions`,
 * beside the actions of each flow.
 * @module
 */
import type { Authentication } from 'ox/webauthn'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from './Authorization.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'
import * as ClientId from './ClientId.js'
import * as Headless from './Headless.js'
import { permissions, request } from './Request.js'
import type { ChainId, HasAccessKey, WithAccount } from '../Permissions.js'
import type * as TempoAccount from './TempoAccount.js'
import type { Tokens } from './Tokens.js'

/**
 * Authorizes a first-party app for a user already signed in to Tempo ID, from a page on a redirect
 * URI's origin. Returns `undefined` without a session. The access key must fit the headless ceiling.
 * An access key with empty limits or scopes, a passed expiry, a negative limit, or a malformed
 * `publicKey` throws before any request, also without a session.
 *
 * With an access key, a user without a Tempo Account in the app's realms receives a first one in the app's
 * first realm. Another app, or a user whose first realm creates no account, receives `rejected`. A
 * third-party client ID, such as an origin, receives `rejected` before any authorization request.
 * With `passkey`, a passkey that owns the account signs the access key on the page, so call it from a
 * click. Without it, or when the passkey's relying party does not cover the page, the account
 * throws `webauthn_required`, so authorize through `Actions.redirect.start`. With `passkey`, a
 * wallet.tempo passkey's account that waits for its upgrade signs the access key as the passkey's own
 * account, and `upgradeAvailable` is `true`. `Actions.account.upgrade` with the access key then upgrades
 * it. Without `passkey`, such an account throws `upgrade_required`.
 *
 * @example
 * ```ts
 * const result = await Actions.authorize(auth)
 * if (!result) showSignIn()
 * ```
 */
export async function authorize<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: authorize.Options<accessKey> = {},
): Promise<authorize.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const { accessKey } = options
  // Tempo ID refuses a headless authorization of a third-party app, whose page also has no CORS
  // grant for the browser's session, so the request could only fail.
  if (ClientId.thirdParty(auth.clientId))
    throw new RequestError({
      code: 'invalid_request',
      // A CLI has no browser window or redirect URI, so it signs in through the device grant.
      message: `Headless authorization refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with ${ClientId.cli(auth.clientId) ? '`device.signIn`' : '`dialog.signIn` or `redirect.signIn`'}.`,
      reason: 'rejected',
      status: 400,
    })
  // An access key that Tempo ID would refuse throws before the session check, so a visitor without
  // a session receives the refusal too, and no request goes out. Only the generation of a new access
  // key waits for the check.
  if (accessKey) {
    permissions(auth, { accessKey })
    AccessKey.own(accessKey)
  }
  // A request without a response, such as offline, throws `server_error` with status 0, so the
  // app tells it from a refusal and retries.
  const answered = Api.answered(auth, {
    message:
      'The authorization received no response. Check the connection, then authorize again.',
  })
  // Checking the session first avoids a failed request for a visitor without one. The access key
  // generates during the check, so a signed-in user waits for no generation after it. Without the
  // check, the authorization's own `session_required` refusal returns no session.
  const [session, generated] = await Promise.all([
    (async () => {
      if (options.check === false) return { user: true }
      // React Native's `AbortSignal` has no `timeout`, so a timer aborts the controller. The timer
      // covers the response's body too. A check that it aborts throws as one without a response.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Api.sessionTimeout)
      try {
        return await Api.json<{ user: unknown }>(
          await answered.fetch!(new URL('/v1/auth/session', auth.url), {
            credentials: 'include',
            // A redirect would send the session cookie's request to another origin.
            redirect: 'manual',
            signal: controller.signal,
          }),
        )
      } finally {
        clearTimeout(timer)
      }
    })(),
    accessKey
      ? AccessKey.resolve(accessKey).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
      : undefined,
  ])
  // A visitor without a session needs no access key, so after the check a failed generation fails
  // only a sign-in. Without the check, a failed generation throws before any request.
  if (!session.user) return undefined
  if (generated && 'error' in generated) throw generated.error
  const resolved = generated?.value
  // With `passkey`, a passkey that owns the account signs the access key on the page. Tempo ID
  // issues the tokens during the request that returns them, so their lifetime counts from its start.
  const { response, sentAt } = await Headless.post(answered, {
    getFn: options.getFn,
    json: {
      ...request(auth, {
        accessKey: resolved &&
          accessKey && { ...accessKey, account: resolved.signer },
        account: options.account,
        challenge: options.challenge,
      }),
      // Without an access key, the chain names where the response lists the user's accounts. An
      // instance with `account: false` reads none, so the request asks for none.
      ...(resolved || auth.account === false ? {} : { chain_id: auth.chainId }),
    },
    passkey: options.passkey ?? false,
  })
  // Without the check, `session_required` means no session. With it, the session can end between
  // the two requests. Any other 401 throws its reason.
  if (response.status === 401) {
    const refused = (await response
      .clone()
      .json()
      .catch(() => ({}))) as Partial<Api.ErrorBody>
    if (refused.reason === 'session_required') return undefined
  }
  const body = await Api.json<Api.Headless>(response)
  const [first] = body.tempo ?? []
  // A refused response's refresh token is revoked, since no session holds it.
  const authorization = await Headless.revoking(auth, {
    body,
    fn: () =>
      resolved
        ? Api.authorization(body, {
            ...resolved,
            challenged: options.challenge !== undefined,
            sentAt,
          })
        : Api.withoutAccessKey(body, {
            challenged: options.challenge !== undefined,
            sentAt,
          }),
  })
  const result: Headless.Result & {
    account?: TempoAccount.TempoAccount | undefined
  } = {
    ...authorization,
    // The response lists the authorization's account first, so the app reads no
    // `GET /v1/account`. An account that the client cannot rebuild stays absent, so the session
    // holds the access key alone. Without an access key, a listed response with no account names
    // `account` as `undefined`, so the caller reads no account either.
    ...(() => {
      // A challenge names the chain that signs it, so Tempo ID lists the accounts also for an
      // instance with `account: false`, which reads none.
      if (!resolved && auth.account === false) return {}
      if (!first) return resolved || !body.tempo ? {} : { account: undefined }
      try {
        return {
          account: Api.tempoAccount(first, {
            getFn: options.getFn as Api.tempoAccount.Options['getFn'],
          }),
        }
      } catch {
        return {}
      }
    })(),
    upgradeAvailable: body.upgrade_available === true,
  }
  // `accessKey` decides both the type and the runtime value of the result.
  return result as authorize.ReturnType<
    ChainId<accessKey>,
    HasAccessKey<accessKey>
  >
}

export declare namespace authorize {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key. Without it, the call authorizes no access key. Within the
     * headless ceiling, unless the app holds `tempo-id:sign`.
     */
    accessKey?: accessKey
    /**
     * The Tempo Account the access key acts for, in place of `accessKey.account`'s `access`, such as
     * one from `Actions.account.get`. It becomes the app's account for later requests that name none.
     */
    account?: `0x${string}` | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /**
     * Whether the call reads `GET /v1/auth/session` before the authorization, so a visitor without
     * a Tempo ID session receives no refusal. With `false`, the authorization is the only request,
     * and Tempo ID's `session_required` refusal returns `undefined`. Use `false` where the user
     * most likely holds the session, such as at the renewal of an expired access key. Defaults to
     * `true`.
     */
    check?: boolean | undefined
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * Whether a passkey that owns the account signs the access key or the challenge on the page, with
     * `getFn` or `navigator.credentials.get`. The ceremony prompts the user, so the call needs a click.
     * Defaults to `false`.
     */
    passkey?: boolean | undefined
  }

  /**
   * The authorization, without its access key for a call without `accessKey`, and whether its account
   * can upgrade. `undefined` without a session.
   */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > =
    | ((hasAccessKey extends false
        ? Omit<Authorization<chainId>, 'accessKey' | 'signer'>
        : Authorization<chainId>) & {
        /**
         * The user's Tempo Account that the authorization acts for, as Tempo ID lists it on the
         * access key's chain, else on the instance's chain. Absent where Tempo ID lists no accounts,
         * and without an access key on an instance with `account: false`, which reads none.
         * Without an access key, `undefined` for a user whom Tempo ID lists with no account.
         */
        account?: TempoAccount.TempoAccount | undefined
        /**
         * Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the
         * access key's chain. `Actions.account.upgrade` with the access key upgrades it, and keeps the access key.
         */
        upgradeAvailable: boolean
      })
    | undefined
}

/**
 * Sends a request with an access token, such as to the app's API. A DPoP token goes with the `DPoP`
 * scheme and a new proof of the instance's `dpop` key for the request's method and URL. Any other
 * token goes as a Bearer token. Calls the instance's `fetch`. Throws `invalid_dpop_proof`, and
 * sends no request, for a DPoP token that the instance's key does not bind, or without a key.
 *
 * @example
 * ```ts
 * const response = await Actions.fetch(auth, {
 *   accessToken: tokens.accessToken,
 *   url: 'https://api.example.com/me',
 * })
 * ```
 */
export async function fetch(
  auth: Config,
  options: fetch.Options,
): Promise<Response> {
  const { accessToken, init = {} } = options
  // A relative URL resolves against the page, as `fetch` resolves it, so the proof names the URL
  // that the request reaches. Only a relative URL reads `location`, whose getter throws in Deno
  // without `--location`.
  const url = (() => {
    // Outside a page, such as in React Native or Node, no URL resolves a relative one. The check
    // reads the scheme before `location` and before any parse, since React Native's own `URL`
    // accepts a relative URL. As the URL parser does, it drops every tab and newline, and skips
    // leading C0 controls and spaces.
    const text = String(options.url).replace(/[\t\n\r]/g, '')
    let index = 0
    while (text.charCodeAt(index) <= 0x20) index++
    if (!/^[a-z][a-z\d+.-]*:/i.test(text.slice(index))) {
      const base = page()
      // The message never names the URL: its userinfo, query, or fragment can hold a token, and an
      // app shows or logs the message.
      if (base === undefined)
        throw new TypeError(
          'Invalid URL: the URL is relative, and no page resolves it. Pass an absolute URL.',
        )
      return new URL(options.url, base)
    }
    try {
      return new URL(options.url)
    } catch {
      // Outside a page, a malformed URL with a scheme throws its own error. The parse error holds
      // the whole URL in `input`, so the error replaces it and never names the URL.
      const base = page()
      if (base === undefined)
        throw new TypeError(
          'Invalid URL: the URL is malformed. Pass a valid absolute URL.',
        )
      return new URL(options.url, base)
    }
  })()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = Api.requestHeaders(init.headers, {
    tokenHeaders: await Api.tokenHeaders(auth, { accessToken, method, url }),
  })
  return (auth.fetch ?? globalThis.fetch)(url, { ...init, headers, method })
}

export declare namespace fetch {
  type Options = Parameters & {
    /** The access token, from any sign-in or refresh. */
    accessToken: string
  }

  type Parameters = {
    /**
     * The request's other options, such as `method` and `body`. It keeps its other headers, and
     * its `Authorization` and `DPoP` headers are replaced.
     */
    init?: RequestInit | undefined
    /**
     * The request's URL. A relative URL resolves against the page's URL, as `fetch` resolves it.
     * Outside a page, such as in React Native, a relative URL throws a `TypeError`.
     */
    url: string | URL
  }
}

/** Milliseconds before {@link refresh} sends a refused refresh again. */
const refreshRetryDelay = 1000

/**
 * Exchanges a refresh token for new tokens. Refresh tokens rotate, so store the new one.
 *
 * Two refreshes with one refresh token within 30 seconds return the same tokens. A refresh that
 * overlaps another one fails with `invalid_grant` until the other one returns, so this action
 * sends a refused refresh once more after one second.
 * A refresh without a response, such as offline, throws `Accounts.RequestError` with status 0.
 *
 * @example
 * ```ts
 * const tokens = await Actions.refresh(auth, {
 *   refreshToken: saved.refreshToken,
 * })
 * ```
 */
export async function refresh(
  auth: Config,
  options: refresh.Options,
): Promise<Tokens> {
  const send = () => Api.refresh(auth, options)

  try {
    return await send()
  } catch (error) {
    if (!(error instanceof RequestError) || error.code !== 'invalid_grant')
      throw error
    // The other refresh rotated the token, and stores its response for the retry to replay. A
    // retry of a revoked or expired token fails the same way, and revokes nothing more.
    await new Promise((resolve) => setTimeout(resolve, refreshRetryDelay))
    return await send()
  }
}

export declare namespace refresh {
  type Options = {
    /** The latest refresh token. */
    refreshToken: string
  }
}

/**
 * Ends the user's Tempo ID session, which signs the user out of every app that relies on it.
 *
 * @example
 * ```ts
 * await Actions.signOut(auth)
 * ```
 */
export async function signOut(auth: Config): Promise<void> {
  // A JSON body keeps the request out of Tempo ID's CSRF check for cross-site form posts.
  await Api.json(await Api.post(auth, '/v1/auth/logout', { json: {} }))
}

/**
 * Returns the page's URL, or `undefined` outside a page. A `location` getter that throws, as in
 * Deno without `--location`, counts as no page.
 */
function page(): string | undefined {
  try {
    return globalThis.location?.href
  } catch {
    return undefined
  }
}
