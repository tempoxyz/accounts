import { describe, expect, test, vi } from 'vp/test'

import * as RateLimit from './rate-limit.js'

function createLimiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) } as unknown as RateLimit
}

function createKv() {
  const store = new Map<string, { value: string; expiration?: number | undefined }>()
  return {
    store,
    kv: {
      get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
      put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, { value, expiration: opts?.expirationTtl })
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key)
      }),
    } as unknown as KVNamespace,
  }
}

describe('check', () => {
  test('returns true when limiter allows', async () => {
    expect(await RateLimit.check(createLimiter(true), 'key')).toMatchInlineSnapshot(`true`)
  })

  test('returns false when limiter blocks', async () => {
    expect(await RateLimit.check(createLimiter(false), 'key')).toMatchInlineSnapshot(`false`)
  })
})

describe('checkDailyEmail', () => {
  test('allows up to 20 per email per day', async () => {
    const { kv } = createKv()
    for (let i = 0; i < 20; i++)
      expect(await RateLimit.checkDailyEmail(kv, 'alice@example.com')).toMatchInlineSnapshot(`true`)
    expect(await RateLimit.checkDailyEmail(kv, 'alice@example.com')).toMatchInlineSnapshot(`false`)
  })

  test('separate emails have independent counters', async () => {
    const { kv } = createKv()
    for (let i = 0; i < 20; i++) await RateLimit.checkDailyEmail(kv, 'alice@example.com')
    expect(await RateLimit.checkDailyEmail(kv, 'bob@example.com')).toMatchInlineSnapshot(`true`)
  })
})

describe('checkDailyGlobal', () => {
  test('increments global counter', async () => {
    const { kv } = createKv()
    expect(await RateLimit.checkDailyGlobal(kv)).toMatchInlineSnapshot(`true`)
    expect(await RateLimit.checkDailyGlobal(kv)).toMatchInlineSnapshot(`true`)
  })
})
