/**
 * The entry of the backend test app of the end-to-end suite. The Worker answers every path of a page
 * with this entry, which starts the page of the path.
 * @module
 */
import * as Asserted from './pages/Asserted.js'
import * as Backend from './pages/Backend.js'
import * as Connected from './pages/Connected.js'
import * as Emailed from './pages/Emailed.js'
import * as Funded from './pages/Funded.js'
import * as Siwe from './pages/Siwe.js'
import * as Sponsored from './pages/Sponsored.js'

/** Starts the page of each path. */
const pages: Readonly<Record<string, () => void>> = {
  '/': Backend.start,
  '/asserted/': Asserted.start,
  '/connected/': Connected.start,
  '/emailed/': Emailed.start,
  '/funded/': Funded.start,
  '/siwe/': Siwe.start,
  '/sponsored/': Sponsored.start,
}

pages[window.location.pathname]?.()
