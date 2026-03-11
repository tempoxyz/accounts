import { describe, expect, test } from 'vitest'

import * as Request from '../request.js'

function request(method: string, params?: unknown) {
  return { id: 1, jsonrpc: '2.0' as const, method, params }
}

const stubAddress = '0x0000000000000000000000000000000000000000'
const stubTxParams = [{ to: stubAddress }]

describe('Request.handle', () => {
  test('default: wallet_connect returns accounts', () => {
    const response = Request.handle(request('wallet_connect'))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": {
          "accounts": [
            {
              "address": "0x0000000000000000000000000000000000000000",
              "capabilities": {},
            },
          ],
        },
      }
    `)
  })

  test('default: eth_sendTransaction returns hash', () => {
    const response = Request.handle(request('eth_sendTransaction', stubTxParams))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": "0x0000000000000000000000000000000000000000000000000000000000000001",
      }
    `)
  })

  test('default: eth_sendTransactionSync returns hash', () => {
    const response = Request.handle(request('eth_sendTransactionSync', stubTxParams))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": "0x0000000000000000000000000000000000000000000000000000000000000001",
      }
    `)
  })

  test('default: eth_signTransaction returns hash', () => {
    const response = Request.handle(request('eth_signTransaction', stubTxParams))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": "0x0000000000000000000000000000000000000000000000000000000000000001",
      }
    `)
  })

  test('default: personal_sign returns signature', () => {
    const response = Request.handle(request('personal_sign', ['0xdeadbeef', stubAddress]))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      }
    `)
  })

  test('default: eth_signTypedData_v4 returns signature', () => {
    const response = Request.handle(request('eth_signTypedData_v4', [stubAddress, '{}']))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      }
    `)
  })

  test('default: wallet_authorizeAccessKey returns key authorization', () => {
    const response = Request.handle(request('wallet_authorizeAccessKey'))

    expect(response).toMatchInlineSnapshot(`
      {
        "result": {
          "address": "0x0000000000000000000000000000000000000000",
          "chainId": "0x1",
          "expiry": null,
          "keyId": "0x0000000000000000000000000000000000000000",
          "keyType": "secp256k1",
          "limits": [],
          "signature": {},
        },
      }
    `)
  })

  test('default: wallet_revokeAccessKey returns undefined', () => {
    const response = Request.handle(
      request('wallet_revokeAccessKey', [
        { address: stubAddress, accessKeyAddress: stubAddress },
      ]),
    )

    expect(response).toMatchInlineSnapshot(`
      {
        "result": undefined,
      }
    `)
  })

  test('behavior: unknown method returns error code -32601', () => {
    const response = Request.handle(request('eth_nonexistent'))

    expect(response).toMatchInlineSnapshot(`
      {
        "error": {
          "code": -32601,
          "message": "Unsupported method",
        },
      }
    `)
  })
})
