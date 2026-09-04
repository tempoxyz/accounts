import { RpcRequest } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Utils from './utils.js'

const request = RpcRequest.from({ id: 1, method: 'eth_sendRawTransaction', params: ['0x00'] })

describe('rpcErrorJson', () => {
  test('maps upstream expired transactions to a transaction-rejected error', () => {
    const error = {
      cause: {
        code: -32603,
        message: 'Revm error: transaction expired',
      },
    }

    expect(Utils.rpcErrorJson(request, error)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": -32003,
          "data": {
            "code": "transaction_expired",
          },
          "message": "Transaction expired.",
        },
        "id": 1,
        "jsonrpc": "2.0",
      }
    `)
  })

  test('preserves unrelated upstream internal errors', () => {
    const error = {
      code: -32603,
      data: { reason: 'database unavailable' },
      message: 'Revm error: database unavailable',
    }

    expect(Utils.rpcErrorJson(request, error)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": -32603,
          "data": {
            "reason": "database unavailable",
          },
          "message": "Revm error: database unavailable",
        },
        "id": 1,
        "jsonrpc": "2.0",
      }
    `)
  })
})
