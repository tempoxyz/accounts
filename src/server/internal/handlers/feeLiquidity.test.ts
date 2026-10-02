import { type Address, createClient, custom } from 'viem'
import * as core_Actions from 'viem/actions'
import { Actions, Addresses } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, expect, test } from 'vp/test'

import * as Kv from '../../Kv.js'
import * as FeeLiquidity from './feeLiquidity.js'

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
const other = '0x20c0000000000000000000000000000000000001'
const client = createClient({ chain: tempo, transport: custom({ request: vi.fn() }) })

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function setup(reserve: bigint) {
  vi.spyOn(core_Actions, 'getBlock').mockResolvedValue({
    miner: Addresses.pathUsd,
    number: 0n,
  } as never)
  vi.spyOn(Actions.fee, 'getValidatorToken').mockResolvedValue(null)
  vi.spyOn(core_Actions, 'readContract').mockResolvedValue(quote)
  return vi.spyOn(Actions.amm, 'getPool').mockResolvedValue({
    reserveUserToken: 0n,
    reserveValidatorToken: reserve,
    totalSupply: 1000n,
  })
}

/** The latest producer prefers `other`; an earlier one in the window uses pathUSD. */
function setupMixedProducers() {
  const pool = setup(0n)
  const latest = '0x0000000000000000000000000000000000000a01'
  vi.spyOn(core_Actions, 'getBlock').mockImplementation(
    async (_, parameters) =>
      ({
        miner: parameters?.blockNumber === undefined ? latest : Addresses.pathUsd,
        number: 20n,
      }) as never,
  )
  vi.spyOn(Actions.fee, 'getValidatorToken').mockImplementation(async (_, { validator }) =>
    validator === latest ? { address: other as Address, id: 1n } : null,
  )
  return pool
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

test('accepts a token any recent producer can settle, not only the latest', async () => {
  const pool = setupMixedProducers()
  // pathUSD is an earlier producer's own token, so it needs no pool.
  expect(
    await FeeLiquidity.has(client, { token: Addresses.pathUsd, amount: 206n }),
  ).toMatchInlineSnapshot(`true`)
  // Only the earlier producer's pool is funded.
  pool.mockImplementation(async (_, { validatorToken }) => ({
    reserveUserToken: 0n,
    reserveValidatorToken: validatorToken === Addresses.pathUsd ? 205n : 0n,
    totalSupply: 1000n,
  }))
  expect(await FeeLiquidity.has(client, { token, amount: 206n })).toMatchInlineSnapshot(`true`)
})

test('reuses cached producer tokens across checks', async () => {
  setup(205n)
  const kv = Kv.memory()
  await FeeLiquidity.has(client, { token, amount: 206n, kv })
  await FeeLiquidity.has(client, { token, amount: 206n, kv })
  expect(core_Actions.getBlock).toHaveBeenCalledTimes(1)
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

test('checks multiple maximum fees against prefetched reserves without more RPCs', async () => {
  const pool = setup(205n)
  vi.spyOn(core_Actions, 'readContract').mockResolvedValue(Addresses.pathUsd)
  const check = await FeeLiquidity.prepare(client, { token })
  expect({ covered: await check(206n), insufficient: await check(207n) }).toMatchInlineSnapshot(`
    {
      "covered": true,
      "insufficient": false,
    }
  `)
  expect({
    blocks: vi.mocked(core_Actions.getBlock).mock.calls.length,
    pools: pool.mock.calls.length,
  }).toMatchInlineSnapshot(`
    {
      "blocks": 1,
      "pools": 1,
    }
  `)
})

test('prefetches both route legs before the maximum fee is known', async () => {
  const pool = setup(0n)
  pool.mockImplementation(async (_, { userToken, validatorToken }) => ({
    reserveUserToken: 0n,
    reserveValidatorToken: validatorToken === quote ? 205n : userToken === quote ? 204n : 0n,
    totalSupply: 1000n,
  }))
  const check = await FeeLiquidity.prepare(client, { token })
  expect(pool).toHaveBeenCalledTimes(3)
  expect(await check(206n)).toMatchInlineSnapshot(`true`)
  expect(pool).toHaveBeenCalledTimes(3)
})

test('a failed speculative two-hop read does not reject a sufficient direct route', async () => {
  const pool = setup(205n)
  pool.mockImplementation(async (_, { userToken, validatorToken }) => {
    if (userToken === quote || validatorToken === quote) throw new Error('Two-hop RPC unavailable')
    return { reserveUserToken: 0n, reserveValidatorToken: 205n, totalSupply: 1000n }
  })
  const check = await FeeLiquidity.prepare(client, { token })
  expect(await check(206n)).toMatchInlineSnapshot(`true`)
  await expect(check(207n)).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: Two-hop RPC unavailable]`,
  )
})

test('concurrent candidate prefetches share recent-producer discovery', async () => {
  setup(205n)
  const kv = Kv.memory()
  const checks = await Promise.all([
    FeeLiquidity.prepare(client, { token, kv }),
    FeeLiquidity.prepare(client, { token: quote, kv }),
  ])
  expect(await Promise.all(checks.map((check) => check(206n)))).toMatchInlineSnapshot(`
    [
      true,
      true,
    ]
  `)
  expect(core_Actions.getBlock).toHaveBeenCalledTimes(1)
  expect(Actions.fee.getValidatorToken).toHaveBeenCalledTimes(1)
})
