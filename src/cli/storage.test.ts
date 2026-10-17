import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { type Address, Json } from 'ox'
import { describe, expect, expectTypeOf, test } from 'vp/test'

import { moduleUrl, run } from '../../test/process.js'
import type * as AccessKey from '../core/AccessKey.js'
import type * as CoreStorage from '../core/Storage.js'
import * as Store from '../core/Store.js'
import * as Storage from './storage.js'

async function createPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-storage-')), 'store.json')
}

const root = '0x00000000000000000000000000000000000000a1'
const root_2 = '0x00000000000000000000000000000000000000a2'
const root_3 = '0x00000000000000000000000000000000000000a3'

function accessKey(
  access: Address.Address,
  address: Address.Address,
  chainId = 4217,
): AccessKey.AccessKey {
  return { access, address, chainId, keyType: 'secp256k1', privateKey: '0x01' }
}

const key_1 = accessKey(root, '0x00000000000000000000000000000000000000b1')
const key_2 = accessKey(root, '0x00000000000000000000000000000000000000b2')
const key_3 = accessKey(root_3, '0x00000000000000000000000000000000000000b3', 42431)

type State = Pick<Store.State, 'accessKeys' | 'accounts' | 'activeAccount' | 'chainId'>

const initial: State = {
  accessKeys: [key_1, key_2],
  accounts: [{ address: root }, { address: root_2 }],
  activeAccount: 1,
  chainId: 4217,
}

function without(state: State, key: { address: string }): State {
  return { ...state, accessKeys: state.accessKeys.filter((x) => x.address !== key.address) }
}

function withExpiry(state: State, key: { address: string }, expiry: number): State {
  return {
    ...state,
    accessKeys: state.accessKeys.map((x) => (x.address === key.address ? { ...x, expiry } : x)),
  }
}

/** Another process's login: a new active account, its key, and its chain. */
function login(state: State): State {
  return {
    accessKeys: [key_3, ...state.accessKeys],
    accounts: [{ address: root_3 }, ...state.accounts],
    activeAccount: 0,
    chainId: 42431,
  }
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

  test('behavior: preserves existing directory permissions and tightens file permissions', async () => {
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
        "directory": "755",
        "file": "600",
      }
    `)
  })

  test('behavior: secures directories it creates', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'accounts-storage-')), 'wallet', 'store.json')
    const storage = Storage.filesystem({ key: 'test', path })

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

  test.each<{
    name: string
    a: (state: State) => State
    b: (state: State) => State
    expected: State
  }>([
    {
      name: 'keeps a login from another process while removing a different key',
      b: login,
      a: (state) => without(state, key_1),
      expected: {
        accessKeys: [key_3, key_2],
        accounts: [{ address: root_3 }, { address: root }, { address: root_2 }],
        activeAccount: 0,
        chainId: 42431,
      },
    },
    {
      name: 'gives a field both processes changed to the later write',
      b: (state) => ({ ...state, chainId: 42431 }),
      a: (state) => ({ ...state, chainId: 1 }),
      expected: { ...initial, chainId: 1 },
    },
    {
      name: 'gives a record both processes changed to the later write',
      b: (state) => withExpiry(login(state), key_1, 100),
      a: (state) => withExpiry(state, key_1, 200),
      expected: { ...login(initial), accessKeys: [key_3, { ...key_1, expiry: 200 }, key_2] },
    },
    {
      name: 'leaves out a record another process removed',
      b: (state) => without(state, key_2),
      a: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
      expected: { ...initial, accessKeys: [key_3, key_1] },
    },
    {
      name: 'restores a record this process changed after another process removed it',
      b: (state) => without(state, key_1),
      a: (state) => withExpiry(state, key_1, 200),
      expected: { ...initial, accessKeys: [{ ...key_1, expiry: 200 }, key_2] },
    },
    {
      name: 'stores a record both processes added once',
      b: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
      a: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
      expected: { ...initial, accessKeys: [key_3, key_1, key_2] },
    },
    {
      name: 'keeps the active account this process chose when another process adds one',
      b: login,
      a: (state) => ({ ...state, activeAccount: 0 }),
      expected: { ...login(initial), activeAccount: 1 },
    },
    {
      name: 'keeps a logout from another process',
      b: (state) => ({ ...state, accessKeys: [], accounts: [], activeAccount: 0 }),
      a: (state) => without(state, key_1),
      expected: { ...initial, accessKeys: [], accounts: [], activeAccount: 0 },
    },
  ])('behavior: $name', async ({ a, b, expected }) => {
    const path = await createPath()
    await Storage.filesystem({ key: 'test', path }).setItem('store', { state: initial, version: 0 })

    // Two adapters on one file stand in for two processes that load the store at the same time.
    const storage_a = Storage.filesystem({ key: 'test', path })
    const storage_b = Storage.filesystem({ key: 'test', path })
    const item_a = (await storage_a.getItem<{ state: State; version: number }>('store'))!
    const item_b = (await storage_b.getItem<{ state: State; version: number }>('store'))!
    await storage_b.setItem('store', { ...item_b, state: b(item_b.state) })
    await storage_a.setItem('store', { ...item_a, state: a(item_a.state) })

    expect(await Storage.filesystem({ key: 'test', path }).getItem('store')).toEqual({
      state: expected,
      version: 0,
    })
  })

  test('behavior: merges each write against the value it last wrote', async () => {
    const path = await createPath()
    const storage_a = Storage.filesystem({ key: 'test', path })
    const storage_b = Storage.filesystem({ key: 'test', path })
    await storage_a.setItem('store', { state: initial, version: 0 })
    await storage_b.getItem('store')

    await storage_b.setItem('store', { state: login(initial), version: 0 })
    // A writes again from its own unchanged copy: B's login must survive both writes.
    await storage_a.setItem('store', { state: without(initial, key_1), version: 0 })
    await storage_a.setItem('store', { state: without(without(initial, key_1), key_2), version: 0 })

    expect(await storage_b.getItem('store')).toMatchInlineSnapshot(`
      {
        "state": {
          "accessKeys": [
            {
              "access": "0x00000000000000000000000000000000000000a3",
              "address": "0x00000000000000000000000000000000000000b3",
              "chainId": 42431,
              "keyType": "secp256k1",
              "privateKey": "0x01",
            },
          ],
          "accounts": [
            {
              "address": "0x00000000000000000000000000000000000000a3",
            },
            {
              "address": "0x00000000000000000000000000000000000000a1",
            },
            {
              "address": "0x00000000000000000000000000000000000000a2",
            },
          ],
          "activeAccount": 0,
          "chainId": 42431,
        },
        "version": 0,
      }
    `)
  })

  test('behavior: stores exactly the given value when no other process wrote', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const value = { state: { ...initial, limit: 10n, label: undefined }, version: 0 }

    await storage.getItem('store')
    await storage.setItem('store', value)
    await storage.setItem('store', { ...value, state: without(initial, key_1) })

    expect(await readFile(path, 'utf8')).toBe(
      Json.stringify({ 'test.store': { ...value, state: without(initial, key_1) } }),
    )
  })

  test('behavior: merges the writes of two provider stores', async () => {
    const path = await createPath()
    await Storage.filesystem({ path }).setItem('store', { state: initial, version: 0 })

    const store_a = Store.create({ chainId: 4217, storage: Storage.filesystem({ path }) })
    const store_b = Store.create({ chainId: 4217, storage: Storage.filesystem({ path }) })
    await Promise.all([Store.waitForHydration(store_a), Store.waitForHydration(store_b)])

    store_b.setState(login(store_b.getState()))
    store_a.accessKeys.remove({ account: root, accessKey: key_1.address, chainId: 4217 })

    // Reads queue behind every write to the file.
    expect(await Storage.filesystem({ path }).getItem('store')).toMatchInlineSnapshot(`
      {
        "state": {
          "accessKeys": [
            {
              "access": "0x00000000000000000000000000000000000000a3",
              "address": "0x00000000000000000000000000000000000000b3",
              "chainId": 42431,
              "keyType": "secp256k1",
              "privateKey": "0x01",
            },
            {
              "access": "0x00000000000000000000000000000000000000a1",
              "address": "0x00000000000000000000000000000000000000b2",
              "chainId": 4217,
              "keyType": "secp256k1",
              "privateKey": "0x01",
            },
          ],
          "accounts": [
            {
              "address": "0x00000000000000000000000000000000000000a3",
            },
            {
              "address": "0x00000000000000000000000000000000000000a1",
            },
            {
              "address": "0x00000000000000000000000000000000000000a2",
            },
          ],
          "activeAccount": 0,
          "chainId": 42431,
        },
        "version": 0,
      }
    `)
  })

  test('behavior: keeps every key when processes write at once', async () => {
    const path = await createPath()
    await Storage.filesystem({ key: 'test', path }).setItem('store', { state: initial, version: 0 })

    // Each process loads the store, waits until all have loaded, then adds its own key.
    const writers = Array.from({ length: 6 }, (_, i) =>
      run(`
        import * as Storage from ${JSON.stringify(moduleUrl('src/cli/storage.ts'))}
        const storage = Storage.filesystem({ key: 'test', path: ${JSON.stringify(path)} })
        const item = await storage.getItem('store')
        process.stdout.write('loaded\\n')
        await new Promise((resolve) => process.stdin.once('data', resolve))
        const key = { ...item.state.accessKeys[0], address: '0x${'0'.repeat(39)}${i}' }
        await storage.setItem('store', {
          ...item,
          state: { ...item.state, accessKeys: [key, ...item.state.accessKeys] },
        })
        process.exit(0)
      `),
    )
    await Promise.all(writers.map((x) => x.waitFor('loaded')))
    for (const writer of writers) writer.send('go')
    const results = await Promise.all(writers.map((x) => x.exited))

    const item = await Storage.filesystem({ key: 'test', path }).getItem<{ state: State }>('store')
    expect({
      addresses: item!.state.accessKeys.map((x) => x.address).sort(),
      locked: existsSync(`${path}.lock`),
      mode: process.platform === 'win32' ? '600' : ((await stat(path)).mode & 0o777).toString(8),
      results: results.map(({ code }) => code),
    }).toMatchInlineSnapshot(`
      {
        "addresses": [
          "0x0000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000003",
          "0x0000000000000000000000000000000000000004",
          "0x0000000000000000000000000000000000000005",
          "0x00000000000000000000000000000000000000b1",
          "0x00000000000000000000000000000000000000b2",
        ],
        "locked": false,
        "mode": "600",
        "results": [
          0,
          0,
          0,
          0,
          0,
          0,
        ],
      }
    `)
  })

  test('behavior: leaves a whole file when a writer is killed mid-write', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })

    for (const delay of [0, 5, 10, 20, 40]) {
      const writer = run(`
        import * as Storage from ${JSON.stringify(moduleUrl('src/cli/storage.ts'))}
        const storage = Storage.filesystem({ key: 'test', path: ${JSON.stringify(path)} })
        const accessKeys = Array.from({ length: 2_000 }, (_, i) => ({
          ...${JSON.stringify(key_1)},
          address: '0x' + i.toString(16).padStart(40, '0'),
        }))
        for (let i = 0; ; i++) {
          await storage.setItem('store', { state: { accessKeys, chainId: i }, version: 0 })
          if (i === 0) process.stdout.write('writing\\n')
        }
      `)
      await writer.waitFor('writing')
      await sleep(delay)
      await writer.kill()

      // The file parses, and the next write goes through even if the writer died holding the lock.
      await storage.getItem('store')
      await storage.setItem('store', { state: initial, version: 0 })
    }

    expect({
      item: await storage.getItem('store'),
      mode: process.platform === 'win32' ? '600' : ((await stat(path)).mode & 0o777).toString(8),
    }).toMatchInlineSnapshot(`
      {
        "item": {
          "state": {
            "accessKeys": [
              {
                "access": "0x00000000000000000000000000000000000000a1",
                "address": "0x00000000000000000000000000000000000000b1",
                "chainId": 4217,
                "keyType": "secp256k1",
                "privateKey": "0x01",
              },
              {
                "access": "0x00000000000000000000000000000000000000a1",
                "address": "0x00000000000000000000000000000000000000b2",
                "chainId": 4217,
                "keyType": "secp256k1",
                "privateKey": "0x01",
              },
            ],
            "accounts": [
              {
                "address": "0x00000000000000000000000000000000000000a1",
              },
              {
                "address": "0x00000000000000000000000000000000000000a2",
              },
            ],
            "activeAccount": 1,
            "chainId": 4217,
          },
          "version": 0,
        },
        "mode": "600",
      }
    `)
  })
})
