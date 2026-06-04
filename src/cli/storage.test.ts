import { chmod, mkdtemp, open, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, expectTypeOf, test } from 'vp/test'

import type * as CoreStorage from '../core/Storage.js'
import * as Storage from './storage.js'

async function createPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-storage-')), 'store.json')
}

describe('filesystem', () => {
  test('types: returns a standard storage adapter', () => {
    expectTypeOf(Storage.filesystem).returns.toMatchTypeOf<CoreStorage.Storage>()
  })

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

  test('behavior: tightens directory and file permissions', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })

    await chmod(dirname(path), 0o755)
    await writeFile(path, '{}', { encoding: 'utf8', mode: 0o644 })
    await chmod(path, 0o644)
    await storage.setItem('store', { state: { chainId: 1 }, version: 0 })

    if (process.platform === 'win32') return

    expect({
      directory: ((await stat(dirname(path))).mode & 0o777).toString(8),
      file: ((await stat(path)).mode & 0o777).toString(8),
    }).toMatchInlineSnapshot(`
      {
        "directory": "700",
        "file": "600",
      }
    `)
  })

  test('behavior: wraps malformed JSON errors with the storage path', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })

    await writeFile(path, '{', 'utf8')

    await expect(
      Promise.resolve(storage.getItem('store')).catch((error: Error) => ({
        message: error.message.replace(path, '<path>'),
        name: error.name,
      })),
    ).resolves.toMatchInlineSnapshot(`
      {
        "message": "Failed to parse CLI storage file at <path>. The file is not valid JSON.",
        "name": "FilesystemStorageError",
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

  test('behavior: waits for an external lock file', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const lock = await open(`${path}.lock`, 'wx', 0o600)

    const write = storage.setItem('store', { state: { chainId: 1 }, version: 0 })
    await sleep(50)
    await lock.close()
    await unlink(`${path}.lock`)
    await write

    await expect(storage.getItem('store')).resolves.toMatchInlineSnapshot(`
      {
        "state": {
          "chainId": 1,
        },
        "version": 0,
      }
    `)
  })

  test('behavior: serializes concurrent file writes', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const storage_2 = Storage.filesystem({ key: 'other', path })

    await Promise.all(
      Array.from({ length: 4 }, (_, i) => {
        if (i % 2 === 0) return storage.setItem(`item-${i}`, { index: i })
        return storage_2.setItem(`item-${i}`, { index: i })
      }),
    )

    await expect(
      Promise.all([
        storage.getItem('item-0'),
        storage_2.getItem('item-1'),
        storage.getItem('item-2'),
        storage_2.getItem('item-3'),
      ]),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "index": 0,
        },
        {
          "index": 1,
        },
        {
          "index": 2,
        },
        {
          "index": 3,
        },
      ]
    `)
  })
})
