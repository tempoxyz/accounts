import { describe, expect, test, vi } from 'vp/test'

import * as Dialog from '../Dialog.js'

const host = 'https://wallet.test/embed'

describe('Dialog.consumer.attach', () => {
  test('behavior: each attachment owns its local request lifecycle', async () => {
    const sessions: Dialog.SetupFn.Parameters[] = []
    const syncs: Dialog.Sync[] = []
    const dialog = Dialog.define({ name: 'test' }, (parameters) => {
      sessions.push(parameters)
      return {
        close() {},
        destroy() {},
        open() {},
        async syncRequests(sync) {
          syncs.push(sync)
        },
        syncTheme() {},
      }
    })

    const a = Dialog.consumer.attach({
      dialog,
      getAccounts: () => [],
      getChainId: () => 1,
      host,
      onAccountsInvalid() {},
    })
    const b = Dialog.consumer.attach({
      dialog,
      getAccounts: () => [],
      getChainId: () => 1,
      host,
      onAccountsInvalid() {},
    })

    const promise_a = a.request({
      account: undefined,
      chainId: 1,
      request: { method: 'eth_accounts' },
    })
    const promise_b = b.request({
      account: undefined,
      chainId: 1,
      request: { method: 'wallet_getCallsStatus', params: ['0x1'] },
    })

    await vi.waitFor(() => {
      if (syncs.length < 2) throw new Error('requests not synced')
    })

    expect(syncs.map((sync) => sync.requests.map((x) => x.request))).toMatchInlineSnapshot(`
      [
        [
          {
            "id": 0,
            "jsonrpc": "2.0",
            "method": "eth_accounts",
          },
        ],
        [
          {
            "id": 0,
            "jsonrpc": "2.0",
            "method": "wallet_getCallsStatus",
            "params": [
              "0x1",
            ],
          },
        ],
      ]
    `)

    sessions[0]!.onResponse({ id: syncs[0]!.requests[0]!.request.id, result: 'accounts' })
    sessions[1]!.onResponse({ id: syncs[1]!.requests[0]!.request.id, result: 'status' })

    await expect(promise_a).resolves.toMatchInlineSnapshot(`"accounts"`)
    await expect(promise_b).resolves.toMatchInlineSnapshot(`"status"`)

    a.detach()
    b.detach()
  })
})
