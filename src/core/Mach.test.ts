import { tempo } from 'viem/tempo/chains'
import { describe, expect, test, vi } from 'vp/test'
import * as z from 'zod/mini'

import { fromRequest } from './adapters/internal/fromRequest.js'
import * as Mach from './Mach.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'
import * as Rpc from './zod/rpc.js'

const address = '0x0000000000000000000000000000000000000001'

function setup() {
  const request = vi.fn(async () => undefined)
  const provider = Provider.create({
    adapter: fromRequest({ name: 'Test', rdns: 'test.example', request }),
    chains: [tempo],
    storage: Storage.memory(),
  })
  provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
  return { provider, request }
}

describe('fund', () => {
  test('forwards the pinned token, chain, amount, and account through wallet RPC', async () => {
    const { provider, request } = setup()
    const result = await Mach.fund(provider, { address, amount: '5.25', displayName: 'Example' })
    expect({ result, requests: request.mock.calls }).toMatchInlineSnapshot(`
      {
        "requests": [
          [
            {
              "context": {
                "account": "0x0000000000000000000000000000000000000001",
                "chainId": 4217,
              },
              "method": "wallet_deposit",
              "params": [
                {
                  "address": "0x0000000000000000000000000000000000000001",
                  "amount": "5.25",
                  "chainId": "0x1079",
                  "displayName": "Example",
                  "intent": "mach",
                  "token": "0x20c000000000000000000000f37de3740adec032",
                },
              ],
            },
          ],
        ],
        "result": undefined,
      }
    `)
  })

  test('without hints uses the connected account and still selects MACH', async () => {
    const { provider, request } = setup()
    await Mach.fund(provider)
    expect(request.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "context": {
              "account": "0x0000000000000000000000000000000000000001",
              "chainId": 4217,
            },
            "method": "wallet_deposit",
            "params": [
              {
                "chainId": "0x1079",
                "intent": "mach",
                "token": "0x20c000000000000000000000f37de3740adec032",
              },
            ],
          },
        ],
      ]
    `)
  })

  test('propagates cancellation without retrying or reporting payment success', async () => {
    const { provider, request } = setup()
    request.mockRejectedValueOnce(new Error('Checkout cancelled'))
    await expect(Mach.fund(provider)).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InternalError: Checkout cancelled]`,
    )
    expect(request.mock.calls.length).toMatchInlineSnapshot(`1`)
  })

  test.each([
    '0',
    '0.00',
    '-5',
    '1e2',
    '5.001',
    '01',
    '5&address=other',
    '',
    ' 5',
    'NaN',
    '99999999999999.99',
  ])('rejects invalid amount %s before opening checkout', async (amount) => {
    const { provider, request } = setup()
    await expect(Mach.fund(provider, { amount })).rejects.toThrow()
    expect(request.mock.calls).toMatchInlineSnapshot(`[]`)
  })

  test('rejects testnet before opening checkout', async () => {
    const { provider, request } = setup()
    await expect(
      Mach.fund(provider, { chainId: 42431 }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: MACH funding is only available on Tempo mainnet (4217).]`,
    )
    expect(request.mock.calls).toMatchInlineSnapshot(`[]`)
  })
})

describe('getFundingUrl', () => {
  test('binds a remote-device handoff to the requested account and amount', () => {
    expect(Mach.getFundingUrl({ address, amount: '5.25' })).toMatchInlineSnapshot(
      `"https://wallet.tempo.xyz/agent?action=fund&intent=mach&address=0x0000000000000000000000000000000000000001&chainId=4217&amount=5.25"`,
    )
  })

  test('omits an unspecified amount', () => {
    expect(Mach.getFundingUrl({ address })).toMatchInlineSnapshot(
      `"https://wallet.tempo.xyz/agent?action=fund&intent=mach&address=0x0000000000000000000000000000000000000001&chainId=4217"`,
    )
  })

  test.each(['0x0', '0x0000000000000000000000000000000000000000', `${address}&intent=crypto`])(
    'rejects invalid recipient %s',
    (address) => {
      expect(() =>
        Mach.getFundingUrl({ address: address as `0x${string}` }),
      ).toThrowErrorMatchingInlineSnapshot(
        `[Error: MACH funding requires a nonzero recipient address.]`,
      )
    },
  )

  test('fails closed on an unsupported chain', () => {
    expect(() =>
      Mach.getFundingUrl({ address, chainId: 42431 }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: MACH funding is only available on Tempo mainnet (4217).]`,
    )
  })
})

describe('post-authorization funding', () => {
  test('preserves MACH hints on connect and access-key approval', () => {
    const hints = { amount: '5', intent: 'mach', token: 'MACH' }
    expect({
      connect: z.parse(Rpc.wallet_connect.showDeposit, { ...hints, on: 'login' }),
      authorize: z.parse(Rpc.wallet_authorizeAccessKey.showDeposit, hints),
    }).toMatchInlineSnapshot(`
      {
        "authorize": {
          "amount": "5",
          "intent": "mach",
          "token": "MACH",
        },
        "connect": {
          "amount": "5",
          "intent": "mach",
          "on": "login",
          "token": "MACH",
        },
      }
    `)
  })

  test('rejects unrecognized funding intents', () => {
    expect({
      connect: z.safeParse(Rpc.wallet_connect.showDeposit, { intent: 'unknown' }).success,
      authorize: z.safeParse(Rpc.wallet_authorizeAccessKey.showDeposit, { intent: 'unknown' })
        .success,
    }).toMatchInlineSnapshot(`
      {
        "authorize": false,
        "connect": false,
      }
    `)
  })
})
