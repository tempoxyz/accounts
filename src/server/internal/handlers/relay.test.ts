import { type Address, custom } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Actions, Addresses } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, expect, test } from 'vp/test'

import * as FeeLiquidity from './feeLiquidity.js'
import { relay } from './relay.js'

vi.mock('viem/tempo', async (original) => {
  const module = await original<typeof import('viem/tempo')>()
  return {
    ...module,
    Actions: {
      ...module.Actions,
      fee: { ...module.Actions.fee, getUserToken: vi.fn() },
      token: { ...module.Actions.token, getBalance: vi.fn() },
    },
  }
})

const mach = '0x20c000000000000000000000f37de3740ADec032'
const usdc = '0x20c000000000000000000000b9537d11c60e8b50'
const account = '0x0000000000000000000000000000000000000001'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function setup(options: { preferred?: Address; liquid?: boolean; sponsor?: boolean } = {}) {
  vi.spyOn(Actions.fee, 'getUserToken').mockResolvedValue(
    options.preferred ? { address: options.preferred, id: 1n } : null,
  )
  vi.spyOn(Actions.token, 'getBalance').mockImplementation(
    async (_, { token }) =>
      ({
        amount: token === mach ? 4440000n : 999445n,
        decimals: 6,
        formatted: '',
        symbol: '',
        value: '',
      }) as never,
  )
  const liquidity = vi.fn(
    async (_: unknown, { token }: FeeLiquidity.has.Options) =>
      options.liquid !== false && token.toLowerCase() === usdc.toLowerCase(),
  )
  const prepare = vi.spyOn(FeeLiquidity, 'prepare').mockImplementation(
    async (client, { token }) =>
      (amount) =>
        liquidity(client, { token, amount }),
  )
  const fills: string[] = []
  const request = vi.fn(async ({ method, params }) => {
    if (method !== 'eth_fillTransaction') throw new Error(`Unexpected RPC: ${method}`)
    fills.push(params[0].feeToken)
    return {
      tx: {
        ...params[0],
        type: '0x76',
        gas: '0x22da4',
        maxFeePerGas: '0x55d4a800',
        maxPriorityFeePerGas: '0x0',
        nonce: '0x19',
      },
    }
  })
  const handler = relay({
    chains: [tempo],
    ...(options.sponsor !== undefined
      ? {
          feePayer: {
            account: privateKeyToAccount(`0x${'11'.repeat(32)}`),
            feeToken: usdc,
            validate: () => options.sponsor!,
          },
        }
      : {}),
    resolveTokens: () =>
      ([mach, usdc] as const).map((address) => ({
        address,
        decimals: 6,
        symbol: '',
        name: '',
      })),
    transports: { [tempo.id]: custom({ request }, { retryCount: 0 }) },
  })
  async function fill(feeToken?: Address) {
    const response = await handler.fetch(
      new Request('https://wallet.example.com/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_fillTransaction',
          params: [
            {
              from: account,
              calls: [{ to: Addresses.stablecoinDex, data: '0x' }],
              feeToken,
            },
          ],
        }),
      }),
    )
    return response.json() as Promise<{
      result?: { tx: { feeToken: string } }
      error?: { message: string }
    }>
  }
  return { fill, fills, liquidity, prepare, request }
}

test.each([undefined, mach] as const)(
  'skips illiquid MACH with preference %s',
  async (preferred) => {
    const { fill, fills, liquidity } = setup(preferred ? { preferred } : {})
    const result = await fill()
    expect({ feeToken: result.result?.tx.feeToken.toLowerCase(), fills }).toMatchInlineSnapshot(`
    {
      "feeToken": "0x20c000000000000000000000b9537d11c60e8b50",
      "fills": [
        "0x20c000000000000000000000f37de3740ADec032",
        "0x20c000000000000000000000b9537d11c60e8b50",
      ],
    }
  `)
    expect(liquidity.mock.calls.map(([, options]) => options.amount)).toMatchInlineSnapshot(`
    [
      206n,
      206n,
    ]
  `)
  },
)

test('does not override an explicitly selected fee token', async () => {
  const { fill, fills, liquidity, prepare } = setup()
  const result = await fill(mach)
  expect(result.result?.tx.feeToken.toLowerCase()).toMatchInlineSnapshot(
    `"0x20c000000000000000000000f37de3740adec032"`,
  )
  expect(fills).toHaveLength(1)
  expect(liquidity).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
})

test('stops after exhausting candidates, including a funded on-chain preference', async () => {
  const { fill, fills } = setup({ preferred: mach, liquid: false })
  const result = await fill()
  expect({ error: result.error?.message, attempts: fills.length }).toMatchInlineSnapshot(`
    {
      "attempts": 2,
      "error": "Insufficient liquidity in FeeAMM pool for transaction fee.",
    }
  `)
})

test('does not retry unrelated fill failures', async () => {
  const { fill, request, liquidity } = setup()
  request.mockRejectedValue(new Error('Swap reverted'))
  const result = await fill()
  expect(result.error?.message).toContain('Swap reverted')
  expect(request).toHaveBeenCalledTimes(1)
  expect(liquidity).not.toHaveBeenCalled()
})

test('reselects after sponsorship is declined', async () => {
  const { fill, fills } = setup({ sponsor: false })
  const result = await fill()
  expect({ feeToken: result.result?.tx.feeToken.toLowerCase(), fills }).toMatchInlineSnapshot(`
    {
      "feeToken": "0x20c000000000000000000000b9537d11c60e8b50",
      "fills": [
        undefined,
        "0x20c000000000000000000000f37de3740ADec032",
        "0x20c000000000000000000000b9537d11c60e8b50",
      ],
    }
  `)
})

test('does not apply user fee-token selection to sponsored fills', async () => {
  const { fill, fills, liquidity, prepare } = setup({ sponsor: true })
  const result = await fill()
  expect(result.result?.tx.feeToken.toLowerCase()).toMatchInlineSnapshot(
    `"0x20c000000000000000000000b9537d11c60e8b50"`,
  )
  expect(fills).toHaveLength(1)
  expect(liquidity).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
})

test('tries the next candidate when filling itself reports a fee-liquidity error', async () => {
  const { fill, request } = setup()
  request.mockRejectedValueOnce(
    new Error('insufficient liquidity in FeeAMM pool to swap fee tokens'),
  )
  const result = await fill()
  expect(result.result?.tx.feeToken.toLowerCase()).toMatchInlineSnapshot(
    `"0x20c000000000000000000000b9537d11c60e8b50"`,
  )
  expect(request).toHaveBeenCalledTimes(2)
})

test('starts fee liquidity discovery while user balances are pending', async () => {
  const { fill, prepare, fills } = setup()
  const balances = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const getBalance = vi.mocked(Actions.token.getBalance).getMockImplementation()!
  vi.mocked(Actions.token.getBalance).mockImplementation(async (client, parameters) => {
    await balances.promise
    return getBalance(client, parameters)
  })
  const prefetch = prepare.getMockImplementation()!
  prepare.mockImplementation((client, parameters) => {
    started.resolve()
    return prefetch(client, parameters)
  })
  const pending = fill()
  await started.promise
  expect({ balances: vi.mocked(Actions.token.getBalance).mock.calls.length, fills })
    .toMatchInlineSnapshot(`
    {
      "balances": 2,
      "fills": [],
    }
  `)
  balances.resolve()
  expect((await pending).result?.tx.feeToken.toLowerCase()).toMatchInlineSnapshot(
    `"0x20c000000000000000000000b9537d11c60e8b50"`,
  )
  expect({
    balances: vi.mocked(Actions.token.getBalance).mock.calls.length,
    prepares: prepare.mock.calls.length,
  }).toMatchInlineSnapshot(`
    {
      "balances": 2,
      "prepares": 2,
    }
  `)
})

test('fills concurrently with reserve discovery and validates the filled maximum fee', async () => {
  const { fill, prepare, request, liquidity } = setup()
  const reserves = Promise.withResolvers<void>()
  const filled = Promise.withResolvers<void>()
  const prefetch = prepare.getMockImplementation()!
  prepare.mockImplementation(async (client, parameters) => {
    await reserves.promise
    return prefetch(client, parameters)
  })
  const send = request.getMockImplementation()!
  request.mockImplementation(async (parameters) => {
    const result = await send(parameters)
    filled.resolve()
    return result
  })
  const pending = fill()
  await filled.promise
  expect(liquidity).not.toHaveBeenCalled()
  reserves.resolve()
  await pending
  expect(liquidity.mock.calls.map(([, options]) => options.amount)).toMatchInlineSnapshot(`
    [
      206n,
      206n,
    ]
  `)
})

test('propagates a selected candidate prefetch failure without trying another token', async () => {
  const { fill, prepare, request } = setup()
  prepare.mockRejectedValue(new Error('Reserve RPC unavailable'))
  expect((await fill()).error?.message).toMatchInlineSnapshot(`"Reserve RPC unavailable"`)
  expect(request).toHaveBeenCalledTimes(1)
})

test('does not fail because an unused candidate prefetch rejects', async () => {
  const { fill, prepare } = setup({ preferred: usdc })
  const prefetch = prepare.getMockImplementation()!
  prepare.mockImplementation((client, parameters) =>
    parameters.token === mach
      ? Promise.reject(new Error('Unused reserve RPC unavailable'))
      : prefetch(client, parameters),
  )
  expect((await fill()).result?.tx.feeToken.toLowerCase()).toMatchInlineSnapshot(
    `"0x20c000000000000000000000b9537d11c60e8b50"`,
  )
})

test('prefetches an on-chain preference outside the configured list and reuses its balance', async () => {
  const preferred = '0x20c0000000000000000000000000000000000001'
  const { fill, prepare, fills } = setup({ preferred })
  await fill()
  expect({
    balances: vi.mocked(Actions.token.getBalance).mock.calls.length,
    tokens: prepare.mock.calls.map(([, options]) => options.token),
    fills,
  }).toMatchInlineSnapshot(`
    {
      "balances": 3,
      "fills": [
        "0x20c0000000000000000000000000000000000001",
        "0x20c000000000000000000000f37de3740ADec032",
        "0x20c000000000000000000000b9537d11c60e8b50",
      ],
      "tokens": [
        "0x20c000000000000000000000f37de3740ADec032",
        "0x20c000000000000000000000b9537d11c60e8b50",
        "0x20c0000000000000000000000000000000000001",
      ],
    }
  `)
})
