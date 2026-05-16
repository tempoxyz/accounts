import { describe, expect, test, vi } from 'vp/test'

import * as Remote from './Remote.js'

function createMockRemote() {
  return {
    rejectAll: vi.fn(),
  } as unknown as Remote.Remote
}

describe('validateSearch', () => {
  test('default: validates eth_accounts', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
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
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_connect without params', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
      { method: 'wallet_connect', id: 2, jsonrpc: '2.0' },
      { method: 'wallet_connect' },
    )
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
      }
    `)
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_authorizeAccessKey with expiry and limits', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
      {
        method: 'wallet_authorizeAccessKey',
        id: 3,
        jsonrpc: '2.0',
        params: [
          {
            expiry: 100,
            limits: [{ token: '0x0000000000000000000000000000000000000001', limit: '0xa' }],
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
          },
        ],
      }
    `)
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })

  test('default: validates wallet_connect with authorizeAccessKey containing limits', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
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
              },
            },
          },
        ],
      },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toBe('wallet_connect')
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })

  test('error: rejects on method mismatch', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
        { method: 'eth_accounts', id: 1, jsonrpc: '2.0' },
        { method: 'eth_chainId' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Method mismatch: expected "eth_chainId" but got "eth_accounts".]`,
    )
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('error: rejects on invalid base params', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
        { method: 'not_a_method', id: 1, jsonrpc: '2.0' },
        { method: 'eth_accounts' },
      ),
    ).toThrow()
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: rejects wallet_authorizeAccessKey without limits', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
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
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: rejects wallet_connect with authorizeAccessKey missing limits', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
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
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: passes wallet_connect without authorizeAccessKey', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
      {
        method: 'wallet_connect',
        id: 7,
        jsonrpc: '2.0',
        params: [{ capabilities: { method: 'register' } }],
      },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toBe('wallet_connect')
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })

  test('strict: rejects wallet_authorizeAccessKey with empty policy arrays', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
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
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: rejects wallet_authorizeAccessKey with malformed scope', () => {
    const remote = createMockRemote()
    expect(() =>
      Remote.validateSearch(
        remote,
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
    expect(remote.rejectAll).toHaveBeenCalledOnce()
  })

  test('strict: passes wallet_authorizeAccessKey with bounded policy', () => {
    const remote = createMockRemote()
    const result = Remote.validateSearch(
      remote,
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
    expect(remote.rejectAll).not.toHaveBeenCalled()
  })
})
