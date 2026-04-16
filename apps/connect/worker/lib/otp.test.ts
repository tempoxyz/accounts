import { describe, expect, test, vi } from 'vp/test'

import * as Otp from './otp.js'

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

describe('generate', () => {
  test('returns 6-digit string', () => {
    const code = Otp.generate()
    expect(code).toMatch(/^\d{6}$/)
    expect(Number(code)).toBeGreaterThanOrEqual(100000)
    expect(Number(code)).toBeLessThanOrEqual(999999)
  })

  test('returns 000000 when bypass is true', () => {
    expect(Otp.generate(true)).toMatchInlineSnapshot(`"000000"`)
  })
})

describe('set + verify', () => {
  test('verifies a valid code', async () => {
    const { kv } = createKv()
    const code = Otp.generate()
    await Otp.set(kv, 'alice@example.com', code)
    expect(await Otp.verify(kv, 'alice@example.com', code)).toMatchInlineSnapshot(`true`)
  })

  test('rejects wrong code', async () => {
    const { kv } = createKv()
    await Otp.set(kv, 'alice@example.com', '123456')
    expect(await Otp.verify(kv, 'alice@example.com', '654321')).toMatchInlineSnapshot(`false`)
  })

  test('rejects after code is consumed', async () => {
    const { kv } = createKv()
    const code = '123456'
    await Otp.set(kv, 'alice@example.com', code)
    await Otp.verify(kv, 'alice@example.com', code)
    expect(await Otp.verify(kv, 'alice@example.com', code)).toMatchInlineSnapshot(`false`)
  })

  test('returns false when no code stored', async () => {
    const { kv } = createKv()
    expect(await Otp.verify(kv, 'nobody@example.com', '000000')).toMatchInlineSnapshot(`false`)
  })

  test('locks out after 5 failed attempts', async () => {
    const { kv } = createKv()
    await Otp.set(kv, 'alice@example.com', '123456')

    for (let i = 0; i < 5; i++) await Otp.verify(kv, 'alice@example.com', 'wrong!')

    expect(await Otp.verify(kv, 'alice@example.com', '123456')).toMatchInlineSnapshot(`false`)
  })

  test('allows multiple codes (latest wins)', async () => {
    const { kv } = createKv()
    await Otp.set(kv, 'alice@example.com', '111111')
    await Otp.set(kv, 'alice@example.com', '222222')

    expect(await Otp.verify(kv, 'alice@example.com', '111111')).toMatchInlineSnapshot(`true`)
  })

  test('caps stored codes at 5', async () => {
    const { kv, store } = createKv()
    for (let i = 0; i < 7; i++) await Otp.set(kv, 'alice@example.com', `${100000 + i}`)

    const raw = JSON.parse(store.get('otp:alice@example.com')!.value) as { codes: unknown[] }
    expect(raw.codes).toHaveLength(5)
  })
})
