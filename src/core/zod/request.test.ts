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

  test('default: validates wallet_swap with amountIn', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_swap',
      params: [
        {
          amountIn: '1.5',
          chainId: '0xa',
          tokenIn: '0x0000000000000000000000000000000000000001',
          tokenOut: '0x0000000000000000000000000000000000000002',
        },
      ],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_swap",
        "params": [
          {
            "amountIn": "1.5",
            "chainId": 10,
            "tokenIn": "0x0000000000000000000000000000000000000001",
            "tokenOut": "0x0000000000000000000000000000000000000002",
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

  test('error: rejects wallet_swap when both amountIn and amountOut are provided', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_swap',
        params: [
          {
            amountIn: '1',
            amountOut: '2',
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: params.0.amountOut: Invalid input, params.0.amountIn: Invalid input, params.0.amountIn: Invalid input, params.0.amountOut: Invalid input]`,
    )
  })
})
