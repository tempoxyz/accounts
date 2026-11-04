/**
 * Opens Tempo ID's deposit page for one of the signed-in user's Tempo Accounts from an app's page, in
 * a popup window, in a frame, or through a redirect. The page takes the app's client ID and one of its
 * registered redirect URIs, and continues to that redirect URI through `GET /i/funding/return`, which
 * refuses any other URI. In a popup or a frame, Tempo ID posts the return to the app's page.
 * @module
 */
/* istanbul ignore file -- Each action needs a browser window, for the popup or the redirect. */
import type { Config } from '../Id.js'
import * as Chains from '../internal/chains.js'
import * as Popup from '../internal/popup.js'
import type * as Sheet from '../internal/sheet.js'

/** The browser blocked the popup, since `open` ran outside a user gesture such as a click. */
export class BlockedError extends Error {
  override readonly name = 'Actions.funding.BlockedError'

  constructor() {
    super(
      'The browser blocked the deposit popup. Call `open` in a click handler, before any `await`, or open the deposit page through a redirect.',
    )
  }
}

/**
 * The redirect URI is on another origin than the page, so the return from the popup cannot reach the
 * page that called `open`.
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
 * Returns the result of a deposit page that returned to the redirect URI through a redirect, from
 * the `deposit_status` and `deposit_amount` parameters of `url`. Returns `undefined` for a URL
 * without `deposit_status`, and for a URL that is not the redirect URI. Without `url`, it reads the
 * page's URL, and removes both parameters from it with `history.replaceState`.
 *
 * The parameters are a hint for the page, since any page can link to the redirect URI with them.
 * Read the account's balance before relying on a deposit.
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
     * The USD value that the deposit page saw the account receive, as a decimal string. Absent unless
     * `status` is `received`, and for a deposit that the page could not value, such as a faucet
     * deposit on a chain whose balance does not load.
     */
    amount?: string | undefined
    /**
     * `received` when the user continued after the page saw a deposit arrive, and `continued` when
     * the user continued without one.
     */
    status: 'continued' | 'received'
  }
}

/**
 * Opens Tempo ID's deposit page for `address`, one of the signed-in user's Tempo Accounts. Call it in
 * a user gesture, such as a click, since a popup opens only within one.
 *
 * - `frame`, the default, opens the page in a frame in a dialog, and resolves when the user continues
 *   to the app or closes the dialog. The frame offers a popup when it cannot show the page. A
 *   third-party app's frame continues Buy MACH in a popup, which opens within the user's click in
 *   the frame, or from the dialog's offer when the browser blocks it.
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
 * too.
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
  // iOS and iPadOS open the deposit page in a popup, since Apple Pay pays there without a frame.
  const mode = (() => {
    const value = options.mode ?? 'frame'
    if (value === 'frame' && Popup.apple()) return 'popup'
    return value
  })()
  // A refusal below, such as of an aborted signal or another origin, leaves a promised address
  // unread, so its failure must not surface as an unhandled rejection. A later read still rejects.
  if (options.address instanceof Promise) options.address.catch(() => undefined)
  signal?.throwIfAborted()

  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  /** Returns the deposit page's URL for the account at `address`. */
  const toUrl = (address: string, entry: toUrl.Options = { mode }) => {
    // A frame loads the deposit pages at `/embed/deposit`, the path that Tempo ID frames.
    const url = new URL(
      entry.mode === 'frame' ? '/embed/deposit' : '/deposit',
      auth.url,
    )
    url.search = new URLSearchParams({
      address,
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
      redirect_uri: redirectUri,
    }).toString()
    return url.href
  }

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
    const Sheet = await import('../internal/sheet.js')
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
    typeof options.address === 'string'
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
 * Resolves once the deposit page in `options.popup` returns to the app, or the user closes the
 * popup, and closes the popup. An address that resolves later loads in the popup.
 */
async function watch(
  auth: Config,
  options: watch.Options,
): Promise<NonNullable<open.ReturnType>> {
  const { address, popup, redirectUri, signal, toUrl } = options
  const pending = typeof address !== 'string'

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
        void import('../internal/sheet.js').then(
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
              complete(auth, { redirectUri, url: value }) ?? {
                status: 'continued',
              },
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
    /** The Tempo Account that receives the deposit, or the read that returns it. */
    address: `0x${string}` | Promise<`0x${string}`>
    /** The open popup, which holds the deposit page, or `about:blank` until `address` resolves. */
    popup: Window
    /** The registered redirect URI of the deposit page. */
    redirectUri: string
    /** Rejects the call with the signal's reason, and closes the popup. */
    signal: AbortSignal | undefined
    /** Returns the deposit page's URL for the account at `address`. */
    toUrl: (address: string) => string
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
  type Options = {
    /**
     * The Tempo Account that receives the deposit: one of the signed-in user's accounts. A promise,
     * such as a read of the account, resolves after the popup opens, so the popup still opens
     * within the gesture. A function that returns one runs only after the options pass their checks
     * and the popup opens, so a refused call starts no read.
     */
    address:
      | `0x${string}`
      | Promise<`0x${string}`>
      | (() => Promise<`0x${string}`>)
    /**
     * The amount that the app needs, as a decimal string, such as `10`. With `currency` and `token`,
     * it selects the methods that the page lists. Absent, the page lists every method.
     */
    amount?: string | undefined
    /** The chain of the deposit. Defaults to the instance's `chainId`. */
    chainId?: number | undefined
    /**
     * The ISO 4217 currency of `amount`, such as `EUR`. Defaults to the currency of `token`, or
     * `USD`. Needs `amount`.
     */
    currency?: string | undefined
    /**
     * `frame` for a frame in a dialog on the page, `popup` for a popup window, or `redirect` for a
     * redirect of the page. Defaults to `frame`. Tempo ID frames the page at `/embed/deposit` for
     * any enabled web app, from the origin of `redirectUri`. iOS and iPadOS open `frame` in a popup.
     * A frame that shows no deposit page, such as without a Tempo ID session in the frame, or one
     * that the app's page covers, offers a popup, which opens from the user's click.
     */
    mode?: 'frame' | 'popup' | 'redirect' | undefined
    /**
     * One of the app's registered redirect URIs, which the page returns to. Defaults to the
     * instance's `redirectUri`, or the page's origin with `/`.
     */
    redirectUri?: string | undefined
    /** Rejects the call with the signal's reason, and closes the popup. */
    signal?: AbortSignal | undefined
    /**
     * The symbol or address of the only token that counts toward `amount`, such as `USDC.e`. Needs
     * `amount`.
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
        /** The user closed the popup before the page returned. */
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
  return amount === undefined ? { status } : { amount, status }
}

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
  const Sheet = await import('../internal/sheet.js')
  // An abort while the dialog's module loads fired before the listener below, so it rejects here.
  signal?.throwIfAborted()

  let close: Sheet.frame.ReturnType | undefined
  let abort: (() => void) | undefined
  try {
    return await new Promise<NonNullable<open.ReturnType>>(
      (resolve, reject) => {
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        close = Sheet.frame({
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
                method: entry.method,
                mode: 'popup',
              }),
            )
            if (popup === null) {
              // The offer's Continue is the user's click, so only a blocker refuses it.
              if (!entry.automatic) reject(new BlockedError())
              return false
            }
            close?.()
            watch(auth, { address, popup, redirectUri, signal, toUrl }).then(
              resolve,
              reject,
            )
            return true
          },
          origin: new URL(auth.url).origin,
          url: toUrl(address),
        })
      },
    )
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    close?.()
  }
}

declare namespace frame {
  type Options = {
    /** The Tempo Account that receives the deposit, or the read that returns it. */
    address: `0x${string}` | Promise<`0x${string}`>
    /** The registered redirect URI of the deposit page. */
    redirectUri: string
    /** Rejects the call with the signal's reason, and closes the dialog. */
    signal: AbortSignal | undefined
    /** Returns the deposit page's URL for the account at `address`. */
    toUrl: (address: string, entry?: toUrl.Options) => string
  }
}
