/**
 * Signs the user in on Tempo ID's pages, which redirect back with a code. `start` and `complete`
 * keep the redirect's state in `store`, and, with the default store, its PKCE verifier in the
 * tab's `sessionStorage` too. `createUrl` and `handleCallback` leave it to the app.
 * @module
 */
import type { Account } from 'viem/tempo'
import { type Config, RequestError } from '../Id.js'
import type { Authorization } from '../Authorization.js'
import type * as Funding from '../Funding.js'
import * as AccessKey from '../internal/accessKey.js'
import * as Api from '../internal/api.js'
import * as Callback from '../internal/callback.js'
import * as DefaultStore from '../internal/defaultStore.js'
import { authorizeUrl } from '../internal/request.js'
import * as Verifier from '../internal/verifier.js'
import type * as Pending from '../Pending.js'
import type { Keyed, WithAccount } from '../Permissions.js'

/**
 * Finishes a {@link start} when the page loads with Tempo ID's callback, and returns `undefined`
 * otherwise. It redeems the code once, however often the page calls it. With the default store,
 * it sends the code exchange at once, from the tab's copy of the verifier, before IndexedDB returns
 * the rest of the redirect's state. A callback that denies the
 * redirect, such as `error=access_denied`, throws a `RequestError` with that `code` and status 0.
 * The result carries an access key when `start` received `accessKey`.
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
  const owner = `${auth.clientId}:${auth.chainId}`
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
    const early =
      ticket &&
      url.searchParams.has('code') &&
      url.searchParams.get('state') === ticket.state
        ? redeem(auth, { pending: ticket, url })
        : undefined
    // A refusal surfaces from the await below, after the checks of the stored redirect.
    early?.catch(() => undefined)
    const stored = (await store.getItem(storeKey)) as
      | Pending.Pending
      | Pending.WithoutKey
      | null
      | undefined
    // A registered redirect URI may hold its own `error`, which the app keeps. Only an `error` that
    // the callback added after it belongs to the authorization response.
    const redirectUri = stored?.redirectUri ?? url.origin
    const registered = new URL(redirectUri).searchParams
    // Another instance of the page, such as one of another app, completes its own redirect.
    if (stored != null && !Verifier.owns(auth, stored)) return undefined
    // A custom `store` may return `null` for a missing item.
    const ours =
      stored != null && url.searchParams.get('state') === stored.state
    // Another tab of the app can be away on this redirect, so only its own callback removes it.
    if (ours) await store.removeItem(storeKey)
    // The app keeps its own query and fragment, without the callback's parameters. A code this page
    // did not request is dropped too, since it redeems for whoever crafted its request. A page that is
    // no callback of this page keeps its own `state` and `error` parameters.
    const callback = [
      'code',
      'error',
      'error_description',
      'error_uri',
      'state',
    ]
    if (ours || url.searchParams.has('code')) {
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
    if (ours && error) throw error
    if (!url.searchParams.has('code') || !stored) return undefined
    return finish({
      accessKey: AccessKey.own(options.accessKey),
      body: await (ours && early
        ? early
        : redeem(auth, { pending: stored, url })),
      pending: stored,
    })
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
  type ReturnType = handleCallback.WithoutKey | Authorization | undefined
}

/**
 * Returns the authorization URL, `/oauth2/authorize`, which redirects to Tempo ID's sign-in or
 * approval page, and the `Pending` state to keep until the callback. {@link handleCallback} redeems
 * the code. With `par`, which an instance with a client secret or a client assertion sets by
 * default, it first pushes the request to `/oauth2/par`, and the URL holds only `client_id` and
 * `request_uri`.
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
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: createUrl.Options<accessKey> = {},
): Promise<createUrl.ReturnType<Keyed<accessKey>>> {
  // `accessKey` decides both the type and the runtime value of `pending`.
  return (await authorizeUrl(auth, options)) as createUrl.ReturnType<
    Keyed<accessKey>
  >
}

export declare namespace createUrl {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key, whose material `pending` keeps. Its `access` names the Tempo
     * Account, which defaults to the one the user selects, or the user's oldest. Without it, the
     * sign-in authorizes no access key. The user approves it, so it may exceed the headless ceiling.
     */
    accessKey?: accessKey
    /**
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope. Without `accessKey`, the call throws `Id.ChallengeWithoutKeyError`.
     */
    challenge?: ([accessKey] extends [undefined] ? never : string) | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /**
     * `login` requests a new sign-in of a user whom the browser holds signed in, with the email field
     * filled. Absent, Tempo ID reuses the browser's session.
     */
    prompt?: 'login' | undefined
    /** Defaults to the instance's `redirectUri`, or the page's origin. */
    redirectUri?: string | undefined
  }

  type ReturnType<key extends boolean = false> = {
    /** What to keep until the callback, such as in a sealed cookie. */
    pending: key extends false ? Pending.WithoutKey : Pending.Pending
    /** Where to send the browser. */
    url: string
  }
}

/**
 * Checks the callback's `state`, and redeems its code for the authorization. Throws a
 * `RequestError` for a forged `state`, a callback without a `code`, or a refused code.
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
  const pending extends Pending.Pending | Pending.WithoutKey = Pending.Pending,
>(
  auth: Config,
  options: handleCallback.Options<pending>,
): Promise<handleCallback.ReturnType<pending>> {
  return finish({
    accessKey: AccessKey.own(options.accessKey),
    body: await redeem(auth, {
      pending: options.pending,
      url: new URL(options.url),
    }),
    pending: options.pending,
  }) as handleCallback.ReturnType<pending>
}

export declare namespace handleCallback {
  type Options<
    pending extends Pending.Pending | Pending.WithoutKey = Pending.Pending,
  > = {
    /**
     * The access key that the app passed to `createUrl`, if any, of which only `account` is read,
     * to rebuild the app's own access key.
     */
    accessKey?: AccessKey.own.Options | undefined
    /** What `createUrl` returned to keep. */
    pending: pending
    /** The callback URL that Tempo ID redirected to. */
    url: string | URL
  }

  /** The authorization, without its access key for a `Pending.WithoutKey`. */
  type ReturnType<
    pending extends Pending.Pending | Pending.WithoutKey = Pending.Pending,
  > = [pending] extends [Pending.WithoutKey]
    ? WithoutKey
    : [pending] extends [Pending.Pending]
      ? Authorization
      : Authorization | WithoutKey

  /** A sign-in without an access key: the tokens and the user. */
  type WithoutKey = Omit<Authorization, 'accessKey' | 'key'>
}

/**
 * Checks the callback's `state`, and redeems its code with the verifier of `pending`. Throws a
 * `RequestError` for a forged `state`, a callback without a `code`, or a refused code.
 */
async function redeem(auth: Config, options: redeem.Options) {
  const { redirectUri, state, verifier } = options.pending
  const { url } = options
  const added = (name: string) => Callback.parameter(url, { name, redirectUri })
  // State comes first, so a forged link cannot supply the error an app shows. The issuer replaces a
  // registered `code` and `state` with its own, but appends `state` after a registered one on a
  // refusal, so the last value is the response's.
  Callback.checkState(url, { state })
  const code = url.searchParams.getAll('code').at(-1)
  if (!code)
    throw new RequestError({
      code: added('error') ?? 'invalid_request',
      field: 'code',
      message:
        added('error_description') ??
        'Missing `code` in the callback URL. Start sign-in again.',
      status: 400,
    })

  // A code with this redirect's `state` shows that the user signed in on Tempo ID's pages, so the
  // browser holds that user's Tempo ID session. A failed exchange then ends the app's earlier session.
  return await Api.token(auth, {
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }).catch((error: unknown) => {
    if (error instanceof RequestError) throw signedIn(error)
    throw new RequestError({
      cause: error,
      code: 'server_error',
      message:
        'The code exchange received no response. Check the connection, and sign in again.',
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
 * Returns the authorization of a redeemed code, with the access key of `pending`, or the tokens and the
 * user for a `Pending.WithoutKey`. Throws a `RequestError` when a redirect with an access key receives no
 * key authorization.
 */
function finish(
  options: finish.Options,
): Authorization | handleCallback.WithoutKey {
  const { body } = options
  // The exchange's fields stay out of the access key's material.
  const {
    key,
    chainId: _chainId,
    clientId: _clientId,
    redirectUri: _redirectUri,
    state: _state,
    verifier: _verifier,
    ...material
  } = options.pending
  // `pending.key` decides both the type and the runtime value of the result.
  if (key === false) {
    const tokens = Api.tokens(body)
    return { ...tokens, user: Api.user(tokens) }
  }
  if (!body.account || !body.key_authorization)
    throw new RequestError({
      code: 'invalid_grant',
      message:
        'Missing key authorization in the token response. The code was already redeemed, or did not request a key. Start sign-in again.',
      signedIn: true,
      status: 400,
    })
  return Api.authorization(
    {
      account: body.account,
      key_authorization: body.key_authorization,
      tokens: body,
    },
    { accessKey: options.accessKey, material },
  )
}

declare namespace finish {
  type Options = {
    /** The app's own access key that the app passed to `createUrl`, if any. */
    accessKey?: Account.Account | undefined
    /** The token response of the redeemed code. */
    body: Api.TokenResponse
    /** The redirect's state, whose key material the authorization's key holds. */
    pending: Pending.Pending | Pending.WithoutKey
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
 * @example
 * ```ts
 * await Actions.redirect.start(auth)
 * ```
 */
export async function start(
  auth: Config,
  options: start.Options = {},
): Promise<void> {
  const { pending, url } = await createUrl(auth, options)
  await DefaultStore.get(auth.store)!.setItem(storeKey, pending)
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
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope and an access key.
     */
    challenge?: string | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
  }
}

/**
 * The redirect this page load returns from, for each store, app, and chain, so its code is redeemed
 * once, and only by an instance of the store, app, and chain that started it.
 */
const completed = new WeakMap<
  object,
  Map<string, Promise<complete.ReturnType>>
>()

/** Where a redirect keeps its state in `store`. */
const storeKey = 'tempo-id:redirect'
