import { describe, expect, test, vi } from 'vp/test'

import * as Dialog from '../Dialog.js'

const host = 'https://wallet.test/embed'

describe('Dialog.consumer.attach', () => {
  test('behavior: each attachment owns its local request lifecycle', async () => {
    const requests: Dialog.RequestContext[] = []
    const resolves: ((result: unknown) => void)[] = []
    const dialog = Dialog.define({ name: 'test' }, () => {
      return {
        close() {},
        destroy() {},
        open() {},
        request(request) {
          requests.push(request)
          return new Promise((resolve) => {
            resolves.push(resolve)
          })
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
      if (requests.length < 2) throw new Error('requests not sent')
    })

    expect(requests.map((request) => request.request.request)).toMatchInlineSnapshot(`
      [
        {
          "id": 0,
          "jsonrpc": "2.0",
          "method": "eth_accounts",
        },
        {
          "id": 0,
          "jsonrpc": "2.0",
          "method": "wallet_getCallsStatus",
          "params": [
            "0x1",
          ],
        },
      ]
    `)

    resolves[0]!('accounts')
    resolves[1]!('status')

    await expect(promise_a).resolves.toMatchInlineSnapshot(`"accounts"`)
    await expect(promise_b).resolves.toMatchInlineSnapshot(`"status"`)

    a.detach()
    b.detach()
  })
})
