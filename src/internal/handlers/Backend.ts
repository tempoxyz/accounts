/**
 * The sign-in routes of the `backend` plugin: a redirect sign-in that stores the session on the
 * server, the same sign-in in the dialog, a sign-out, and a read of the signed-in user. With the
 * `siwe` plugin, also a sign-in with a signed message. The browser holds only the session ID, in an
 * `HttpOnly` cookie, so no token reaches it.
 * @module
 */
import { Address, Hex } from 'ox'
import { PendingNotFoundError, RequestError } from '../../Accounts.js'
import type { backend } from '../../plugins/backend.js'
import type { InvalidError, siwe } from '../../plugins/siwe.js'
import type { ErrorBody } from '../Api.js'
import * as BackendCookie from '../BackendCookie.js'
import * as BackendOperations from '../BackendOperations.js'
import * as BackendSessions from '../BackendSessions.js'
import * as Handler from '../Handler.js'
import * as LogoutToken from '../../LogoutToken.js'
import type { User } from '../User.js'

/** The session that the page reads, without tokens: a Tempo ID session, or a SIWE session. */
export type PageSession = PageSession.Siwe | PageSession.TempoId

export declare namespace PageSession {
  /** A SIWE session, as the page reads it. */
  type Siwe = {
    /** The account that signed in. */
    account: Address.Address
    /** How the user signed in: with a signed message. */
    method: 'siwe'
  }

  /** A Tempo ID session, as the page reads it: the user and the Tempo Account. */
  type TempoId = {
    /** The Tempo Account of the session's access key. `null` for a session without an access key. */
    account: Address.Address | null
    /** How the user signed in: through Tempo ID. */
    method: 'tempo-id'
    /** The signed-in user. */
    user: User
  }
}

/**
 * The result of a callback's redemption for one sign-in in progress: a {@link Redemption}, or `stale`
 * for a sign-in that the store no longer holds.
 */
type Completion = Redemption | { stale: true }

/** The result of the sign-in that a callback's `state` names. */
type Redemption =
  | { id: string; session: backend.Session.TempoId }
  | { refusal: RequestError }

/** A sign-in in progress, as its cookie holds it. */
type Pending = {
  /**
   * Whether the dialog started the sign-in, so only `POST /callback` redeems it. For an entry of an
   * earlier release, the dialog cookie says.
   */
  dialog: boolean
  /** The session ID of the sign-in. */
  id: string
  /** The app's path to return to after the sign-in. Absent for a sign-in in the dialog. */
  returnTo?: string | undefined
  /**
   * When the sign-in started, in seconds. The entry leaves the cookie {@link pendingMaxAge} later,
   * as the store drops its pending state. Absent in an entry of an earlier release.
   */
  startedAt?: number | undefined
}

/** How long a sign-in in progress lasts, in seconds, as the plugin keeps its pending state. */
const pendingMaxAge = 10 * 60

/** The lifetime of a session cookie whose session has no expiry, in seconds: 400 days, a browser's limit. */
const sessionMaxAge = 400 * 24 * 60 * 60

/**
 * How many sign-ins in progress the browser holds, newest first. Each tab of a browser can start
 * one, so each callback finds its own sign-in by its `state`.
 */
const pendingLimit = 3

/**
 * The most bytes of the values of the sign-ins' cookies together. A browser refuses a cookie above
 * 4096 bytes and keeps the previous one, so older sign-ins leave first, and the newest one always
 * stays.
 */
const pendingBytes = 3072

/**
 * The largest body of `POST /backchannel-logout` that the route reads, in bytes. A logout token is a
 * JWT of about 1 KiB. Any server can post to the route, so the route stops at the chunk that crosses it.
 */
const maxLogoutBodySize = 64 * 1_024

/**
 * The script of the page that `GET /callback` returns to a popup of the dialog. It posts the callback
 * URL on the channel that the dialog's page listens on, as `Actions.dialog.callback` does, and closes
 * the popup. It reads the URL itself, so the page embeds no request value. A tab that no script
 * opened stays open, so it returns to `/` with `error`, as a refused redirect sign-in does.
 */
const relayScript = `(() => {
  const url = new URL(location.href)
  const state = url.searchParams.getAll('state').at(-1)
  if (state) {
    const channel = new BroadcastChannel('tempo-id:dialog:' + state)
    channel.postMessage({ url: url.href })
    channel.close()
  }
  window.close()
  setTimeout(() => location.replace('/?error=invalid_request'), 500)
})()`

/**
 * Creates the handler of the `backend` plugin's routes, under `basePath`. `accounts.handler` serves
 * them under `/auth` of its own `basePath`, so as `GET /api/auth/login` by default.
 *
 * | Route | Serves |
 * | --- | --- |
 * | `POST /backchannel-logout` | Verifies the logout token that Tempo ID posts at the end of a Tempo ID session, ends each session of its `sid` that Tempo ID issued no later than the token, without a revocation, and answers 200. Answers 413 to a body above 64 KiB |
 * | `GET /login` | Starts a sign-in, sets a `__Host-tempo-id.pending.` cookie of its own for 10 minutes, and redirects to Tempo ID. Passes the `loginHint` query parameter, and `prompt=login`, to `backend.start` |
 * | `POST /login` | Starts a sign-in in the dialog, sets a `__Host-tempo-id.pending.` cookie of its own for 10 minutes, and returns `{ url }` |
 * | `GET /callback` | Completes the sign-in, sets `__Host-tempo-id.sid`, deletes the session that the cookie named before without a revocation, and redirects to `returnTo` |
 * | `POST /callback` | Completes the dialog's sign-in from `{ url }`, sets `__Host-tempo-id.sid`, deletes the session that the cookie named before without a revocation, and returns `{ session: { account, method, user } }` |
 * | `POST /logout` | Ends the session, and deletes its cookie |
 * | `GET /session` | Returns `{ session: { account, method, user } }`, `{ session: { account, method: 'siwe' } }` for a SIWE session, or `{ session: null }`. Deletes a cookie whose session ended |
 * | `POST /siwe/challenge` | With `siwe`, starts a SIWE sign-in from an optional `{ address }`, sets `__Host-tempo-id.siwe` for 10 minutes, and returns `{ message }` |
 * | `POST /siwe`, `POST /siwe/verify` | With `siwe`, verifies `{ address, message, signature }`, sets `__Host-tempo-id.sid`, deletes the session that the cookie named before without a revocation, and returns `{ session: { account, method } }` |
 *
 * Any other method on these paths receives 405. `POST /login`, `POST /callback`, `POST /logout`,
 * and the SIWE routes compare the request's `Origin` with its URL's origin, and refuse another
 * origin with 403.
 *
 * With `siwe({ token: true })`, the SIWE routes set no cookie. `POST /siwe/challenge` returns
 * `{ id, message }`, and both verify routes take `id` in the body and return `{ session, token }`.
 * `GET /session` and `POST /logout` read the token from `Authorization: Bearer`. These routes also
 * accept the plugin's `origin`, answer it with `Access-Control-Allow-Origin`, and answer its
 * preflight. Tempo ID posts to `POST /backchannel-logout` from its server, so the route
 * checks the token's signature in place of the origin. The app registers the route's URL as its
 * back-channel logout URI.
 *
 * A page with `dialog({ backend })` signs in through the `POST` routes, in the dialog's frame or
 * popup. The backend keeps the PKCE verifier, so the code that passes through the page redeems
 * only at the backend.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant P as Page
 *   participant B as Backend
 *   participant ID as Tempo ID
 *   P->>B: 1. POST /login
 *   B-->>P: { url }, Set-Cookie: __Host-tempo-id.pending.<id>
 *   P->>ID: 2. The frame or the popup shows url
 *   ID-->>P: 3. The callback URL, with code and state
 *   P->>B: 4. POST /callback { url }
 *   B->>ID: POST /oauth2/token
 *   B-->>P: { session }, Set-Cookie: __Host-tempo-id.sid
 * ```
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { Sessions } from 'accounts/cloudflare'
 * import { backend } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId,
 *   plugins: [backend({ sessions: Sessions.durableObject(env.SESSIONS) })],
 * })
 *
 * app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
 * ```
 */
export function create(options: create.Options): Handler.Handler {
  const { backend, siwe } = options
  const operations = backend[BackendOperations.key]
  const base = (options.basePath ?? '').replace(/\/+$/, '')
  const settings = (siwe as Record<symbol, unknown> | undefined)?.[
    BackendOperations.siwe
  ] as create.SiweSettings | undefined
  // In the `siwe` plugin's token mode, the page holds a SIWE session's ID as a bearer token, and may
  // sit on one of the plugin's `origin`, apart from the routes.
  const token = settings?.token === true
  const pageOrigins = token ? settings?.origins : undefined

  /** Returns the session ID in the request's bearer token, in the `siwe` plugin's token mode. */
  function bearer(request: Request) {
    return token ? BackendCookie.bearer(request) : undefined
  }

  /** Returns the redirect URI of the sign-in that `request` starts. */
  function redirectUri(request: Request) {
    return (
      options.redirectUri ?? `${new URL(request.url).origin}${base}/callback`
    )
  }

  /**
   * Starts a sign-in under a new session ID, and redirects to Tempo ID's pages. The `returnTo`
   * query parameter, as in `GET /login?returnTo=/notes`, names the app's path to return to after
   * the callback. `loginHint` fills the email field of Tempo ID's sign-in page, and `prompt=login`
   * requests a new sign-in, as `GET /login?prompt=login` does for a switch to another account. The
   * route drops any other `prompt`. A refusal of Tempo ID answers with its error body and status, or 503
   * `temporarily_unavailable` for a push without a response, a 429, a 5xx, or a response below 400
   * without a valid body. It sets no cookie and redirects nowhere, so a page that sends a
   * signed-out user to this route does not loop. A fault of the instance, such as an expired
   * `accessKey.expiry`, throws, since its message states the fix.
   */
  async function login(request: Request) {
    const url = new URL(request.url)
    const started = await backend
      .start({
        loginHint: url.searchParams.get('loginHint') || undefined,
        prompt:
          url.searchParams.get('prompt') === 'login' ? 'login' : undefined,
        redirectUri: redirectUri(request),
      })
      .catch((error: unknown) => {
        if (error instanceof RequestError && answered(error)) return error
        throw error
      })
    if (started instanceof RequestError) {
      const headers = { 'cache-control': 'no-store' }
      const status = loginStatus(started)
      if (status === 503)
        return Response.json(
          { error: 'temporarily_unavailable' },
          { headers, status: 503 },
        )
      return Response.json(
        {
          error: started.code,
          error_description: started.message,
          error_uri: started.uri,
          field: started.field,
          meta: started.meta,
          reason: started.reason,
        },
        { headers, status },
      )
    }

    const { id, url: location } = started
    const headers = new Headers({ location })
    for (const cookie of pendingCookies(request, {
      entries: [
        {
          dialog: false,
          id,
          returnTo: returnTo(url.searchParams.get('returnTo'), {
            origin: url.origin,
          }),
          startedAt: now(),
        },
        ...pendings(request),
      ],
    }))
      headers.append('set-cookie', cookie)
    return new Response(null, { headers, status: 302 })
  }

  /**
   * Starts a sign-in in the dialog under a new session ID, and returns its URL, which the dialog
   * shows in its frame or its popup. The request asks for the popup's compact screens, which the
   * frame drops. It is never pushed, since the frame takes the request's own parameters. An app
   * that [requires pushed requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md#required-pushed-requests)
   * signs in through `GET /login` instead.
   */
  async function dialogLogin(request: Request) {
    const refusal = foreign(request)
    if (refusal) return refusal

    const { id, url } = await backend.start({
      display: 'popup',
      par: false,
      redirectUri: redirectUri(request),
    })
    const headers = new Headers({ 'cache-control': 'no-store' })
    for (const cookie of pendingCookies(request, {
      entries: [{ dialog: true, id, startedAt: now() }, ...pendings(request)],
    }))
      headers.append('set-cookie', cookie)
    return Response.json({ url }, { headers })
  }

  /**
   * Redeems the callback for the pending session ID, and sets it as the session's cookie. A denial
   * returns to `returnTo` with `error`, such as `/notes?error=access_denied`, so the page shows it,
   * and sets no session cookie. An expired sign-in, which the store no longer holds, matches no
   * entry, and receives the page of a callback of the dialog, so a tab returns to
   * `/?error=invalid_request`.
   *
   * A callback of the dialog returns a page that posts it to the dialog's page instead, and redeems
   * nothing, since only a popup whose page severed its opener reaches it, such as with the page's
   * `Cross-Origin-Opener-Policy`. That is a callback of `POST /login`, or one that no redirect
   * sign-in of this browser started, such as a signed message's of `dialog.signMessage`. The
   * pending sign-ins stay.
   */
  async function callback(request: Request) {
    const entries = pendings(request)
    const redirects = entries.filter((entry) => !entry.dialog)
    if (redirects.length === 0) return relay()

    const { match, stale } = await redeem(request, {
      entries: redirects,
      url: request.url,
    })
    // Another `state` names a sign-in that this browser's redirect did not start, such as a signed
    // message's in the dialog's popup. The check runs before the pending sign-in is spent. The
    // sign-ins that the store no longer holds leave the cookie, so they keep no slot from a live one.
    if (!match) {
      const response = relay()
      if (stale.length > 0)
        for (const cookie of cleared(request, {
          ended: stale,
          entries,
        }).getSetCookie())
          response.headers.append('set-cookie', cookie)
      return response
    }

    const { entry, result } = match
    const url = new URL(request.url)
    const path = returnTo(entry.returnTo, { origin: url.origin })
    const headers = cleared(request, { ended: [entry.id, ...stale], entries })
    if ('refusal' in result) {
      headers.set(
        'location',
        withError(path, { error: result.refusal.code, origin: url.origin }),
      )
      return new Response(null, { headers, status: 302 })
    }

    headers.set('location', path)
    headers.append('set-cookie', sessionCookie(result.session))
    return new Response(null, { headers, status: 302 })
  }

  /**
   * Redeems the callback URL that the dialog posts for the pending session ID, sets it as the
   * session's cookie, and returns the session. The callback's `state` must match the pending
   * sign-in that this browser's cookie names, so another site's callback signs no one in. A refusal
   * answers with its OAuth error body and its status, or 503 for an exchange without a response, so
   * the page's `Accounts.RequestError` keeps its `reason` and description. The body holds the
   * refusal's `error`, such as `access_denied`, `error_description`, `field`, and `reason`. The
   * route deletes the cookies of the sign-in, also for a refused callback, such as a denial or a
   * forged `state`.
   */
  async function dialogCallback(request: Request) {
    const refusal = foreign(request)
    if (refusal) return refusal

    const body = (await request.json().catch(() => undefined)) as
      | { url?: unknown }
      | undefined
    const url = typeof body?.url === 'string' ? URL.parse(body.url) : null
    if (!url)
      return Response.json(
        {
          error: 'invalid_request',
          error_description:
            'Invalid body: `url` is not a URL. Send the callback URL of the sign-in as `url`.',
        },
        { status: 400 },
      )

    const entries = pendings(request)
    const dialogs = entries.filter((entry) => entry.dialog !== false)
    const {
      match,
      refusal: mismatch,
      stale,
    } = await redeem(request, {
      entries: dialogs,
      url: url.href,
    })
    // A forged callback ends the dialog's sign-ins, and keeps the redirect sign-ins of other tabs.
    if (!match)
      return refused(mismatch ?? missing(), {
        headers: cleared(request, {
          ended: dialogs.map((entry) => entry.id),
          entries,
        }),
      })

    const { entry, result } = match
    const headers = cleared(request, { ended: [entry.id, ...stale], entries })
    if ('refusal' in result) return refused(result.refusal, { headers })

    headers.append('set-cookie', sessionCookie(result.session))
    return Response.json({ session: pageSession(result.session) }, { headers })
  }

  /**
   * Redeems `url` for the sign-in in progress whose `state` it names, of the sign-ins' cookies
   * `entries`. A sign-in of another `state`, or one that the store no longer holds, spends nothing,
   * so every entry is tried at once, and only the one of the callback's `state` redeems a code. Returns
   * the sign-in and its result as `match`, absent when no sign-in matches, and the session IDs that
   * the store no longer holds as `stale`. Without a match, `refusal` is the refusal of the callback's
   * `state`, absent when the store holds no entry. A failure of another entry, such as of its store read,
   * never discards the result of the callback's entry.
   */
  async function redeem(
    request: Request,
    options: { entries: readonly Pending[]; url: string },
  ): Promise<{
    match?: { entry: Pending; result: Redemption } | undefined
    refusal?: RequestError | undefined
    stale: readonly string[]
  }> {
    const { entries, url } = options
    const settled = await Promise.allSettled(
      entries.map(async (entry) => ({
        entry,
        result: await complete(request, { id: entry.id, url }),
      })),
    )
    const results = settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    )
    const stale = results
      .filter((item) => 'stale' in item.result)
      .map((item) => item.entry.id)

    const match = results.find(
      (item) =>
        !('stale' in item.result) &&
        !('refusal' in item.result && item.result.refusal.field === 'state'),
    ) as { entry: Pending; result: Redemption } | undefined
    if (match) return { match, stale }
    // Without a match, the failed entry can be the callback's own, so its failure surfaces.
    const failed = settled.find((item) => item.status === 'rejected')
    if (failed) throw failed.reason
    // A sign-in that the store no longer holds can be another tab's, so it never answers a callback
    // that can be a dialog popup's.
    const refusal = results
      .map((item) => item.result)
      .find((result) => 'refusal' in result)?.refusal
    return { refusal, stale }
  }

  /**
   * Redeems `url` for the pending session ID `id`, and deletes the session that the cookie named
   * before, without a revocation, beside the index write of the new session's `sid`. Returns the
   * session ID and the session, the refusal, or `stale` for a sign-in that the store no longer holds.
   */
  async function complete(
    request: Request,
    options: { id: string; url: string },
  ): Promise<Completion> {
    const { id } = options

    const session = await (async () => {
      try {
        return await operations.complete({
          id,
          replace: () => replace(request, { id }),
          url: options.url,
        })
      } catch (error) {
        if (error instanceof PendingNotFoundError)
          return { stale: true } as const
        if (error instanceof RequestError) return { refusal: error }
        throw error
      }
    })()
    if ('refusal' in session || 'stale' in session) return session
    return { id, session }
  }

  /**
   * Deletes the session that the request's cookie names, unless it is `id`, since a sign-in over a
   * session replaces it. The deletion sends no revocation, as `save` does. Nothing holds the
   * replaced refresh token any more. If Tempo ID ended that session, such as at a sign-out of Tempo
   * ID, a revocation reads as reuse, and revokes the new session's refresh token too. A Durable
   * Object of an earlier release has no deletion without a revocation, so the call throws a
   * `TypeError`, and the session ends with a revocation, as before. Any other failed deletion sends
   * no revocation, and leaves a session that no cookie names.
   */
  async function replace(request: Request, options: { id: string }) {
    const previous = BackendCookie.get(request, {
      name: BackendCookie.names.session,
    })
    if (previous && previous !== options.id)
      await backend
        .end({ id: previous, revoke: false })
        // Workers RPC throws a `TypeError` only for a method that the object lacks. Any other failure
        // sends no revocation, since the replaced token can be one that Tempo ID revoked.
        .catch((error: unknown) =>
          error instanceof TypeError
            ? backend.end({ id: previous })
            : undefined,
        )
        .catch(() => undefined)
  }

  /**
   * Starts a SIWE sign-in under a new session ID, sets the ID as the pending cookie, and returns
   * the message. In the token mode, returns `{ id, message }` without a cookie. A body may name the
   * account that signs as `address`, and the chain that the message names as `chainId`. A chain that
   * is outside the plugin's `chains` receives 400. With the plugin's `origin`, a request from
   * another origin receives 403.
   */
  async function siweChallenge(request: Request, actions: create.Siwe) {
    const refusal = foreign(request, { origins: pageOrigins })
    if (refusal) return refusal

    // The body is optional, so a request without one starts the sign-in of an unknown account.
    const body = (await request.json().catch(() => undefined)) as
      | { address?: unknown; chainId?: unknown }
      | null
      | undefined
    const address = body?.address
    const chainId = body?.chainId
    if (
      address !== undefined &&
      (typeof address !== 'string' ||
        !Address.validate(address, { strict: false }))
    )
      return Response.json(
        {
          error: 'invalid_request',
          error_description:
            'Invalid body: `address` is not an address. Send the address of the account that signs, or no `address`.',
        },
        { status: 400 },
      )
    if (
      chainId !== undefined &&
      (typeof chainId !== 'number' || !Number.isSafeInteger(chainId))
    )
      return Response.json(
        {
          error: 'invalid_request',
          error_description:
            'Invalid body: `chainId` is not a chain ID. Send the ID of the chain to sign in on, or no `chainId`.',
        },
        { status: 400 },
      )

    const started = await actions
      .start({ address, chainId, request })
      .catch((error) => {
        if (invalid(error)) return error
        throw error
      })
    if ('reason' in started) {
      if (started.reason === 'chain')
        return Response.json(
          { error: 'invalid_request', error_description: started.message },
          { status: 400 },
        )
      // The plugin's `origin` refuses a request from another origin, as `foreign` does.
      return Response.json(
        { error: 'forbidden', error_description: started.message },
        { status: 403 },
      )
    }
    const { id, message } = started
    const headers = new Headers({ 'cache-control': 'no-store' })
    // The page of the token mode holds the session ID, which the verify route takes in its body.
    if (token) return Response.json({ id, message }, { headers })
    headers.append(
      'set-cookie',
      BackendCookie.serialize({
        maxAge: pendingMaxAge,
        name: BackendCookie.names.siwe,
        value: id,
      }),
    )
    return Response.json({ message }, { headers })
  }

  /**
   * Verifies the signed message of the SIWE sign-in that the pending cookie names, sets its session
   * ID as the session's cookie, deletes the session that the cookie named before without a
   * revocation, and returns the session. A sign-in with an access key sends `keyAuthorization` in
   * place of `signature`, with its access token in the request's headers. In the token mode,
   * verifies the sign-in of the body's `id`,
   * and returns `{ session, token }` without a cookie. A refused sign-in deletes the pending cookie, since its
   * challenge is spent. A malformed body, a request without a challenge, and a message other than
   * the challenge receive 400 `invalid_request`. A signature that is not the account's receives 403
   * `access_denied`.
   */
  async function siweVerify(request: Request, actions: create.Siwe) {
    const refusal = foreign(request, { origins: pageOrigins })
    if (refusal) return refusal

    const body = (await request.json().catch(() => undefined)) as
      | {
          address?: unknown
          id?: unknown
          keyAuthorization?: unknown
          message?: unknown
          signature?: unknown
        }
      | null
      | undefined
    const { address, keyAuthorization, message, signature } = body ?? {}
    // A sign-in with an access key sends the signed key authorization in place of the signature,
    // which the plugin checks with the access token of the request.
    const proof = (() => {
      if (typeof signature === 'string' && Hex.validate(signature))
        return { signature }
      if (
        typeof keyAuthorization === 'object' &&
        keyAuthorization !== null &&
        !Array.isArray(keyAuthorization)
      )
        return {
          keyAuthorization:
            keyAuthorization as siwe.complete.Parameters['keyAuthorization'],
          request,
        }
      return undefined
    })()
    if (
      (token && typeof body?.id !== 'string') ||
      typeof address !== 'string' ||
      typeof message !== 'string' ||
      !proof ||
      !Address.validate(address, { strict: false })
    )
      return Response.json(
        {
          error: 'invalid_request',
          error_description: token
            ? 'Invalid body: send the challenge’s `id`, the signed message as `message`, its signature as `signature` or the key authorization that binds it as `keyAuthorization`, and the address of the account that signed as `address`.'
            : 'Invalid body: send the signed message as `message`, its signature as `signature` or the key authorization that binds it as `keyAuthorization`, and the address of the account that signed as `address`.',
        },
        { status: 400 },
      )

    const headers = new Headers({ 'cache-control': 'no-store' })
    if (!token)
      headers.set(
        'set-cookie',
        BackendCookie.serialize({ name: BackendCookie.names.siwe }),
      )
    const id = token
      ? (body?.id as string)
      : BackendCookie.get(request, { name: BackendCookie.names.siwe })
    const session = await (async () => {
      if (!id) return undefined
      try {
        return await actions.complete({ address, id, message, ...proof })
      } catch (error) {
        if (invalid(error)) return error
        throw error
      }
    })()
    if (!session || 'reason' in session) {
      const signer = session?.reason === 'signer'
      return Response.json(
        {
          error: signer ? 'access_denied' : 'invalid_request',
          error_description:
            session?.message ??
            'Missing challenge: no SIWE sign-in is in progress in this browser. Request a new challenge.',
        },
        { headers, status: signer ? 403 : 400 },
      )
    }

    // The page of the token mode holds the session ID as its token, and the browser no cookie.
    if (token)
      return Response.json(
        { session: pageSession(session), token: session.id },
        { headers },
      )
    await replace(request, { id: session.id })
    headers.append('set-cookie', sessionCookie(session))
    return Response.json({ session: pageSession(session) }, { headers })
  }

  /**
   * Ends the cookie's session, deletes the cookie, and answers 204. Only a request from the app's
   * own origin may sign out, since the browser sends the cookie with a cross-site form post. In the
   * token mode, ends the session of the bearer token without a cookie, also for a request from the
   * plugin's `origin`. If the revocation or the store fails, the route answers 503
   * `temporarily_unavailable`, and deletes the cookie anyway.
   */
  async function logout(request: Request) {
    const held = bearer(request)
    // The browser never adds a bearer token to a cross-site request, so the page's origin may send it.
    const refusal = foreign(request, {
      origins: held ? pageOrigins : undefined,
    })
    if (refusal) return refusal

    const id =
      BackendCookie.get(request, { name: BackendCookie.names.session }) ?? held
    const headers = new Headers({
      'set-cookie': BackendCookie.serialize({
        name: BackendCookie.names.session,
      }),
    })
    // The cookie goes either way. A failed revocation, store, or Durable Object call keeps the
    // session in the store until it expires, but the browser no longer names it.
    const ended = id
      ? await backend.end({ id }).then(
          () => true,
          () => false,
        )
      : true
    if (!ended)
      return Response.json(
        { error: 'temporarily_unavailable' },
        { headers, status: 503 },
      )
    return new Response(null, { headers, status: 204 })
  }

  /**
   * Ends the sessions of the logout token in the request's form body, and answers 200. A body above
   * 64 KiB receives 413 `invalid_request`, and the route stops at the chunk that crosses 64 KiB. A token that
   * does not verify receives 400 `invalid_request`. A key set that cannot be fetched, or a failed
   * store or Durable Object call, receives 503 `temporarily_unavailable`, so Tempo ID sends the
   * token again.
   */
  async function backchannelLogout(request: Request) {
    const headers = { 'cache-control': 'no-store' }
    // Tempo ID posts the token as `application/x-www-form-urlencoded` (Back-Channel Logout §2.5).
    const body = await read(request, { limit: maxLogoutBodySize }).catch(
      () => '',
    )
    if (body === undefined)
      return Response.json(
        {
          error: 'invalid_request',
          error_description:
            'Request too large: the body exceeds 64 KiB. Send only the logout token as a form field.',
        },
        { headers, status: 413 },
      )
    const logoutToken = new URLSearchParams(body).get('logout_token')
    if (!logoutToken)
      return Response.json(
        {
          error: 'invalid_request',
          error_description:
            'Invalid body: `logout_token` is missing. Send the logout token as a form field.',
        },
        { headers, status: 400 },
      )

    // Any rejection fails the route, also one with a falsy reason.
    const result = await backend.logout({ logoutToken }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ error, ok: false as const }),
    )
    if (!result.ok && result.error instanceof LogoutToken.InvalidError)
      return Response.json(
        { error: 'invalid_request', error_description: result.error.message },
        { headers, status: 400 },
      )
    if (!result.ok)
      return Response.json(
        { error: 'temporarily_unavailable' },
        { headers, status: 503 },
      )
    return new Response(null, { headers, status: 200 })
  }

  /**
   * Returns the cookie's user and Tempo Account, or `null`, and deletes a cookie whose session
   * ended. In the token mode, a request without the cookie reads the SIWE session of its bearer
   * token. A refresh without a response, or with a 429 or 5xx status, answers 503
   * `temporarily_unavailable` and keeps the cookie, so the next request reads the session again.
   * Any other refusal, such as `invalid_dpop_proof`, repeats at each read, so the route ends the
   * session as `POST /logout` does, returns `null`, and deletes the cookie.
   */
  async function session(request: Request) {
    const cookie = BackendCookie.get(request, {
      name: BackendCookie.names.session,
    })
    const held = cookie ? undefined : bearer(request)
    const id = cookie ?? held
    const read = id
      ? await backend.get({ id }).catch((error: unknown) => {
          if (error instanceof RequestError) return error
          throw error
        })
      : undefined
    // A bearer token names only a SIWE session, as `session.get(request)` reads it.
    const current =
      held && (read instanceof RequestError || read?.method !== 'siwe')
        ? undefined
        : read
    const headers = new Headers({ 'cache-control': 'no-store' })
    if (current instanceof RequestError && transient(current))
      return Response.json(
        { error: 'temporarily_unavailable' },
        { headers, status: 503 },
      )
    // The store keeps a session that Tempo ID refused, so the route ends it, which revokes its refresh
    // token. The cookie goes either way, so the page signs in again. A failed end leaves a session
    // that no cookie names, as `/logout` does.
    if (cookie && current instanceof RequestError)
      await backend.end({ id: cookie }).catch(() => undefined)
    if (cookie && (!current || current instanceof RequestError))
      headers.set(
        'set-cookie',
        BackendCookie.serialize({ name: BackendCookie.names.session }),
      )
    return Response.json(
      {
        session:
          current && !(current instanceof RequestError)
            ? pageSession(current)
            : null,
      },
      { headers },
    )
  }

  const routes: Record<
    string,
    Partial<Record<'GET' | 'POST', (request: Request) => Promise<Response>>>
  > = {
    [`${base}/backchannel-logout`]: { POST: backchannelLogout },
    [`${base}/callback`]: { GET: callback, POST: dialogCallback },
    [`${base}/login`]: { GET: login, POST: dialogLogin },
    [`${base}/logout`]: { POST: logout },
    [`${base}/session`]: { GET: session },
    ...(siwe
      ? {
          // `siwe({ auth: '/api/auth/siwe' })` on the page posts its signature to the challenge
          // route's parent. `/siwe/verify` serves `dialog({ backend: true })` and earlier releases.
          [`${base}/siwe`]: {
            POST: (request: Request) => siweVerify(request, siwe),
          },
          [`${base}/siwe/challenge`]: {
            POST: (request: Request) => siweChallenge(request, siwe),
          },
          [`${base}/siwe/verify`]: {
            POST: (request: Request) => siweVerify(request, siwe),
          },
        }
      : {}),
  }

  // The routes that the page of the token mode calls from the plugin's `origin`.
  const shared = new Set(
    ['/logout', '/session', '/siwe', '/siwe/challenge', '/siwe/verify'].map(
      (path) => `${base}${path}`,
    ),
  )

  return Handler.from({
    async fetch(request) {
      const { pathname } = new URL(request.url)
      const route = routes[pathname]
      if (!route) return Response.json({ error: 'not_found' }, { status: 404 })
      // The page of the token mode sends no cookie, so its origin reads the responses, and sends
      // its bearer token and JSON bodies after a preflight.
      const origin = request.headers.get('origin')
      const cors =
        origin && pageOrigins?.includes(origin) && shared.has(pathname)
          ? { 'access-control-allow-origin': origin, vary: 'origin' }
          : undefined
      if (cors && request.method === 'OPTIONS')
        return new Response(null, {
          headers: {
            ...cors,
            'access-control-allow-headers': 'authorization, content-type, dpop',
            'access-control-allow-methods': Object.keys(route).join(', '),
            'access-control-max-age': '600',
          },
          status: 204,
        })
      const fn = route[request.method as 'GET' | 'POST']
      if (!fn)
        return Response.json(
          { error: 'method_not_allowed' },
          { headers: { allow: Object.keys(route).join(', ') }, status: 405 },
        )
      const response = await fn(request)
      if (cors)
        for (const [name, value] of Object.entries(cors))
          response.headers.set(name, value)
      return response
    },
  })
}

export declare namespace create {
  type Options = {
    /** The `backend` plugin's actions. */
    backend: Actions
    /** The path that the routes sit under, such as `/api`. Defaults to the root. */
    basePath?: string | undefined
    /**
     * The registered redirect URI that Tempo ID returns to. Defaults to `/callback` under `basePath`,
     * at the request's origin.
     */
    redirectUri?: string | undefined
    /** The `siwe` plugin's actions, which serve the SIWE routes. Absent without the plugin. */
    siwe?: Siwe | undefined
  }

  /** The `backend` plugin's actions that the routes call. */
  type Actions = {
    /** The plugin's operations, which it keeps off the namespace's enumerable members. */
    [BackendOperations.key]: backend.Operations
    end: (parameters: backend.end.Parameters) => Promise<void>
    get: (parameters: {
      id: string
    }) => Promise<backend.Session.Cookie | undefined>
    logout: (
      parameters: backend.logout.Parameters,
    ) => Promise<backend.logout.ReturnType>
    start: (
      parameters?: backend.start.Parameters,
    ) => Promise<{ id: string; url: string }>
  }

  /** The `siwe` plugin's settings that the routes read. */
  type SiweSettings = siwe.Settings

  /** The `siwe` plugin's actions that the routes call. */
  type Siwe = {
    complete: (
      parameters: siwe.complete.Parameters,
    ) => Promise<backend.Session.Siwe>
    start: (
      parameters: siwe.start.Parameters,
    ) => Promise<{ id: string; message: string }>
  }
}

/**
 * Returns headers that delete the cookies of the sign-ins in progress `ended`. The other sign-ins of
 * `entries`, which other tabs started, keep their cookies.
 */
function cleared(request: Request, options: cleared.Options) {
  const { ended, entries } = options
  const headers = new Headers({ 'cache-control': 'no-store' })
  const rest = entries.filter((entry) => !ended.includes(entry.id))
  for (const cookie of pendingCookies(request, { entries: rest }))
    headers.append('set-cookie', cookie)
  return headers
}

declare namespace cleared {
  type Options = {
    /** The session IDs of the sign-ins that end: the callback's, and those the store no longer holds. */
    ended: readonly string[]
    /** The sign-ins in progress that the request's cookies hold. */
    entries: readonly Pending[]
  }
}

/**
 * Returns the sign-ins in progress that the request's cookies hold, newest first, without those
 * older than {@link pendingMaxAge}. Each sign-in's own cookie holds it with its flow and path. A
 * sign-in that an earlier release started is in the list cookie, or only in the pending cookie,
 * with its path in the return cookie and its flow in the dialog cookie, as that release writes
 * them.
 */
function pendings(request: Request): readonly Pending[] {
  const own = BackendCookie.list(request, {
    prefix: BackendCookie.pendingPrefix,
  })
    .flatMap(([name, value]) =>
      entry({ id: name.slice(BackendCookie.pendingPrefix.length), value }),
    )
    // A browser sends cookies of one path oldest first (RFC 6265 §5.4), so the reverse order keeps
    // the newest first among sign-ins that started in the same second.
    .reverse()
  const listed = parse(
    BackendCookie.get(request, { name: BackendCookie.names.pendings }),
  )
  const id = BackendCookie.get(request, { name: BackendCookie.names.pending })
  const legacy = ((): Pending[] => {
    if (!id || !sessionId.test(id)) return []
    if (
      BackendCookie.get(request, { name: BackendCookie.names.dialog }) !==
      undefined
    )
      return [{ dialog: true, id }]
    return [
      {
        dialog: false,
        id,
        returnTo: decode(
          BackendCookie.get(request, { name: BackendCookie.names.return }),
        ),
      },
    ]
  })()

  // Each sign-in counts once. A sign-in of the earliest release holds no start, and its pending
  // cookie names the newest sign-in, so it comes first.
  const seen = new Set<string>()
  return [...own, ...listed, ...legacy]
    .filter((item) => !seen.has(item.id) && !!seen.add(item.id))
    .sort(
      (a, b) =>
        (b.startedAt ?? Number.MAX_SAFE_INTEGER) -
        (a.startedAt ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, pendingLimit)
}

/** Returns the sign-ins that the list cookie of an earlier release holds. */
function parse(value: string | undefined): Pending[] {
  if (!value) return []
  // The cookie is the browser's input, so a crafted one names no more sign-ins than a written one.
  return value
    .split('|')
    .slice(0, pendingLimit)
    .flatMap((part) => {
      const index = part.indexOf('.')
      if (index < 0) return []
      return entry({ id: part.slice(0, index), value: part.slice(index + 1) })
    })
}

/**
 * Returns the sign-in `id` that a cookie's `value` holds, as {@link pendingCookies} writes it, or
 * none for a malformed value or a sign-in older than {@link pendingMaxAge}.
 */
function entry(options: { id: string; value: string }): Pending[] {
  const { id, value } = options
  const [head = '', path] = value.split(':')
  const dialog = path === undefined && head.endsWith('!')
  const started = dialog ? head.slice(0, -1) : head
  if (!sessionId.test(id) || !started) return []

  const startedAt = parseInt(started, 36)
  if (!(startedAt + pendingMaxAge > now())) return []
  if (dialog) return [{ dialog, id, startedAt }]
  if (path === undefined) return []
  return [{ dialog, id, returnTo: decode(path), startedAt }]
}

/** Returns the time in seconds. */
function now() {
  return Math.floor(Date.now() / 1000)
}

/**
 * Returns the `Set-Cookie` value of `session`'s cookie, which lasts as long as the store keeps the
 * session, so a browser that restarts still names it. A session that the store keeps without an
 * expiry keeps its cookie for {@link sessionMaxAge}.
 */
function sessionCookie(session: backend.Session.Cookie) {
  const expiresAt = BackendSessions.expiresAt(session)
  return BackendCookie.serialize({
    maxAge:
      expiresAt === undefined
        ? sessionMaxAge
        : Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0),
    name: BackendCookie.names.session,
    value: session.id,
  })
}

/** A session ID in a sign-in's cookie: URL-safe Base64, as `backend.start` writes it. */
const sessionId = /^[\w-]{1,128}$/

/**
 * Returns the `Set-Cookie` values that keep the sign-ins in progress `entries`, newest first, and
 * delete the cookie of each other sign-in that `request` holds. Each sign-in has a cookie of its
 * own, under `BackendCookie.pendingPrefix` and its session ID, so concurrent requests of several
 * tabs never replace another tab's sign-in. The value is the sign-in's start in base 36, then `!`
 * for a dialog's, or `:` and the path for a redirect's. Each path is percent-encoded, so it holds no
 * separator. The newest {@link pendingLimit} sign-ins stay while their values fit in
 * {@link pendingBytes}, and a path that alone exceeds it returns to `/`. Only a sign-in without a
 * cookie in `request` receives one, so a response never restores a sign-in that another tab ended.
 *
 * The pending and return cookies hold the newest sign-in as the earliest release writes it, so that
 * release completes it while a deployment runs both. The list cookie of the release before goes,
 * since each of its sign-ins receives a cookie of its own. Each cookie lasts until
 * {@link pendingMaxAge} after its sign-in's start.
 */
function pendingCookies(
  request: Request,
  options: { entries: readonly Pending[] },
) {
  const kept = options.entries.slice(0, pendingLimit).map((entry) => ({
    ...entry,
    // A sign-in of the earliest release holds no start, so it starts again here.
    startedAt: entry.startedAt ?? now(),
  }))
  const path = (entry: Pending) => {
    const path = encodeURIComponent(entry.returnTo ?? '/')
    return path.length > pendingBytes ? encodeURIComponent('/') : path
  }
  const values = kept.map((entry) => {
    const head = entry.startedAt.toString(36)
    return entry.dialog ? `${head}!` : `${head}:${path(entry)}`
  })
  // The newest entries stay, so an entry that does not fit drops every older one too.
  const overflow = values.findIndex(
    (_, index) =>
      index > 0 && values.slice(0, index + 1).join('').length > pendingBytes,
  )
  const live = overflow === -1 ? kept : kept.slice(0, overflow)
  const maxAge = (entry: { startedAt: number }) =>
    Math.max(entry.startedAt + pendingMaxAge - now(), 0)
  const name = (entry: Pending) =>
    `${BackendCookie.pendingPrefix}${entry.id}` as const

  const present = BackendCookie.list(request, {
    prefix: BackendCookie.pendingPrefix,
  }).map(([item]) => item)
  const own = [
    ...live.flatMap((entry, index) =>
      present.includes(name(entry))
        ? []
        : [
            BackendCookie.serialize({
              maxAge: maxAge(entry),
              name: name(entry),
              value: values[index]!,
            }),
          ],
    ),
    ...present
      .filter((item) => !live.some((entry) => name(entry) === item))
      .map((item) => BackendCookie.serialize({ name: item })),
    ...(BackendCookie.get(request, { name: BackendCookie.names.pendings }) ===
    undefined
      ? []
      : [BackendCookie.serialize({ name: BackendCookie.names.pendings })]),
  ]

  const newest = live[0]
  if (!newest)
    return [
      ...own,
      ...[
        BackendCookie.names.dialog,
        BackendCookie.names.pending,
        BackendCookie.names.return,
      ].map((item) => BackendCookie.serialize({ name: item })),
    ]
  return [
    ...own,
    BackendCookie.serialize({
      maxAge: maxAge(newest),
      name: BackendCookie.names.pending,
      value: newest.id,
    }),
    newest.dialog
      ? BackendCookie.serialize({ name: BackendCookie.names.return })
      : BackendCookie.serialize({
          maxAge: maxAge(newest),
          name: BackendCookie.names.return,
          value: path(newest),
        }),
    // The earliest release takes the newest sign-in for the dialog's while this cookie is present.
    newest.dialog
      ? BackendCookie.serialize({
          maxAge: maxAge(newest),
          name: BackendCookie.names.dialog,
          value: '1',
        })
      : BackendCookie.serialize({ name: BackendCookie.names.dialog }),
  ]
}

/** Returns a cookie's percent-decoded value, or `undefined` for a malformed one. */
function decode(value: string | undefined) {
  if (value === undefined) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/**
 * Returns the 403 response to a request from another origin, or `undefined` for the app's own, or
 * for one of `options.origins`, the page's origins of the `siwe` plugin's token mode. The browser sends the
 * cookies with a cross-site form post, so each route that changes them checks. Behind a proxy that
 * changes the URL, the proxy keeps the public origin.
 */
function foreign(
  request: Request,
  options: { origins?: readonly string[] | undefined } = {},
) {
  const origin = request.headers.get('origin')
  if (origin === new URL(request.url).origin) return undefined
  if (origin && options.origins?.includes(origin)) return undefined
  return Response.json(
    {
      error: 'forbidden',
      error_description:
        'Invalid origin: only a request from the app’s own origin can call this route. Send the request from the app’s page.',
    },
    { status: 403 },
  )
}

/**
 * Returns the status of a refused callback: the issuer's own 4xx, 503 for a server fault or an
 * exchange without an answer of the issuer, such as a refused redirect, or 400 for any other refusal, such as a denial, which the callback
 * URL carries.
 *
 * @example
 * ```ts
 * Backend.callbackStatus(new RequestError({ code: 'invalid_grant', message, status: 400 })) // 400
 * ```
 */
export function callbackStatus(refusal: RequestError) {
  if (refusal.status >= 400 && refusal.status < 500) return refusal.status
  // A response accepts no status above 599, so every status from 500 answers as unavailable.
  if (refusal.status >= 500) return 503
  // Only the code exchange and the read of its response mark the user signed in. A status below
  // 400 then means no answer of the issuer, such as no response or a refused redirect, or an answer
  // that does not parse. A denial that the callback URL carries, such as `error=server_error`, has no
  // sign-in, and answers 400.
  if (refusal.signedIn) return 503
  return 400
}

/** Returns the response of `POST /callback` for `refusal`: its error body, at {@link callbackStatus}. */
function refused(refusal: RequestError, options: { headers: Headers }) {
  return Response.json(
    {
      error: refusal.code,
      error_description: refusal.message,
      error_uri: refusal.uri,
      field: refusal.field,
      meta: refusal.meta,
      reason: refusal.reason,
    } satisfies ErrorBody,
    { headers: options.headers, status: callbackStatus(refusal) },
  )
}

/** Returns the refusal of a callback without a sign-in in progress in this browser. */
function missing() {
  return new RequestError({
    code: 'invalid_request',
    message:
      'Missing sign-in: no sign-in is in progress in this browser, or it expired. Start sign-in again.',
    status: 400,
  })
}

/** Returns whether `error` is the `siwe` plugin's refusal of a sign-in. */
function invalid(error: unknown): error is InvalidError {
  // The routes import no module of the plugin, so the name identifies the class.
  return error instanceof Error && error.name === 'Plugins.siwe.InvalidError'
}

/** Returns the session that the page reads, without tokens. */
function pageSession(session: backend.Session.TempoId): PageSession.TempoId
function pageSession(session: backend.Session.Cookie): PageSession
function pageSession(session: backend.Session.Cookie): PageSession {
  if (session.method === 'siwe')
    return { account: session.address, method: 'siwe' }
  return {
    account: session.accessKey?.account ?? null,
    method: 'tempo-id',
    user: session.user,
  }
}

/**
 * Returns the page that posts a popup's callback to the dialog's page. The callback URL holds the
 * code, so the page sends no referrer, and its policy runs only its own script.
 */
function relay() {
  const nonce = crypto.randomUUID()
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Sign-in</title><p>Return to the app’s window to continue.</p><script nonce="${nonce}">${relayScript}</script>`,
    {
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'`,
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
      },
    },
  )
}

/**
 * Returns `value` as a path on the app's own origin, with its query and fragment, or `/` for any
 * other value, such as `//evil.example` or `https://evil.example`.
 */
function returnTo(
  value: string | null | undefined,
  options: { origin: string },
) {
  if (!value?.startsWith('/')) return '/'
  const url = (() => {
    try {
      return new URL(value, options.origin)
    } catch {
      return undefined
    }
  })()
  if (url?.origin !== options.origin) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Returns whether Tempo ID answered the request that `error` refuses, or the request received no
 * response. A fault of the instance's own options, such as `expiry_passed`, sends no request, and has
 * status 0 with a `reason` or another code, such as `redirect_refused` for a wrong `url`.
 */
function answered(error: RequestError) {
  if (error.status !== 0) return true
  return error.code === 'server_error' && error.reason === undefined
}

/**
 * Returns the status of a refused start of `GET /login`: the issuer's own 4xx, or 503 for a refusal that
 * can pass at a later request, or for a response below 400 without a valid body, such as a proxy's
 * page, which refuses nothing.
 *
 * @example
 * ```ts
 * Backend.loginStatus(new RequestError({ code: 'server_error', message, status: 0 })) // 503
 * ```
 */
export function loginStatus(refusal: RequestError) {
  if (transient(refusal) || refusal.status < 400) return 503
  return refusal.status
}

/**
 * Returns whether a refusal of a session's read can pass at a later read: no response, a rate limit,
 * or a server error.
 */
function transient(error: RequestError) {
  return error.status === 0 || error.status === 429 || error.status >= 500
}

/** Returns the app's path `path` with the callback's `error` in its query. */
function withError(path: string, options: { error: string; origin: string }) {
  const url = new URL(path, options.origin)
  url.searchParams.set('error', options.error)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Reads the body of `request` once, as UTF-8 text. Returns `undefined` once the declared or the
 * streamed size exceeds `limit`, in bytes, and cancels the rest of the body. The runtime sets the
 * size of each chunk, so the route reads `limit` bytes and at most the one chunk that crosses it.
 */
async function read(request: Request, options: { limit: number }) {
  const { limit } = options
  if (Number(request.headers.get('content-length')) > limit) {
    // The refusal does not wait for the cancel, which can settle only once the body ends.
    void request.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!request.body) return ''

  const decoder = new TextDecoder()
  const reader = request.body.getReader()
  let size = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    size += value.byteLength
    if (size > limit) {
      // As above, the refusal does not wait for the cancel.
      void reader.cancel().catch(() => undefined)
      return undefined
    }
    text += decoder.decode(value, { stream: true })
  }
}
