import { defineContentScript } from 'wxt/utils/define-content-script'
import { injectScript } from 'wxt/utils/inject-script'
import { browser } from 'wxt/browser'

import * as Messenger from '../lib/Messenger.js'

export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*'],
  runAt: 'document_start',
  async main() {
    // Inject the inpage script into the MAIN world.
    // Works on both Chrome (via <script src>) and Firefox (inline script).
    await injectScript('/inpage.js', { keepInDom: true })

    const port = browser.runtime.connect()

    // inpage → background: relay window messages to the background port.
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      if (!Messenger.isMessage(event.data)) return
      if (event.data.type !== 'rpc-request') return
      port.postMessage(event.data)
    })

    // background → inpage: relay port messages back to the page.
    port.onMessage.addListener((raw) => {
      if (!Messenger.isMessage(raw)) return
      if (raw.type !== 'rpc-response') return
      window.postMessage(raw, '*')
    })
  },
})
