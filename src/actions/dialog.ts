/**
 * Signs the user in on Tempo ID without leaving the app's page: in a frame of Tempo ID's embedded
 * sign-in, which a dialog shows on the page, or in a popup window. Either way the page keeps the
 * access key in memory. By default, the request asks for the web message mode: Tempo ID redeems the
 * code, and its page posts the authorization to the page. With `crossOriginOpenerPolicy`, or for an
 * instance with DPoP, the page keeps the PKCE verifier and redeems the code, and Tempo ID's page in
 * a popup posts the callback. On a page whose own `Cross-Origin-Opener-Policy` severs that handle,
 * the popup returns to the redirect URI, whose page calls {@link callback}.
 * @module
 */
/* istanbul ignore file -- Each action needs a browser window, for the dialog or the popup. */
import {
  type Actor as XStateActor,
  assign,
  createActor,
  emit,
  setup,
} from 'xstate'
import { type Config, RequestError } from '../Accounts.js'
import * as Api from '../internal/Api.js'
import type * as Authorization_ from '../internal/Authorization.js'
import type { Authorization } from '../internal/Authorization.js'
import type {
  Addressed,
  HasAccessKey,
  WithAccount,
  WithAddress,
} from '../Permissions.js'
import * as Callback from '../internal/Callback.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as FrameTrust from '../internal/FrameTrust.js'
import * as Handler from '../internal/Handler.js'
import type { PageSession } from '../internal/handlers/Backend.js'
import {
  authorizeUrl,
  challengeParameters,
  fundingParameters,
  permissions,
  pushes,
  resources,
} from '../internal/Request.js'
import * as Popup from '../internal/Popup.js'
import * as Sheet from '../internal/Sheet.js'
import type { Store } from '../Store.js'
import * as Funding from './funding.js'
import * as redirect from './redirect.js'

/**
 * The browser blocked the popup, since `signIn` ran outside a user gesture such as a click.
 * `dialog.signIn` throws it. `dialog.updateAccessKey` and `dialog.revokeAccessKey` throw
 * `Actions.account.BlockedError` instead.
 */
export class BlockedError extends Error {
  override readonly name = 'Actions.dialog.BlockedError'

  constructor() {
    super(
      'The browser blocked the sign-in popup. Call `signIn` in a click handler, before any `await`, or sign in through a redirect.',
    )
  }
}

/**
 * The redirect URI is on another origin than the page, so its callback page cannot reach the page
 * that called `signIn`. `dialog.signIn` throws it. `dialog.updateAccessKey` and
 * `dialog.revokeAccessKey` throw `Actions.account.OriginError` instead.
 */
export class OriginError extends Error {
  override readonly name = 'Actions.dialog.OriginError'

  constructor(options: OriginError.Options) {
    super(
      `Invalid redirect URI: ${options.redirectUri} is not on this page's origin, ${options.origin}. Call \`signIn\` on a page of the redirect URI's origin, or sign in through a redirect.`,
    )
  }
}

export declare namespace OriginError {
  type Options = {
    /** The origin of the page that called `signIn`. */
    origin: string
    /** The redirect URI of the sign-in. */
    redirectUri: string
  }
}

/**
 * No browser page holds the dialog or the popup, such as in Node, a Worker, or React Native.
 * `dialog.signIn` and `dialog.signMessage` throw it before any request or store write.
 */
export class PageRequiredError extends Error {
  override readonly name = 'Actions.dialog.PageRequiredError'

  constructor() {
    super(
      'No browser page: the sign-in shows in a frame or a popup, which only a page opens. Outside a page, sign in with the `device` plugin.',
    )
  }
}

/**
 * Posts the callback to the page that opened the popup, and closes the popup. Returns `true` on the
 * callback of a {@link signIn}, and `false` on any other page load, such as a redirect's callback.
 * Tempo ID's page in the popup posts the callback to the opening page itself, so only an app whose
 * page sends `Cross-Origin-Opener-Policy: same-origin` needs it. That policy severs the popup's
 * `window.opener`, and the popup then returns to the redirect URI. The page reads the sign-in's item
 * from IndexedDB, whatever the instance's `store`, since it is another window. Call it there before
 * `Actions.redirect.complete`, which removes the callback. The `iframe` mode needs it too, since its
 * dialog falls back to a popup.
 *
 * @example
 * ```ts
 * if (await Actions.dialog.callback(auth)) return
 * const authorization = await Actions.redirect.complete(auth)
 * ```
 */
export async function callback(auth: Config): Promise<boolean> {
  const url = new URL(window.location.href)
  // The issuer replaces a registered `state`, or appends its own after it on a refusal, so the last
  // `state` is the response's.
  const state = url.searchParams.getAll('state').at(-1)
  if (!state) return false

  // Only a state that `signIn` stored belongs to a dialog. A redirect keeps its own.
  const store = items(auth)
  const name = channel({ state })
  // A custom `store` may return `null` for a missing item.
  if ((await store.getItem(name)) == null) return false

  // A page on the way, such as one that sends its own `Cross-Origin-Opener-Policy`, can sever
  // `window.opener`, so the callback reaches the opening page on a channel of the page's origin.
  const broadcast = new BroadcastChannel(name)
  broadcast.postMessage({ url: url.href } satisfies Message)
  broadcast.close()
  // The opening page takes one callback for the sign-in, and removes the item too once it ends, so a
  // slow or failing store holds neither the callback nor the popup's close.
  void Promise.resolve()
    .then(() => store.removeItem(name))
    .catch(() => {})
  window.close()
  return true
}

/**
 * Loads the `iframe` dialog of a later {@link signIn}, hidden, so the dialog shows the sign-in at
 * once. Call it when the page loads, such as beside the sign-in button. `accounts` calls it when it
 * creates the client, unless its `preload` is `false`. Without it, the dialog shows once its frame
 * loads.
 *
 * The frame loads without a request, so `signIn` takes it whatever its access key or challenge. Each sign-in keeps the frame loaded, and the next one posts its request to the same
 * frame, which starts the sign-in again. A call while the page holds a frame of the same redirect
 * URI that has not failed loads nothing. Outside a secure context, on a page on `http:` for a Tempo
 * ID on `https:`, and for an instance that pushes its requests with `par`, it loads nothing, since
 * `signIn` then opens a popup. An instance with a `resource` loads the frame, since
 * `signMessage` signs in it. On a page that is not on the redirect URI's origin it loads nothing
 * either, since `signIn` then throws.
 *
 * @example
 * ```ts
 * Actions.dialog.preload(auth)
 * button.onclick = () => Actions.dialog.signIn(auth, { accessKey })
 * ```
 */
export function preload(auth: Config, options: preload.Options = {}): void {
  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  // A frame of the same redirect URI that the page still holds, such as one that a sign-in kept,
  // takes the next sign-in, so it stays loaded. A failed frame offers a popup, so a new one replaces it.
  const entry = machines.entry(slot(auth).getSnapshot())
  if (entry?.redirectUri === redirectUri && entry.sheet.usable()) return
  // A sign-in that holds the dialog keeps its own frame for the next one, so the preload waits for
  // it to end, and loads only if it kept none.
  if (machines.running(slot(auth).getSnapshot()))
    return slot(auth).send({ options, type: 'queue' })
  slot(auth).send({ type: 'discard' })
  if (!framed(auth, { redirectUri }) || pushes(auth)) return

  // A script that runs before the body parses, such as one in the head, preloads once it parses.
  if (!document.body) {
    document.addEventListener(
      'DOMContentLoaded',
      () => preload(auth, options),
      {
        once: true,
      },
    )
    return
  }
  slot(auth).send({
    entry: {
      options,
      redirectUri,
      sheet: Sheet.create({ url: frameUrl(auth, { redirectUri }) }),
    },
    type: 'preload',
  })
}

export declare namespace preload {
  type Options = Pick<signIn.Options, 'redirectUri'>
}

/**
 * Signs the user in on Tempo ID, and resolves with the authorization. Call it in a user gesture, such
 * as a click, since a popup opens only within one.
 *
 * - `iframe`, the default, shows Tempo ID's embedded sign-in in a dialog on the page: a compact
 *   modal, or a bottom sheet on a narrow screen. The dialog shows once its frame shows the request,
 *   at once after {@link preload}. The frame shows the approval page and the account step itself. A
 *   first-party app's access key must fit the headless ceiling. When the frame cannot load, or the sign-in
 *   needs a wallet upgrade, the dialog offers a popup, which the user's click opens. In a browser without
 *   IntersectionObserver v2, the call signs in with `popup` instead, unless the preloaded frame
 *   reported that Tempo ID trusts the app.
 * - `popup` opens Tempo ID's pages in a popup window, with `display=popup`, so they show compact
 *   screens. An access key may exceed the headless ceiling, since the approval page shows it.
 *
 * The page must be on the origin of the redirect URI, since the callback reaches the page only on
 * that origin. Outside a secure context, `iframe` signs in with `popup`. A page on `http:`, such as
 * `http://localhost`, signs in with `popup` too, unless Tempo ID is on `http:` itself, such as a
 * local one. An instance that pushes its requests with `par` signs in with `popup` as well, since the
 * frame takes the request's own parameters, and Tempo ID reads a pushed request only from its push.
 * A request with a `resource`, its own or the instance's, signs in with `popup` too, since the frame's
 * tokens are for Tempo ID's origin alone.
 * A request with `funding` signs in in the
 * frame. If the account holds less than the hint, the call redeems the code, then opens the deposit
 * page as `Actions.funding.open` does in `frame` mode, and resolves once that page returns or closes.
 * A request whose deposit page runs Coinflow where no frame can, such as Buy MACH on iOS and iPadOS, signs in with `popup`, whose pages show the deposit page. The next call of the
 * instance replaces a pending call in either mode, and rejects it with an `AbortError`. A popup that
 * the user closes rejects the call with an `AbortError` too. A page that sends
 * `Cross-Origin-Opener-Policy: same-origin` severs its handle to the popup, so a popup that the user
 * closes there leaves the call pending until `signal` aborts or the next call replaces it.
 *
 * With `backend`, the path where the app mounts `accounts.handler`, the handler's sign-in routes
 * run the sign-in. `POST /login` builds the request, and `POST /callback` redeems the callback's
 * code and sets the session cookie. The call resolves with the session that the page reads, and the
 * page holds no token.
 *
 * @throws {PageRequiredError} Outside a browser page, such as in Node or React Native.
 *
 * @example
 * ```ts
 * button.onclick = async () => {
 *   const authorization = await Actions.dialog.signIn(auth)
 * }
 * ```
 */
export async function signIn(
  auth: Config,
  options: signIn.BackendOptions & { method: 'siwe' },
): Promise<PageSession.Siwe>
export async function signIn(
  auth: Config,
  options: signIn.BackendOptions & { method?: 'tempo-id' | undefined },
): Promise<PageSession.TempoId>
export async function signIn(
  auth: Config,
  options: signIn.BackendOptions,
): Promise<PageSession>
export async function signIn<
  const accessKey extends WithAccount | WithAddress | undefined = undefined,
>(
  auth: Config,
  options?: signIn.Options<accessKey>,
): Promise<signIn.ReturnType<HasAccessKey<accessKey>, Addressed<accessKey>>>
export async function signIn(
  auth: Config,
  options: signIn.Options | signIn.BackendOptions = {},
): Promise<unknown> {
  // React Native defines `window` without `location`, so the check reads `document`.
  if (typeof document === 'undefined') throw new PageRequiredError()
  if ('backend' in options) {
    const { crossOriginOpenerPolicy, mode, signal, timeout } = options
    // The sign-in routes sit under `/auth` of the handler's path.
    const basePath = `${(options.backend === true
      ? Handler.basePath
      : options.backend
    ).replace(/\/+$/, '')}${Handler.authPath}`
    // The redirect URI is the backend's callback route, so a popup whose page severs its opener
    // returns there, and the route posts the callback to this page.
    const redirectUri =
      options.redirectUri ??
      auth.redirectUri ??
      `${window.location.origin}${basePath}/callback`
    if (options.method === 'siwe') {
      let session: PageSession.Siwe | undefined
      // The verification runs within the sign-in, so a later sign-in, the signal, or a close of the
      // dialog ends it too.
      await sign(auth, {
        crossOriginOpenerPolicy,
        message: (ended) => siweChallenge(auth, { basePath, signal: ended }),
        mode,
        redirectUri,
        async settle(signed, ended) {
          session = await siweVerify(auth, {
            ...signed,
            basePath,
            signal: ended,
          })
        },
        signal,
        timeout,
      })
      return session!
    }
    const { authorization } = await authorize<undefined, PageSession.TempoId>(
      auth,
      {
        backend: { basePath },
        mode,
        redirectUri,
        signal,
        timeout,
      },
    )
    return authorization
  }

  return signInPage(auth, options)
}

/**
 * Runs a sign-in of the page, without `backend`. A page that severs the popup's opener without
 * `crossOriginOpenerPolicy` signs in again with a code that the page redeems. With `funding`, opens
 * the deposit page after the sign-in.
 */
async function signInPage(
  auth: Config,
  options: authorize.Options<WithAccount | WithAddress | undefined>,
): Promise<unknown> {
  // `authorize` chooses the mode before its first `await`, so a popup still opens within the gesture.
  // A page that severs the popup's opener, without `crossOriginOpenerPolicy`, receives no web message,
  // so the sign-in starts again with a code that the page redeems.
  const { authorization, funding } = await authorize(auth, options).catch(
    (error: unknown) => {
      if (
        !(error instanceof RequestError) ||
        error.code !== 'web_message_unavailable' ||
        options.crossOriginOpenerPolicy
      )
        throw error
      // The retry runs outside the gesture, so a popup waits for the user's click on Continue.
      return authorize(auth, {
        ...options,
        crossOriginOpenerPolicy: 'same-origin',
        retried: true,
      })
    },
  )
  if (!funding || !options.funding) return authorization

  // The sign-in already succeeded, so a deposit page that fails rejects nothing but the signal.
  await Funding.open(auth, {
    ...options.funding,
    address: funding.address,
    mode: 'frame',
    redirectUri:
      options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`,
    signal: options.signal,
  }).catch(() => undefined)
  dropped(auth, { authorization, signal: options.signal })
  return authorization
}

/**
 * Asks the user's Tempo Account to sign `message` in a sign-in without an access key, and returns
 * the account, the message, and its signature. The account signs the message's EIP-191 hash, as
 * `personal_sign` does. The sign-in requests no `offline_access`, so Tempo ID issues no refresh
 * token, and the call keeps no token. A function that returns the message runs after the dialog or
 * the popup opens, so a popup opens within the gesture also when the message comes from a request.
 *
 * @throws {PageRequiredError} Outside a browser page, such as in Node or React Native.
 *
 * @example
 * ```ts
 * button.onclick = async () => {
 *   const { message, signature } = await Actions.dialog.signMessage(auth, {
 *     message: () => fetch('/v1/approvals', { method: 'POST' }).then((response) => response.text()),
 *   })
 * }
 * ```
 */
export async function signMessage(
  auth: Config,
  options: signMessage.Options,
): Promise<signMessage.ReturnType> {
  if (typeof document === 'undefined') throw new PageRequiredError()
  return sign(auth, options)
}

/**
 * Runs `signMessage`, and then `settle` with its result within the sign-in, so a later sign-in, the
 * signal, or a close of the dialog ends `settle` too.
 */
async function sign(
  auth: Config,
  options: signMessage.Options & {
    /**
     * Runs with the signed message before the sign-in ends, such as a backend's verification. Its
     * signal aborts once the sign-in ends.
     */
    settle?:
      | ((signed: signMessage.ReturnType, signal: AbortSignal) => Promise<void>)
      | undefined
  },
): Promise<signMessage.ReturnType> {
  const { message: source, settle, ...rest } = options
  // A retry outside the gesture requests the message again, so the last one is the signed one.
  let message = typeof source === 'string' ? source : undefined
  /** Returns the signed message of the sign-in's authorization. */
  const signed = (result: Authorization_.Addressed | Authorization) => {
    // The sign-in throws without the signature, so both are present.
    const { address, challengeSignature } = Api.challengeSignature(
      {
        account: result.address,
        challenge_signature: result.challengeSignature,
      },
      { challenged: true },
    )
    return {
      address: address!,
      message: message!,
      signature: challengeSignature!,
    }
  }
  const result = (await signInPage(auth, {
    ...rest,
    challenge:
      typeof source === 'string'
        ? source
        : async (signal) => (message = await source(signal)),
    // The signature keeps no token, so the request names no resource and keeps the frame.
    resource: [],
    scope: auth.scope
      .split(' ')
      .filter((entry) => entry !== 'offline_access')
      .join(' '),
    settle:
      settle &&
      ((authorization, signal) => settle(signed(authorization), signal)),
  })) as Authorization
  return signed(result)
}

/**
 * Signs the user in, as {@link signIn} describes, and resolves with the authorization and the deposit
 * page that the frame's sign-in leaves to the app.
 */
async function authorize<
  const accessKey extends WithAccount | WithAddress | undefined = undefined,
  result = signIn.ReturnType<HasAccessKey<accessKey>, Addressed<accessKey>>,
>(
  auth: Config,
  options: authorize.Options<accessKey>,
): Promise<authorize.ReturnType<result>> {
  const {
    backend,
    cancel,
    crossOriginOpenerPolicy,
    deferred: defers,
    mode: requested = 'iframe',
    retried,
    settle,
    signal,
    timeout = 10_000,
    ...rest
  } = options
  signal?.throwIfAborted()
  cancel?.throwIfAborted()
  // Tempo ID redeems the code and posts the authorization, unless the page severs the popup's
  // opener, which then receives nothing, or the instance binds its tokens with DPoP, whose proof
  // only the page signs. A pushed request and a funding hint redeem on the page too, since Tempo ID
  // keeps no seed in a push and seals a funded code into the deposit page's state. The backend
  // redeems the code of its own request, which it never pushes.
  const pushed = !backend && pushes(auth)
  const responseMode = (() => {
    if (backend || crossOriginOpenerPolicy || auth.dpop) return undefined
    if (pushed || rest.funding) return undefined
    return 'web_message' as const
  })()

  // The mode is chosen before the first `await`, so a popup still opens within the gesture. Tempo
  // ID lets only the redirect URI's origin frame the sign-in, and only in a secure context. A page
  // on `http:`, such as `http://localhost`, is one, but signs in with a popup for a Tempo ID on
  // `https:`, as `Popup.http` describes. A browser without IntersectionObserver v2 cannot show
  // that nothing covers the frame, so only a frame that Tempo ID trusts, as its loaded page
  // reports, signs in there. The frame takes the
  // request's own parameters, so an instance that pushes them signs in with a popup. Buy MACH on iOS
  // and iPadOS runs Apple Pay, which no frame runs, and a popup opens only within the gesture, so a
  // request with such a funding hint signs in with a popup, whose own pages show the deposit page.
  const redirectUri =
    rest.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  // A popup's callback page posts on a channel of its own origin, which no page of another origin
  // receives.
  if (new URL(redirectUri).origin !== window.location.origin)
    throw new OriginError({ origin: window.location.origin, redirectUri })
  // A refused expiry or funding hint throws before the popup or the dialog opens, as it does before
  // any request.
  if (rest.accessKey) permissions(auth, { accessKey: rest.accessKey })
  fundingParameters(rest.funding)
  // The page takes clicks while a popup is open, and until a frame's dialog shows, so a sign-in in
  // either mode ends when the next one starts.
  const actor = slot(auth)
  actor.send({ type: 'replace' })
  const entry = machines.entry(actor.getSnapshot())
  const mode =
    requested === 'iframe' &&
    !(
      rest.funding &&
      Popup.coinflow({
        ...rest.funding,
        chainId: auth.chainId,
      })
    ) &&
    !pushed &&
    // Tempo ID's frame sets the request's resource to its own origin, so only a popup issues tokens
    // for a registered resource.
    resources(auth, rest).length === 0 &&
    framed(auth, { redirectUri }) &&
    (visibility() || entry?.sheet.trusted() === true)
      ? 'iframe'
      : 'popup'

  // Outside a gesture, such as after a failed transaction or for a retry, a popup blocker refuses
  // the popup that `iframe` falls back to, so a dialog offers it, and the user's click on Continue
  // starts the sign-in again. The offer holds the dialog's token, so a later sign-in replaces it.
  if (
    (requested !== 'popup' || retried) &&
    mode === 'popup' &&
    !Popup.activated()
  )
    return await new Promise((resolve, reject) => {
      actor.send({ type: 'start' })
      const call = actor.getSnapshot().context.call ?? 0
      const settle = (fn: () => void) => {
        close()
        subscription.unsubscribe()
        signal?.removeEventListener('abort', abort)
        cancel?.removeEventListener('abort', cancelOffer)
        actor.send({ call, kept: undefined, type: 'end' })
        fn()
      }
      const abort = () => settle(() => reject(signal?.reason))
      const cancelOffer = () => settle(() => reject(cancel?.reason))
      const subscription = actor.on('replaced', (event) => {
        if (event.call !== call) return
        settle(() =>
          reject(
            new DOMException(
              'A later sign-in replaced this one.',
              'AbortError',
            ),
          ),
        )
      })
      const close = Sheet.prompt({
        label: 'Continue with Tempo',
        onCancel: () =>
          settle(() =>
            reject(
              new DOMException('The user closed the sign-in.', 'AbortError'),
            ),
          ),
        // The sign-in in the popup replaces the offer, and holds the dialog's next token.
        onContinue: () =>
          settle(() => {
            authorize<accessKey, result>(auth, {
              ...options,
              mode: 'popup',
              retried: false,
            }).then(resolve, reject)
          }),
        text: 'Continue in a Tempo ID window to finish signing in.',
      })
      signal?.addEventListener('abort', abort, { once: true })
      cancel?.addEventListener('abort', cancelOffer, { once: true })
    })

  // A popup blocker accepts `window.open` only within the gesture, so the popup opens blank before
  // the first `await`, and navigates once the URL is ready.
  const popup = mode === 'popup' ? Popup.openPopup('about:blank') : undefined
  if (popup === null) throw new BlockedError()
  // A later sign-in replaces this one from the start, while its request still builds, and closes
  // the blank popup before it navigates.
  let replace: (() => void) | undefined
  const replaced = new Promise<never>((_, reject) => {
    replace = () => {
      popup?.close()
      reject(
        new DOMException('A later sign-in replaced this one.', 'AbortError'),
      )
    }
  })
  actor.send({ type: 'start' })
  // The machine gives each sign-in that starts a token, which `start` set.
  const call = actor.getSnapshot().context.call ?? 0
  const subscription = actor.on('replaced', (event) => {
    if (event.call === call) replace?.()
  })
  // The signal can abort while the request builds, before the dialog or the popup waits on it. An
  // app can pass one signal to many calls, so each call removes its listener as it settles.
  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
  })
  // `cancel` ends the call only until the callback arrives. After it, Tempo ID issued the tokens, so
  // the call returns them, and the caller revokes them.
  let uncancel: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    const listener = () => {
      popup?.close()
      reject(cancel?.reason)
    }
    uncancel = () => cancel?.removeEventListener('abort', listener)
    cancel?.addEventListener('abort', listener, { once: true })
  })
  // The user's close of the dialog or the popup ends the call at any step, including while its code
  // redeems, after the callback arrived.
  let close: (() => void) | undefined
  const closed = new Promise<never>((_, reject) => {
    close = () =>
      reject(new DOMException('The user closed the sign-in.', 'AbortError'))
  })
  // While the popup is open, a dialog on the page names the window, and its Cancel closes the
  // sign-in.
  const unblock = popup
    ? Sheet.waiting({ onCancel: () => close?.(), popup })
    : undefined
  // A function `challenge` and `settle` stop their own requests once the call ends, such as when a
  // later sign-in replaced it, so an ended call's request changes no state of the active one.
  const ending = new AbortController()
  // Each step that waits takes the rejections, unless the call fails before it waits.
  aborted.catch(() => {})
  cancelled.catch(() => {})
  closed.catch(() => {})
  replaced.catch(() => {})

  // The sign-in takes the preloaded frame of the same redirect URI, and keeps it loaded for the next
  // sign-in once it settles. A frame of another redirect URI closes, and so does one that the page
  // removed, such as when a framework mounts into the body after the client preloads it, or one
  // in a scheme that the page no longer declares.
  const reused =
    mode === 'iframe' &&
    entry?.redirectUri === redirectUri &&
    entry.sheet.connected()
      ? entry.sheet
      : undefined
  if (entry) actor.send({ reuse: reused !== undefined, type: 'take' })

  const store = items(auth)
  let broadcast: BroadcastChannel | undefined
  let name: string | undefined
  let unwatch: (() => void) | undefined
  // The write of the item, which the cleanup waits for, so a slow store cannot write it after the
  // cleanup removed it.
  let written: Promise<unknown> | undefined
  // The reused frame belongs to the call from the start, so a call that fails before it shows the
  // dialog keeps the frame loaded for the next one.
  let sheet: Sheet.create.ReturnType | undefined = reused
  // With `deferred`, a function `challenge` resolves after the click. Its request starts at once,
  // and the frame shows the request without it meanwhile, so the dialog shows at the click. The
  // frame receives the challenge once it arrives, and checks the request only then.
  const deferred =
    defers === true && mode === 'iframe' && typeof rest.challenge === 'function'
  // An async function turns a callback that throws into a rejection, which ends the call as a failed
  // request does, with its cleanup.
  const message =
    deferred && typeof rest.challenge === 'function'
      ? (async (challenge: (signal: AbortSignal) => Promise<string>) =>
          challenge(ending.signal))(rest.challenge)
      : undefined
  message?.catch(() => {})
  try {
    // Tempo ID's pages in a popup window show their compact screens, as OpenID Connect's
    // `display=popup` asks. Better Auth signs it into the query of each page, and a pushed request
    // holds it in its push.
    const {
      pending: built,
      state,
      url: popupUrl,
    } = await Promise.race([
      backend
        ? login(auth, backend)
        : (async () =>
            authorizeUrl(auth, {
              ...rest,
              challenge: await (() => {
                if (deferred) return undefined
                if (typeof rest.challenge === 'function')
                  return rest.challenge(ending.signal)
                return rest.challenge
              })(),
              display: 'popup',
              // A guest session signs no challenge, so a request whose challenge arrives later
              // offers no guest.
              ...(deferred ? { guest: false } : {}),
              redirectUri,
              ...(responseMode ? { responseMode } : {}),
            }))().then((value) => ({ ...value, state: value.pending.state })),
      aborted,
      cancelled,
      closed,
      replaced,
    ])
    // A deferred request names its challenge once it arrives, so its callback carries the
    // challenge's signature.
    const pending =
      deferred && built ? { ...built, challenge: true as const } : built
    // The frame takes the request's own parameters, without the popup's `display`. Only a request
    // that the instance does not push signs in there.
    const toRequest = (url: string) => {
      const query = new URL(url).searchParams
      query.delete('display')
      return query.toString()
    }
    const request = toRequest(popupUrl)
    if (mode === 'iframe')
      sheet ??= Sheet.create({ url: frameUrl(auth, { redirectUri }) })
    name = channel({ state })
    // A popup's callback page reads the item, in either mode, since the dialog can fall back to one.
    // A custom store can take long, so the signal and a later sign-in end the wait.
    const writing = Promise.resolve(store.setItem(name, true))
    written = writing
    // A deferred request shows while the item writes, so the dialog shows at the click. Its
    // challenge, which its popup and its check need, follows the write. A failed request ends the
    // call, and the frame's check never runs, so nothing is sent.
    const early = (() => {
      if (!message || !sheet) return undefined
      const target = sheet
      return new Promise<{
        callback: Callback.Received
        funding?: Sheet.machines.sheet.Funding | undefined
      }>((resolve, reject) => {
        const shown = target.show({
          deferred: true,
          onCallback: (callback, funding) => resolve({ callback, funding }),
          onClose: () => close?.(),
          request,
          timeout,
        })
        Promise.all([message, writing]).then(([value]) => {
          const url = new URL(popupUrl)
          for (const [name, parameter] of Object.entries(
            challengeParameters(auth, {
              accessKey: Boolean(rest.accessKey),
              challenge: value,
            }),
          ))
            url.searchParams.set(name, parameter)
          target.challenge({
            id: shown,
            popupUrl: url.href,
            request: toRequest(url.href),
          })
        }, reject)
      })
    })()
    early?.catch(() => {})
    // A failed challenge ends the call at once, without the write.
    const failed = message?.then(() => new Promise<never>(() => {}))
    await Promise.race([
      written,
      aborted,
      cancelled,
      closed,
      ...(failed ? [failed] : []),
      replaced,
    ])
    // The blank popup reads closed only after the user closes it, since it navigates next. Once it
    // navigates, a close counts only after Tempo ID's page reports.
    if (popup?.closed)
      throw new DOMException('The user closed the sign-in.', 'AbortError')

    // The channel opens before any popup navigates, so it receives the callback however fast the
    // popup returns.
    const listener = new BroadcastChannel(name)
    broadcast = listener
    const received = new Promise<{
      callback: Callback.Received
      funding?: Sheet.machines.sheet.Funding | undefined
    }>((resolve, reject) => {
      listener.onmessage = (event: MessageEvent<Message>) =>
        resolve({ callback: { url: event.data.url } })
      aborted.catch(reject)
      cancelled.catch(reject)
      closed.catch(reject)
      replaced.catch(reject)
      // The popup's page posts the callback here, and a user who closes the popup closes the sign-in.
      if (popup)
        unwatch = Popup.watchPopup(popup, {
          onCallback: (callback) => resolve({ callback }),
          onClose: () => close?.(),
          // The page takes input again once the popup closes, while a late callback can still arrive.
          onClosed: () => unblock?.(),
          origin: new URL(auth.url).origin,
        })
      if (early) early.then(resolve, reject)
      else
        sheet?.show({
          onCallback: (callback, funding) => resolve({ callback, funding }),
          onClose: () => close?.(),
          popupUrl,
          request,
          timeout,
        })
    })
    if (popup) popup.location.href = popupUrl
    const { callback, funding } = await received
    uncancel?.()
    // The callback page closes its popup once it delivers the callback, so a popup's close after the
    // callback ends nothing. A close of the dialog still ends the call while its code redeems.
    unwatch?.()
    unwatch = undefined
    sheet?.received()
    // The popup is closed once its callback arrives, so the page takes input again while the code
    // redeems.
    unblock?.()

    // The user selected "Continue as guest" on a request in the web message mode, which issues no
    // tokens. A sign-in plugin starts the guest session.
    if ('guest' in callback) {
      if (callback.state !== state)
        throw new RequestError({
          code: 'invalid_request',
          field: 'state',
          message:
            'Invalid `state` in the posted result. Start sign-in again from this app.',
          status: 400,
        })
      throw Callback.guestSelected()
    }
    // Tempo ID redeemed the code of a request in the web message mode, and posted its authorization.
    if ('authorization' in callback) {
      const authorization = await (async () => {
        try {
          return redirect.handleResult({
            accessKey: rest.accessKey,
            authorization: callback.authorization,
            // Only a request that the page builds asks for the web message mode, so `pending` is set.
            pending: pending!,
            state: callback.state,
          }) as result
        } catch (error) {
          // No session holds the refresh token of a refused response, so it is revoked, as a refused
          // redemption's is. A failed revocation leaves the refusal as the error.
          const refreshToken = callback.authorization.refresh_token
          if (typeof refreshToken === 'string')
            await Api.revoke(auth, { refreshToken }).catch(() => undefined)
          throw error
        }
      })()
      if (settle)
        await Promise.race([
          settle(authorization as Authorization, ending.signal),
          aborted,
          closed,
          replaced,
        ])
      dropped(auth, { authorization, signal })
      return { authorization, funding }
    }
    const callbackUrl = new URL(callback.url)
    // The channel's name holds the state, but the check repeats it before a denial throws.
    const ours = callbackUrl.searchParams.getAll('state').at(-1) === state
    const denial = Callback.error(callbackUrl, { redirectUri })
    if (ours && denial) throw denial
    // The signal, a close, and a later sign-in end the call while its code redeems too, which writes
    // nothing. No caller then holds the tokens that the redemption returns, so they are revoked.
    const redemption = backend
      ? undefined
      : redirect.handleCallback(auth, {
          accessKey: rest.accessKey,
          pending: pending!,
          url: callbackUrl,
        })
    const authorization = (await Promise.race([
      redemption ?? complete(auth, { ...backend!, url: callbackUrl }),
      aborted,
      closed,
      replaced,
    ]).catch((error: unknown) => {
      // The call rejects at once, and the revocation runs once the redemption settles.
      if (redemption) void discard(auth, { redemption })
      throw error
    })) as result
    if (settle)
      await Promise.race([
        settle(authorization as Authorization, ending.signal),
        aborted,
        closed,
        replaced,
      ])
    // A signal that aborts as the redemption settles still rejects the call.
    dropped(auth, { authorization, signal })
    return { authorization, funding }
  } finally {
    ending.abort()
    if (abort) signal?.removeEventListener('abort', abort)
    uncancel?.()
    broadcast?.close()
    unwatch?.()
    subscription.unsubscribe()
    // A later sign-in that replaced this one keeps its own frame, which holds the session that it
    // signs in, so this one keeps no frame and preloads none. The frame takes the next sign-in's
    // request too, whether it preloaded or not, unless it failed and the dialog offers a popup in
    // its place, or another preload replaced it.
    const { keep, owned, queued } = machines.ending(actor.getSnapshot(), {
      call,
      framed: sheet !== undefined,
    })
    const kept = keep && sheet !== undefined && sheet.hide()
    actor.send({
      call,
      kept:
        kept && sheet
          ? { options: { redirectUri }, redirectUri, sheet }
          : undefined,
      type: 'end',
    })
    // The approval pages read the trust that the taken frame reported, since a frame that reported
    // no trust is not loaded again.
    const trusted = entry?.sheet.trusted()
    if (trusted !== undefined) reports.set(auth, trusted)
    if (!kept) {
      sheet?.close()
      // A browser without IntersectionObserver v2 signs in to an app that Tempo ID does not trust
      // through a popup, so it preloads no frame for that app again. A preload that the page asked
      // for during the sign-in loads now.
      const usable = visibility() || trusted !== false
      const next = entry?.options ?? queued
      if (owned && next && usable && !machines.entry(actor.getSnapshot()))
        preload(auth, next)
    }
    unblock?.()
    // After a page severs the handle to the popup, `close` does nothing, and the callback page closes
    // the popup itself.
    popup?.close()
    // Only a popup's callback page reads the item, while a sign-in waits, so a slow or failing
    // store holds neither the call's result nor its error. The item stays at worst.
    if (name) {
      const item = name
      void (written ?? Promise.resolve())
        .then(() => store.removeItem(item))
        .catch(() => {})
    }
  }
}

/**
 * Revokes the refresh token that `redemption` returns, for a sign-in that ended while its code
 * redeemed, such as at a close of the dialog. A failed redemption or revocation changes nothing.
 */
async function discard(auth: Config, options: discard.Options) {
  const authorization = await options.redemption.catch(() => undefined)
  const refreshToken = authorization?.refreshToken
  if (refreshToken)
    await Api.revoke(auth, { refreshToken }).catch(() => undefined)
}

/**
 * Throws the reason of `signal` once it aborted, and revokes the refresh token of `authorization`,
 * which no caller then holds. The call rejects at once, and the revocation runs beside it.
 */
function dropped(auth: Config, options: dropped.Options) {
  const { authorization, signal } = options
  if (!signal?.aborted) return
  void discard(auth, {
    redemption: Promise.resolve(
      authorization as { refreshToken?: string | undefined },
    ),
  })
  signal.throwIfAborted()
}

declare namespace dropped {
  type Options = {
    /** The authorization that the call returns, unless the signal aborted. */
    authorization: unknown
    /** The signal of the call. */
    signal?: AbortSignal | undefined
  }
}

declare namespace discard {
  type Options = {
    /** The redemption of the callback's code, which settles after the call ended. */
    redemption: Promise<{ refreshToken?: string | undefined }>
  }
}

export declare namespace signIn {
  type Options<
    accessKey extends WithAccount | WithAddress | undefined =
      | WithAccount
      | WithAddress
      | undefined,
  > = Omit<redirect.createUrl.Options<accessKey>, 'challenge'> & {
    /**
     * A message, which `challengeSignature` signs as `address`, as in `redirect.createUrl`, or a
     * function that returns it. The function runs after the dialog or the popup opens, so a popup
     * opens within the gesture also when the message comes from a request, such as a backend's. Its
     * signal aborts once the call ends, such as when a later sign-in replaces it.
     */
    challenge?: string | ((signal: AbortSignal) => Promise<string>) | undefined
    /**
     * Rejects the call with the signal's reason, and closes the dialog or the popup, only until the
     * callback arrives. After it, the call resolves with the issued tokens, so the caller revokes
     * them, such as at a sign-out that overtook the sign-in.
     */
    cancel?: AbortSignal | undefined
    /**
     * `same-origin` for a page that sends `Cross-Origin-Opener-Policy: same-origin`, which severs
     * the popup's handle to the page. The sign-in then redeems a code on the page, since the popup
     * posts nothing. Absent, Tempo ID redeems the code and its page posts the authorization, which
     * saves the page's request to the token endpoint. A page that severs the handle without it
     * signs in again with `same-origin`.
     */
    crossOriginOpenerPolicy?: 'same-origin' | undefined
    /**
     * Whether the frame shows the request at the call, without its message, while a function
     * `challenge` runs, such as one that requests the message from the app's server. The frame
     * checks the request once the message arrives, so every action waits for it. Defaults to
     * `false`: the dialog shows once the function returns. A popup opens at the call either way.
     */
    deferred?: boolean | undefined
    /**
     * `iframe` to sign in in a dialog on the page, or `popup` for a popup window. Defaults to
     * `iframe`, which falls back to `popup` outside a secure context, on a page on `http:` for a
     * Tempo ID on `https:`, for an instance that pushes its requests with `par`, and for a request
     * with `funding` whose deposit page runs Coinflow where no frame can: Buy MACH for a hint of
     * `MACH` on Tempo mainnet, on iOS and iPadOS.
     */
    mode?: 'iframe' | 'popup' | undefined
    /**
     * The scopes of the tokens, separated by spaces, such as without `offline_access` for a sign-in
     * whose tokens the page does not keep. Defaults to the instance's `scope`.
     */
    scope?: string | undefined
    /**
     * Rejects the call with the signal's reason, such as on a timeout or a cancel button. Without
     * it, a popup that the user closes on a page that severs its handle to the popup, with
     * `Cross-Origin-Opener-Policy: same-origin`, leaves the call pending until the next call.
     */
    signal?: AbortSignal | undefined
    /**
     * Milliseconds that the frame has to show the request after the call, before the dialog offers
     * a popup. Defaults to 10,000.
     */
    timeout?: number | undefined
  }

  type BackendOptions = Pick<
    Options,
    'crossOriginOpenerPolicy' | 'mode' | 'redirectUri' | 'signal' | 'timeout'
  > & {
    /**
     * The path where the app mounts `accounts.handler` on the page's origin: the server's
     * `handler.basePath`, under whose `/auth` the `backend` plugin serves its sign-in routes. `true`
     * names the default, `/api`.
     * `POST /login` builds the request, and `POST /callback` redeems the code and sets the session
     * cookie, so the page holds no token. The call resolves with the session that the page reads,
     * and sets no session of the instance. The redirect URI defaults to `/auth/callback` under the path.
     */
    backend: string | true
    /**
     * `siwe` to sign in with a SIWE message of the `siwe` plugin: `POST /siwe/challenge` issues it
     * after the dialog opens, the account signs it, and `POST /siwe/verify` sets the session cookie.
     * Defaults to `tempo-id`, a Tempo ID sign-in.
     */
    method?: 'siwe' | 'tempo-id' | undefined
  }

  /**
   * The authorization, without its access key for a sign-in without `accessKey`, and without
   * `accessKey` for an access key that another party holds.
   */
  type ReturnType<
    hasAccessKey extends boolean = false,
    addressed extends boolean = false,
  > = hasAccessKey extends false
    ? redirect.handleCallback.WithoutAccessKey
    : addressed extends true
      ? Authorization_.Addressed
      : Authorization
}

export declare namespace signMessage {
  type Options = Pick<
    signIn.Options,
    'crossOriginOpenerPolicy' | 'mode' | 'redirectUri' | 'signal' | 'timeout'
  > & {
    /**
     * The message to sign, such as a SIWE message, or a function that returns it, such as from a
     * request to the app's backend. Tempo ID's page shows it. The function's signal aborts once the
     * sign-in ends, such as when a later sign-in replaces it.
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

declare namespace authorize {
  type Options<
    accessKey extends WithAccount | WithAddress | undefined = undefined,
  > = signIn.Options<accessKey> & {
    /**
     * The `backend` plugin's sign-in routes, whose `POST /login` builds the request and whose
     * `POST /callback` redeems the code. Absent, the page does both.
     */
    backend?: { basePath: string } | undefined
    /** Whether the call retries a sign-in outside the gesture, so a popup waits for a click. */
    retried?: boolean | undefined
    /**
     * Runs with the authorization before the call ends, such as a backend's verification of its
     * signed message. A later sign-in, the signal, or a close of the dialog ends it too, and aborts
     * the signal that it receives.
     */
    settle?:
      | ((authorization: Authorization, signal: AbortSignal) => Promise<void>)
      | undefined
  }

  type ReturnType<result> = {
    /** The authorization, or the backend's session. */
    authorization: result
    /** The deposit page that the app opens after the sign-in. Absent for none. */
    funding?: Sheet.machines.sheet.Funding | undefined
  }
}

/**
 * Starts a sign-in at the backend's `POST /login`, which keeps the request's pending state and sets
 * its cookie. Returns the request's URL and `state`. The page keeps no pending state.
 * Throws `Accounts.RequestError` with status 0 without a response.
 */
async function login(auth: Config, options: { basePath: string }) {
  // A request without a response, such as offline, throws `server_error` with status 0, as the
  // sign-in without a backend does, so the app tells it from a refusal and retries.
  const response = await Api.answered(auth, {
    message:
      'The sign-in received no response from the backend. Check the connection, then sign in again.',
  }).fetch!(new URL(`${options.basePath}/login`, window.location.origin), {
    credentials: 'same-origin',
    method: 'POST',
    redirect: 'manual',
  })
  const { url } = await Api.json<{ url: string }>(response)
  // The backend never pushes the dialog's request, so its URL holds `state`.
  const state = new URL(url).searchParams.get('state')!
  return { pending: undefined, state, url }
}

/**
 * Sends the callback URL to the backend's `POST /callback`, which redeems the code and sets the
 * session cookie. Returns the session that the page reads. Throws `Accounts.RequestError` for a
 * refusal, such as a callback of another sign-in, with `signedIn` when the backend's code exchange
 * failed after the user signed in, and with status 0 and `signedIn` without a response.
 */
async function complete(auth: Config, options: { basePath: string; url: URL }) {
  // The user signed in on Tempo ID, so a callback without a response, or without its body, has
  // `signedIn`.
  try {
    const response = await (auth.fetch ?? fetch)(
      new URL(`${options.basePath}/callback`, window.location.origin),
      {
        body: JSON.stringify({ url: options.url.href }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        redirect: 'manual',
      },
    )
    const { session } = await Api.json<{ session: PageSession.TempoId }>(
      response,
    )
    return session
  } catch (error) {
    if (error instanceof RequestError && error.status !== 0) throw error
    return Api.signedIn(error, {
      message:
        'The sign-in received no response from the backend after the user signed in. Check the connection, then sign in again.',
    })
  }
}

/**
 * Issues a SIWE message at the backend's `POST /siwe/challenge`, which keeps its challenge and sets
 * its cookie. Returns the message.
 */
async function siweChallenge(
  auth: Config,
  options: { basePath: string; signal: AbortSignal },
) {
  const response = await (auth.fetch ?? fetch)(
    new URL(`${options.basePath}/siwe/challenge`, window.location.origin),
    {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'manual',
      signal: options.signal,
    },
  ).catch((error: unknown) => unanswered(error, { signal: options.signal }))
  const { message } = await Api.json<{ message: string }>(response)
  return message
}

/**
 * Sends the signed message to the backend's `POST /siwe/verify`, which verifies it and sets the
 * session cookie. Returns the session that the page reads. Throws `Accounts.RequestError` for a
 * refusal, such as a spent challenge, and the reason of `signal` when it aborts.
 */
async function siweVerify(
  auth: Config,
  options: signMessage.ReturnType & {
    basePath: string
    signal?: AbortSignal | undefined
  },
) {
  const { address, basePath, message, signal, signature } = options
  const response = await (auth.fetch ?? fetch)(
    new URL(`${basePath}/siwe/verify`, window.location.origin),
    {
      body: JSON.stringify({ address, message, signature }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'manual',
      signal: signal ?? null,
    },
  ).catch((error: unknown) => unanswered(error, { signal }))
  const { session } = await Api.json<{ session: PageSession.Siwe }>(response)
  return session
}

/**
 * Throws `Accounts.RequestError` with `server_error` and status 0 for a SIWE route that receives
 * no response, such as offline. Rethrows the error of an aborted `signal`, such as a closed dialog.
 */
function unanswered(
  error: unknown,
  options: { signal?: AbortSignal | undefined },
): never {
  if (options.signal?.aborted) throw error
  throw new RequestError({
    cause: error,
    code: 'server_error',
    message:
      'The sign-in received no response from the backend. Check the connection, then sign in again.',
    status: 0,
  })
}

/** What {@link callback} posts to the opening page. */
type Message = {
  /** The callback URL, with its `code` and `state`, or its `error`. */
  url: string
}

/**
 * Milliseconds after which a call of IndexedDB for a sign-in's item counts as failed, since some
 * browsers leave an open of IndexedDB pending, such as Safari 14.1 after launch. A cold open in a new
 * popup window on a slow device can take seconds, and a read that ends early misses a valid item, so
 * the limit is long.
 */
const sharedTimeout = 10_000

/**
 * Returns the store of a sign-in's item, which the popup's callback page reads. That page is another
 * window, so the item stays in IndexedDB, which every window of the origin shares, also for an
 * instance whose `store` holds its values in one window, such as `Store.memory`. The item stays in
 * the instance's store too, so a callback page that reads only that store, such as one of an earlier
 * release, finds it. A write resolves once both stores settle, and rejects only when neither holds
 * the item. A read returns the first item that either store holds. IndexedDB that refuses or stalls a
 * call fails no sign-in, since each of its calls ends after {@link sharedTimeout}.
 */
function items(auth: Config): Store {
  const own = DefaultStore.get(auth.store)!
  const shared = DefaultStore.get(undefined)
  if (!shared || shared === own) return own
  // Each key's write to each store, which that store's removal follows, so no write lands after its
  // removal, and a stalled write of IndexedDB holds back no removal from the instance's store.
  const writes = new Map<
    string,
    { own: Promise<unknown>; shared: Promise<unknown> }
  >()
  /** Returns `promise`, or rejects after {@link sharedTimeout}. */
  const bounded = <value>(promise: Promise<value>) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('The store timed out.')),
          sharedTimeout,
        )
      }),
    ])
  return {
    async getItem(key) {
      // A custom `store` may return `null` for a missing item.
      const found = (value: unknown) =>
        value == null ? Promise.reject(new Error()) : value
      return await Promise.any([
        bounded(shared.getItem(key)).then(found),
        own.getItem(key).then(found),
      ]).catch(() => undefined)
    },
    async removeItem(key) {
      const pending = writes.get(key)
      writes.delete(key)
      const settled = (promise: Promise<unknown> | undefined) =>
        Promise.resolve(promise).catch(() => undefined)
      await Promise.all([
        settled(pending?.shared).then(() =>
          bounded(shared.removeItem(key)).catch(() => {}),
        ),
        settled(pending?.own).then(() => own.removeItem(key)),
      ])
    },
    async setItem(key, value) {
      const sharedWrite = shared.setItem(key, value)
      const ownWrite = own.setItem(key, value)
      writes.set(key, { own: ownWrite, shared: sharedWrite })
      // A callback page of this release in another window reads IndexedDB, and one of an earlier
      // release reads only the instance's store, so the write waits for both, and rejects only when
      // neither holds the item.
      const [sharedResult, ownResult] = await Promise.allSettled([
        bounded(sharedWrite),
        ownWrite,
      ])
      if (sharedResult.status === 'rejected' && ownResult.status === 'rejected')
        throw ownResult.reason
    },
  }
}

/** Returns the name of a dialog's channel, which is also its key in {@link items}. */
function channel(options: channel.Options) {
  return `tempo-id:dialog:${options.state}`
}

declare namespace channel {
  type Options = {
    /** The sign-in's `state`. */
    state: string
  }
}

/** Each instance's dialog, which only `preload` and `signIn` read and send to. */
const slots = new WeakMap<Config, machines.dialog.Actor>()

/** The trust that each instance's last frame reported before a sign-in took it. */
const reports = new WeakMap<Config, boolean>()

/** Returns the instance's dialog, which the instance's first `preload` or `signIn` creates. */
function slot(auth: Config) {
  const existing = slots.get(auth)
  if (existing) return existing
  const actor = createActor(
    machines.dialog.provide({
      actions: { close: ({ context }) => context.entry?.sheet.close() },
    }),
  ).start()
  slots.set(auth, actor)
  // The approval pages, such as the payment's, frame Tempo ID where the preloaded frame does.
  FrameTrust.register(auth, {
    read: () =>
      machines.entry(actor.getSnapshot())?.sheet.trusted() ?? reports.get(auth),
  })
  return actor
}

/**
 * Returns whether Tempo ID can frame the sign-in on this page: a secure context on the redirect
 * URI's origin, and not a page on `http:` for a Tempo ID on `https:`.
 */
function framed(auth: Config, options: framed.Options) {
  return (
    window.isSecureContext &&
    new URL(options.redirectUri).origin === window.location.origin &&
    !Popup.http({ page: window.location.href, url: auth.url })
  )
}

declare namespace framed {
  type Options = {
    /** The redirect URI, whose origin frames the page. */
    redirectUri: string
  }
}

/** Returns the `/embed` URL of the instance's frame, which takes any request of the app. */
function frameUrl(auth: Config, options: frameUrl.Options) {
  const url = new URL('/embed', auth.url)
  url.search = new URLSearchParams({
    client_id: auth.clientId,
    redirect_uri: options.redirectUri,
  }).toString()
  return url.href
}

declare namespace frameUrl {
  type Options = {
    /** The redirect URI, whose origin frames the page and receives the callback. */
    redirectUri: string
  }
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

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The machine. Two regions run in parallel: `frame`, the preloaded frame, and `call`, the sign-in
   * that holds the dialog.
   *
   * | State               | Meaning                                                              |
   * | ------------------- | -------------------------------------------------------------------- |
   * | `frame.empty`       | No frame is preloaded. A sign-in that holds one owns it.             |
   * | `frame.preloaded`   | A hidden frame waits for the next sign-in, in `context.entry`.       |
   * | `call.idle`         | No sign-in holds the dialog.                                         |
   * | `call.running`      | The sign-in of `context.call` holds the dialog. A preload waits in  |
   * |                     | `context.queued` until it ends, which loads it if it kept no frame. |
   */
  export const dialog = setup({
    actions: {
      /** Closes the preloaded frame. `dialog.ts` provides it. */
      close: () => {},
      /** Ends the sign-in that holds the dialog, and drops the preload that waited for it. */
      finish: assign({ call: undefined, queued: undefined }),
      /** Holds the frame that the sign-in kept, or the new preload. */
      hold: assign(({ event }) => {
        if (event.type === 'preload') return { entry: event.entry }
        if (event.type === 'end') return { entry: event.kept }
        return {}
      }),
      /** Holds the options of a preload that waits for the sign-in that holds the dialog. */
      queue: assign(({ event }) =>
        event.type === 'queue' ? { queued: event.options } : {},
      ),
      /** Emits `replaced` for the sign-in that holds the dialog. */
      replace: emit(({ context }) => ({
        call: context.call ?? 0,
        type: 'replaced' as const,
      })),
      /** Gives the sign-in that starts the next token. */
      start: assign(({ context }) => ({
        call: context.calls + 1,
        calls: context.calls + 1,
      })),
      /** Releases the preloaded frame, which a sign-in owns or closed. */
      take: assign({ entry: undefined }),
    },
    guards: {
      /** Whether the sign-in that ended kept its frame loaded for the next one. */
      kept: ({ event }) => event.type === 'end' && event.kept !== undefined,
      /** Whether the sign-in that ended still holds the dialog. */
      owned: ({ context, event }) =>
        event.type === 'end' && event.call === context.call,
      /** Whether the sign-in shows the preloaded frame. */
      reuse: ({ event }) => event.type === 'take' && event.reuse,
    },
    types: {
      context: {} as machines.dialog.Context,
      emitted: {} as machines.dialog.Emitted,
      events: {} as machines.dialog.Event,
    },
  }).createMachine({
    context: { call: undefined, calls: 0, entry: undefined, queued: undefined },
    id: 'dialog',
    states: {
      call: {
        initial: 'idle',
        states: {
          idle: {
            on: { start: { actions: 'start', target: 'running' } },
          },
          running: {
            on: {
              end: { actions: 'finish', guard: 'owned', target: 'idle' },
              queue: { actions: 'queue' },
              replace: { actions: 'replace' },
              // A sign-in that the browser's popup blocker refused never starts, so the sign-in that
              // it replaced still holds the dialog.
              start: { actions: 'start', reenter: true, target: 'running' },
            },
          },
        },
      },
      frame: {
        initial: 'empty',
        states: {
          empty: {
            on: {
              end: { actions: 'hold', guard: 'kept', target: 'preloaded' },
              preload: { actions: 'hold', target: 'preloaded' },
            },
          },
          preloaded: {
            on: {
              discard: { actions: ['close', 'take'], target: 'empty' },
              preload: {
                actions: ['close', 'hold'],
                reenter: true,
                target: 'preloaded',
              },
              take: [
                { actions: 'take', guard: 'reuse', target: 'empty' },
                { actions: ['close', 'take'], target: 'empty' },
              ],
            },
          },
        },
      },
    },
    type: 'parallel',
  })

  /** The types of {@link dialog}. */
  export namespace dialog {
    /** A frame that the instance preloaded, which the next sign-in of the same redirect URI takes. */
    export type Entry = {
      /** The options of the preload, which the next one reuses. */
      options: {
        /** The redirect URI that the preload named, if any. */
        redirectUri?: string | undefined
      }
      /** The redirect URI of the frame, with the default filled. */
      redirectUri: string
      /** The hidden dialog that frames the sign-in. */
      sheet: Sheet.create.ReturnType
    }

    /** The context of the machine. */
    export type Context = {
      /** The token of the sign-in that holds the dialog, which the next sign-in replaces. */
      call: number | undefined
      /** The number of sign-ins that started, which gives each one its token. */
      calls: number
      /** The preloaded frame, while `frame` is `preloaded`. */
      entry: Entry | undefined
      /** The options of a preload that waits for the sign-in that holds the dialog, if any. */
      queued: Entry['options'] | undefined
    }

    /** An event of the machine. */
    export type Event =
      | {
          /** The preloaded frame closes, such as for a new preload. */
          type: 'discard'
        }
      | {
          /** The token of the sign-in that ended. */
          call: number
          /** The frame that the sign-in kept loaded for the next one, which it hid, if any. */
          kept: Entry | undefined
          /** A sign-in ended. */
          type: 'end'
        }
      | {
          /** The frame that loads hidden for the next sign-in. */
          entry: Entry
          /** The instance preloaded a frame. */
          type: 'preload'
        }
      | {
          /** The options of the preload. */
          options: Entry['options']
          /** The instance asked for a preload while a sign-in holds the dialog. */
          type: 'queue'
        }
      | {
          /** A sign-in starts, which replaces the one that holds the dialog, if any. */
          type: 'replace'
        }
      | {
          /** The replacing sign-in holds the dialog, and takes the next token. */
          type: 'start'
        }
      | {
          /** Whether the sign-in shows the preloaded frame, which it then owns, or closes it. */
          reuse: boolean
          /** A sign-in takes the preloaded frame. */
          type: 'take'
        }

    /** An event that the machine emits. */
    export type Emitted = {
      /** The token of the sign-in that the next one replaced. */
      call: number
      /** A later sign-in replaced the sign-in of `call`, which rejects. */
      type: 'replaced'
    }

    /** A running instance of {@link machine}. */
    export type Actor = XStateActor<typeof dialog>

    /** A snapshot of {@link machine}. */
    export type Snapshot = ReturnType<Actor['getSnapshot']>
  }

  /**
   * Returns what an ending sign-in of `call` does with its frame:
   *
   * - `owned`: whether it still holds the dialog, so no later sign-in replaced it.
   * - `keep`: whether it hides its frame and keeps it for the next sign-in, which it does while it
   *   holds the dialog and no other preload took the instance's place. `dialog.ts` then hides the
   *   frame, which a failed frame refuses.
   * - `queued`: the options of the preload that waited for it, which loads if it keeps no frame.
   */
  export function ending(
    snapshot: machines.dialog.Snapshot,
    options: machines.ending.Options,
  ): machines.ending.ReturnType {
    const owned = options.call === snapshot.context.call
    return {
      keep: owned && options.framed && snapshot.matches({ frame: 'empty' }),
      owned,
      queued: owned ? snapshot.context.queued : undefined,
    }
  }

  export declare namespace ending {
    type Options = {
      /** The token of the sign-in that ends. */
      call: number
      /** Whether the sign-in holds a frame. */
      framed: boolean
    }

    type ReturnType = {
      /** Whether the sign-in hides its frame and keeps it for the next one. */
      keep: boolean
      /** Whether the sign-in still holds the dialog. */
      owned: boolean
      /** The options of the preload that waited for the sign-in, if it still holds the dialog. */
      queued: machines.dialog.Entry['options'] | undefined
    }
  }

  /** Returns whether a sign-in holds the dialog, so a preload waits for it. */
  export function running(snapshot: machines.dialog.Snapshot) {
    return snapshot.matches({ call: 'running' })
  }

  /** Returns the preloaded frame, or `undefined` without one. */
  export function entry(snapshot: machines.dialog.Snapshot) {
    return snapshot.context.entry
  }
}
