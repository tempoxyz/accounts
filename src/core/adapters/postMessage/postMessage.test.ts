import { tempoModerato } from 'viem/tempo/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'
import { Wata as HostWata, postMessage as hostPostMessage } from 'wata/host'

import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Mount from './mount.js'
import { postMessage } from './postMessage.js'

const address = '0x0000000000000000000000000000000000000001'
const consumerOrigin = 'https://app.example'
const walletOrigin = 'https://wallet.tempo.xyz'

const hosts: Promise<{ close: () => Promise<void> }>[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(hosts.splice(0).map((host) => host.then((session) => session.close())))
})

type Listener = (event: { data: unknown; origin: string; source?: unknown }) => void

function realm() {
  const listeners = new Set<Listener>()
  return {
    addEventListener: (_type: string, listener: Listener) => void listeners.add(listener),
    deliver(data: unknown, origin: string, source?: unknown) {
      for (const listener of [...listeners]) listener({ data, origin, source })
    },
    removeEventListener: (_type: string, listener: Listener) => void listeners.delete(listener),
  }
}

/**
 * Fakes a browser whose `window.open` mints an in-process wallet window. A
 * closed window drops inbound frames, like a real closed popup.
 */
function installBrowser() {
  const consumer = realm()
  const windows: { closed: boolean }[] = []
  vi.stubGlobal(
    'window',
    Object.assign(consumer, {
      dispatchEvent: () => true,
      innerWidth: 1024,
      innerHeight: 768,
      location: { origin: consumerOrigin },
      open: () => {
        const wallet = realm()
        const handle = {
          addEventListener() {},
          closed: false,
          close() {
            this.closed = true
          },
          focus() {},
          postMessage(data: unknown) {
            if (!this.closed) wallet.deliver(data, consumerOrigin)
          },
        }
        const opener = {
          addEventListener() {},
          postMessage: (data: unknown) => {
            if (!handle.closed) consumer.deliver(data, walletOrigin, handle)
          },
        }
        const session = HostWata.create({
          transports: [
            hostPostMessage({
              source: wallet as never,
              target: () => opener as unknown as Window,
              targetOrigin: consumerOrigin,
            }),
          ],
        }).start()
        session.onRequest(async (event) => {
          await event.respond({ accounts: [{ address, capabilities: {} }] })
        })
        hosts.push(Promise.resolve(session))
        windows.push(handle)
        return handle
      },
      screenX: 0,
      screenY: 0,
    }),
  )
  const element = () => ({
    addEventListener() {},
    appendChild() {},
    remove() {},
    style: {},
    textContent: '',
  })
  vi.stubGlobal('document', { body: element(), createElement: () => element() })
  return { windows }
}

describe('popup', () => {
  test('behavior: a request right after the popup closes opens a new popup', async () => {
    const { windows } = installBrowser()
    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: Mount.popup(),
        name: 'Tempo Wallet',
        rdns: 'xyz.tempo',
      }),
      chains: [tempoModerato],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(windows[0]!.closed).toBe(true), { interval: 1 })

    // Sent before the transport's 250 ms closed-window poll could notice.
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts.map((account) => account.address)).toMatchInlineSnapshot(`
      [
        "0x0000000000000000000000000000000000000001",
      ]
    `)
    expect(windows.map((window) => window.closed)).toMatchInlineSnapshot(`
      [
        true,
        true,
      ]
    `)
  })
})
