import { createClient, custom } from 'viem'
import * as core_Actions from 'viem/actions'
import { Actions, Addresses } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { afterEach, expect, test } from 'vp/test'

import * as FeeLiquidity from './feeLiquidity.js'

declare const vi: typeof import('vp/test').vi

vi.mock('viem/actions', async (original) => ({
  ...(await original<typeof core_Actions>()),
  getBlock: vi.fn(),
  readContract: vi.fn(),
}))
vi.mock('viem/tempo', async (original) => {
  const module = await original<typeof import('viem/tempo')>()
  return {
    ...module,
    Actions: {
      ...module.Actions,
      fee: { ...module.Actions.fee, getValidatorToken: vi.fn() },
      amm: { ...module.Actions.amm, getPool: vi.fn() },
    },
  }
})

const token = '0x20c000000000000000000000f37de3740ADec032'
const quote = '0x20c000000000000000000000b9537d11c60e8b50'
const client = createClient({ chain: tempo, transport: custom({ request: vi.fn() }) })

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function setup(reserve: bigint) {
  vi.spyOn(core_Actions, 'getBlock').mockResolvedValue({ miner: Addresses.pathUsd } as never)
  vi.spyOn(Actions.fee, 'getValidatorToken').mockResolvedValue(null)
  vi.spyOn(core_Actions, 'readContract').mockResolvedValue(quote)
  return vi.spyOn(Actions.amm, 'getPool').mockResolvedValue({
    reserveUserToken: 0n,
    reserveValidatorToken: reserve,
    totalSupply: 1000n,
  })
}

test('validator token needs no fee pool', async () => {
  const pool = setup(0n)
  expect(
    await FeeLiquidity.has(client, { token: Addresses.pathUsd, amount: 206n }),
  ).toMatchInlineSnapshot(`true`)
  expect(pool).not.toHaveBeenCalled()
})

test('empty pools reject a funded MACH candidate', async () => {
  setup(0n)
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`false`)
})

test('direct pool must cover the maximum fee after the 30 bps deduction', async () => {
  const pool = setup(204n)
  vi.spyOn(core_Actions, 'readContract').mockResolvedValue(Addresses.pathUsd)
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`false`)
  pool.mockResolvedValue({ reserveUserToken: 0n, reserveValidatorToken: 205n, totalSupply: 1000n })
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`true`)
})

test('two-hop route needs sufficient output reserves on both legs', async () => {
  const pool = setup(0n)
  pool.mockImplementation(async (_, { userToken, validatorToken }) => ({
    reserveUserToken: 0n,
    reserveValidatorToken: validatorToken === quote ? 205n : userToken === quote ? 204n : 0n,
    totalSupply: 1000n,
  }))
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`true`)
  pool.mockImplementation(async (_, { userToken, validatorToken }) => ({
    reserveUserToken: 0n,
    reserveValidatorToken: validatorToken === quote ? 205n : userToken === quote ? 203n : 0n,
    totalSupply: 1000n,
  }))
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`false`)
})

test('pool read failures propagate instead of being treated as missing liquidity', async () => {
  setup(0n).mockRejectedValue(new Error('RPC unavailable'))
  await expect(
    FeeLiquidity.has(client, { token, amount: 206n }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: RPC unavailable]`)
})

test('respects a configured pre-T5 hardfork', async () => {
  const pool = setup(0n)
  const older = createClient({
    chain: { ...tempo, hardfork: 't4' },
    transport: custom({ request: vi.fn() }),
  })
  expect(await FeeLiquidity.has(older, { token, amount: 206n })).toMatchInlineSnapshot(`false`)
  expect(pool).toHaveBeenCalledTimes(1)
  expect(core_Actions.readContract).not.toHaveBeenCalled()
})
