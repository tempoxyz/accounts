import { describe, expect, test } from 'vp/test'

import * as Schema from '../Schema.js'
import * as RpcRequest from './request.js'

describe('validate', () => {
  test('default: validates eth_accounts', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'eth_accounts',
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "eth_accounts",
      }
    `)
  })

  test('default: validates eth_chainId', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'eth_chainId',
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "eth_chainId",
      }
    `)
  })

  test('default: validates wallet_connect without params', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
      }
    `)
  })

  test('default: validates wallet_connect with capabilities', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "method": "register",
            },
          },
        ],
      }
    `)
  })

  test('behavior: validates wallet_connect with required identity email capability', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [
        {
          capabilities: { identity: { email: { required: true } }, method: 'register' },
        },
      ],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "identity": {
                "email": {
                  "required": true,
                },
              },
              "method": "register",
            },
          },
        ],
      }
    `)
  })

  test('behavior: validates wallet_connect with Tempo OIDC capability', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [
        {
          capabilities: { method: 'login', oidc: { tempo: { nonce: 'nonce-1', scope: 'openid' } } },
        },
      ],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "method": "login",
              "oidc": {
                "tempo": {
                  "nonce": "nonce-1",
                  "scope": "openid",
                },
              },
            },
          },
        ],
      }
    `)
  })

  test('default: validates wallet_disconnect', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_disconnect',
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_disconnect",
      }
    `)
  })

  test('default: validates wallet_switchEthereumChain with hex chainId', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xa' }],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_switchEthereumChain",
        "params": [
          {
            "chainId": 10,
          },
        ],
      }
    `)
  })

  test('behavior: preserves original request properties', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'eth_accounts',
      id: 1,
      jsonrpc: '2.0',
    })
    expect({ id: (result as any).id, jsonrpc: (result as any).jsonrpc }).toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
      }
    `)
  })

  test('error: throws UnsupportedMethodError for unknown methods', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'eth_unknownMethod',
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedMethodError: Unsupported method "eth_unknownMethod".]`,
    )
  })

  test('error: throws ProviderRpcError for invalid params', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: 'not-hex' }],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: params.0.chainId: Expected hex value, params.0.chainId: Invalid input]`,
    )
  })
})
