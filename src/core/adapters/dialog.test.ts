import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../../test/config.js'
import * as Dialog from '../Dialog.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import type * as Store from '../Store.js'
import { dialog } from './dialog.js'

describe('dialog', () => {
  test('behavior: queued requests carry signer metadata', async () => {
    const queues: (readonly Store.QueuedRequest[])[] = []
    const provider = Provider.create({
      adapter: dialog({
        dialog: ((parameters) => ({
          close() {},
          destroy() {},
          open() {},
          async syncRequests(requests) {
            queues.push(requests)
            if (requests.length === 0) return
            parameters.store.setState((state) => ({
              requestQueue: state.requestQueue.map((queued) =>
                queued.status === 'pending'
                  ? {
                      ...(queued.account ? { account: queued.account } : {}),
                      request: queued.request,
                      result: '0x1234',
                      status: 'success' as const,
                    }
                  : queued,
              ),
            }))
          },
          syncTheme() {},
        })) satisfies Dialog.Dialog,
      }),
      storage: Storage.memory({ key: 'dialog-request-account-test' }),
    })
    provider.store.setState({
      accounts: [
        {
          address: accounts[0].address,
          keyType: 'webAuthn_headless',
          origin: 'https://example.com',
          privateKey: privateKeys[0],
          rpId: 'example.com',
        },
      ],
      activeAccount: 0,
    })

    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ data: '0x', from: accounts[0].address, to: accounts[0].address }],
    })

    expect(result).toMatchInlineSnapshot(`"0x1234"`)
    expect(queues[0]?.[0]?.account).toMatchInlineSnapshot(`
      {
        "address": "${accounts[0].address}",
        "keyType": "webAuthn",
        "type": "json-rpc",
      }
    `)
  })
})
