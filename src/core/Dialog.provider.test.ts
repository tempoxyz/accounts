import { createWalletClient, custom } from 'viem'
import { tempo } from 'viem/tempo/chains'
import { afterEach, expect, test, vi } from 'vp/test'

import { dialog } from './adapters/dialog.js'
import * as Dialog from './Dialog.js'
import * as RemoteRequests from './internal/RemoteRequests.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const host = 'https://wallet.example/remote?secret=private'
const address = '0x0000000000000000000000000000000000000001'

afterEach(() => RemoteRequests.reset(host))

test.each(['provider', 'viem'] as const)(
  'startup diagnostics survive the public %s request path',
  async (path) => {
    const sync = vi.fn(async () => {
      throw new Dialog.TransportError(host, 'dialog_ready')
    })
    const provider = Provider.create({
      adapter: dialog({
        dialog: () => ({ close() {}, destroy() {}, open() {}, syncRequests: sync, syncTheme() {} }),
        host,
      }),
      chains: [tempo],
      storage: Storage.memory(),
    })
    provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
    const client = createWalletClient({
      chain: tempo,
      transport: custom(provider, { retryCount: 0 }),
    })
    const error = await (
      path === 'provider'
        ? provider.request({ method: 'personal_sign', params: ['0x1234', address] })
        : client.signMessage({ account: address, message: { raw: '0x1234' } })
    ).catch((error: unknown) => error)

    const diagnostics = []
    let current = error
    for (let depth = 0; current && typeof current === 'object' && depth < 10; depth++) {
      const candidate = current as { cause?: unknown; code?: unknown; data?: unknown }
      if (candidate.code === -32000 && candidate.data)
        diagnostics.push({ code: candidate.code, data: candidate.data })
      current = candidate.cause
    }
    expect(diagnostics).toContainEqual({
      code: -32000,
      data: { origin: 'https://wallet.example', stage: 'dialog_ready' },
    })
    expect(sync.mock.calls.length).toMatchInlineSnapshot('1')
  },
)
