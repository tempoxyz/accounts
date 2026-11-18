/**
 * Whether Tempo ID's pages act in a frame on the app's page. A browser without IntersectionObserver
 * v2 cannot show that nothing covers the frame, so Tempo ID's pages act there only for an app that
 * Tempo ID trusts. The dialog's preloaded frame reports that trust.
 * @module
 */
import type { Config } from '../Accounts.js'

/** The reader of each instance's preloaded frame, which `actions/dialog.ts` registers. */
const readers = new WeakMap<Config, () => boolean | undefined>()

/**
 * Returns whether Tempo ID's page in a frame acts on this page: in a browser with
 * IntersectionObserver v2, or if the instance's preloaded frame reports that Tempo ID trusts the app.
 * Returns `false` while no preloaded frame reported, such as with `preload: false`, as a sign-in
 * does, since the frame of an app that Tempo ID does not trust only offers a popup after the click.
 */
export function frames(auth: Config) {
  return visibility() || read(auth) === true
}

/**
 * Returns the trust that the instance's preloaded frame reports for the app, or `undefined` before
 * it reports or without a registered reader.
 */
export function read(auth: Config) {
  return readers.get(auth)?.()
}

/** Registers the reader of the trust that the instance's preloaded frame reports. */
export function register(auth: Config, options: register.Options) {
  readers.set(auth, options.read)
}

export declare namespace register {
  type Options = {
    /** Returns the trust of the preloaded frame's app, or `undefined` before it reports. */
    read: () => boolean | undefined
  }
}

/** Returns whether the browser reports whether anything covers an element. */
function visibility() {
  return (
    typeof IntersectionObserverEntry !== 'undefined' &&
    'isVisible' in IntersectionObserverEntry.prototype
  )
}
