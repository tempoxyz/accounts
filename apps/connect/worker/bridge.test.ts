import { beforeAll, describe, expect, test } from 'vp/test'

import * as TestSession from '../test/session.js'
import app from './index.js'

beforeAll(() => TestSession.install())

describe('POST /api/bridge/deposit', () => {
  test('returns deposit address for USDC on Base', async () => {
    const cookie = await TestSession.cookie()

    const res = await post(
      {
        origin: { chainId: 8453, token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
      },
      cookie,
    )

    expect(res.status).toMatchInlineSnapshot(`200`)
    const data = (await res.json()) as { address: string; id: string }
    expect(data.address).toBeDefined()
    expect(data.id).toBeDefined()
    // EVM deposit addresses are 0x-prefixed.
    expect(data.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('returns deposit address for ETH on Ethereum', async () => {
    const cookie = await TestSession.cookie()

    const res = await post(
      { origin: { chainId: 1, token: '0x0000000000000000000000000000000000000000', decimals: 18 } },
      cookie,
    )

    expect(res.status).toMatchInlineSnapshot(`200`)
    const data = (await res.json()) as { address: string; id: string }
    expect(data.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('returns deposit address for USDC on Solana', async () => {
    const cookie = await TestSession.cookie()

    const res = await post(
      {
        origin: {
          chainId: 792703809,
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          decimals: 6,
        },
      },
      cookie,
    )

    expect(res.status).toMatchInlineSnapshot(`200`)
    const data = (await res.json()) as { address: string; id: string }
    expect(data.address).toBeDefined()
    expect(data.id).toBeDefined()
  })

  test('returns UNSUPPORTED_ROUTE for invalid token', async () => {
    const cookie = await TestSession.cookie()

    const res = await post(
      {
        origin: { chainId: 8453, token: '0x0000000000000000000000000000000000000001', decimals: 6 },
      },
      cookie,
    )

    const data = (await res.json()) as { code?: string }
    expect(data.code).toMatchInlineSnapshot(`"UNSUPPORTED_ROUTE"`)
  })

  test('returns 401 without session', async () => {
    const res = await post({
      origin: { chainId: 8453, token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 },
    })
    expect(res.status).toMatchInlineSnapshot(`401`)
  })

  test('returns 400 with invalid body', async () => {
    const cookie = await TestSession.cookie()
    const res = await post({ origin: { chainId: 'not-a-number' } }, cookie)
    expect(res.status).toMatchInlineSnapshot(`400`)
  })
})

/** POST to /api/bridge/deposit with optional session cookie. */
async function post(body: unknown, cookie?: string) {
  return app.request('/api/bridge/deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}
