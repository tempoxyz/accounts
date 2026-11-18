/**
 * The entry of the web test app of the end-to-end suite. The server answers every path with this
 * entry, which starts the page of the path. Each page signs in with its own plugin, and shows the
 * controls of `App.tsx`.
 * @module
 */
import * as Chains from './pages/Chains.js'
import * as Custom from './pages/Custom.js'
import * as Dialog from './pages/Dialog.js'
import * as Mpp from './pages/Mpp.js'
import * as Open from './pages/Open.js'
import * as Popup from './pages/Popup.js'
import * as Redirect from './pages/Redirect.js'
import * as Wagmi from './pages/Wagmi.js'

/** Starts the page of each path. */
const pages: Readonly<Record<string, () => Promise<void>>> = {
  '/': Dialog.start,
  '/chains/': Chains.start,
  '/custom/': Custom.start,
  '/isolated/': () =>
    Popup.start({
      crossOriginOpenerPolicy: 'same-origin',
      redirectUri: `${window.location.origin}/isolated/`,
    }),
  '/mpp/': Mpp.start,
  '/open/': Open.start,
  '/open/callback/': Open.callback,
  '/popup/': () => Popup.start(),
  '/redirect/': Redirect.start,
  '/severed/': () =>
    Popup.start({ redirectUri: `${window.location.origin}/severed/` }),
  '/wagmi/': Wagmi.start,
}

await pages[window.location.pathname]?.()
