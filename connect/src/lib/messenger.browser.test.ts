import { Messenger } from '@tempoxyz/accounts'
import { describe, expect, test } from 'vitest'

import * as Messenger_connect from './messenger.js'

describe('Messenger.init', () => {
  test('default: returns noop when not in iframe or popup', () => {
    const messenger = Messenger_connect.init()

    expect(() => messenger.send('ready', undefined)).not.toThrow()
    expect(() => messenger.on('rpc-requests', () => {})).not.toThrow()
    expect(() => messenger.destroy()).not.toThrow()
  })

  test('behavior: bridge ready/request/response round-trip', async () => {
    // Use two messengers on the same window to test the bridge protocol
    // without needing real cross-frame postMessage (source filtering
    // is tested in the lib Messenger tests).
    const remote = Messenger.bridge({
      from: Messenger.fromWindow(window),
      to: Messenger.fromWindow(window),
    })
    const host = Messenger.bridge({
      from: Messenger.fromWindow(window),
      to: Messenger.fromWindow(window),
    })

    // Ready signal
    const ready = host.waitForReady()
    remote.ready()
    await ready

    // Host → remote: rpc-requests
    const received = new Promise<Messenger.Payload<'rpc-requests'>>((resolve) => {
      remote.on('rpc-requests', resolve)
    })
    host.send('rpc-requests', [{ id: 1, jsonrpc: '2.0', method: 'eth_accounts' }])
    expect(await received).toMatchObject([{ id: 1, method: 'eth_accounts' }])

    // Remote → host: rpc-response
    const responded = new Promise<Messenger.Payload<'rpc-response'>>((resolve) => {
      host.on('rpc-response', resolve)
    })
    remote.send('rpc-response', {
      id: 1,
      jsonrpc: '2.0',
      result: ['0xabc'],
      _request: { id: 1, method: 'eth_accounts' },
    })
    expect(await responded).toMatchObject({ id: 1, result: ['0xabc'] })

    remote.destroy()
    host.destroy()
  })
})
