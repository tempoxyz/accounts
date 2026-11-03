import { RpcRequest } from 'ox'
import { tempo, tempoDevnet, tempoLocalnet, tempoModerato } from 'viem/tempo/chains'
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

describe('withMulticall3', () => {
  test('adds the genesis Multicall3 to Tempo chains and leaves other chains alone', () => {
    const own = {
      ...tempo,
      contracts: { multicall3: { address: '0x1111111111111111111111111111111111111111' } },
    } as const
    expect({
      ...Object.fromEntries(
        [tempo, tempoModerato, tempoDevnet, tempoLocalnet].map((chain) => [
          chain.id,
          Utils.withMulticall3(chain).contracts?.multicall3,
        ]),
      ),
      keepsContracts:
        Utils.withMulticall3(tempo).contracts?.earnFactory === tempo.contracts.earnFactory,
      own: Utils.withMulticall3(own).contracts?.multicall3,
    }).toMatchInlineSnapshot(`
      {
        "1337": undefined,
        "31318": {
          "address": "0xcA11bde05977b3631167028862bE2a173976CA11",
          "blockCreated": 0,
        },
        "4217": {
          "address": "0xcA11bde05977b3631167028862bE2a173976CA11",
          "blockCreated": 0,
        },
        "42431": {
          "address": "0xcA11bde05977b3631167028862bE2a173976CA11",
          "blockCreated": 0,
        },
        "keepsContracts": true,
        "own": {
          "address": "0x1111111111111111111111111111111111111111",
        },
      }
    `)
  })
})
