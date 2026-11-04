/**
 * Signs the user in on Tempo ID without leaving the app's page: in a frame of Tempo ID's embedded
 * sign-in, which a dialog shows on the page, or in a popup window. Either way the page keeps the
 * PKCE verifier and the access key in memory, and redeems the code. Tempo ID's page in a popup posts the
 * callback to the page that opened it. On a page whose own `Cross-Origin-Opener-Policy` severs that
 * handle, the popup returns to the redirect URI, whose page calls {@link callback}.
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
import type { Config } from '../Id.js'
import type { Authorization } from '../Authorization.js'
import type { Keyed, WithAccount } from '../Permissions.js'
import * as Callback from '../internal/callback.js'
import * as DefaultStore from '../internal/defaultStore.js'
import { authorizeUrl, pushes } from '../internal/request.js'
import * as Popup from '../internal/popup.js'
import * as Sheet from '../internal/sheet.js'
import * as Funding from './funding.js'
import * as redirect from './redirect.js'

/** The browser blocked the popup, since `signIn` ran outside a user gesture such as a click. */
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
 * that called `signIn`.
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
 * Posts the callback to the page that opened the popup, and closes the popup. Returns `true` on the
 * callback of a {@link signIn}, and `false` on any other page load, such as a redirect's callback.
 * Tempo ID's page in the popup posts the callback to the opening page itself, so only an app whose
 * page sends `Cross-Origin-Opener-Policy: same-origin` needs it. That policy severs the popup's
 * `window.opener`, and the popup then returns to the redirect URI. Call it there before
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
  const store = DefaultStore.get(auth.store)!
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
 * once. Call it when the page loads, such as beside the sign-in button. `tempoId` calls it when it
 * creates the client, unless its `preload` is `false`. Without it, the dialog shows once its frame
 * loads.
 *
 * The frame loads without a request, so `signIn` takes it whatever its access key or challenge. Each sign-in keeps the frame loaded, and the next one posts its request to the same
 * frame, which starts the sign-in again. Outside a secure context, and for an instance that pushes
 * its requests with `par`, it loads nothing, since `signIn` then opens a popup. On a page that is
 * not on the redirect URI's origin it loads nothing either, since `signIn` then throws.
 *
 * @example
 * ```ts
 * Actions.dialog.preload(auth)
 * button.onclick = () => Actions.dialog.signIn(auth, { accessKey })
 * ```
 */
export function preload(auth: Config, options: preload.Options = {}): void {
  slot(auth).send({ type: 'discard' })
  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  if (!framed({ redirectUri }) || pushes(auth)) return

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
 * that origin. Outside a secure context, `iframe` signs in with `popup`. An instance that pushes its
 * requests with `par` signs in with `popup` too, since the frame takes the request's own parameters,
 * and Tempo ID reads a pushed request only from its push. A request with `funding` signs in in the
 * frame. If the account holds less than the hint, the call redeems the code, then opens the deposit
 * page as `Actions.funding.open` does in `frame` mode, and resolves once that page returns or closes.
 * On iOS and iPadOS, such a request signs in with `popup`, whose pages show the deposit page. The next call of the
 * instance replaces a pending call in either mode, and rejects it with an `AbortError`. A popup that
 * the user closes rejects the call with an `AbortError` too. A page that sends
 * `Cross-Origin-Opener-Policy: same-origin` severs its handle to the popup, so a popup that the user
 * closes there leaves the call pending until `signal` aborts or the next call replaces it.
 *
 * @example
 * ```ts
 * button.onclick = async () => {
 *   const authorization = await Actions.dialog.signIn(auth)
 * }
 * ```
 */
export async function signIn<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey> = {},
): Promise<signIn.ReturnType<Keyed<accessKey>>> {
  // `authorize` chooses the mode before its first `await`, so a popup still opens within the gesture.
  const { authorization, funding } = await authorize(auth, options)
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
  options.signal?.throwIfAborted()
  return authorization
}

/**
 * Signs the user in, as {@link signIn} describes, and resolves with the authorization and the deposit
 * page that the frame's sign-in leaves to the app.
 */
async function authorize<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey>,
): Promise<authorize.ReturnType<Keyed<accessKey>>> {
  const {
    mode: requested = 'iframe',
    signal,
    timeout = 10_000,
    ...rest
  } = options
  signal?.throwIfAborted()

  // The mode is chosen before the first `await`, so a popup still opens within the gesture. Tempo
  // ID lets only the redirect URI's origin frame the sign-in, and only in a secure context. A
  // browser without IntersectionObserver v2 cannot show that nothing covers the frame, so only a
  // frame that Tempo ID trusts, as its loaded page reports, signs in there. The frame takes the
  // request's own parameters, so an instance that pushes them signs in with a popup. iOS and iPadOS
  // open the deposit page in a popup, which only the gesture opens, so a request with a funding
  // hint signs in with a popup there, whose own pages show the deposit page.
  const redirectUri =
    rest.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  // A popup's callback page posts on a channel of its own origin, which no page of another origin
  // receives.
  if (new URL(redirectUri).origin !== window.location.origin)
    throw new OriginError({ origin: window.location.origin, redirectUri })
  // The page takes clicks while a popup is open, and until a frame's dialog shows, so a sign-in in
  // either mode ends when the next one starts.
  const actor = slot(auth)
  actor.send({ type: 'replace' })
  const entry = machines.entry(actor.getSnapshot())
  const mode =
    requested === 'iframe' &&
    !(rest.funding && Popup.apple()) &&
    !pushes(auth) &&
    framed({ redirectUri }) &&
    (visibility() || entry?.sheet.trusted() === true)
      ? 'iframe'
      : 'popup'

  // Outside a gesture, such as after a failed transaction, a popup blocker refuses the popup that
  // `iframe` falls back to, so a dialog offers it, and the user's click on Continue starts the
  // sign-in again. The offer holds the dialog's token, so a later sign-in replaces it.
  if (requested !== 'popup' && mode === 'popup' && !Popup.activated())
    return await new Promise((resolve, reject) => {
      actor.send({ type: 'start' })
      const call = actor.getSnapshot().context.call ?? 0
      const settle = (fn: () => void) => {
        close()
        subscription.unsubscribe()
        signal?.removeEventListener('abort', abort)
        actor.send({ call, kept: undefined, type: 'end' })
        fn()
      }
      const abort = () => settle(() => reject(signal?.reason))
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
            authorize(auth, { ...options, mode: 'popup' }).then(resolve, reject)
          }),
        text: 'Continue in a Tempo ID window to finish signing in.',
      })
      signal?.addEventListener('abort', abort, { once: true })
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
  // Each step that waits takes the rejections, unless the call fails before it waits.
  aborted.catch(() => {})
  closed.catch(() => {})
  replaced.catch(() => {})

  // The sign-in takes the preloaded frame of the same redirect URI, and keeps it loaded for the next
  // sign-in once it settles. A frame of another redirect URI closes, and so does one that the page
  // removed, such as when a framework mounts into the body after the client preloads it.
  const reused =
    mode === 'iframe' &&
    entry?.redirectUri === redirectUri &&
    entry.sheet.connected()
      ? entry.sheet
      : undefined
  if (entry) actor.send({ reuse: reused !== undefined, type: 'take' })

  const store = DefaultStore.get(auth.store)!
  let broadcast: BroadcastChannel | undefined
  let name: string | undefined
  let unwatch: (() => void) | undefined
  // The write of the item, which the cleanup waits for, so a slow store cannot write it after the
  // cleanup removed it.
  let written: Promise<unknown> | undefined
  // The reused frame belongs to the call from the start, so a call that fails before it shows the
  // dialog keeps the frame loaded for the next one.
  let sheet: Sheet.create.ReturnType | undefined = reused
  try {
    // Tempo ID's pages in a popup window show their compact screens, as OpenID Connect's
    // `display=popup` asks. Better Auth signs it into the query of each page, and a pushed request
    // holds it in its push.
    const { pending, url: popupUrl } = await Promise.race([
      authorizeUrl(auth, { ...rest, display: 'popup', redirectUri }),
      aborted,
      closed,
      replaced,
    ])
    // The frame takes the request's own parameters, without the popup's `display`. Only a request
    // that the instance does not push signs in there.
    const request = (() => {
      const query = new URL(popupUrl).searchParams
      query.delete('display')
      return query.toString()
    })()
    if (mode === 'iframe')
      sheet ??= Sheet.create({ url: frameUrl(auth, { redirectUri }) })
    name = channel({ state: pending.state })
    // A popup's callback page reads the item, in either mode, since the dialog can fall back to one.
    // A custom store can take long, so the signal and a later sign-in end the wait.
    written = Promise.resolve(store.setItem(name, true))
    await Promise.race([written, aborted, closed, replaced])
    // The blank popup reads closed only after the user closes it, since it navigates next. Once it
    // navigates, a close counts only after Tempo ID's page reports.
    if (popup?.closed)
      throw new DOMException('The user closed the sign-in.', 'AbortError')

    // The channel opens before any popup navigates, so it receives the callback however fast the
    // popup returns.
    const listener = new BroadcastChannel(name)
    broadcast = listener
    const received = new Promise<{
      funding?: Sheet.machines.sheet.Funding | undefined
      url: string
    }>((resolve, reject) => {
      listener.onmessage = (event: MessageEvent<Message>) =>
        resolve({ url: event.data.url })
      aborted.catch(reject)
      closed.catch(reject)
      replaced.catch(reject)
      // The popup's page posts the callback here, and a user who closes the popup closes the sign-in.
      if (popup)
        unwatch = Popup.watchPopup(popup, {
          onCallback: (url) => resolve({ url }),
          onClose: () => close?.(),
          // The page takes input again once the popup closes, while a late callback can still arrive.
          onClosed: () => unblock?.(),
          origin: new URL(auth.url).origin,
        })
      sheet?.show({
        onCallback: (url, funding) => resolve({ funding, url }),
        onClose: () => close?.(),
        popupUrl,
        request,
        timeout,
      })
    })
    if (popup) popup.location.href = popupUrl
    const { funding, url } = await received
    const callbackUrl = new URL(url)
    // The callback page closes its popup once it delivers the callback, so a popup's close after the
    // callback ends nothing. A close of the dialog still ends the call while its code redeems.
    unwatch?.()
    unwatch = undefined
    sheet?.received()
    // The popup is closed once its callback arrives, so the page takes input again while the code
    // redeems.
    unblock?.()

    // The channel's name holds the state, but the check repeats it before a denial throws.
    const ours =
      callbackUrl.searchParams.getAll('state').at(-1) === pending.state
    const denial = Callback.error(callbackUrl, { redirectUri })
    if (ours && denial) throw denial
    // The signal and a later sign-in end the call while its code redeems too, which writes nothing,
    // so a redemption that settles after the call ends has no effect.
    const authorization = (await Promise.race([
      redirect.handleCallback(auth, {
        accessKey: rest.accessKey,
        pending,
        url: callbackUrl,
      }),
      aborted,
      closed,
      replaced,
    ])) as signIn.ReturnType<Keyed<accessKey>>
    // A signal that aborts as the redemption settles still rejects the call.
    signal?.throwIfAborted()
    return { authorization, funding }
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    broadcast?.close()
    unwatch?.()
    subscription.unsubscribe()
    // A later sign-in that replaced this one keeps its own frame, which holds the session that it
    // signs in, so this one keeps no frame and preloads none. The frame takes the next sign-in's
    // request too, whether it preloaded or not, unless it failed and the dialog offers a popup in
    // its place, or another preload replaced it.
    const { keep, owned } = machines.ending(actor.getSnapshot(), {
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
    if (!kept) {
      sheet?.close()
      // A browser without IntersectionObserver v2 signs in to an app that Tempo ID does not trust
      // through a popup, so it preloads no frame for that app again.
      const usable = visibility() || entry?.sheet.trusted() !== false
      if (owned && entry && usable && !machines.entry(actor.getSnapshot()))
        preload(auth, entry.options)
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

export declare namespace signIn {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = redirect.createUrl.Options<accessKey> & {
    /**
     * `iframe` to sign in in a dialog on the page, or `popup` for a popup window. Defaults to
     * `iframe`, which falls back to `popup` outside a secure context, for an instance that pushes
     * its requests with `par`, and for a request with `funding` on iOS and iPadOS.
     */
    mode?: 'iframe' | 'popup' | undefined
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

  /** The authorization, without its access key for a sign-in without `accessKey`. */
  type ReturnType<key extends boolean = false> = key extends false
    ? redirect.handleCallback.WithoutKey
    : Authorization
}

declare namespace authorize {
  type ReturnType<key extends boolean = false> = {
    /** The authorization. */
    authorization: signIn.ReturnType<key>
    /** The deposit page that the app opens after the sign-in. Absent for none. */
    funding?: Sheet.machines.sheet.Funding | undefined
  }
}

/** What {@link callback} posts to the opening page. */
type Message = {
  /** The callback URL, with its `code` and `state`, or its `error`. */
  url: string
}

/** Returns the name of a dialog's channel, which is also its key in `store`. */
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
  return actor
}

/** Returns whether Tempo ID can frame the sign-in on this page: a secure context on the redirect URI's origin. */
function framed(options: { redirectUri: string }) {
  return (
    window.isSecureContext &&
    new URL(options.redirectUri).origin === window.location.origin
  )
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
   * | `call.running`      | The sign-in of `context.call` holds the dialog.                      |
   */
  export const dialog = setup({
    actions: {
      /** Closes the preloaded frame. `dialog.ts` provides it. */
      close: () => {},
      /** Ends the sign-in that holds the dialog. */
      finish: assign({ call: undefined }),
      /** Holds the frame that the sign-in kept, or the new preload. */
      hold: assign(({ event }) => {
        if (event.type === 'preload') return { entry: event.entry }
        if (event.type === 'end') return { entry: event.kept }
        return {}
      }),
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
    context: { call: undefined, calls: 0, entry: undefined },
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
   */
  export function ending(
    snapshot: machines.dialog.Snapshot,
    options: machines.ending.Options,
  ): machines.ending.ReturnType {
    const owned = options.call === snapshot.context.call
    return {
      keep: owned && options.framed && snapshot.matches({ frame: 'empty' }),
      owned,
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
    }
  }

  /** Returns the preloaded frame, or `undefined` without one. */
  export function entry(snapshot: machines.dialog.Snapshot) {
    return snapshot.context.entry
  }
}
