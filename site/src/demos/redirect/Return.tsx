/**
 * Returns a redirect's callback from the root of the site to the path that started the sign-in.
 * Without a registration, the root of an origin is its only redirect URI, and the demos of the
 * "Redirect" and "Redirect (Backend)" guides are on other pages.
 * @module
 */

/** Where the tab keeps the path of the page that started the sign-in, in `sessionStorage`. */
const storageKey = 'accounts-site:redirect.return'

/**
 * Forwards the callback with its query, before the page renders. It reads the saved path once, and
 * forwards only to a path of the site. A page load without a callback keeps the saved path.
 */
const script = `(() => {
  try {
    const path = sessionStorage.getItem(${JSON.stringify(storageKey)})
    if (!path || !new URLSearchParams(location.search).has('state')) return
    sessionStorage.removeItem(${JSON.stringify(storageKey)})
    if (/^\\/(?![\\/\\\\])/.test(path)) location.replace(path + location.search)
  } catch {}
})()`

/**
 * Removes the saved path, such as on a page load without a callback, so a later callback at the
 * root stays there.
 *
 * @example
 * ```ts
 * import * as Return from './redirect/Return.tsx'
 *
 * Return.clear()
 * ```
 */
export function clear() {
  try {
    sessionStorage.removeItem(storageKey)
  } catch {
    // A blocked storage holds no path.
  }
}

/**
 * Forwards a callback at the root of the site to the path that `save` names, such as the page where
 * the first `accounts.session.get()` completes the sign-in. It renders a script that runs as the browser
 * reads the page, so the root shows nothing first. Without a saved path, the root keeps the
 * callback.
 *
 * @example
 * ```mdx
 * import { Forward } from '../demos/redirect/Return.tsx'
 *
 * <Forward />
 * ```
 */
export function Forward() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}

/**
 * Saves a path for the tab, before a sign-in leaves the page. `Forward` returns the callback to it.
 *
 * @example
 * ```ts
 * import * as Return from './redirect/Return.tsx'
 *
 * Return.save()
 * await accounts.redirect.signIn()
 * ```
 */
export function save(options: save.Options = {}) {
  const { path = window.location.pathname } = options

  try {
    sessionStorage.setItem(storageKey, path)
  } catch {
    // Without the path, the callback stays at the root, and the next visit of the page restores
    // no session.
  }
}

export declare namespace save {
  type Options = {
    /** Path that receives the callback, such as a server's callback route. Defaults to the path of the page. */
    path?: string | undefined
  }
}
