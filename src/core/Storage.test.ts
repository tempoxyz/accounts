import { describe, expect, test } from 'vp/test'

import * as Storage from './Storage.js'

describe('combine', () => {
  describe.each(['sync', 'async'] as const)('%s failures', (mode) => {
    const fail = () => {
      if (mode === 'sync') throw new Error('Storage unavailable')
      return Promise.reject(new Error('Storage unavailable'))
    }
    const failed: Storage.Storage = {
      getItem: fail,
      setItem: fail,
      removeItem: fail,
    }

    test('reads from the next adapter', async () => {
      const memory = Storage.memory()
      await memory.setItem('item', 'cached')
      const storage = Storage.combine(failed, memory)

      expect(await storage.getItem('item')).toMatchInlineSnapshot('"cached"')
    })

    test('writes to the next adapter', async () => {
      const memory = Storage.memory()
      const storage = Storage.combine(failed, memory)
      await storage.setItem('item', 'saved')

      expect(await memory.getItem('item')).toMatchInlineSnapshot('"saved"')
    })

    test('removes from the next adapter', async () => {
      const memory = Storage.memory()
      await memory.setItem('item', 'cached')
      const storage = Storage.combine(failed, memory)
      await storage.removeItem('item')

      expect(await memory.getItem('item')).toMatchInlineSnapshot('null')
    })

    test('settles when every adapter fails', async () => {
      const storage = Storage.combine(failed, failed)

      expect([
        await storage.getItem('item'),
        await storage.setItem('item', 'saved'),
        await storage.removeItem('item'),
      ]).toMatchInlineSnapshot(`
        [
          null,
          undefined,
          undefined,
        ]
      `)
    })
  })

  test('reads the first non-nullish value in adapter order', async () => {
    const first = Storage.memory()
    const second = Storage.memory()
    await first.setItem('item', 'first')
    await second.setItem('item', 'second')
    const missing: Storage.Storage = {
      ...Storage.memory(),
      getItem: () => undefined as never,
    }
    const storage = Storage.combine(Storage.memory(), missing, first, second)

    expect(await storage.getItem('item')).toMatchInlineSnapshot('"first"')
  })

  test.each([false, 0, ''])('preserves the non-nullish value %j', async (value) => {
    const first = Storage.memory()
    const second = Storage.memory()
    await first.setItem('item', value)
    await second.setItem('item', 'second')

    expect(await Storage.combine(first, second).getItem('item')).toBe(value)
  })

  test('settles with no adapters', async () => {
    const storage = Storage.combine()

    expect([
      await storage.getItem('item'),
      await storage.setItem('item', 'saved'),
      await storage.removeItem('item'),
    ]).toMatchInlineSnapshot(`
      [
        null,
        undefined,
        undefined,
      ]
    `)
  })
})
