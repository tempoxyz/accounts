import { custom, encodeAbiParameters, encodeFunctionResult, multicall3Abi, zeroAddress } from 'viem'
import type { Transaction } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, beforeEach, describe, expect, test } from 'vp/test'

import type { Handler } from '../../Handler.js'
import { relay } from './relay.js'

const sender = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const payer = '0x3333333333333333333333333333333333333333'
const token = '0x20c0000000000000000000000000000000000001'
const token_sponsor = '0x20c0000000000000000000000000000000000002'
const token_default = '0x20c0000000000000000000000000000000000003'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled'))
})

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

function setup() {
  const sign = vi.fn().mockResolvedValue({ r: 1n, s: 2n, yParity: 0 })
  const validate = vi.fn(
    (_transaction: Transaction.TransactionRequest): boolean | Promise<boolean> => false,
  )
  const request = vi.fn(
    async ({
      method,
      params,
    }: {
      method: string
      params?: readonly unknown[] | undefined
    }): Promise<unknown> => {
      // An unset on-chain fee-token preference leaves selection to the fill.
      if (method === 'eth_call')
        return encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: [
            {
              success: true,
              returnData: encodeAbiParameters([{ type: 'address' }], [zeroAddress]),
            },
          ],
        })
      if (method !== 'eth_fillTransaction') throw new Error(`Unexpected RPC: ${method}`)
      const [transaction] = params as readonly Record<string, unknown>[]
      return {
        tx: {
          ...transaction,
          gas: '0x30d40',
          nonce: '0x2',
          maxFeePerGas: '0x3',
          feeToken: transaction!.feeToken ?? token_default,
        },
      }
    },
  )
  const handler = relay({
    chains: [tempo],
    resolveTokens: () => [],
    transports: { [tempo.id]: custom({ request }, { retryCount: 0 }) },
    feePayer: {
      account: { address: payer, type: 'local', sign } as never,
      feeToken: token_sponsor,
      name: 'Synthetic sponsor',
      validate,
    },
  })
  return { handler, request, sign, validate }
}

async function fill(handler: Handler, transaction: Record<string, unknown> = {}) {
  const response = await handler.fetch(
    new Request('https://relay.invalid/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_fillTransaction',
        params: [
          {
            from: sender,
            chainId: '0x1079',
            gas: '0x186a0',
            nonce: '0x1',
            maxFeePerGas: '0x2',
            calls: [{ to: recipient, data: '0x1234', value: '0x3' }],
            feeToken: token,
            capabilities: { balanceDiffs: false },
            ...transaction,
          },
        ],
      }),
    }),
  )
  return await response.json()
}

describe('conditional sponsorship', () => {
  test.each([undefined, true])(
    'refills a rejected prepared transaction with the caller fee token (feePayer: %s)',
    async (feePayer) => {
      const fixture = setup()
      const response = await fill(fixture.handler, { feePayer })

      expect(fixture.validate).toHaveBeenCalledTimes(1)
      expect(fixture.validate.mock.calls[0]?.[0].feeToken).toMatchInlineSnapshot(
        '"0x20c0000000000000000000000000000000000002"',
      )
      expect(fixture.request).toHaveBeenCalledTimes(1)
      expect(fixture.sign).not.toHaveBeenCalled()
      expect(fixture.request.mock.calls).toMatchInlineSnapshot(`
        [
          [
            {
              "method": "eth_fillTransaction",
              "params": [
                {
                  "calls": [
                    {
                      "data": "0x1234",
                      "to": "0x2222222222222222222222222222222222222222",
                      "value": "0x3",
                    },
                  ],
                  "capabilities": {
                    "balanceDiffs": false,
                  },
                  "chainId": "0x1079",
                  "data": undefined,
                  "feeToken": "0x20c0000000000000000000000000000000000001",
                  "from": "0x1111111111111111111111111111111111111111",
                  "gas": "0x186a0",
                  "maxFeePerGas": "0x2",
                  "nonce": "0x1",
                  "to": undefined,
                  "type": "0x76",
                  "value": undefined,
                },
              ],
            },
            undefined,
          ],
        ]
      `)
      expect(response).toMatchInlineSnapshot(`
        {
          "id": 1,
          "jsonrpc": "2.0",
          "result": {
            "capabilities": {
              "sponsored": false,
            },
            "tx": {
              "blockNumber": null,
              "calls": [
                {
                  "data": "0x1234",
                  "to": "0x2222222222222222222222222222222222222222",
                  "value": "0x3",
                },
              ],
              "chainId": "0x1079",
              "feeToken": "0x20c0000000000000000000000000000000000001",
              "from": "0x1111111111111111111111111111111111111111",
              "gas": "0x30d40",
              "maxFeePerGas": "0x3",
              "nonce": "0x2",
              "transactionIndex": null,
              "type": "0x76",
              "value": "0x0",
            },
          },
        }
      `)
    },
  )

  test('does not carry the sponsor token into a refill without an explicit token', async () => {
    const fixture = setup()
    const response = await fill(fixture.handler, { feeToken: undefined })

    expect(fixture.request).toHaveBeenCalledTimes(2)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(fixture.request.mock.calls.map(([request]) => request.method)).toMatchInlineSnapshot(`
      [
        "eth_call",
        "eth_fillTransaction",
      ]
    `)
    expect(
      fixture.request.mock.calls.filter(([request]) => request.method === 'eth_fillTransaction'),
    ).toMatchInlineSnapshot(`
      [
        [
          {
            "method": "eth_fillTransaction",
            "params": [
              {
                "calls": [
                  {
                    "data": "0x1234",
                    "to": "0x2222222222222222222222222222222222222222",
                    "value": "0x3",
                  },
                ],
                "capabilities": {
                  "balanceDiffs": false,
                },
                "chainId": "0x1079",
                "data": undefined,
                "from": "0x1111111111111111111111111111111111111111",
                "gas": "0x186a0",
                "maxFeePerGas": "0x2",
                "nonce": "0x1",
                "to": undefined,
                "type": "0x76",
                "value": undefined,
              },
            ],
          },
          undefined,
        ],
      ]
    `)
    expect(response).toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "capabilities": {
            "sponsored": false,
          },
          "tx": {
            "blockNumber": null,
            "calls": [
              {
                "data": "0x1234",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "0x3",
              },
            ],
            "chainId": "0x1079",
            "feeToken": "0x20c0000000000000000000000000000000000003",
            "from": "0x1111111111111111111111111111111111111111",
            "gas": "0x30d40",
            "maxFeePerGas": "0x3",
            "nonce": "0x2",
            "transactionIndex": null,
            "type": "0x76",
            "value": "0x0",
          },
        },
      }
    `)
  })

  test('retains the sponsor token and skips refilling an accepted prepared transaction', async () => {
    const fixture = setup()
    fixture.validate.mockReturnValue(true)
    const response = await fill(fixture.handler)

    expect(fixture.validate).toHaveBeenCalledTimes(1)
    expect(fixture.request).not.toHaveBeenCalled()
    expect(fixture.sign).toHaveBeenCalledTimes(1)
    expect(response).toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "capabilities": {
            "sponsor": {
              "address": "0x3333333333333333333333333333333333333333",
              "name": "Synthetic sponsor",
            },
            "sponsored": true,
          },
          "sponsor": {
            "address": "0x3333333333333333333333333333333333333333",
            "name": "Synthetic sponsor",
          },
          "tx": {
            "blockNumber": null,
            "calls": [
              {
                "data": "0x1234",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "0x3",
              },
            ],
            "chainId": "0x1079",
            "feePayerSignature": {
              "r": "0x0000000000000000000000000000000000000000000000000000000000000001",
              "s": "0x0000000000000000000000000000000000000000000000000000000000000002",
              "v": "0x1b",
              "yParity": "0x0",
            },
            "feeToken": "0x20c0000000000000000000000000000000000002",
            "from": "0x1111111111111111111111111111111111111111",
            "gas": "0x186a0",
            "maxFeePerGas": "0x2",
            "nonce": "0x1",
            "transactionIndex": null,
            "type": "0x76",
            "value": "0x0",
          },
        },
      }
    `)
  })

  test('propagates self-payment refill failures without signing', async () => {
    const fixture = setup()
    fixture.validate.mockImplementation(async () => false)
    fixture.request.mockRejectedValueOnce({ code: -32000, message: 'Self-payment fill failed.' })
    const response = await fill(fixture.handler)

    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(response).toMatchInlineSnapshot(`
      {
        "error": {
          "code": -32000,
          "message": "Self-payment fill failed.",
        },
        "id": 1,
        "jsonrpc": "2.0",
      }
    `)
  })

  test('propagates validation failures without refilling or signing', async () => {
    const fixture = setup()
    fixture.validate.mockRejectedValueOnce(new Error('Sponsorship validation failed.'))
    const response = await fill(fixture.handler)

    expect(fixture.request).not.toHaveBeenCalled()
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(response).toMatchInlineSnapshot(`
      {
        "error": {
          "code": -32603,
          "message": "Sponsorship validation failed.",
        },
        "id": 1,
        "jsonrpc": "2.0",
      }
    `)
  })

  test('keeps the existing unprepared rejection fallback', async () => {
    const fixture = setup()
    const response = await fill(fixture.handler, { gas: undefined })

    expect(fixture.validate).toHaveBeenCalledTimes(1)
    expect(fixture.request).toHaveBeenCalledTimes(2)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(fixture.request.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "method": "eth_fillTransaction",
            "params": [
              {
                "calls": [
                  {
                    "data": "0x1234",
                    "to": "0x2222222222222222222222222222222222222222",
                    "value": "0x3",
                  },
                ],
                "capabilities": {
                  "balanceDiffs": false,
                },
                "chainId": "0x1079",
                "data": undefined,
                "feePayer": true,
                "from": "0x1111111111111111111111111111111111111111",
                "maxFeePerGas": "0x2",
                "nonce": "0x1",
                "to": undefined,
                "type": "0x76",
                "value": undefined,
              },
            ],
          },
          undefined,
        ],
        [
          {
            "method": "eth_fillTransaction",
            "params": [
              {
                "calls": [
                  {
                    "data": "0x1234",
                    "to": "0x2222222222222222222222222222222222222222",
                    "value": "0x3",
                  },
                ],
                "capabilities": {
                  "balanceDiffs": false,
                },
                "chainId": "0x1079",
                "data": undefined,
                "feeToken": "0x20c0000000000000000000000000000000000001",
                "from": "0x1111111111111111111111111111111111111111",
                "maxFeePerGas": "0x2",
                "nonce": "0x1",
                "to": undefined,
                "type": "0x76",
                "value": undefined,
              },
            ],
          },
          undefined,
        ],
      ]
    `)
    expect(response).toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "capabilities": {
            "sponsored": false,
          },
          "tx": {
            "blockNumber": null,
            "calls": [
              {
                "data": "0x1234",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "0x3",
              },
            ],
            "chainId": "0x1079",
            "feeToken": "0x20c0000000000000000000000000000000000001",
            "from": "0x1111111111111111111111111111111111111111",
            "gas": "0x30d40",
            "maxFeePerGas": "0x3",
            "nonce": "0x2",
            "transactionIndex": null,
            "type": "0x76",
            "value": "0x0",
          },
        },
      }
    `)
  })

  test('respects an explicit sponsorship opt-out', async () => {
    const fixture = setup()
    const response = await fill(fixture.handler, { feePayer: false })

    expect(fixture.validate).not.toHaveBeenCalled()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(response).toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "capabilities": {
            "sponsored": false,
          },
          "tx": {
            "blockNumber": null,
            "calls": [
              {
                "data": "0x1234",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "0x3",
              },
            ],
            "chainId": "0x1079",
            "feeToken": "0x20c0000000000000000000000000000000000001",
            "from": "0x1111111111111111111111111111111111111111",
            "gas": "0x30d40",
            "maxFeePerGas": "0x3",
            "nonce": "0x2",
            "transactionIndex": null,
            "type": "0x76",
            "value": "0x0",
          },
        },
      }
    `)
  })
})
