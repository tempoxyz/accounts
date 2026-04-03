import { defineBackground } from 'wxt/utils/define-background'
import { browser } from 'wxt/browser'

import * as Messenger from '../lib/Messenger.js'

const rpcUrl = 'https://rpc.tempo.xyz'

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener(async (raw) => {
      if (!Messenger.isMessage(raw)) return
      if (raw.type !== 'rpc-request') return

      try {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: raw.method,
            params: raw.params,
          }),
        })

        const json = (await res.json()) as {
          result?: unknown
          error?: { code: number; message: string }
        }

        if (json.error) port.postMessage(Messenger.error(raw.id, json.error))
        else port.postMessage(Messenger.response(raw.id, json.result))
      } catch (e) {
        port.postMessage(
          Messenger.error(raw.id, {
            code: -32603,
            message: e instanceof Error ? e.message : 'Internal error',
          }),
        )
      }
    })
  })
})
