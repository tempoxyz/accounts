import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as Schema from '../Schema.js'
import * as RpcRequest from './request.js'
import * as Rpc from './rpc.js'

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

  test('default: validates wallet_swap with sell amount', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_swap',
      params: [
        {
          amount: '1.5',
          pairToken: '0x0000000000000000000000000000000000000002',
          slippage: 0.01,
          token: '0x0000000000000000000000000000000000000001',
          type: 'sell',
        },
      ],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_swap",
        "params": [
          {
            "amount": "1.5",
            "pairToken": "0x0000000000000000000000000000000000000002",
            "slippage": 0.01,
            "token": "0x0000000000000000000000000000000000000001",
            "type": "sell",
          },
        ],
      }
    `)
  })

  test('default: validates wallet_deposit with amount and token symbol', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_deposit',
      params: [
        {
          amount: '50',
          displayName: 'DoorDash',
          token: 'USDC',
        },
      ],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_deposit",
        "params": [
          {
            "amount": "50",
            "displayName": "DoorDash",
            "token": "USDC",
          },
        ],
      }
    `)
  })

  test('default: validates wallet_deposit without params', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_deposit',
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_deposit",
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

  test('error: rejects wallet_swap with invalid type', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_swap',
        params: [
          {
            type: 'hold',
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: params.0.type: Invalid input, params.0.type: Invalid input]`,
    )
  })

  test('default: validates wallet_connect with personalSign capability (login branch)', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [{ capabilities: { personalSign: { message: 'hello' } } }],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "personalSign": {
                "message": "hello",
              },
            },
          },
        ],
      }
    `)
  })

  test('default: validates wallet_connect with personalSign capability (register branch)', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', personalSign: { message: 'hello' } } }],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "method": "register",
              "personalSign": {
                "message": "hello",
              },
            },
          },
        ],
      }
    `)
  })

  test('default: validates wallet_connect with personalSign empty message', () => {
    const result = RpcRequest.validate(Schema.Request, {
      method: 'wallet_connect',
      params: [{ capabilities: { personalSign: { message: '' } } }],
    })
    expect(result._decoded).toMatchInlineSnapshot(`
      {
        "method": "wallet_connect",
        "params": [
          {
            "capabilities": {
              "personalSign": {
                "message": "",
              },
            },
          },
        ],
      }
    `)
  })

  test('error: rejects wallet_connect personalSign as a string', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_connect',
        params: [{ capabilities: { personalSign: 'hello' } }],
      }),
    ).toThrowError(/Invalid params/)
  })

  test('error: rejects wallet_connect personalSign without message', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_connect',
        params: [{ capabilities: { personalSign: {} } }],
      }),
    ).toThrowError(/Invalid params/)
  })

  test('error: rejects wallet_connect personalSign with non-string message', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_connect',
        params: [{ capabilities: { personalSign: { message: 0 } } }],
      }),
    ).toThrowError(/Invalid params/)
  })

  test('error: rejects wallet_swap with out-of-range slippage', () => {
    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_swap',
        params: [
          {
            slippage: 1.1,
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: params.0.slippage: Invalid input]`,
    )

    expect(() =>
      RpcRequest.validate(Schema.Request, {
        method: 'wallet_swap',
        params: [
          {
            slippage: -0.1,
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: Invalid params: params.0.slippage: Invalid input]`,
    )
  })
})

describe('wallet_connect_strict.parameters', () => {
  test('default: parses personalSign on the strict (login) branch', () => {
    const result = z.parse(Rpc.wallet_connect_strict.parameters, {
      capabilities: { personalSign: { message: 'hello' } },
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "personalSign": {
            "message": "hello",
          },
        },
      }
    `)
  })

  test('default: parses personalSign on the strict (register) branch', () => {
    const result = z.parse(Rpc.wallet_connect_strict.parameters, {
      capabilities: { method: 'register', personalSign: { message: 'hello' } },
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "method": "register",
          "personalSign": {
            "message": "hello",
          },
        },
      }
    `)
  })

  test('error: rejects strict personalSign without message', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: { personalSign: {} },
      }),
    ).toThrowError()
  })
})
