import { describe, expect, test, vi } from 'vp/test'

import * as Dialog from './Dialog.js'

describe('channel', () => {
  test('postMessage: delivers ready, requests, and responses', async () => {
    const windows = createWindows()
    const consumer = Dialog.channel.consumerPostMessage({
      host: `${windows.host.origin}/dialog`,
      source: windows.app.source as unknown as Window,
      target: windows.appToHost as unknown as Window,
    })
    const host = Dialog.channel.hostPostMessage({
      source: windows.host.source as unknown as Window,
      target: windows.hostToApp as unknown as Window,
      targetOrigin: windows.app.origin,
    })
    const requests: { meta: Dialog.host.Meta; sync: Dialog.Sync }[] = []
    const responses: Dialog.channel.Response[] = []

    host.onRequests((sync, meta) => requests.push({ meta, sync }))
    consumer.onResponse((response) => responses.push(response))

    await host.start()
    await consumer.start()
    await host.ready({ trustedHosts: ['app.test'] })

    await expect(consumer.waitForReady()).resolves.toMatchInlineSnapshot(`
      {
        "trustedHosts": [
          "app.test",
        ],
      }
    `)

    await consumer.sendRequests({
      account: undefined,
      chainId: 1,
      requests: [
        {
          request: { id: 1, jsonrpc: '2.0', method: 'eth_accounts' } as never,
          status: 'pending',
        },
      ],
    })

    await vi.waitFor(() => {
      expect(requests).toMatchInlineSnapshot(`
        [
          {
            "meta": {
              "origin": "https://app.test",
            },
            "sync": {
              "account": undefined,
              "chainId": 1,
              "requests": [
                {
                  "request": {
                    "id": 1,
                    "jsonrpc": "2.0",
                    "method": "eth_accounts",
                  },
                  "status": "pending",
                },
              ],
            },
          },
        ]
      `)
    })

    await host.sendResponse({
      _request: { id: 1, jsonrpc: '2.0', method: 'eth_accounts' } as never,
      id: 1,
      jsonrpc: '2.0',
      result: ['0x0000000000000000000000000000000000000001'],
    })

    await vi.waitFor(() => {
      expect(responses).toMatchInlineSnapshot(`
        [
          {
            "_request": {
              "id": 1,
              "jsonrpc": "2.0",
              "method": "eth_accounts",
            },
            "id": 1,
            "jsonrpc": "2.0",
            "result": [
              "0x0000000000000000000000000000000000000001",
            ],
          },
        ]
      `)
    })

    await consumer.close()
    await host.close()
  })

  test('postMessage: waitForReady rejects on transport errors', async () => {
    const windows = createWindows()
    const consumer = Dialog.channel.consumerPostMessage({
      host: `${windows.host.origin}/dialog`,
      source: windows.app.source as unknown as Window,
      target: windows.appToHost as unknown as Window,
    })

    await consumer.start()
    windows.app.dispatch({ type: 'urpc.ready' }, windows.host.origin)

    await expect(consumer.waitForReady()).rejects.toMatchInlineSnapshot(
      `[PostMessage.InvalidFrameError: inbound postMessage frame is missing or has malformed v4 UUID \`id\`]`,
    )

    await consumer.close()
  })
})

function createWindows() {
  const app = createSource('https://app.test')
  const host = createSource('https://wallet.test')
  return {
    app,
    appToHost: createTarget(host, app.origin),
    host,
    hostToApp: createTarget(app, host.origin),
  }
}

function createSource(origin: string) {
  const listeners = new Set<EventListenerOrEventListenerObject>()
  return {
    closed: false,
    dispatch(data: unknown, origin: string) {
      const event = { data, origin } as MessageEvent
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
    },
    origin,
    source: {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'message') listeners.add(listener)
      },
      closed: false,
      postMessage() {},
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'message') listeners.delete(listener)
      },
    },
  }
}

function createTarget(destination: ReturnType<typeof createSource>, origin: string) {
  return {
    addEventListener() {},
    closed: false,
    postMessage(data: unknown, targetOrigin: string) {
      if (targetOrigin !== '*' && targetOrigin !== destination.origin) return
      destination.dispatch(data, origin)
    },
    removeEventListener() {},
  }
}
