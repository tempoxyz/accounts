import { createWalletClient, custom } from 'viem'
import { tempo } from 'viem/tempo/chains'

import { dialog } from '../src/core/adapters/dialog.js'
import * as Dialog from '../src/core/Dialog.js'
import * as RemoteRequests from '../src/core/internal/RemoteRequests.js'
import * as Provider from '../src/core/Provider.js'
import * as Storage from '../src/core/Storage.js'

const host = `http://127.0.0.1:${location.port}/remote?secret=never-show-this`
const results: unknown[] = []
const received: number[] = []
let handle: Dialog.Instance

window.addEventListener('message', (event) => {
  if (event.origin !== new URL(host).origin) return
  if (event.data.topic === 'observed') received.push(event.data.id)
})

const fixture = {
  provider() {
    RemoteRequests.reset(host)
    const provider = Provider.create({
      adapter: dialog({ dialog: Dialog.iframe(), host }),
      chains: [tempo],
      mpp: false,
      storage: Storage.memory(),
    })
    const address = '0x0000000000000000000000000000000000000001'
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const client = createWalletClient({
      chain: tempo,
      transport: custom(provider, { retryCount: 0 }),
    })
    void client
      .signMessage({ account: address, message: { raw: '0x1234' } })
      .catch((error: unknown) => {
        let current = error
        for (let depth = 0; current && typeof current === 'object' && depth < 10; depth++) {
          const candidate = current as { cause?: unknown; code?: unknown; data?: unknown }
          if (candidate.code === -32000 && candidate.data) {
            results.push({ code: candidate.code, data: candidate.data })
            return
          }
          current = candidate.cause
        }
        results.push({ missing: true })
      })
  },
  begin(method = 'personal_sign') {
    void RemoteRequests.request(host, {
      account: undefined,
      chainId: 4217,
      request: { method, params: ['do-not-log'] },
    }).then(
      (result) => results.push({ result }),
      (error) => results.push({ code: error.code, data: error.data, message: error.message }),
    )
  },
  cancel() {
    handle.open()
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel'))
  },
  destroy() {
    handle.destroy()
  },
  received,
  results,
  setup(mode = 'iframe') {
    const dialog = mode === 'popup' ? Dialog.popup() : Dialog.iframe()
    RemoteRequests.attach(host, {
      dialog(parameters) {
        handle = dialog(parameters)
        return handle
      },
      host,
      store: { getState: () => ({ accounts: [], chainId: 4217 }) } as never,
    })
  },
}

Object.assign(window, { fixture })
