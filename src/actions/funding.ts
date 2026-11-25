/**
 * Opens Tempo ID's deposit page for one of the signed-in user's Tempo Accounts from an app's page, in
 * a popup window, in a frame, or through a redirect. The page takes the app's client ID and one of its
 * registered redirect URIs, and continues to that redirect URI through `GET /i/funding/return`, which
 * refuses any other URI. In a popup or a frame, Tempo ID posts the return to the app's page.
 * @module
 */
/* istanbul ignore file -- Each action needs a browser window, for the popup or the redirect. */
import type { Config } from '../Accounts.js'
import * as Chains from '../internal/Chains.js'
import * as FrameTrust from '../internal/FrameTrust.js'
import * as Popup from '../internal/Popup.js'
import type * as Sheet from '../internal/Sheet.js'

/**
 * The browser blocked the popup, since `open` ran outside a user gesture such as a click, or after
 * an `await` in the click handler. The fix is a call of `funding.open` first in the handler, or
 * `mode: 'redirect'`.
 */
export class BlockedError extends Error {
  override readonly name = 'Actions.funding.BlockedError'

  constructor() {
    super(
      'The browser blocked the deposit popup. Call `open` in a click handler, before any `await`, or open the deposit page through a redirect.',
    )
  }
}

/**
 * The redirect URI is on another origin than the page, so the return from the popup cannot reach
 * the page that called `open`. `open` throws it before the popup opens. The fix is a call of `open`
 * on a page of the redirect URI's origin, or `mode: 'redirect'`.
 */
export class OriginError extends Error {
  override readonly name = 'Actions.funding.OriginError'

  constructor(options: OriginError.Options) {
    super(
      `Invalid redirect URI: ${options.redirectUri} is not on this page's origin, ${options.origin}. Call \`open\` on a page of the redirect URI's origin, or open the deposit page through a redirect.`,
    )
  }
}

export declare namespace OriginError {
  type Options = {
    /** The origin of the page that called `open`. */
    origin: string
    /** The redirect URI of the deposit page. */
    redirectUri: string
  }
}

/**
 * The runtime has no browser page, such as a server, a CLI, or a React Native app, so no deposit
 * page can open from it. The fix is to pass `funding` to the sign-in instead:
 * `accounts.backend.start` on a server, or `accounts.device.signIn` in a CLI.
 */
export class PageRequiredError extends Error {
  override readonly name = 'Actions.funding.PageRequiredError'

  constructor() {
    super(
      'No browser window: the deposit page opens only from a page. On a server, pass `funding` to `accounts.backend.start`. In a CLI, pass it to `accounts.device.signIn`.',
    )
  }
}

/** Each instance's preloaded deposit frame, which only `preload` and `open` read and replace. */
const preloads = new WeakMap<Config, Preload>()

/** A deposit frame that `preload` loads for the next `open` of the same page. */
type Preload = {
  /** Resolves once the frame starts to load, or once the preload loads nothing. */
  ready: Promise<void>
  /** The hidden dialog, or `undefined` while the dialog's module loads. */
  sheet: Sheet.load.ReturnType | undefined
  /** The deposit page's URL, which the next `open` must name to take the frame. */
  url: string
}

/**
 * Returns the result of a deposit page that returned to the redirect URI through a redirect, from
 * the `deposit_status` and `deposit_amount` parameters of `url`. Returns `undefined` for a URL
 * without `deposit_status`, and for a URL that is not the redirect URI. Without `url`, it reads the
 * page's URL, and removes both parameters from it with `history.replaceState`. Outside a browser
 * page, such as in a server render or a React Native app, a call without `url` reads no URL,
 * and returns `undefined`.
 *
 * The parameters are a hint for the page, since any page can link to the redirect URI with them.
 * A `deposit_amount` that is not a decimal, such as `25.5`, returns no `amount`. Read the account's
 * balance before relying on a deposit.
 *
 * @example
 * ```ts
 * const result = Actions.funding.complete(auth)
 * if (result?.status === 'received') showBalance()
 * ```
 */
export function complete(
  auth: Config,
  options: complete.Options = {},
): complete.ReturnType | undefined {
  const own = options.url === undefined
  // A server render or a React Native app reads no page, so only a call with `url` holds a
  // result there. React Native defines `window` without `location`, so the check reads `document`.
  if (own && typeof document === 'undefined') return undefined
  const url = new URL(options.url ?? window.location.href)
  // A call with `url`, such as on a server, reads no page, so the default comes from `url`.
  const redirectUri = new URL(
    options.redirectUri ?? auth.redirectUri ?? `${url.origin}/`,
  )
  if (url.origin + url.pathname !== redirectUri.origin + redirectUri.pathname)
    return undefined
  // The return route keeps the redirect URI's own parameters first, so a URL without them, such as
  // one with another tenant's state, is not the redirect URI.
  for (const name of new Set(redirectUri.searchParams.keys())) {
    const values = url.searchParams.getAll(name)
    const fixed = redirectUri.searchParams.getAll(name)
    if (fixed.some((value, index) => values[index] !== value)) return undefined
  }
  const result = parse(url, { redirectUri })
  if (!result || !own) return result

  // The return route appends its parameters after the redirect URI's own, so the redirect URI's
  // values stay.
  for (const name of ['deposit_amount', 'deposit_status']) {
    url.searchParams.delete(name)
    for (const value of redirectUri.searchParams.getAll(name))
      url.searchParams.append(name, value)
  }
  window.history.replaceState(window.history.state, '', url.href)
  return result
}

export declare namespace complete {
  type Options = {
    /**
     * The redirect URI that `open` passed to the deposit page. Defaults to the instance's
     * `redirectUri`, or the origin of `url` with `/`.
     */
    redirectUri?: string | undefined
    /** The URL that the deposit page returned to. Defaults to the page's URL. */
    url?: string | URL | undefined
  }

  /** How the deposit page ended, as its return to the redirect URI states. */
  type ReturnType = {
    /**
     * The USD value that the deposit page saw the account receive, or the confirmed amount of a Buy
     * MACH purchase, as a decimal string, such as `25.500000`. Absent unless `status` is
     * `received`, and for a deposit that the page could not value, such as a faucet deposit on a
     * chain whose balance does not load.
     */
    amount?: string | undefined
    /**
     * `received` when the user continued after the page saw a deposit arrive: when Done on a
     * receive screen saw it, after a confirmed Buy MACH purchase, or after the faucet of a test
     * chain funded the account. `continued` when the user selected Continue to the app without a
     * deposit, which only a tab offers.
     */
    status: 'continued' | 'received'
  }
}

/**
 * Closes the deposit frame that {@link preload} loaded for the instance, if any, such as at a sign-out,
 * so no later {@link open} shows the page of the ended session. The `funding` plugin calls it after
 * each sign-out.
 *
 * @example
 * ```ts
 * await Actions.signOut(auth)
 * Actions.funding.discard(auth)
 * ```
 */
export function discard(auth: Config): void {
  preloads.get(auth)?.sheet?.close()
  preloads.delete(auth)
}

/**
 * Opens Tempo ID's deposit page for `address`, one of the signed-in user's Tempo Accounts. Call it in
 * a user gesture, such as a click, since a popup opens only within one.
 *
 * - `frame`, the default, opens the page in a frame in a dialog, and resolves when the user continues
 *   to the app or closes the dialog. After {@link preload} of the same page, the dialog shows the page
 *   at once. The frame offers a popup when it cannot show the page. A frame runs no Coinflow, so MACH
 *   in its list, and Pay by card on Buy MACH's amount step, continue in a popup, which opens within
 *   the user's click in the frame, or from the dialog's offer when the browser blocks it. On iOS and
 *   iPadOS, Buy MACH for a hint of `MACH` on Tempo mainnet opens in a popup at once, without the frame.
 *   In Safari and Firefox, the page opens in a popup at once too, unless the dialog's preloaded frame
 *   reported that Tempo ID trusts the app.
 * - `popup` opens the page in a popup window, and resolves when the user continues to
 *   the app or closes the popup. The page must be on the origin of the redirect URI, since Tempo ID
 *   posts the return only to that origin.
 * - `redirect` sends the browser to the page, and resolves with `undefined` once the navigation starts.
 *   The page returns to the redirect URI, whose page reads the result with {@link complete}.
 *
 * The page lists the methods that deliver a token that `amount`, `currency`, and `token` count, and
 * offers Continue to the app on each screen of a tab. Once Done on a receive screen reads the
 * deposit, the page returns to the app with its amount. A popup offers no Continue, so a close of the
 * window without a deposit resolves with `closed`. The page refuses a redirect URI that the app did not register. Without a
 * session at Tempo ID, the page signs the user in and then opens the account page, so a popup stays
 * open and the call stays pending until `signal` aborts. A page that sends
 * `Cross-Origin-Opener-Policy: same-origin` severs its handle to the popup, so the call stays pending
 * too. Outside a browser page, such as on a server, in a CLI, or in a React Native app, it throws
 * {@link PageRequiredError} before it reads the account.
 *
 * @example
 * ```ts
 * button.onclick = async () => {
 *   const result = await Actions.funding.open(auth, { address, amount: '10' })
 *   if (result?.status === 'received') showBalance()
 * }
 * ```
 */
export async function open(
  auth: Config,
  options: open.Options,
): Promise<open.ReturnType> {
  const { amount, currency, signal, token } = options
  // A refusal below, such as of an aborted signal or another origin, leaves a promised address
  // unread, so its failure must not surface as an unhandled rejection. A later read still rejects.
  // `Promise.resolve` also follows a promise of another realm, which `instanceof` misses.
  if (typeof options.address === 'object')
    Promise.resolve(options.address).catch(() => undefined)
  signal?.throwIfAborted()
  // Each mode needs a page. React Native defines `window` without `location`, so the check reads
  // `document`, and a server, a CLI, or a React Native app fails before it reads the account.
  // The check runs before the mode, whose Coinflow check reads `navigator`.
  if (typeof document === 'undefined') throw new PageRequiredError()

  const mode = (() => {
    const value = options.mode ?? 'frame'
    if (value !== 'frame') return value
    // A page that runs Coinflow where no frame can opens in a popup at once, without the frame. So
    // does the page of an app whose frame would only offer a popup.
    if (
      Popup.coinflow({
        amount,
        chainId: options.chainId ?? auth.chainId,
        token,
      }) ||
      !FrameTrust.frames(auth)
    )
      return 'popup'
    return value
  })()

  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  /** Returns the deposit page's URL for the account at `address`, or the page's choice. */
  const toUrl = (
    address: string | undefined,
    entry: toUrl.Options = { mode },
  ) =>
    pageUrl(auth, {
      address,
      amount,
      chainId: options.chainId,
      currency,
      entry,
      redirectUri,
      token,
    })

  // A function starts its read only once the options pass their checks, so a refused call reads
  // and creates no account.
  // A function that throws rejects the call as a rejected read does, so the popup still closes.
  const read = () => {
    if (typeof options.address !== 'function') return options.address
    try {
      return options.address()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  // A frame takes the preloaded frame of its page. Another mode shows none, so the frame closes.
  if (mode !== 'frame') discard(auth)

  if (mode === 'redirect') {
    const address = await abortable(read(), { signal })
    window.location.assign(toUrl(address))
    return undefined
  }

  // Tempo ID posts the return only to the redirect URI's origin.
  if (new URL(redirectUri).origin !== window.location.origin)
    throw new OriginError({ origin: window.location.origin, redirectUri })

  // Outside a gesture, such as after a failed transaction, a popup blocker refuses the popup that iOS
  // and iPadOS open, so a dialog offers it, and the user's click on Continue opens it.
  if (mode === 'popup' && options.mode !== 'popup' && !Popup.activated()) {
    const address = await abortable(read(), { signal })
    const Sheet = await import('../internal/Sheet.js')
    return await new Promise((resolve, reject) => {
      const abort = () => {
        close()
        reject(signal?.reason)
      }
      const close = Sheet.prompt({
        label: 'Add funds with Tempo',
        onCancel: () => {
          close()
          signal?.removeEventListener('abort', abort)
          resolve({ status: 'closed' })
        },
        onContinue: () => {
          close()
          signal?.removeEventListener('abort', abort)
          open(auth, { ...options, address, mode: 'popup' }).then(
            resolve,
            reject,
          )
        },
        text: 'Continue in a Tempo ID window to add funds.',
      })
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }

  if (mode === 'frame')
    return await frame(auth, { address: read(), redirectUri, signal, toUrl })
  // A popup blocker accepts `window.open` only within the gesture, so the popup opens before any
  // `await`. An address that resolves later loads in the open popup.
  const popup = Popup.openPopup(
    options.address === undefined || typeof options.address === 'string'
      ? toUrl(options.address)
      : 'about:blank',
  )
  if (popup === null) throw new BlockedError()
  return await watch(auth, {
    address: read(),
    popup,
    redirectUri,
    signal,
    toUrl,
  })
}

/**
 * Loads the deposit page of a later {@link open} in `frame` mode, in a hidden dialog, so `open` shows
 * the page at once, without the dialog's skeleton. Call it once the address is known, such as after
 * the sign-in, or when the pointer enters the deposit button. Resolves once the frame starts to load,
 * or at once when it loads nothing. It never rejects.
 *
 * The next `open` of the same deposit page takes the frame: the same address, hint, chain, and
 * redirect URI. Each frame serves one `open`, and the dialog closes once the call ends. An `open` of
 * another page or in another mode closes the frame, and so do a later `preload` of another page and
 * {@link discard}. A call while the
 * instance holds a frame of the same page that shows no offer of a popup loads nothing. Where `open`
 * opens no frame, it loads nothing: outside a browser page, on a page that is not on the redirect
 * URI's origin, for Buy MACH of a hint of `MACH` on Tempo mainnet on iOS and iPadOS, and in Safari
 * and Firefox unless the dialog's preloaded frame reported that Tempo ID trusts the app.
 *
 * The frame loads the page as `open` does, so it reads the account, and on Tempo mainnet the
 * universal deposit address, which Tempo ID creates on its first read.
 *
 * @example
 * ```ts
 * await Actions.funding.preload(auth, { address, amount: '10' })
 * button.onclick = () => Actions.funding.open(auth, { address, amount: '10' })
 * ```
 */
export async function preload(
  auth: Config,
  options: preload.Options,
): Promise<void> {
  if (typeof document === 'undefined') return
  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  if (new URL(redirectUri).origin !== window.location.origin) return
  if (
    Popup.coinflow({
      amount: options.amount,
      chainId: options.chainId ?? auth.chainId,
      token: options.token,
    }) ||
    !FrameTrust.frames(auth)
  )
    return

  const url = pageUrl(auth, {
    ...options,
    entry: { mode: 'frame' },
    redirectUri,
  })
  const held = preloads.get(auth)
  // A call for the same page while its frame loads waits for that load.
  if (held?.url === url && held.sheet?.usable() !== false)
    return await held.ready
  held?.sheet?.close()
  // The dialog's module loads from a chunk of its own, so the entry holds no dialog until it loads. A
  // later `preload` or `open` that replaces the entry meanwhile closes nothing, and this one then
  // loads nothing.
  const entry: Preload = { ready: Promise.resolve(), sheet: undefined, url }
  preloads.set(auth, entry)
  entry.ready = (async () => {
    // A chunk that fails to load leaves no frame, and `open` loads its own.
    const Sheet = await import('../internal/Sheet.js').catch(() => undefined)
    // A script that runs before the body parses, such as one in the head, loads once it parses.
    if (!document.body)
      await new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', resolve, {
          once: true,
        }),
      )
    if (preloads.get(auth) !== entry) return
    if (!Sheet) {
      preloads.delete(auth)
      return
    }
    entry.sheet = Sheet.load(sheetOptions(auth, { url }))
  })()
  return await entry.ready
}

export declare namespace preload {
  type Options = Pick<
    open.Options,
    'amount' | 'chainId' | 'currency' | 'redirectUri' | 'token'
  > & {
    /**
     * The Tempo Account that receives the deposit: one of the signed-in user's accounts. Absent,
     * the page funds the user's oldest account that receives deposits.
     */
    address?: `0x${string}` | undefined
  }
}

/**
 * Resolves once the deposit page in `options.popup` returns to the app, or the user closes the
 * popup, and closes the popup. An address that resolves later loads in the popup.
 */
async function watch(
  auth: Config,
  options: watch.Options,
): Promise<NonNullable<open.ReturnType>> {
  const { address, popup, redirectUri, signal, toUrl } = options
  const pending = typeof address === 'object'

  let abort: (() => void) | undefined
  let settled = false
  let unblock: (() => void) | undefined
  let unwatch: (() => void) | undefined
  try {
    return await new Promise<NonNullable<open.ReturnType>>(
      (resolve, reject) => {
        // While the popup is open, a dialog on the page names the window, and its Cancel settles
        // the call as closed. The dialog's module loads from a chunk of its own, so the instance does
        // not bundle it, and the dialog shows once the chunk loads unless the call settled before. A
        // chunk that fails to load leaves the page without the dialog, and the popup still settles
        // the call, so the import's own rejection handler makes it safe to leave unawaited.
        void import('../internal/Sheet.js').then(
          (Sheet) => {
            if (settled) return
            unblock = Sheet.waiting({
              onCancel: () => resolve({ status: 'closed' }),
              popup,
            })
          },
          () => undefined,
        )
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        // The abort listener runs before the address resolves, so an abort while it resolves closes
        // the popup, and the page never loads.
        // A popup that the user closed before the address resolved holds no page of Tempo ID's, which
        // `watchPopup` needs to count a close, so the call settles as closed here.
        if (pending)
          Promise.resolve(address).then((value) => {
            if (signal?.aborted) return
            if (popup.closed) resolve({ status: 'closed' })
            else popup.location.replace(toUrl(value))
          }, reject)
        // Tempo ID's page in the popup reports that it loaded, so a close counts only after it.
        unwatch = Popup.watchPopup(popup, {
          onCallback: (value) =>
            resolve(
              ('url' in value
                ? complete(auth, { redirectUri, url: value.url })
                : undefined) ?? { status: 'continued' },
            ),
          onClose: () => resolve({ status: 'closed' }),
          // The page takes input again once the popup closes, while a late return can still arrive.
          onClosed: () => unblock?.(),
          origin: new URL(auth.url).origin,
        })
      },
    )
  } finally {
    settled = true
    if (abort) signal?.removeEventListener('abort', abort)
    unblock?.()
    unwatch?.()
    popup.close()
  }
}

declare namespace watch {
  type Options = {
    /**
     * The Tempo Account that receives the deposit, or the read that returns it. `undefined` lets
     * the page choose the account.
     */
    address: open.Address | Promise<open.Address>
    /** The open popup, which holds the deposit page, or `about:blank` until `address` resolves. */
    popup: Window
    /** The registered redirect URI of the deposit page. */
    redirectUri: string
    /** Rejects the call with the signal's reason, and closes the popup. */
    signal: AbortSignal | undefined
    /** Returns the deposit page's URL for the account at `address`, or the page's choice. */
    toUrl: (address: open.Address) => string
  }
}

/**
 * Returns the URL of the deposit page for the account at `options.address`. Without one, the page
 * funds the user's oldest account that receives deposits.
 */
function pageUrl(auth: Config, options: pageUrl.Options) {
  const { amount, currency, entry, token } = options
  // A frame and a popup load the deposit pages at `/embed/deposit`, the path of an app's pages.
  // A redirect loads Tempo ID's own deposit pages.
  const url = new URL(
    entry.mode === 'redirect' ? '/deposit' : '/embed/deposit',
    auth.url,
  )
  url.search = new URLSearchParams({
    ...(options.address === undefined ? {} : { address: options.address }),
    ...(entry.amount ? { amount: entry.amount } : {}),
    // The page reads `mainnet` and `testnet` by name, and another chain by the name that the
    // deployment lists for its ID.
    chain: Chains.parameter({ chainId: options.chainId ?? auth.chainId }),
    client_id: auth.clientId,
    ...(entry.mode === 'popup' ? { display: entry.mode } : {}),
    ...(currency === undefined ? {} : { funding_currency: currency }),
    ...(amount === undefined ? {} : { funding_hint: amount }),
    ...(token === undefined ? {} : { funding_token: token }),
    ...(entry.method ? { method: entry.method } : {}),
    redirect_uri: options.redirectUri,
  }).toString()
  return url.href
}

declare namespace pageUrl {
  type Options = Pick<
    open.Options,
    'amount' | 'chainId' | 'currency' | 'token'
  > & {
    /** The Tempo Account that receives the deposit. Absent, the page chooses the account. */
    address?: string | undefined
    /** The mode that loads the page, and the method that it opens. */
    entry: toUrl.Options
    /** The registered redirect URI of the deposit page. */
    redirectUri: string
  }
}

/** Returns the options of the dialog that frames the deposit page at `options.url`. */
function sheetOptions(
  auth: Config,
  options: sheetOptions.Options,
): Sheet.load.Options {
  const origin = new URL(auth.url).origin
  return {
    // Apple Pay and Google Pay need the `payment` permission in a frame, and their sheets open popups
    // from the frame's own clicks. The frame runs third-party scripts and nests the card issuer's page.
    // The page runs the passkey ceremony of a swap from the account's balance, for Tempo ID's origin.
    allow: `payment; publickey-credentials-get ${origin}`,
    label: 'Add funds with Tempo',
    origin,
    sandbox:
      'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts',
    text: 'Continue in a Tempo ID window to add funds.',
    url: options.url,
  }
}

declare namespace sheetOptions {
  type Options = {
    /** The deposit page's URL at `/embed/deposit`. */
    url: string
  }
}

declare namespace toUrl {
  type Options = {
    /** With `method`, the amount in USD that the method's first step shows, such as `7.50`. */
    amount?: string | undefined
    /** The method that the page opens, such as `mach` for Buy MACH. Absent, the page lists them. */
    method?: 'mach' | undefined
    /** The mode that loads the page, which selects its path and `display`. */
    mode: 'frame' | 'popup' | 'redirect'
  }
}

export declare namespace open {
  /** The address of a Tempo Account, or `undefined` for the account that the page chooses. */
  type Address = `0x${string}` | undefined

  type Options = {
    /**
     * The Tempo Account that receives the deposit: one of the signed-in user's accounts. A promise,
     * such as a read of the account, resolves after the popup opens, so the popup still opens
     * within the gesture. A function that returns one runs only after the options pass their checks
     * and the popup opens, so a refused call starts no read. Absent, or for a promise that resolves
     * to `undefined`, the page funds the user's oldest account that receives deposits, as an app
     * that holds no account address needs.
     */
    address?: Address | Promise<Address> | (() => Promise<Address>)
    /**
     * The amount that the app needs, as a decimal string, such as `10`. With `currency` and `token`,
     * it selects the methods that the page lists, as
     * [Deposit methods](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-methods)
     * describes. Tempo ID checks the hint against the listed tokens of the deposit's chain. Absent,
     * or for a hint that Tempo ID refuses, the page lists every method.
     */
    amount?: string | undefined
    /**
     * The chain of the deposit. Defaults to the instance's `chainId`. The page's `chain` parameter
     * names Tempo mainnet and Tempo testnet as `mainnet` and `testnet`, and another chain by its
     * ID. On a chain whose faucet funds accounts, such as Tempo testnet, the page offers the faucet
     * first, and a successful faucet deposit returns `received`.
     */
    chainId?: number | undefined
    /**
     * The ISO 4217 currency of `amount`, such as `EUR`. Every listed token of the currency counts.
     * Defaults to the currency of `token`, or `USD`. Needs `amount`.
     */
    currency?: string | undefined
    /**
     * `frame` for a frame in a dialog on the page, `popup` for a popup window, or `redirect` for a
     * redirect of the page in the same tab. Defaults to `frame`. Tempo ID frames the page at
     * `/embed/deposit` for any enabled web app, from the origin of `redirectUri`. A page that runs
     * Coinflow where no frame can, Buy MACH on iOS and iPadOS, opens `frame` in a popup, since
     * Apple Pay runs only on a top-level page. So does the page in a browser without
     * IntersectionObserver v2, such as Safari or Firefox, unless the dialog's preloaded frame reported
     * that Tempo ID trusts the app, since the frame of an untrusted app only offers a popup. Coinflow's purchase protection, Apple Pay, and
     * Google Pay need a top-level page, so a frame runs no Coinflow. A frame that shows no deposit
     * page, such as without a Tempo ID session in the frame, or one that the app's page covers,
     * offers a popup, which opens from the user's click.
     */
    mode?: 'frame' | 'popup' | 'redirect' | undefined
    /**
     * One of the app's registered redirect URIs, which the page returns to. The page offers no way
     * back to the app for a redirect URI that the app did not register. Defaults to the instance's
     * `redirectUri`, or the page's origin with `/`.
     */
    redirectUri?: string | undefined
    /**
     * Rejects the call with the signal's reason, such as a `TimeoutError` from
     * `AbortSignal.timeout`, and closes the popup.
     */
    signal?: AbortSignal | undefined
    /**
     * The symbol or address of the only token that counts toward `amount`, such as `USDC.e`. Its
     * currency must equal `currency`. Needs `amount`. On Tempo mainnet, `MACH` opens Buy MACH with
     * `amount` in place of the list of methods.
     */
    token?: string | undefined
  }

  /**
   * How the popup ended: the return of the deposit page, or `closed` when the user closed the
   * popup. `undefined` for a redirect.
   */
  type ReturnType =
    | complete.ReturnType
    | {
        /**
         * The user closed the popup before the page returned, such as before a transfer from
         * another network lands, or selected Cancel in the page's dialog.
         */
        status: 'closed'
      }
    | undefined
}

/** Resolves `value`, or rejects with the reason of `signal` once it aborts, also before `value` resolves. */
async function abortable<value>(
  value: value | Promise<value>,
  options: abortable.Options,
): Promise<value> {
  const { signal } = options
  if (!signal) return await value

  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

declare namespace abortable {
  type Options = {
    /** The signal whose abort rejects the wait. */
    signal: AbortSignal | undefined
  }
}

/**
 * Returns the result in the return URL `url`, or `undefined` without a `deposit_status` that the
 * return route appended.
 */
function parse(
  url: URL,
  options: parse.Options,
): complete.ReturnType | undefined {
  // The return route appends its parameters after the redirect URI's own, so only the values past
  // the redirect URI's count are the return's.
  const appended = (name: string) =>
    url.searchParams
      .getAll(name)
      .slice(options.redirectUri.searchParams.getAll(name).length)
      .at(-1)
  const status = appended('deposit_status')
  if (status === 'continued') return { status }
  if (status !== 'received') return undefined
  const amount = appended('deposit_amount')
  // Any page can link to the redirect URI, so only a decimal of the return route's form counts.
  return amount === undefined || !decimal.test(amount)
    ? { status }
    : { amount, status }
}

/** The form of `deposit_amount` that Tempo ID's return route sends, such as `25.5`. */
const decimal = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/

declare namespace parse {
  type Options = {
    /** The redirect URI, whose own parameters the result leaves out. */
    redirectUri: URL
  }
}

/**
 * Shows the deposit page of `options.address` in a frame in a dialog, and resolves once the page
 * returns to the app or the user closes the dialog. A frame that requests a popup for a method, such
 * as Buy MACH, opens it at once within the user's click. Otherwise, or if the browser blocks it, the
 * dialog offers the popup, which opens from the user's click.
 */
async function frame(
  auth: Config,
  options: frame.Options,
): Promise<NonNullable<open.ReturnType>> {
  const { redirectUri, signal, toUrl } = options
  const address = await abortable(options.address, { signal })
  const Sheet = await import('../internal/Sheet.js')
  // An abort while the dialog's module loads fired before the listener below, so it rejects here.
  signal?.throwIfAborted()

  // The call takes the preloaded frame of the same page, and closes a frame of another page.
  const url = toUrl(address)
  const held = preloads.get(auth)
  preloads.delete(auth)
  const reused =
    held?.url === url && held.sheet?.usable() ? held.sheet : undefined
  if (!reused) held?.sheet?.close()
  const sheet = reused ?? Sheet.load(sheetOptions(auth, { url }))

  let abort: (() => void) | undefined
  try {
    return await new Promise<NonNullable<open.ReturnType>>(
      (resolve, reject) => {
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        sheet.show({
          onCallback: (value) =>
            resolve(
              complete(auth, { redirectUri, url: value }) ?? {
                status: 'continued',
              },
            ),
          onCancel: () => resolve({ status: 'closed' }),
          onPopup: (entry) => {
            const popup = Popup.openPopup(
              toUrl(address, {
                amount: entry.amount,
                // Only the payment page requests a sign-in as another user.
                method: entry.method === 'mach' ? entry.method : undefined,
                mode: 'popup',
              }),
            )
            if (popup === null) {
              // The offer's Continue is the user's click, so only a blocker refuses it.
              if (!entry.automatic) reject(new BlockedError())
              return false
            }
            sheet.close()
            watch(auth, { address, popup, redirectUri, signal, toUrl }).then(
              resolve,
              reject,
            )
            return true
          },
        })
      },
    )
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    sheet.close()
  }
}

declare namespace frame {
  type Options = {
    /**
     * The Tempo Account that receives the deposit, or the read that returns it. `undefined` lets
     * the page choose the account.
     */
    address: open.Address | Promise<open.Address>
    /** The registered redirect URI of the deposit page. */
    redirectUri: string
    /** Rejects the call with the signal's reason, and closes the dialog. */
    signal: AbortSignal | undefined
    /** Returns the deposit page's URL for the account at `address`, or the page's choice. */
    toUrl: (address: open.Address, entry?: toUrl.Options) => string
  }
}
