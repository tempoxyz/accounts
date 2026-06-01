import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vp/test'

import * as Storage from './storage.js'

async function createPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-storage-')), 'store.json')
}

describe('filesystem', () => {
  test('behavior: stores values in a JSON file', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })

    await storage.setItem('store', { state: { chainId: 1 }, version: 0 })
    const value = await storage.getItem('store')

    expect(value).toMatchInlineSnapshot(`
      {
        "state": {
          "chainId": 1,
        },
        "version": 0,
      }
    `)
  })

  test('behavior: scopes values by storage key', async () => {
    const path = await createPath()
    const a = Storage.filesystem({ key: 'a', path })
    const b = Storage.filesystem({ key: 'b', path })

    await a.setItem('store', { state: { chainId: 1 }, version: 0 })

    await expect(b.getItem('store')).resolves.toMatchInlineSnapshot(`null`)
  })

  test('behavior: serializes concurrent writes', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ path })

    await Promise.all([storage.setItem('a', { value: 1 }), storage.setItem('b', { value: 2 })])

    await expect(storage.getItem('a')).resolves.toMatchInlineSnapshot(`
      {
        "value": 1,
      }
    `)
    await expect(storage.getItem('b')).resolves.toMatchInlineSnapshot(`
      {
        "value": 2,
      }
    `)
  })
})
