import { describe, expect, test } from 'vp/test'

import * as Kv from '../Kv.js'
import { cached } from './kv.js'

/**
 * Wraps a memory Kv and records the number of `get`/`set` calls per key —
 * lets the tests below assert that L1 cache hits short-circuit L2 reads.
 */
function counting() {
  const inner = Kv.memory()
  const calls = { get: 0, set: 0 }
  const kv: Kv.Kv = {
    async get(key) {
      calls.get++
      return inner.get(key)
    },
    async set(key, value) {
      calls.set++
      return inner.set(key, value)
    },
    async delete(key) {
      return inner.delete(key)
    },
  }
  return { calls, kv }
}

describe('cached', () => {
  test('behavior: caches the result of fn for the configured ttl', async () => {
    const { calls, kv } = counting()
    let invocations = 0
    const fn = async () => ++invocations

    expect(await cached(kv, 'k', fn, { ttl: 60 })).toBe(1)
    expect(await cached(kv, 'k', fn, { ttl: 60 })).toBe(1)
    expect(invocations).toBe(1)
    // First call writes through to L2; subsequent reads stay in L1.
    expect(calls.set).toBe(1)
  })

  test('behavior: re-fetches after the entry expires', async () => {
    const { kv } = counting()
    let invocations = 0
    const fn = async () => ++invocations

    // ttl: 0 expires immediately (Date.now() + 0 is not strictly >).
    expect(await cached(kv, 'k', fn, { ttl: 0 })).toBe(1)
    expect(await cached(kv, 'k', fn, { ttl: 0 })).toBe(2)
    expect(invocations).toBe(2)
  })

  test('behavior: L1 cache short-circuits L2 reads', async () => {
    const { calls, kv } = counting()
    await cached(kv, 'k', async () => 1, { ttl: 60 })
    expect(calls.get).toBe(1) // miss → reads L2 once
    await cached(kv, 'k', async () => 2, { ttl: 60 })
    await cached(kv, 'k', async () => 3, { ttl: 60 })
    // Subsequent calls hit L1 — no extra L2 reads.
    expect(calls.get).toBe(1)
  })

  test('behavior: coalesces concurrent calls for the same key', async () => {
    const { kv } = counting()
    let invocations = 0
    const fn = async () => {
      invocations++
      // Force the second call to start before fn() resolves.
      await new Promise((r) => setTimeout(r, 10))
      return invocations
    }

    const [a, b, c] = await Promise.all([
      cached(kv, 'k', fn, { ttl: 60 }),
      cached(kv, 'k', fn, { ttl: 60 }),
      cached(kv, 'k', fn, { ttl: 60 }),
    ])

    expect(invocations).toBe(1)
    expect([a, b, c]).toEqual([1, 1, 1])
  })

  test('behavior: isolates L1 cache per kv instance', async () => {
    const a = counting()
    const b = counting()
    let invocations = 0
    const fn = async () => ++invocations

    await cached(a.kv, 'k', fn, { ttl: 60 })
    await cached(b.kv, 'k', fn, { ttl: 60 })
    expect(invocations).toBe(2)
  })

  test('behavior: falls back to fn when L2 read throws', async () => {
    const failing: Kv.Kv = {
      async get() {
        throw new Error('boom')
      },
      async set() {},
      async delete() {},
    }

    expect(await cached(failing, 'k', async () => 'value', { ttl: 60 })).toBe('value')
  })

  test('behavior: does not throw when L2 write fails', async () => {
    const failing: Kv.Kv = {
      async get() {
        return null as never
      },
      async set() {
        throw new Error('boom')
      },
      async delete() {},
    }

    expect(await cached(failing, 'k', async () => 'value', { ttl: 60 })).toBe('value')
  })

  test('behavior: caches forever when ttl is omitted', async () => {
    const { kv } = counting()
    let invocations = 0
    const fn = async () => ++invocations

    expect(await cached(kv, 'k', fn)).toBe(1)
    expect(await cached(kv, 'k', fn)).toBe(1)
    expect(invocations).toBe(1)
  })
})
