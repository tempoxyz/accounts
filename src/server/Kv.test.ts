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
