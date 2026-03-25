import { describe, expect, test } from 'vp/test'

import { withDedupe } from './withDedupe.js'

describe('withDedupe', () => {
  test('default: returns result of fn', async () => {
    const result = await withDedupe(() => Promise.resolve(42), { id: 'a' })
    expect(result).toMatchInlineSnapshot(`42`)
  })

  test('behavior: deduplicates concurrent calls with same id', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return new Promise<number>((resolve) => setTimeout(() => resolve(calls), 10))
    }

    const [a, b, c] = await Promise.all([
      withDedupe(fn, { id: 'same' }),
      withDedupe(fn, { id: 'same' }),
      withDedupe(fn, { id: 'same' }),
    ])

    expect(calls).toMatchInlineSnapshot(`1`)
    expect(a).toMatchInlineSnapshot(`1`)
    expect(b).toMatchInlineSnapshot(`1`)
    expect(c).toMatchInlineSnapshot(`1`)
  })

  test('behavior: different ids execute independently', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(calls)
    }

    const [a, b] = await Promise.all([withDedupe(fn, { id: 'x' }), withDedupe(fn, { id: 'y' })])

    expect(calls).toMatchInlineSnapshot(`2`)
    expect(a).toMatchInlineSnapshot(`1`)
    expect(b).toMatchInlineSnapshot(`2`)
  })

  test('behavior: cache is cleared after promise resolves', async () => {
    const fn = () => Promise.resolve('ok')

    await withDedupe(fn, { id: 'clear' })
    expect(withDedupe.cache.has('clear')).toMatchInlineSnapshot(`false`)
  })

  test('behavior: cache is cleared after promise rejects', async () => {
    const fn = () => Promise.reject(new Error('fail'))

    await withDedupe(fn, { id: 'reject' }).catch(() => {})
    expect(withDedupe.cache.has('reject')).toMatchInlineSnapshot(`false`)
  })

  test('behavior: rejection is shared across deduped calls', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.reject(new Error('boom'))
    }

    const results = await Promise.allSettled([
      withDedupe(fn, { id: 'err' }),
      withDedupe(fn, { id: 'err' }),
    ])

    expect(calls).toMatchInlineSnapshot(`1`)
    expect(results[0]!.status).toMatchInlineSnapshot(`"rejected"`)
    expect(results[1]!.status).toMatchInlineSnapshot(`"rejected"`)
  })

  test('behavior: allows new call after previous settles', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(calls)
    }

    const first = await withDedupe(fn, { id: 'seq' })
    const second = await withDedupe(fn, { id: 'seq' })

    expect(first).toMatchInlineSnapshot(`1`)
    expect(second).toMatchInlineSnapshot(`2`)
    expect(calls).toMatchInlineSnapshot(`2`)
  })

  test('behavior: bypasses when enabled is false', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve('ok')
    }

    await Promise.all([
      withDedupe(fn, { id: 'dis', enabled: false }),
      withDedupe(fn, { id: 'dis', enabled: false }),
    ])

    expect(calls).toMatchInlineSnapshot(`2`)
  })

  test('behavior: bypasses when id is undefined', async () => {
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve('ok')
    }

    await Promise.all([withDedupe(fn, { id: undefined }), withDedupe(fn, { id: undefined })])

    expect(calls).toMatchInlineSnapshot(`2`)
  })
})
