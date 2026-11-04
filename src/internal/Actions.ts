/**
 * Tempo ID's actions, each of which takes an instance from `Accounts.create`.
 * @module
 */
import type { Authentication } from 'ox/webauthn'
import {
  type Config,
  ChallengeWithoutKeyError,
  RequestError,
} from '../Accounts.js'
import type { Authorization } from './Authorization.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'
import * as Headless from './Headless.js'
import { request } from './Request.js'
import type { ChainId, Keyed, WithAccount } from '../Permissions.js'
import type * as TempoAccount from './TempoAccount.js'
import type { Tokens } from './Tokens.js'

export * as account from '../actions/account.js'
export * as backend from '../actions/backend.js'
export * as device from '../actions/device.js'
export * as dialog from '../actions/dialog.js'
export * as email from '../actions/email.js'
export * as funding from '../actions/funding.js'
export * as oauth from '../actions/oauth.js'
export * as passkey from '../actions/passkey.js'
export * as realm from '../actions/realm.js'
export * as redirect from '../actions/redirect.js'

/**
 * Authorizes a first-party app for a user already signed in to Tempo ID, from a page on a redirect
 * URI's origin. Returns `undefined` without a session. The access key must fit the headless ceiling.
 *
 * With an access key, a user without a Tempo Account in the app's realms receives a first one in the app's
 * first realm. Another app, or a user whose first realm creates no account, receives `rejected`.
 * With `passkey`, a passkey that owns the account signs the access key on the page, so call it from a
 * click. Without it, or when the passkey's relying party does not cover the page, the account
 * throws `webauthn_required`, so authorize through `Actions.redirect.start`. With `passkey`, a
 * wallet.tempo passkey's account that waits for its upgrade signs the access key as the passkey's own
 * account, and `upgradeAvailable` is `true`. `Actions.account.upgrade` with the access key then upgrades
 * it. Without `passkey`, such an account throws `upgrade_required`. An access key above the headless ceiling
 * throws `reauthentication_required` when the user signed in more than 10 minutes before.
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
): Promise<authorize.ReturnType<ChainId<accessKey>, Keyed<accessKey>>> {
  const { accessKey } = options
  // A challenge rides in the access key, so a call without one refuses it before any request.
  if (!accessKey && options.challenge !== undefined)
    throw new ChallengeWithoutKeyError()

  // Checking the session first avoids a failed request for a visitor without one. The access key
  // generates during the check, so a signed-in user waits for no generation after it.
  const [session, generated] = await Promise.all([
    (async () =>
      Api.json<{ user: unknown }>(
        await (auth.fetch ?? globalThis.fetch)(
          new URL('/v1/auth/session', auth.url),
          {
            credentials: 'include',
          },
        ),
      ))(),
    accessKey
      ? AccessKey.resolve(accessKey).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
      : undefined,
  ])
  // A visitor without a session needs no access key, so a failed generation fails only a sign-in.
  if (!session.user) return undefined
  if (generated && 'error' in generated) throw generated.error
  const key = generated?.value
  // With `passkey`, a passkey that owns the account signs the access key on the page.
  const response = await Headless.post(auth, {
    getFn: options.getFn,
    json: request(auth, {
      accessKey: key && accessKey && { ...accessKey, account: key.accessKey },
      account: options.account,
      challenge: options.challenge,
    }),
    passkey: options.passkey ?? false,
  })
  // The session can end between the two requests. Any other 401 throws its reason.
  if (response.status === 401) {
    const refused = (await response
      .clone()
      .json()
      .catch(() => ({}))) as Partial<Api.ErrorBody>
    if (refused.reason === 'session_required') return undefined
  }
  const body = await Api.json<Api.Headless>(response)
  const [first] = body.tempo ?? []
  const result: Headless.Result & { account?: TempoAccount.TempoAccount } = {
    ...(key ? Api.authorization(body, key) : Api.withoutKey(body)),
    // The response lists the access key's account first, so the app reads no `GET /v1/account`.
    // An account that the client cannot rebuild stays absent, so the session holds the access key alone.
    ...(key && first
      ? (() => {
          try {
            return {
              account: Api.tempoAccount(first, {
                getFn: options.getFn as Api.tempoAccount.Options['getFn'],
              }),
            }
          } catch {
            return {}
          }
        })()
      : {}),
    upgradeAvailable: body.upgrade_available === true,
  }
  // `accessKey` decides both the type and the runtime value of the result.
  return result as authorize.ReturnType<ChainId<accessKey>, Keyed<accessKey>>
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
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope and an access key.
     */
    challenge?: ([accessKey] extends [undefined] ? never : string) | undefined
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * Whether a passkey that owns the account signs the access key on the page, with `getFn` or
     * `navigator.credentials.get`. The ceremony prompts the user, so the call needs a click.
     * Defaults to `false`.
     */
    passkey?: ([accessKey] extends [undefined] ? never : boolean) | undefined
  }

  /**
   * The authorization, without its access key for a call without `accessKey`, and whether its account
   * can upgrade. `undefined` without a session.
   */
  type ReturnType<
    chainId extends number = number,
    key extends boolean = false,
  > =
    | ((key extends false
        ? Omit<Authorization<chainId>, 'accessKey' | 'key'>
        : Authorization<chainId>) & {
        /**
         * The user's Tempo Account that the access key acts for, as Tempo ID lists it on the access
         * key's chain. Absent without an access key, or where Tempo ID returns no accounts.
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
 * Sends a request with an access token, such as to the app's API. A DPoP token from an instance
 * with a `dpop` key goes with the `DPoP` scheme and a new proof for the request's
 * method and URL. Any other token goes as a Bearer token. Calls the instance's `fetch`.
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
    try {
      return new URL(options.url)
    } catch {
      return new URL(options.url, globalThis.location.href)
    }
  })()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(
    await Api.tokenHeaders(auth, { accessToken, method, url }),
  ))
    headers.set(name, value)
  return (auth.fetch ?? globalThis.fetch)(url, { ...init, headers, method })
}

export declare namespace fetch {
  type Options = {
    /** The access token, from any sign-in or refresh. */
    accessToken: string
    /** The request's other options, such as `method` and `body`. Its `Authorization` and `DPoP` headers are replaced. */
    init?: RequestInit | undefined
    /** The request's URL. A relative URL resolves against the page's URL, as `fetch` resolves it. */
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
  const send = async () =>
    Api.tokens(
      await Api.token(auth, {
        grant_type: 'refresh_token',
        refresh_token: options.refreshToken,
      }),
    )

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
