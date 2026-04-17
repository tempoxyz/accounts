import { encodeAbiParameters, parseUnits } from 'viem'
import type { Transaction } from 'viem/tempo'
import { describe, expect, test, vi } from 'vp/test'

import * as FeePayer from './fee-payer.js'

function parseAttodollar(value: string) {
  return parseUnits(value, 18)
}

function encodeBalance(value: bigint) {
  return encodeAbiParameters([{ type: 'uint256' }], [value])
}

const FEE_PAYER = '0x1111111111111111111111111111111111111111' as const
const REQUESTER = '0x2222222222222222222222222222222222222222' as const

function createKv() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  } as unknown as KVNamespace
}

function createMocks(
  state: {
    requesterRows?: { gas_used: string; effective_gas_price: string }[]
    globalRows?: { gas_used: string; effective_gas_price: string }[]
    balance?: bigint
  } = {},
) {
  const { requesterRows = [], globalRows = [], balance = 2_000_000n } = state
  return {
    client: {
      chain: { id: 4217 },
      request: vi.fn(async () => encodeBalance(balance)),
    } as never,
    queryBuilder: {
      selectFrom: () => {
        let requesterFilter: string | undefined
        return {
          select() {
            return this
          },
          where(column: string, _op: string, value: unknown) {
            if (column === 'from') requesterFilter = value as string
            return this
          },
          execute: vi.fn(async () => (requesterFilter ? requesterRows : globalRows)),
        }
      },
    } as never,
  }
}

function request(from?: string) {
  return {
    from: from ?? REQUESTER,
    gas: 1n,
    maxFeePerGas: parseAttodollar('0.02'),
    chainId: 4217,
  } as Transaction.TransactionRequest
}

/** Call once to populate KV via background refresh, then validate again. */
async function warmAndValidate(
  validate: FeePayer.create.ReturnType,
  req: Transaction.TransactionRequest,
) {
  await validate(req)
  await new Promise((r) => setTimeout(r, 10))
  return validate(req)
}

describe('create', () => {
  test('approves on cold KV (first call)', async () => {
    const kv = createKv()
    const validate = FeePayer.create(FEE_PAYER, kv, createMocks())
    expect(await validate(request())).toMatchInlineSnapshot(`true`)
  })

  test('approves when under budget (warm KV)', async () => {
    const kv = createKv()
    const validate = FeePayer.create(FEE_PAYER, kv, createMocks())
    expect(await warmAndValidate(validate, request())).toMatchInlineSnapshot(`true`)
  })

  test('blocks when requester daily budget is exceeded', async () => {
    const kv = createKv()
    const validate = FeePayer.create(
      FEE_PAYER,
      kv,
      createMocks({
        requesterRows: [{ gas_used: '1', effective_gas_price: parseAttodollar('0.19').toString() }],
        globalRows: [{ gas_used: '1', effective_gas_price: parseAttodollar('0.19').toString() }],
      }),
    )
    expect(await warmAndValidate(validate, request())).toMatchInlineSnapshot(`false`)
  })

  test('blocks when global daily budget is exceeded', async () => {
    const kv = createKv()
    const validate = FeePayer.create(
      FEE_PAYER,
      kv,
      createMocks({
        requesterRows: [{ gas_used: '1', effective_gas_price: parseAttodollar('0.01').toString() }],
        globalRows: [{ gas_used: '1', effective_gas_price: parseAttodollar('49.99').toString() }],
      }),
    )
    expect(await warmAndValidate(validate, request())).toMatchInlineSnapshot(`false`)
  })

  test('blocks when fee payer has insufficient balance', async () => {
    const kv = createKv()
    const validate = FeePayer.create(FEE_PAYER, kv, createMocks({ balance: 0n }))
    expect(await validate(request())).toMatchInlineSnapshot(`false`)
  })

  test('approves when both limits are disabled', async () => {
    process.env.FEE_PAYER_DAILY_LIMIT_USD = '0'
    process.env.FEE_PAYER_GLOBAL_DAILY_LIMIT_USD = '0'
    try {
      const kv = createKv()
      const validate = FeePayer.create(FEE_PAYER, kv, createMocks())
      expect(await validate(request())).toMatchInlineSnapshot(`true`)
    } finally {
      delete process.env.FEE_PAYER_DAILY_LIMIT_USD
      delete process.env.FEE_PAYER_GLOBAL_DAILY_LIMIT_USD
    }
  })

  test('approves when gas/maxFeePerGas missing', async () => {
    const kv = createKv()
    const validate = FeePayer.create(FEE_PAYER, kv, createMocks())
    expect(
      await validate({ from: REQUESTER } as Transaction.TransactionRequest),
    ).toMatchInlineSnapshot(`true`)
  })
})
