/**
 * Signs the user in on Tempo ID's pages, which redirect back with a code. `start` and `complete`
 * keep the redirect's state in `store`, and, with the default store, its PKCE verifier in the
 * tab's `sessionStorage` too. `createUrl` and `handleCallback` leave it to the app.
 * @module
 */
import {
  type Config,
  RedirectUriRequiredError,
  RequestError,
} from '../Accounts.js'
import type * as Authorization_ from '../internal/Authorization.js'
import type { Authorization } from '../internal/Authorization.js'
import type * as Funding from '../internal/Funding.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Api from '../internal/Api.js'
import * as Callback from '../internal/Callback.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import { authorizeUrl } from '../internal/Request.js'
import * as Verifier from '../internal/Verifier.js'
import type * as Pending from '../internal/Pending.js'
import type {
  Addressed,
  HasAccessKey,
  WithAccount,
  WithAddress,
} from '../Permissions.js'

/**
 * Finishes a {@link start} when the page loads with Tempo ID's callback, and returns `undefined`
 * otherwise. It redeems the code once, however often the page calls it. With the default store,
 * it sends the code exchange at once, from the tab's copy of the verifier, before IndexedDB returns
 * the rest of the redirect's state. It removes the redirect's state beside the code exchange, and a
 * failed removal rejects. A callback that denies the
 * redirect, such as `error=access_denied`, throws a `RequestError` with that `code` and status 0.
 * The result carries an access key when `start` received `accessKey`.
 *
 * If the tab redeemed its code and `store` holds no state of the redirect, such as after another
 * tab completed it, it revokes the code's refresh token and throws a `RequestError` with
 * `invalid_request` and `signedIn`. If the tab started the redirect with a custom `store` that holds
 * no state of it, such as one that expired the state, it redeems nothing, and throws a
 * `RequestError` with `invalid_request` and the `field` `state`. A callback that the tab did not
 * start, such as a crafted link, returns `undefined`. A failure of the token response after the
 * code exchange has `signedIn` too, and revokes the response's refresh token before it throws.
 *
 * @example
 * ```ts
 * const authorization =
 *   (await Actions.redirect.complete(auth)) ??
 *   (await Actions.authorize(auth))
 * ```
 */
export function complete(
  auth: Config,
  options: complete.Options = {},
): Promise<complete.ReturnType> {
  // Instances that differ in their app, chain, or Tempo ID deployment each complete their own redirect.
  const owner = `${auth.clientId}:${auth.chainId}:${Verifier.issuerOf(auth)}`
  const store = DefaultStore.get(auth.store)!
  let results = completed.get(store)
  if (!results) completed.set(store, (results = new Map()))
  const pending = results.get(owner)
  if (pending) return pending
  const result = (async () => {
    const url = new URL(window.location.href)
    // The tab's ticket starts the code exchange before the store's first read, which waits behind
    // the page's first tasks. It runs only for this page's own redirect.
    const ticket = Verifier.take(auth)
    // With a custom `store`, the tab keeps only the redirect's `state`, which shows that this tab
    // started the redirect of the callback.
    const started = Verifier.started(auth, {
      state: url.searchParams.getAll('state').at(-1),
    })
    const early =
      ticket &&
      url.searchParams.has('code') &&
      url.searchParams.get('state') === ticket.state
        ? redeem(auth, { pending: ticket, url })
        : undefined
    // A refusal surfaces from the await below, after the checks of the stored redirect.
    early?.catch(() => undefined)
    // The callback's last `state` is the authorization response's, and names its redirect's entry.
    const state = url.searchParams.getAll('state').at(-1)
    const entry = await (async () => {
      if (state === undefined) return undefined
      const key = storeKey(state)
      // The tab's mark shows that the redirect is this instance's own, so a store with `takeItem`,
      // such as `Store.redis`, takes its entry in the read. Of tabs that return from one redirect at
      // once, such as a duplicated tab, only one receives it and redeems the code. The mark holds the
      // redirect's selected chain, so an instance on another selected chain leaves the entry.
      if (started && store.takeItem && Verifier.owns(auth, started)) {
        const value = (await store.takeItem(key)) as Stored
        if (value != null) return { key, taken: true, value }
      } else {
        const value = (await store.getItem(key)) as Stored
        if (value != null) return { key, taken: false, value }
      }
      // A redirect without an entry of its own keeps its state under the shared key.
      const legacy = (await store.getItem(legacyStoreKey)) as Stored
      if (legacy?.state === state)
        return { key: legacyStoreKey, taken: false, value: legacy }
      return undefined
    })()
      .then(async (found) => {
        if (found === undefined || !outdated(auth, found.value)) return found
        // A redirect of an earlier version names no Tempo ID deployment, so no instance redeems its
        // code. Its entry is removed, and its callback still clears and throws, so its sign-in starts
        // again.
        if (!found.taken) await store.removeItem(found.key)
        return found
      })
      .catch(async (error: unknown) => {
        // The early exchange may have issued tokens that no session will hold.
        await discard(auth, early)
        throw error
      })
    const legacy = entry !== undefined && outdated(auth, entry.value)
    const stored = legacy ? undefined : entry?.value
    // A registered redirect URI may hold its own `error`, which the app keeps. Only an `error` that
    // the callback added after it belongs to the authorization response.
    // Without the redirect's state, the tab's mark, or else the instance's `redirectUri`, names the
    // registered parameters.
    const redirectUri =
      entry?.value.redirectUri ??
      ticket?.redirectUri ??
      started?.redirectUri ??
      auth.redirectUri ??
      url.origin
    const registered = new URL(redirectUri).searchParams
    // Another instance of the page, such as one of another app, completes its own redirect.
    if (stored != null && !Verifier.owns(auth, stored)) return undefined
    // A custom `store` may return `null` for a missing item.
    const ours = stored != null && state === stored.state
    // A callback of a redirect that this tab started, whose state the store lost, is this page's own
    // too. A crafted link carries no such mark.
    const mine =
      ours ||
      legacy ||
      started !== undefined ||
      (ticket !== undefined && ticket.state === state)
    // The code exchange reads nothing of the removal, so both run in one round. The entry holds the
    // material of the access key that the exchange authorizes, so a failed removal fails the sign-in.
    // The function wraps a store's synchronous return or throw in the promise.
    const removed =
      ours && entry && !entry.taken
        ? (async () => store.removeItem(entry.key))()
        : undefined
    // Each await below surfaces a failed removal. A removal that fails after a refused exchange
    // rejects into this handler, not unhandled.
    removed?.catch(() => undefined)
    // The app keeps its own query and fragment, without the callback's parameters, which include the
    // issuer's `iss` (RFC 9207). A code this page did not request is dropped too, since it redeems for
    // whoever crafted its request. A page that is no callback of this page keeps its own `state` and
    // `error` parameters.
    const callback = [
      'code',
      'error',
      'error_description',
      'error_uri',
      'iss',
      'state',
    ]
    if (mine || url.searchParams.has('code')) {
      const clean = new URL(url)
      for (const name of callback) {
        clean.searchParams.delete(name)
        for (const value of registered.getAll(name))
          clean.searchParams.append(name, value)
      }
      window.history.replaceState(
        null,
        '',
        clean.pathname + clean.search + clean.hash,
      )
    }

    // A denial of this page's redirect throws, so the app never mistakes it for a page load
    // without a callback and authorizes another way.
    const error = Callback.error(url, { redirectUri })
    if (mine && error) {
      await removed
      throw error
    }
    if (!url.searchParams.has('code') || !stored) {
      await removed
      // The code of a redirect of an earlier version stays unredeemed, so the app signs in again.
      if (legacy && url.searchParams.has('code')) {
        await discard(auth, early)
        throw new RequestError({
          code: 'invalid_request',
          field: 'state',
          message:
            'Expired sign-in: the redirect started with an earlier version of the package, which names no Tempo ID deployment. Start sign-in again.',
          status: 400,
        })
      }
      // A callback of a redirect that this tab started, whose state the store lost, such as a store
      // in memory that the page load emptied, is a sign-in that no session keeps. A crafted link
      // carries no such mark. The code stays unredeemed, so the session stays as it was.
      if (
        started !== undefined &&
        stored == null &&
        url.searchParams.has('code')
      )
        throw new RequestError({
          code: 'invalid_request',
          field: 'state',
          message:
            'Missing sign-in: the store holds no state of this redirect, or it expired. Keep the state in a store that persists across page loads, and start sign-in again.',
          status: 400,
        })
      if (!early) return undefined
      // A refused exchange issued no tokens, such as one of a code that another tab redeemed, so the
      // page stays one without a callback, and the session of that tab stays.
      const body = await early.catch(() => undefined)
      if (!body) return undefined
      // The tab's ticket redeemed the code of a redirect whose state the store holds no more, such
      // as one that another tab completed. The user signed in, and no session keeps the tokens, so
      // the sign-in fails after the sign-in. It fails also when the revocation does, and its refusal
      // names the fault.
      if (body.refresh_token)
        await Api.revoke(auth, { refreshToken: body.refresh_token }).catch(
          () => undefined,
        )
      throw new RequestError({
        code: 'invalid_request',
        message:
          'Missing sign-in: the store holds no state of this redirect, or it expired. Start sign-in again.',
        signedIn: true,
        status: 400,
      })
    }
    const exchange =
      ours && early ? early : redeem(auth, { pending: stored, url })
    // A failed removal surfaces first, below, so a refused exchange is not unhandled meanwhile.
    exchange.catch(() => undefined)
    // A failed removal fails the sign-in, so the exchange's tokens, which no session will hold, are
    // revoked.
    await removed?.catch(async (error: unknown) => {
      await discard(auth, exchange)
      throw error
    })
    const body = await exchange
    // `start` takes only the app's own access key, so the result holds `accessKey`.
    return (await finish_revoke(auth, {
      accessKey: options.accessKey,
      body,
      pending: stored,
    })) as handleCallback.WithoutAccessKey | Authorization
  })()
  results.set(owner, result)
  return result
}

export declare namespace complete {
  type Options = {
    /**
     * The access key that the app passed to {@link start}, if any, of which only `account` is read,
     * to rebuild the app's own access key.
     */
    accessKey?: AccessKey.own.Options | undefined
  }

  /**
   * The authorization, with its access key when `start` received `accessKey`. `undefined` when the page
   * is not a redirect's callback.
   */
  type ReturnType = handleCallback.WithoutAccessKey | Authorization | undefined
}

/**
 * Returns the authorization URL, `/oauth2/authorize`, which redirects to Tempo ID's sign-in or
 * approval page, and the `Pending` state to keep until the callback. {@link handleCallback} redeems
 * the code. With `par`, which an instance with a client secret or a client assertion sets by
 * default, it first pushes the request to `/oauth2/par`, and the URL holds only `client_id` and
 * `request_uri`.
 *
 * Throws a `RequestError` with status 0, before any request, for an access key without bounds,
 * which Tempo ID's page refuses: `missing_permissions` without `limits`, or with `scopes: 'any'`,
 * and `invalid_expiry` for `expiry: false`.
 *
 * @example
 * ```ts
 * const { pending, url } = await Actions.redirect.createUrl(auth, {
 *   redirectUri: 'https://app.example/auth/callback',
 * })
 * await seal(c, 'oauth', pending)
 * return c.redirect(url)
 * ```
 */
export async function createUrl<
  const accessKey extends WithAccount | WithAddress | undefined = undefined,
>(
  auth: Config,
  options: createUrl.Options<accessKey> = {},
): Promise<
  createUrl.ReturnType<HasAccessKey<accessKey>, Addressed<accessKey>>
> {
  // Tempo ID's page refuses an access key without bounds, and its callback names no `reason`, so
  // the request is refused before any navigation, with the reason of Tempo ID's refusal.
  if (options.accessKey) bounded(options.accessKey)
  // `accessKey` decides both the type and the runtime value of `pending`.
  return (await authorizeUrl(auth, options)) as createUrl.ReturnType<
    HasAccessKey<accessKey>,
    Addressed<accessKey>
  >
}

export declare namespace createUrl {
  type Options<
    accessKey extends WithAccount | WithAddress | undefined =
      | WithAccount
      | WithAddress
      | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key, whose material `pending` keeps. Its `access` names the Tempo
     * Account, which defaults to the one the user selects, or the user's oldest. With `address`, it
     * names an access key that another party holds, such as an MPP merchant's, and the result holds
     * no `accessKey`. Without it, the sign-in authorizes no access key. The user approves it, so it
     * may exceed the headless ceiling.
     */
    accessKey?: accessKey
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * Tempo ID's page shows the message, from any app, with or without an access key.
     */
    challenge?: string | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /**
     * The address that Tempo ID's sign-in page fills in its email field, as OpenID Connect's
     * `login_hint`, such as the saved session's when the browser's Tempo ID session expired. The
     * field stays editable.
     */
    loginHint?: string | undefined
    /**
     * `login` requests a new sign-in of a user whom the browser holds signed in, with the email field
     * filled. Absent, Tempo ID reuses the browser's session.
     */
    prompt?: 'login' | undefined
    /** Defaults to the instance's `redirectUri`, or the page's origin. */
    redirectUri?: string | undefined
    /**
     * The registered resources (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`.
     * Each access token names them as `aud`, and the code's redemption names none, so it receives
     * them all. Defaults to the instance's `resource`, or else Tempo ID's origin. A pushed request
     * names at most one. An unknown or disabled resource fails with `invalid_target`.
     */
    resource?: Config['resource']
  }

  type ReturnType<
    hasAccessKey extends boolean = false,
    addressed extends boolean = false,
  > = {
    /** What to keep until the callback, such as in a sealed cookie. */
    pending: hasAccessKey extends false
      ? Pending.WithoutAccessKey
      : addressed extends true
        ? Pending.Addressed
        : Pending.Pending
    /** Where to send the browser. */
    url: string
  }
}

/**
 * Checks the callback's `state`, and redeems its code for the authorization. Throws a
 * `RequestError` for a URL that is not a valid absolute URL, a forged `state`, a callback without a `code`,
 * or a refused code. If it refuses the token response of a redeemed code, such as one without a key
 * authorization, it revokes the response's refresh token before it throws. An exchange without a
 * response, such as offline, throws `server_error` with status 0 and `signedIn`. A fault before the
 * request, such as in the client assertion or the DPoP proof, throws `server_error` with status 0,
 * `signedIn`, and the fault as its `cause`. Its message names the client assertion and the DPoP key.
 *
 * @example
 * ```ts
 * const authorization = await Actions.redirect.handleCallback(auth, {
 *   pending: await unseal(c, 'oauth'),
 *   url: c.req.url,
 * })
 * ```
 */
export async function handleCallback<
  const pending extends
    | Pending.Addressed
    | Pending.Pending
    | Pending.WithoutAccessKey = Pending.Pending,
  const accessKey extends handleCallback.Supplied | undefined = undefined,
>(
  auth: Config,
  options: handleCallback.Options<pending, accessKey>,
): Promise<handleCallback.ReturnType<pending, accessKey>> {
  return (await finish_revoke(auth, {
    accessKey: options.accessKey,
    body: await redeem(auth, {
      pending: options.pending,
      url: Callback.url(options.url),
    }),
    pending: options.pending,
  })) as handleCallback.ReturnType<pending, accessKey>
}

/**
 * Completes a sign-in in the web message mode with `authorization`, the token response of the code
 * that Tempo ID redeemed, which its page posted in place of the callback URL. Throws on a `state`
 * that is not the pending sign-in's, and on a posted object that holds no token response. Each
 * failure of the posted object after the `state` check has `signedIn`, since the user signed in on
 * Tempo ID's pages.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const session = Actions.redirect.handleResult({
 *   authorization: event.data.authorization,
 *   pending,
 *   state: event.data.state,
 * })
 * ```
 */
export function handleResult<
  const pending extends
    | Pending.Addressed
    | Pending.Pending
    | Pending.WithoutAccessKey = Pending.Pending,
  const accessKey extends handleCallback.Supplied | undefined = undefined,
>(
  options: handleResult.Options<pending, accessKey>,
): handleCallback.ReturnType<pending, accessKey> {
  if (options.state !== options.pending.state)
    throw new RequestError({
      code: 'invalid_request',
      field: 'state',
      message:
        'Invalid `state` in the posted authorization. Start sign-in again from this app.',
      status: 400,
    })
  const { authorization } = options
  // The page posts what Tempo ID's redemption returned, so a refusal or a partial response fails
  // here, as the page's own redemption would. The user signed in on Tempo ID's pages either way.
  if (typeof authorization.error === 'string')
    throw signedIn(
      Api.error(authorization as Partial<Api.ErrorBody>, { status: 400 }),
    )
  if (
    typeof authorization.access_token !== 'string' ||
    typeof authorization.expires_in !== 'number'
  )
    throw new RequestError({
      code: 'invalid_request',
      message:
        'Invalid posted authorization: it holds no token response. Start sign-in again from this app.',
      signedIn: true,
      status: 400,
    })
  return finish({
    accessKey: options.accessKey,
    body: authorization as Api.TokenResponse,
    pending: options.pending,
  }) as handleCallback.ReturnType<pending, accessKey>
}

export declare namespace handleResult {
  type Options<
    pending extends
      | Pending.Addressed
      | Pending.Pending
      | Pending.WithoutAccessKey = Pending.Pending,
    accessKey extends handleCallback.Supplied | undefined =
      | handleCallback.Supplied
      | undefined,
  > = {
    /**
     * The access key that the app passed to `createUrl`, if any, of which only `account` and
     * `address` are read.
     */
    accessKey?: accessKey | undefined
    /** The token response that Tempo ID's page posted. */
    authorization: Record<string, unknown>
    /** What `createUrl` returned to keep. */
    pending: pending
    /** The `state` that Tempo ID's page posted. */
    state: string | undefined
  }
}

export declare namespace handleCallback {
  type Options<
    pending extends
      | Pending.Addressed
      | Pending.Pending
      | Pending.WithoutAccessKey = Pending.Pending,
    accessKey extends Supplied | undefined = Supplied | undefined,
  > = {
    /**
     * The access key that the app passed to `createUrl`, if any, of which only `account` is read,
     * to rebuild the app's own access key, and `address`, which marks another party's.
     */
    accessKey?: accessKey | undefined
    /** What `createUrl` returned to keep. */
    pending: pending
    /** The absolute callback URL that Tempo ID redirected to, not only its path. */
    url: string | URL
  }

  /**
   * The authorization, without its access key for a `Pending.WithoutAccessKey`, and without
   * `accessKey` for an access key that another party holds.
   */
  type ReturnType<
    pending extends
      | Pending.Addressed
      | Pending.Pending
      | Pending.WithoutAccessKey = Pending.Pending,
    accessKey extends Supplied | undefined = undefined,
  > = [pending] extends [Pending.WithoutAccessKey]
    ? WithoutAccessKey
    : [pending] extends [Pending.Addressed]
      ? Authorization_.Addressed
      : [Addressed<accessKey>] extends [true]
        ? Authorization_.Addressed
        : [Addressed<accessKey>] extends [false]
          ? [pending] extends [Pending.Pending]
            ? Authorization
            :
                | Authorization
                | WithoutAccessKey
                // A `pending` that may be an addressed redirect's returns its authorization too.
                | ([Extract<pending, Pending.Addressed>] extends [never]
                    ? never
                    : Authorization_.Addressed)
          : // An `accessKey` that may name either kind of access key returns either authorization.
            Authorization | Authorization_.Addressed | WithoutAccessKey

  /** The access key that an app passes to `createUrl`: its own, or another party's by address. */
  type Supplied = AccessKey.own.Options | WithAddress

  /** A sign-in without an access key: the tokens and the user. */
  type WithoutAccessKey = Omit<Authorization, 'accessKey' | 'signer'>
}

/**
 * Throws a `RequestError` with status 0 for an access key without bounds, which every page of Tempo
 * ID refuses: `missing_permissions` without `limits`, or with `scopes: 'any'`, and `invalid_expiry`
 * for an access key that never expires. Only a headless sign-in requests such an access key.
 */
function bounded(accessKey: WithAccount | WithAddress) {
  // Absent scopes fill from the limits, so only `'any'`, or absent limits, leaves the scopes out.
  const missing = [
    ...(accessKey.limits === undefined ? (['limits'] as const) : []),
    ...(accessKey.limits === undefined || accessKey.scopes === 'any'
      ? (['scopes'] as const)
      : []),
  ]
  if (missing[0])
    throw new RequestError({
      code: 'invalid_request',
      field: `accessKey.${missing[0]}`,
      message: `Missing ${missing.map((field) => `\`${field}\``).join(' and ')}: an access key that spends any amount or makes any call needs a headless sign-in. Name \`limits\`, and leave out \`scopes\` to fill them from \`limits\`.`,
      reason: 'missing_permissions',
      status: 0,
    })
  if (accessKey.expiry === false || accessKey.expiry === 0)
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.expiry',
      message:
        "Invalid `expiry`: an access key that never expires needs a headless sign-in. Use a duration, such as `'1d'`, or a future Unix time in seconds.",
      reason: 'invalid_expiry',
      status: 0,
    })
}

/**
 * Revokes the refresh token of a code exchange whose sign-in failed for another reason, such as a
 * store's error, since no session holds it. A refused exchange issued no tokens, and a failed
 * revocation leaves the other failure as the error.
 */
async function discard(
  auth: Config,
  exchange: ReturnType<typeof redeem> | undefined,
): Promise<void> {
  const body = await exchange?.catch(() => undefined)
  if (body?.refresh_token)
    await Api.revoke(auth, { refreshToken: body.refresh_token }).catch(
      () => undefined,
    )
}

/**
 * Checks the callback's `state`, and redeems its code with the verifier of `pending`. Throws a
 * `RequestError` for a forged `state`, a callback without a `code`, or a refused code.
 */
async function redeem(auth: Config, options: redeem.Options) {
  const { redirectUri, state, verifier } = options.pending
  const { url } = options
  // State comes first, so a forged link cannot supply the error an app shows. The issuer replaces a
  // registered `code` and `state` with its own, but appends `state` after a registered one on a
  // refusal, so the last value is the response's.
  Callback.checkState(url, { state })
  // A denial, such as `error=access_denied`, has the same fields in every flow as on the page. A
  // registered `code` stays on a refusal, so the denial is read first.
  const denial = Callback.error(url, { redirectUri })
  if (denial) throw denial
  const code = url.searchParams.getAll('code').at(-1)
  if (!code)
    throw new RequestError({
      code: 'invalid_request',
      field: 'code',
      message: 'Missing `code` in the callback URL. Start sign-in again.',
      status: 400,
    })

  // A code with this redirect's `state` shows that the user signed in on Tempo ID's pages, so the
  // browser holds that user's Tempo ID session. A failed exchange then ends the app's earlier session.
  // Only a fetch that rejects is an exchange without a response. A fault before it, such as in the
  // client assertion or the DPoP proof, is the `cause` of its own error.
  const config = Api.answered(auth, {
    message:
      'The code exchange received no response. Check the connection, and sign in again.',
  })
  return await Api.token(config, {
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }).catch((error: unknown) => {
    // The issuer refuses a wrong, expired, or redeemed code with `invalid_grant` and a description that
    // names no recovery. Tempo ID's own refusals carry a `reason`, and keep their description.
    if (
      error instanceof RequestError &&
      error.code === 'invalid_grant' &&
      error.reason === undefined
    )
      throw new RequestError({
        cause: error,
        code: error.code,
        message:
          'Invalid code: the code is wrong, expired, or already redeemed. Start sign-in again.',
        signedIn: true,
        status: error.status,
      })
    if (error instanceof RequestError) throw signedIn(error)
    // The user signed in on Tempo ID's pages, so the error is `signedIn` too, which ends the app's
    // earlier session.
    throw new RequestError({
      cause: error,
      code: 'server_error',
      // The message can reach the browser, as a backend's refusal, so the fault's own text, which can
      // name a signing service or an access key, stays in `cause`.
      message:
        'The code exchange failed before its request. Check the client assertion and the DPoP key, and sign in again.',
      signedIn: true,
      status: 0,
    })
  })
}

/** Returns `error`, marked as a refusal after the user signed in. */
function signedIn(error: RequestError) {
  return new RequestError({
    cause: error.cause,
    code: error.code,
    field: error.field,
    message: error.message,
    meta: error.meta,
    reason: error.reason,
    signedIn: true,
    status: error.status,
    uri: error.uri,
  })
}

declare namespace redeem {
  type Options = {
    /** The redirect's state, of which the exchange reads `redirectUri`, `state`, and `verifier`. */
    pending: Pick<Pending.Pending, 'redirectUri' | 'state' | 'verifier'>
    /** The callback URL that Tempo ID redirected to. */
    url: URL
  }
}

/**
 * Returns what {@link finish} returns for the token response of a redeemed code. If `finish` throws,
 * it revokes the response's refresh token first, since no session holds it, and then rethrows.
 */
async function finish_revoke(auth: Config, options: finish.Options) {
  try {
    return finish(options)
  } catch (error) {
    // A failed revocation leaves a refresh token that nothing holds, so the refusal stays the error.
    const { refresh_token } = options.body
    if (refresh_token)
      await Api.revoke(auth, { refreshToken: refresh_token }).catch(
        () => undefined,
      )
    throw error
  }
}

/**
 * Returns the authorization of a redeemed code, with the access key of `pending`, or the tokens and
 * the user for a `Pending.WithoutAccessKey`. Throws a `RequestError` when a redirect with an access
 * key receives no key authorization, or when the token response does not parse, such as one without
 * an ID token. Each such failure has `signedIn`. A fault of the app's own access key throws as it
 * is, without `signedIn`: `AccessKey.SignerRequiredError` for a callback without `accessKey`, and
 * `AccessKey.KeyTypeError` for an authorization of a configurable account.
 */
function finish(
  options: finish.Options,
): Authorization | Authorization_.Addressed | handleCallback.WithoutAccessKey {
  // Each caller holds the token response of a redirect whose `state` matched, so the user signed in
  // on Tempo ID's pages. A failure here then ends the app's earlier session, as a refused exchange
  // does.
  try {
    const { body } = options
    // The exchange's fields stay out of the access key's material. A redirect of an earlier release
    // names `accessKey` as `key`.
    const {
      accessKey: latest,
      chainId: _chainId,
      challenge: challenged,
      clientId: _clientId,
      issuer: _issuer,
      key: earlier,
      redirectUri: _redirectUri,
      state: _state,
      verifier: _verifier,
      ...material
    } = options.pending as finish.Options['pending'] & {
      key?: 'address' | false | undefined
    }
    const kind = latest ?? earlier
    // `pending.accessKey` decides both the type and the runtime value of the result.
    if (kind === false) {
      const tokens = Api.tokens(body)
      return {
        ...tokens,
        ...Api.challengeSignature(body, { challenged }),
        user: Api.user(tokens),
      }
    }
    if (!body.account || !body.key_authorization)
      throw new RequestError({
        code: 'invalid_grant',
        message:
          'Missing key authorization in the token response. The code was already redeemed, or did not request an access key. Start sign-in again.',
        signedIn: true,
        status: 400,
      })
    // Another party holds an access key named by its address, so nothing here signs with it. The
    // pending state records it, so a callback without `accessKey` still finds it.
    if (
      kind === 'address' ||
      (options.accessKey && 'address' in options.accessKey)
    ) {
      const tokens = Api.tokens(body)
      return {
        ...tokens,
        ...Api.challengeSignature(body, { challenged }),
        accessKey: AccessKey.from({
          account: body.account,
          keyAuthorization: body.key_authorization,
        }),
        user: Api.user(tokens),
      }
    }
    return Api.authorization(
      {
        account: body.account,
        ...(body.challenge_signature
          ? { challenge_signature: body.challenge_signature }
          : {}),
        key_authorization: body.key_authorization,
        tokens: body,
      },
      { challenged, material, signer: AccessKey.own(options.accessKey) },
    )
  } catch (error) {
    // A fault of the app's own access key, such as a callback without its `accessKey`, is no fault of
    // the token response, and every such callback repeats it. Its error passes as it is, and names
    // the fix.
    if (
      error instanceof AccessKey.KeyTypeError ||
      error instanceof AccessKey.SignerRequiredError
    )
      throw error
    return Api.signedIn(error, {
      message:
        'Invalid token response: its authorization does not parse. Start sign-in again.',
    })
  }
}

declare namespace finish {
  type Options = {
    /** The access key that the app passed to `createUrl`, if any. */
    accessKey?: handleCallback.Supplied | undefined
    /** The token response of the redeemed code. */
    body: Api.TokenResponse
    /** The redirect's state, whose material the authorization's access key holds. */
    pending: Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey
  }
}

/**
 * Prefetches the scripts and style sheets of Tempo ID's sign-in page, from `GET /v1/auth/assets`, so
 * the page that {@link start} opens loads them from the browser's cache. A browser partitions its
 * cache by site, so only a page on Tempo ID's site, such as `app.tempo.xyz` for `id.tempo.xyz`,
 * gains. Returns the URLs of the assets. Outside a browser, it prefetches nothing.
 *
 * It never throws. A failed read returns no URLs, and the sign-in page loads its assets itself.
 *
 * @example
 * ```ts
 * // Once the sign-in button shows:
 * void Actions.redirect.prefetch(auth)
 * ```
 */
export async function prefetch(auth: Config): Promise<prefetch.ReturnType> {
  const urls = await (async () => {
    // The list is public, so the request carries no cookie.
    const { assets } = await Api.json<{ assets: readonly string[] }>(
      await (auth.fetch ?? fetch)(new URL('/v1/auth/assets', auth.url)),
    )
    return assets.map((path) => new URL(path, auth.url).href)
  })().catch(() => [])
  if (typeof document === 'undefined') return urls

  const linked = new Set(
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="prefetch"]')].map(
      (link) => link.href,
    ),
  )
  for (const href of urls) {
    if (linked.has(href)) continue
    const link = document.createElement('link')
    link.href = href
    link.rel = 'prefetch'
    document.head.appendChild(link)
  }
  return urls
}

export declare namespace prefetch {
  /** The absolute URLs of the sign-in page's scripts and style sheets. */
  type ReturnType = readonly string[]
}

/**
 * Sends the browser to Tempo ID's pages to sign in, and keeps the redirect's state in `store`.
 * With the default store, it also keeps the `state`, the redirect URI, and the PKCE verifier in
 * the tab's `sessionStorage`, without the access key's material. {@link complete} finishes it when the
 * browser returns.
 *
 * Throws a `RequestError` with `invalid_request`, the `field` `store`, and status 0, before any
 * request, for a `store` that sets `local`, such as `Store.memory`. The page load at the return
 * empties such a store, so no callback completes the redirect.
 *
 * @example
 * ```ts
 * await Actions.redirect.start(auth)
 * ```
 */
export async function start(
  auth: Config,
  options: start.Options = {},
): Promise<void> {
  // The redirect leaves the page, which empties a store that only the page holds, so no return
  // completes it. The refusal comes before the user signs in for nothing. Outside a page, an
  // instance without a redirect URI has no redirect at all, so that refusal comes first.
  if (auth.store?.local) {
    if (auth.redirectUri === undefined && !globalThis.window?.location?.origin)
      throw new RedirectUriRequiredError()
    throw new RequestError({
      code: 'invalid_request',
      field: 'store',
      message:
        'Invalid store: it holds its values only in this page, and the redirect leaves the page. Keep the state in a store that persists across page loads, such as the default.',
      status: 0,
    })
  }

  const store = DefaultStore.get(auth.store)!
  // Each redirect has its own entry, so the index of pending redirects removes the expired ones that
  // no callback completed. The URL's request runs before the lock, so a stalled request in one tab
  // never holds the lock that every other tab's start waits for.
  const { pending, url } = await createUrl(auth, options)
  // The default store never expires an entry, so an entry without its index row stays. Tabs that
  // start at once each rewrite the index, so the browser's lock runs the rewrites of the default
  // store one at a time. A custom store, which may expire entries, takes no lock, so a stalled
  // custom store never blocks another instance's start. Each write keeps the rows that this page
  // wrote since, so starts that overlap in one page keep each other's row.
  await exclusive(auth, async () => {
    const index =
      ((await store.getItem(indexKey)) as Index | null | undefined) ?? []
    const now = Date.now()
    const expiresAt = now + pendingLifetime
    // The page's rows that have not expired, with this redirect's.
    const page = [
      ...(written.get(store) ?? []).filter((entry) => entry.expiresAt > now),
      { expiresAt, state: pending.state },
    ]
    written.set(store, page)
    const rows = [
      ...index,
      ...page.filter(
        (entry) => !index.some((row) => row.state === entry.state),
      ),
    ]
    const expired = rows.filter((entry) => entry.expiresAt <= now)
    const kept = rows.filter((entry) => entry.expiresAt > now)
    // The lock holds until every write settles, so a write that fails first never lets another
    // tab read the index while this tab's index write still runs.
    const results = await Promise.allSettled([
      ...expired.map((entry) => store.removeItem(storeKey(entry.state))),
      store.setItem(indexKey, kept, {
        expiresAt,
      }),
      store.setItem(storeKey(pending.state), pending, { expiresAt }),
    ])
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
  })
  Verifier.save(auth, pending)
  window.location.assign(url)
}

export declare namespace start {
  type Options = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * {@link complete} needs too, and which defaults to a new access key. Without it, the sign-in
     * authorizes no access key. The user approves it, so it may exceed the headless ceiling.
     */
    accessKey?: WithAccount | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * Tempo ID's page shows the message, from any app, with or without an access key.
     */
    challenge?: string | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /** The address that Tempo ID's sign-in page fills in its email field, as `login_hint`. */
    loginHint?: string | undefined
    /** The registered resources that the tokens are for. Defaults to the instance's `resource`. */
    resource?: Config['resource']
  }
}

/**
 * Runs `fn` while no other start in the origin's pages rewrites the default store's index, under
 * the browser's Web Lock. With a custom `store`, or without Web Locks, such as outside a browser, it
 * runs `fn` at once. The lock's name is no store key, so a store that locks each key never waits
 * for the lock that its caller holds.
 */
function exclusive<value>(
  auth: Config,
  fn: () => Promise<value>,
): Promise<value> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
    ?.locks
  if (auth.store || !locks) return fn()
  return locks.request(`${indexKey}:exclusive`, fn)
}

/**
 * The redirect this page load returns from, for each store, app, and chain, so its code is redeemed
 * once, and only by an instance of the store, app, and chain that started it.
 */
const completed = new WeakMap<
  object,
  Map<string, Promise<complete.ReturnType>>
>()

/**
 * The index rows that each store's `start` calls wrote in this page, so a write of the index keeps
 * the rows of starts that overlap it.
 */
const written = new WeakMap<object, Index>()

/** Where `start` keeps the index of pending redirects in `store`. */
const indexKey = 'tempo-id:redirects'

/** The pending redirects of `store`, each with its expiry, in milliseconds. */
type Index = readonly { expiresAt: number; state: string }[]

/** How long a redirect's pending state stays in `store` without its callback, in milliseconds. */
const pendingLifetime = 60 * 60 * 1000

/** The shared key of a redirect that keeps its pending state without an entry of its own. */
const legacyStoreKey = 'tempo-id:redirect'

/** A redirect's pending state as `store` returns it. A custom store may return `null`. */
/**
 * Returns whether `stored` is this instance's redirect of an earlier version, which names no Tempo
 * ID deployment, so no instance redeems its code.
 */
function outdated(auth: Config, stored: NonNullable<Stored>) {
  return (
    stored.issuer === undefined &&
    Verifier.owns(auth, { ...stored, issuer: Verifier.issuerOf(auth) })
  )
}

type Stored =
  | Pending.Addressed
  | Pending.Pending
  | Pending.WithoutAccessKey
  | null
  | undefined

/**
 * Returns where the redirect of `state` keeps its pending state in `store`. Each redirect has its
 * own entry, so a redirect that another tab of the app starts never replaces it.
 */
function storeKey(state: string) {
  return `tempo-id:redirect:${state}`
}
