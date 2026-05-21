import { describe, expect, test } from 'vp/test'

import * as Kv from './Kv.js'

describe('memory', () => {
  test('default: round-trips set/get/delete', async () => {
    const kv = Kv.memory()

    await kv.set('a', { value: 1 })
    expect(await kv.get('a')).toMatchInlineSnapshot(`
      {
        "value": 1,
      }
    `)

    await kv.delete('a')
    expect(await kv.get('a')).toMatchInlineSnapshot(`undefined`)
  })

  test('ttl: returns value before expiry', async () => {
    let now = 1_000_000
    const kv = Kv.memory({ now: () => now })

    await kv.set('a', 'v', { ttl: 60 })
    now += 30_000
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v"`)
  })

  test('ttl: returns undefined after expiry', async () => {
    let now = 1_000_000
    const kv = Kv.memory({ now: () => now })

    await kv.set('a', 'v', { ttl: 60 })
    now += 60_001
    expect(await kv.get('a')).toMatchInlineSnapshot(`undefined`)
  })

  test('ttl: expiry deletes the entry (lazy eviction)', async () => {
    let now = 1_000_000
    const kv = Kv.memory({ now: () => now })

    await kv.set('a', 'v', { ttl: 1 })
    now += 2_000
    await kv.get('a')
    // Re-set without TTL; previous expired entry should be gone, not lingering.
    await kv.set('a', 'v2')
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v2"`)
  })

  test('create: writes only when key is absent', async () => {
    const kv = Kv.memory()

    expect(await kv.create!('a', 'v1')).toMatchInlineSnapshot(`true`)
    expect(await kv.create!('a', 'v2')).toMatchInlineSnapshot(`false`)
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v1"`)
  })

  test('create: replaces expired entries', async () => {
    let now = 1_000_000
    const kv = Kv.memory({ now: () => now })

    await kv.set('a', 'v1', { ttl: 1 })
    now += 2_000
    expect(await kv.create!('a', 'v2')).toMatchInlineSnapshot(`true`)
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v2"`)
  })

  test('create: concurrent callers — only one writes', async () => {
    const kv = Kv.memory()

    const results = await Promise.all([kv.create!('a', 'v1'), kv.create!('a', 'v2')])
    expect(results.filter(Boolean)).toMatchInlineSnapshot(`
      [
        true,
      ]
    `)
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v1"`)
  })

  test('take: returns the value and removes the entry', async () => {
    const kv = Kv.memory()

    await kv.set('n', { nonce: 'abc' })
    expect(await kv.take!('n')).toMatchInlineSnapshot(`
      {
        "nonce": "abc",
      }
    `)
    expect(await kv.get('n')).toMatchInlineSnapshot(`undefined`)
  })

  test('take: returns undefined for missing or expired keys', async () => {
    let now = 1_000_000
    const kv = Kv.memory({ now: () => now })

    expect(await kv.take!('missing')).toMatchInlineSnapshot(`undefined`)

    await kv.set('e', 'v', { ttl: 1 })
    now += 2_000
    expect(await kv.take!('e')).toMatchInlineSnapshot(`undefined`)
  })

  test('take: concurrent callers — only one observes the value', async () => {
    // The whole point: read+delete is atomic across awaits, so two
    // verifies racing on the same nonce can never both succeed.
    const kv = Kv.memory()
    await kv.set('nonce', 'one-time')

    const [a, b] = await Promise.all([kv.take!('nonce'), kv.take!('nonce')])
    const winners = [a, b].filter((v) => v !== undefined)
    expect(winners).toMatchInlineSnapshot(`
      [
        "one-time",
      ]
    `)
  })
})

describe('durableObject + NonceStorage', () => {
  /**
   * In-process simulation: a single `NonceStorage` instance backed by a
   * Map, exposed via the same fetch protocol the real DO would use.
   * This is exactly what the CF runtime gives us — single-actor, no
   * concurrent requests interleaving inside the DO — so the same
   * atomicity guarantees apply.
   */
  function fakeDurableObject() {
    const map = new Map<string, unknown>()
    const storage = {
      async get<T>(key: string) {
        return map.get(key) as T | undefined
      },
      async put(key: string, value: unknown) {
        map.set(key, value)
      },
      async delete(key: string) {
        map.delete(key)
      },
    }
    const instance = new Kv.NonceStorage({ storage })
    // Mimic the CF DO runtime's actor model: requests to the same DO
    // instance are serialized — never two `fetch` invocations executing
    // interleaved in the same actor.
    let queue: Promise<unknown> = Promise.resolve()
    const serialized = (req: Request) => {
      const next = queue.then(() => instance.fetch(req))
      queue = next.catch(() => {})
      return next
    }
    return {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (input: string, init?: unknown) =>
          serialized(new Request(input, init as RequestInit)),
      }),
    }
  }

  test('round-trips set/get/delete via the DO fetch protocol', async () => {
    const kv = Kv.durableObject(fakeDurableObject())

    await kv.set('a', { value: 1 })
    expect(await kv.get('a')).toMatchInlineSnapshot(`
      {
        "value": 1,
      }
    `)
    await kv.delete('a')
    expect(await kv.get('a')).toMatchInlineSnapshot(`undefined`)
  })

  test('take: removes the entry and returns the value', async () => {
    const kv = Kv.durableObject(fakeDurableObject())

    await kv.set('n', 'one-time')
    expect(await kv.take!('n')).toMatchInlineSnapshot(`"one-time"`)
    expect(await kv.get('n')).toMatchInlineSnapshot(`undefined`)
  })

  test('take: concurrent callers — only one wins', async () => {
    // The whole point of the DO adapter: even with parallel `take` calls
    // only one observer receives the value. The DO actor serializes
    // requests, so this is guaranteed by the runtime.
    const kv = Kv.durableObject(fakeDurableObject())
    await kv.set('nonce', 'consume-once')

    const [a, b] = await Promise.all([kv.take!('nonce'), kv.take!('nonce')])
    const winners = [a, b].filter((v) => v !== undefined)
    expect(winners).toMatchInlineSnapshot(`
      [
        "consume-once",
      ]
    `)
  })

  test('create: concurrent callers — only one wins', async () => {
    const kv = Kv.durableObject(fakeDurableObject())

    const results = await Promise.all([kv.create!('a', 'v1'), kv.create!('a', 'v2')])
    expect(results.filter(Boolean)).toMatchInlineSnapshot(`
      [
        true,
      ]
    `)
    expect(await kv.get('a')).toMatchInlineSnapshot(`"v1"`)
  })

  test('take: missing key returns undefined', async () => {
    const kv = Kv.durableObject(fakeDurableObject())
    expect(await kv.take!('missing')).toMatchInlineSnapshot(`undefined`)
  })
})

describe('cloudflare', () => {
  test('default: forwards set/get/delete to underlying KV', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const fakeKv = {
      get: async (key: string, format: 'json') => {
        calls.push({ method: 'get', args: [key, format] })
        return 'value' as never
      },
      put: async (key: string, value: string, options?: unknown) => {
        calls.push({ method: 'put', args: [key, value, options] })
      },
      delete: async (key: string) => {
        calls.push({ method: 'delete', args: [key] })
      },
    }
    const kv = Kv.cloudflare(fakeKv)

    await kv.set('a', { value: 1 })
    await kv.get('a')
    await kv.delete('a')

    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "args": [
            "a",
            "{"value":1}",
            undefined,
          ],
          "method": "put",
        },
        {
          "args": [
            "a",
            "json",
          ],
          "method": "get",
        },
        {
          "args": [
            "a",
          ],
          "method": "delete",
        },
      ]
    `)
  })

  test('take: NOT implemented (CF KV is not linearizable)', () => {
    const kv = Kv.cloudflare({
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    })
    expect(kv.take).toBeUndefined()
  })

  test('create: NOT implemented (CF KV is not linearizable)', () => {
    const kv = Kv.cloudflare({
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    })
    expect(kv.create).toBeUndefined()
  })

  test('ttl: passes expirationTtl seconds to underlying put', async () => {
    const puts: { key: string; value: string; options: unknown }[] = []
    const fakeKv = {
      get: async () => undefined as never,
      put: async (key: string, value: string, options?: unknown) => {
        puts.push({ key, value, options })
      },
      delete: async () => {},
    }
    const kv = Kv.cloudflare(fakeKv)

    await kv.set('a', 'v', { ttl: 60 })

    expect(puts).toMatchInlineSnapshot(`
      [
        {
          "key": "a",
          "options": {
            "expirationTtl": 60,
          },
          "value": ""v"",
        },
      ]
    `)
  })
})
