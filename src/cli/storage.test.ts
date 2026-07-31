import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, expectTypeOf, test } from 'vp/test'

import type * as CoreStorage from '../core/Storage.js'
import * as Store from '../core/Store.js'
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

  test('behavior: waits for another process and rereads after locking', async () => {
    const path = await createPath()
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import Koffi from 'koffi'
          import { closeSync, openSync, writeFileSync } from 'node:fs'
          import { setTimeout } from 'node:timers/promises'
          const library = Koffi.load(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6')
          const flock = library.func('flock', 'int', ['int', 'int'])
          const fd = openSync(${JSON.stringify(`${path}.lock`)}, 'a+')
          flock(fd, 2)
          process.stdout.write('locked')
          await setTimeout(100)
          writeFileSync(${JSON.stringify(path)}, JSON.stringify({ 'external.store': { state: { chainId: 1 }, version: 0 } }))
          flock(fd, 8)
          closeSync(fd)
        `,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const exit = once(child, 'exit')
    await once(child.stdout!, 'data')
    let complete = false
    const write = Promise.resolve(
      Storage.filesystem({ key: 'local', path }).setItem('store', {
        state: { chainId: 2 },
        version: 0,
      }),
    ).then(() => {
      complete = true
    })
    await setTimeout(30)
    expect(complete).toBe(false)
    const [code] = await exit
    expect(code).toBe(0)
    await write

    await expect(
      Promise.all([
        Storage.filesystem({ key: 'external', path }).getItem('store'),
        Storage.filesystem({ key: 'local', path }).getItem('store'),
      ]),
    ).resolves.toEqual([
      { state: { chainId: 1 }, version: 0 },
      { state: { chainId: 2 }, version: 0 },
    ])
  })

  test('behavior: does not restore credentials from stale hydrated state', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const accessKey = {
      access: '0x0000000000000000000000000000000000000001',
      address: '0x0000000000000000000000000000000000000002',
      chainId: 1,
      handle: 'stale-handle',
      keyType: 'secp256k1',
      keyPair: { privateKey: 'stale-key-pair' },
      privateKey: `0x${'11'.repeat(32)}`,
    } as const
    await storage.setItem('store', {
      state: { accessKeys: [accessKey], accounts: [], activeAccount: 0, chainId: 1 },
      version: 0,
    })
    const store = Store.create({ chainId: 1, storage })
    await Store.waitForHydration(store)

    const { handle: _, keyPair: __, privateKey: ___, ...retired } = accessKey
    await Storage.filesystem({ key: 'test', path }).setItem('store', {
      state: { accessKeys: [retired], accounts: [], activeAccount: 0, chainId: 1 },
      version: 0,
    })
    store.setState({ chainId: 2 })

    await expect(storage.getItem('store')).resolves.toEqual({
      state: { accessKeys: [retired], accounts: [], activeAccount: 0, chainId: 2 },
      version: 0,
    })
  })

  test('behavior: preserves a store created after empty hydration', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const store = Store.create({ chainId: 1, storage })
    await Store.waitForHydration(store)
    const accessKey = {
      access: '0x0000000000000000000000000000000000000001',
      address: '0x0000000000000000000000000000000000000002',
      chainId: 1,
      keyType: 'secp256k1',
      privateKey: `0x${'22'.repeat(32)}`,
    } as const
    await Storage.filesystem({ key: 'test', path }).setItem('store', {
      state: { accessKeys: [accessKey], accounts: [], activeAccount: 0, chainId: 1 },
      version: 0,
    })

    store.setState({ chainId: 2 })

    await expect(storage.getItem('store')).resolves.toEqual({
      state: { accessKeys: [accessKey], accounts: [], activeAccount: 0, chainId: 2 },
      version: 0,
    })
  })
})
