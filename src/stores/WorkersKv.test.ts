/**
 * Tests of `Store.workersKv` against a KV namespace of Miniflare, which runs workerd's KV.
 * @module
 */
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'
import * as WorkersKv from './WorkersKv.js'

async function namespace() {
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      kvNamespaces: ['STORE'],
      modules: true,
      script: 'export default { fetch: () => new Response() }',
    }),
  )
  onTestFinished(() => miniflare.dispose())
  return miniflare.getKVNamespace('STORE')
}

describe('Store.workersKv', () => {
  test('behavior: a write that expires within 60 seconds succeeds, a read skips it after its expiry, and KV deletes it 60 seconds after the write', async () => {
    const kv = await namespace()
    const store = WorkersKv.create(kv)
    const start = Date.now()

    await store.setItem('kept', { amount: 1n })
    await store.setItem('brief', 'value', { expiresAt: start + 200 })
    const [listed] = (await kv.list({ prefix: 'brief' })).keys

    expect(await store.getItem('kept')).toMatchInlineSnapshot(`
      {
        "amount": 1n,
      }
    `)
    expect(await store.getItem('brief')).toBe('value')
    expect(listed!.expiration).toBeGreaterThanOrEqual(start / 1000 + 60)
    await expect.poll(() => store.getItem('brief')).toBeUndefined()
  })

  test('behavior: a write whose expiry passed deletes the entry, and a value without a JSON form rejects and keeps it', async () => {
    const kv = await namespace()
    const store = WorkersKv.create(kv)
    await store.setItem('passed', 'value')
    await store.setItem('kept', 'value')

    await store.setItem('passed', 'next', { expiresAt: Date.now() - 1 })
    const error = await store
      .setItem('kept', undefined, { expiresAt: Date.now() - 1 })
      .catch((error: unknown) => error)

    expect(await kv.get('passed')).toBeNull()
    expect(error).toMatchInlineSnapshot(
      '[TypeError: Unserializable value: the value has no JSON form, such as `undefined` or a function. Call `removeItem` to delete the entry.]',
    )
    expect(await store.getItem('kept')).toBe('value')
  })
})
