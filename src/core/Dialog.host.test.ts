import { describe, expect, test, vi } from 'vp/test'

import * as Dialog from './Dialog.js'

function createMockHost() {
  return {
    rejectAll: vi.fn(),
  } as unknown as Dialog.Host
}

describe('validateSearch', () => {
  test('default: validates eth_accounts', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      { method: 'eth_accounts', id: 1, jsonrpc: '2.0' },
      { method: 'eth_accounts' },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "eth_accounts",
      }
    `)
    expect(result.id).toBe(1)
    expect(result.jsonrpc).toBe('2.0')
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_connect without params', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      { method: 'wallet_connect', id: 2, jsonrpc: '2.0' },
      { method: 'wallet_connect' },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
      }
    `)
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_authorizeAccessKey with expiry and limits', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_authorizeAccessKey',
        id: 3,
        jsonrpc: '2.0',
        params: [
          {
            expiry: 100,
            limits: [{ token: '0x0000000000000000000000000000000000000001', limit: '0xa' }],
            scopes: [{ address: '0x0000000000000000000000000000000000000002' }],
          },
        ],
      },
      { method: 'wallet_authorizeAccessKey' },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_authorizeAccessKey",
        "params": [
          {
            "expiry": 100,
            "limits": [
              {
                "limit": 10n,
                "token": "0x0000000000000000000000000000000000000001",
              },
            ],
            "scopes": [
              {
                "address": "0x0000000000000000000000000000000000000002",
              },
            ],
          },
        ],
      }
    `)
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_connect with authorizeAccessKey containing limits', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_connect',
        id: 4,
        jsonrpc: '2.0',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: {
                expiry: 100,
                limits: [{ token: '0x0000000000000000000000000000000000000001', limit: '0xa' }],
                scopes: [{ address: '0x0000000000000000000000000000000000000002' }],
              },
            },
          },
        ],
      },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toBe('wallet_connect')
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('error: rejects on method mismatch', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        { method: 'eth_accounts', id: 1, jsonrpc: '2.0' },
        { method: 'eth_chainId' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Method mismatch: expected "eth_chainId" but got "eth_accounts".]`,
    )
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('error: rejects on invalid base params', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        { method: 'not_a_method', id: 1, jsonrpc: '2.0' },
        { method: 'eth_accounts' },
      ),
    ).toThrow()
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: rejects wallet_authorizeAccessKey without limits', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        {
          method: 'wallet_authorizeAccessKey',
          id: 5,
          jsonrpc: '2.0',
          params: [{ expiry: 100 }],
        },
        { method: 'wallet_authorizeAccessKey' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Invalid params for "wallet_authorizeAccessKey":
  - limits: Expected array
  - scopes: Expected array]`,
    )
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: rejects wallet_connect with authorizeAccessKey missing limits', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        {
          method: 'wallet_connect',
          id: 6,
          jsonrpc: '2.0',
          params: [
            {
              capabilities: {
                method: 'register',
                authorizeAccessKey: { expiry: 100 },
              },
            },
          ],
        },
        { method: 'wallet_connect' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Invalid params for "wallet_connect":
  - capabilities.authorizeAccessKey.limits: Expected array
  - capabilities.authorizeAccessKey.scopes: Expected array]`,
    )
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict false: validates wallet_connect with authorizeAccessKey missing policy', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_connect',
        id: 6,
        jsonrpc: '2.0',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: { expiry: 100 },
            },
          },
        ],
      },
      { method: 'wallet_connect', strict: false },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "authorizeAccessKey": {
                "expiry": 100,
              },
              "method": "register",
            },
          },
        ],
      }
    `)
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('strict: passes wallet_connect without authorizeAccessKey', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_connect',
        id: 7,
        jsonrpc: '2.0',
        params: [{ capabilities: { method: 'register' } }],
      },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toBe('wallet_connect')
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('strict: rejects wallet_authorizeAccessKey with empty policy arrays', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        {
          method: 'wallet_authorizeAccessKey',
          id: 8,
          jsonrpc: '2.0',
          params: [{ expiry: 100, limits: [], scopes: [] }],
        },
        { method: 'wallet_authorizeAccessKey' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Invalid params for "wallet_authorizeAccessKey":
  - limits: Invalid input
  - scopes: Invalid input]`,
    )
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict false: validates wallet_authorizeAccessKey without policy', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_authorizeAccessKey',
        id: 8,
        jsonrpc: '2.0',
        params: [{ expiry: 100 }],
      },
      { method: 'wallet_authorizeAccessKey', strict: false },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_authorizeAccessKey",
        "params": [
          {
            "expiry": 100,
          },
        ],
      }
    `)
    expect(host.rejectAll).not.toHaveBeenCalled()
  })

  test('strict: rejects wallet_authorizeAccessKey with malformed scope', () => {
    const host = createMockHost()
    expect(() =>
      Dialog.host.validateSearch(
        host,
        {
          method: 'wallet_authorizeAccessKey',
          id: 9,
          jsonrpc: '2.0',
          params: [
            {
              expiry: 100,
              limits: [{ token: '0x20c0000000000000000000000000000000000001', limit: '0x1' }],
              scopes: [{ selector: 'transfer(address,uint256)' }],
            },
          ],
        },
        { method: 'wallet_authorizeAccessKey' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Invalid params for "wallet_authorizeAccessKey":
  - params.0.scopes.0.address: Expected string]`,
    )
    expect(host.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: passes wallet_authorizeAccessKey with bounded policy', () => {
    const host = createMockHost()
    const result = Dialog.host.validateSearch(
      host,
      {
        method: 'wallet_authorizeAccessKey',
        id: 10,
        jsonrpc: '2.0',
        params: [
          {
            expiry: 100,
            limits: [{ token: '0x20c0000000000000000000000000000000000001', limit: '0x1' }],
            scopes: [{ address: '0x20c0000000000000000000000000000000000001' }],
          },
        ],
      },
      { method: 'wallet_authorizeAccessKey' },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_authorizeAccessKey",
        "params": [
          {
            "expiry": 100,
            "limits": [
              {
                "limit": 1n,
                "token": "0x20c0000000000000000000000000000000000001",
              },
            ],
            "scopes": [
              {
                "address": "0x20c0000000000000000000000000000000000001",
              },
            ],
          },
        ],
      }
    `)
    expect(host.rejectAll).not.toHaveBeenCalled()
  })
})

describe('respond', () => {
  test('behavior: sends the provider result to the consumer', async () => {
    const sendResponse = vi.fn()
    const host = Dialog.host.create({
      channel: {
        onCancelRequests: vi.fn(),
        onRequest: vi.fn(),
        onValidateCachedAccounts: vi.fn(),
        ready: vi.fn(),
        sendResponse,
      } as never,
      provider: {
        request: vi.fn(async () => ['0x0000000000000000000000000000000000000001']),
      } as never,
    })

    const result = await host.respond({ id: 1, jsonrpc: '2.0', method: 'eth_accounts' } as never)

    expect(result).toMatchInlineSnapshot(`
      [
        "0x0000000000000000000000000000000000000001",
      ]
    `)
    expect(sendResponse.mock.calls).toMatchInlineSnapshot(`
      [
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
        ],
      ]
    `)
  })

  test('behavior: defer returns the provider result without sending a response', async () => {
    const sendResponse = vi.fn()
    const host = Dialog.host.create({
      channel: {
        onCancelRequests: vi.fn(),
        onRequest: vi.fn(),
        onValidateCachedAccounts: vi.fn(),
        ready: vi.fn(),
        sendResponse,
      } as never,
      provider: {
        request: vi.fn(async () => ({ ok: true })),
      } as never,
    })

    const result = await host.respond(
      { id: 1, jsonrpc: '2.0', method: 'wallet_connect' } as never,
      { defer: true },
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "ok": true,
      }
    `)
    expect(sendResponse).not.toHaveBeenCalled()
  })

  test('behavior: same-origin WebAuthn errors switch the consumer to popup mode', async () => {
    const sendResponse = vi.fn()
    const switchMode = vi.fn()
    const host = Dialog.host.create({
      channel: {
        onCancelRequests: vi.fn(),
        onRequest: vi.fn(),
        onValidateCachedAccounts: vi.fn(),
        ready: vi.fn(),
        sendResponse,
        switchMode,
      } as never,
      provider: {
        request: vi.fn(async () => {
          throw new Error('sameOriginWithAncestors')
        }),
      } as never,
    })

    const result = await host.respond({ id: 1, jsonrpc: '2.0', method: 'wallet_connect' } as never)

    expect(result).toMatchInlineSnapshot(`undefined`)
    expect(sendResponse).not.toHaveBeenCalled()
    expect(switchMode.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "mode": "popup",
          },
        ],
      ]
    `)
  })
})

describe('ready', () => {
  test('behavior: publishes trusted hosts and validates cached accounts', () => {
    let onValidateCachedAccounts:
      | ((
          payload: Dialog.channel.ValidateCachedAccountsRequest,
        ) => Dialog.channel.ValidateCachedAccountsResponse | void)
      | undefined
    const ready = vi.fn()
    const host = Dialog.host.create({
      channel: {
        onCancelRequests: vi.fn(),
        onRequest: vi.fn(),
        onValidateCachedAccounts: vi.fn((listener) => {
          onValidateCachedAccounts = listener
          return () => {}
        }),
        ready,
      } as never,
      provider: {
        request: vi.fn(),
      } as never,
      trustedHosts: ['app.test'],
    })

    host.ready({ accounts: ['0x0000000000000000000000000000000000000001'] })

    expect(ready.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "trustedHosts": [
              "app.test",
            ],
          },
        ],
      ]
    `)
    expect([
      onValidateCachedAccounts!({
        addresses: ['0x0000000000000000000000000000000000000001'],
      }),
      onValidateCachedAccounts!({
        addresses: ['0x0000000000000000000000000000000000000002'],
      }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "valid": true,
        },
        {
          "valid": false,
        },
      ]
    `)
  })
})
