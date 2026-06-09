import { describe, expect, test } from 'vp/test'

import * as ProviderRequest from './ProviderRequest.js'

describe('parse', () => {
  test('default: parses a provider request with metadata', () => {
    const request = ProviderRequest.parse({
      id: 'request-1',
      jsonrpc: '2.0',
      method: 'wallet_switchEthereumChain',
      origin: 'https://app.example',
      params: [{ chainId: '0xa' }],
    })

    expect(request).toMatchInlineSnapshot(`
      {
        "id": "request-1",
        "jsonrpc": "2.0",
        "method": "wallet_switchEthereumChain",
        "origin": "https://app.example",
        "params": [
          {
            "chainId": 10,
          },
        ],
      }
    `)
  })

  test('default: narrows to an expected method', () => {
    const request = ProviderRequest.parse(
      {
        method: 'personal_sign',
        params: ['0x68656c6c6f', '0x0000000000000000000000000000000000000001'],
      },
      { method: 'personal_sign' },
    )

    expect(request.params).toMatchInlineSnapshot(`
      [
        "0x68656c6c6f",
        "0x0000000000000000000000000000000000000001",
      ]
    `)
  })

  test('error: rejects method mismatch', () => {
    expect(() =>
      ProviderRequest.parse(
        {
          method: 'eth_accounts',
        },
        { method: 'wallet_connect' },
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Method mismatch: expected "wallet_connect" but got "eth_accounts".]`,
    )
  })

  test('error: rejects invalid request metadata', () => {
    expect(() =>
      ProviderRequest.parse({
        id: {},
        method: 'eth_accounts',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`[ProviderRpcError: Invalid request: id: Expected string]`)
  })

  test('error: rejects invalid wallet params', () => {
    expect(() =>
      ProviderRequest.parse({
        method: 'wallet_connect',
        params: [{ capabilities: { authorizeAccessKey: { expiry: 1 }, method: 'register' } }],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: capabilities.authorizeAccessKey.limits: Expected array, capabilities.authorizeAccessKey.scopes: Expected array]`,
    )
  })
})
