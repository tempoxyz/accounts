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
const root_4 = '0x00000000000000000000000000000000000000a4'

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
const key_4 = accessKey(root_4, '0x00000000000000000000000000000000000000b4')

const labels: Record<string, string> = {
  [root]: 'root',
  [root_2]: 'root_2',
  [root_3]: 'root_3',
  [root_4]: 'root_4',
  [key_1.address]: 'key_1',
  [key_2.address]: 'key_2',
  [key_3.address]: 'key_3',
  [key_4.address]: 'key_4',
}

type State = Pick<Store.State, 'accessKeys' | 'accounts' | 'activeAccount' | 'auth' | 'chainId'>

const initial: State = {
  accessKeys: [key_1, key_2],
  accounts: [{ address: root }, { address: root_2 }],
  activeAccount: 1,
  chainId: 4217,
}

const auth = { logout: 'https://example.com/logout' }

/** A stored state with records named after their fixtures. */
function summarize(state: Partial<State> | undefined) {
  if (!state) return state
  const { accessKeys = [], accounts = [], activeAccount = 0, ...rest } = state
  return {
    ...rest,
    accessKeys: accessKeys.map(
      (key) => `${labels[key.address]}${key.expiry ? ` (expiry ${key.expiry})` : ''}`,
    ),
    accounts: accounts.map((account) => labels[account.address]),
    active: accounts[activeAccount] ? labels[accounts[activeAccount].address] : null,
  }
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

/** A login: a new active account, its key, and its chain. */
function login(
  state: State,
  account: Address.Address = root_3,
  key = key_3,
  chainId = 42431,
): State {
  return {
    ...state,
    accessKeys: [key, ...state.accessKeys],
    accounts: [{ address: account }, ...state.accounts],
    activeAccount: 0,
    chainId,
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

  test('behavior: merges concurrent writes per field and record', async () => {
    // Two adapters on one file stand in for two processes that load the store at the same time.
    // B writes first, then A. A `fresh` A writes without reading the file first.
    const rows: {
      name: string
      a: (state: State) => State
      b: (state: State) => State
      fresh?: boolean | undefined
      initial?: State | undefined
    }[] = [
      {
        name: 'keeps a login from another process while removing a different key',
        b: (state) => login(state),
        a: (state) => without(state, key_1),
      },
      {
        name: 'gives a field both processes changed to the later write',
        b: (state) => ({ ...state, chainId: 42431 }),
        a: (state) => ({ ...state, chainId: 1 }),
      },
      {
        name: 'gives a record both processes changed to the later write',
        b: (state) => withExpiry(login(state), key_1, 100),
        a: (state) => withExpiry(state, key_1, 200),
      },
      {
        name: 'adds a new key while another process removes a different one',
        b: (state) => without(state, key_2),
        a: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
      },
      {
        name: 'leaves out a record another process removed, even if this process changed it',
        b: (state) => without(state, key_1),
        a: (state) => withExpiry(state, key_1, 200),
      },
      {
        name: 'stores a record both processes added once',
        b: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
        a: (state) => ({ ...state, accessKeys: [key_3, ...state.accessKeys] }),
      },
      {
        name: 'keeps the account this process selected when another process adds one',
        b: (state) => login(state),
        a: (state) => ({ ...state, activeAccount: 0 }),
      },
      {
        name: 'keeps the account this process selected after another process removed it',
        b: (state) => ({ ...state, accounts: [{ address: root_2 }], activeAccount: 0 }),
        a: (state) => ({ ...state, activeAccount: 0 }),
      },
      {
        name: 'keeps the selection when neither process changed it',
        b: (state) => ({
          ...state,
          accounts: [{ address: root_3 }, ...state.accounts],
          activeAccount: 2,
        }),
        a: (state) => without(state, key_1),
      },
      {
        name: "selects this process's account when it removed the other's selection",
        b: (state) => ({ ...state, activeAccount: 0 }),
        a: (state) => ({ ...state, accounts: [{ address: root_2 }], activeAccount: 0 }),
      },
      {
        name: 'removes a field another process cleared',
        initial: { ...initial, auth },
        b: ({ auth: _, ...state }) => state,
        a: (state) => without(state, key_1),
      },
      {
        name: 'keeps the auth of the login that is selected',
        b: (state) => ({ ...login(state), auth }),
        a: (state) => login(state, root_4, key_4, 4217),
      },
      {
        name: 'keeps a logout from another process',
        b: (state) => ({ ...state, accessKeys: [], accounts: [], activeAccount: 0 }),
        a: (state) => without(state, key_1),
      },
      {
        name: 'keeps a logout from another process over a stale key change',
        b: (state) => ({ ...state, accessKeys: [], accounts: [], activeAccount: 0 }),
        a: (state) => withExpiry(state, key_1, 200),
      },
      {
        name: 'keeps a logout from another process over a stale selection',
        b: (state) => ({ ...state, accessKeys: [], accounts: [], activeAccount: 0 }),
        a: (state) => ({ ...state, activeAccount: 0 }),
      },
      {
        name: 'replaces the item on a write without a read',
        fresh: true,
        b: (state) => login(state),
        a: () => ({
          accessKeys: [key_4],
          accounts: [{ address: root_4 }],
          activeAccount: 0,
          chainId: 1,
        }),
      },
    ]

    const results: Record<string, unknown> = {}
    for (const { a, b, fresh, name, initial: state = initial } of rows) {
      const path = await createPath()
      await Storage.filesystem({ key: 'test', path }).setItem('store', { state, version: 0 })
      const storage_a = Storage.filesystem({ key: 'test', path })
      const storage_b = Storage.filesystem({ key: 'test', path })
      const item_a = fresh
        ? { state, version: 0 }
        : (await storage_a.getItem<{ state: State; version: number }>('store'))!
      const item_b = (await storage_b.getItem<{ state: State; version: number }>('store'))!
      await storage_b.setItem('store', { ...item_b, state: b(item_b.state) })
      await storage_a.setItem('store', { ...item_a, state: a(item_a.state) })

      const item = await Storage.filesystem({ key: 'test', path }).getItem<{ state: State }>(
        'store',
      )
      results[name] = summarize(item?.state)
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "adds a new key while another process removes a different one": {
          "accessKeys": [
            "key_3",
            "key_1",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
        "gives a field both processes changed to the later write": {
          "accessKeys": [
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 1,
        },
        "gives a record both processes changed to the later write": {
          "accessKeys": [
            "key_3",
            "key_1 (expiry 200)",
            "key_2",
          ],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_3",
          "chainId": 42431,
        },
        "keeps a login from another process while removing a different key": {
          "accessKeys": [
            "key_3",
            "key_2",
          ],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_3",
          "chainId": 42431,
        },
        "keeps a logout from another process": {
          "accessKeys": [],
          "accounts": [],
          "active": null,
          "chainId": 4217,
        },
        "keeps a logout from another process over a stale key change": {
          "accessKeys": [],
          "accounts": [],
          "active": null,
          "chainId": 4217,
        },
        "keeps a logout from another process over a stale selection": {
          "accessKeys": [],
          "accounts": [],
          "active": null,
          "chainId": 4217,
        },
        "keeps the account this process selected after another process removed it": {
          "accessKeys": [
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root",
          "chainId": 4217,
        },
        "keeps the account this process selected when another process adds one": {
          "accessKeys": [
            "key_3",
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root",
          "chainId": 42431,
        },
        "keeps the auth of the login that is selected": {
          "accessKeys": [
            "key_4",
            "key_3",
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root_4",
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_4",
          "chainId": 42431,
        },
        "keeps the selection when neither process changed it": {
          "accessKeys": [
            "key_2",
          ],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
        "leaves out a record another process removed, even if this process changed it": {
          "accessKeys": [
            "key_2",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
        "removes a field another process cleared": {
          "accessKeys": [
            "key_2",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
        "replaces the item on a write without a read": {
          "accessKeys": [
            "key_4",
          ],
          "accounts": [
            "root_4",
          ],
          "active": "root_4",
          "chainId": 1,
        },
        "selects this process's account when it removed the other's selection": {
          "accessKeys": [
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
        "stores a record both processes added once": {
          "accessKeys": [
            "key_3",
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root",
            "root_2",
          ],
          "active": "root_2",
          "chainId": 4217,
        },
      }
    `)
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

    const item = await storage_b.getItem<{ state: State }>('store')
    expect(summarize(item?.state)).toMatchInlineSnapshot(`
      {
        "accessKeys": [
          "key_3",
        ],
        "accounts": [
          "root_3",
          "root",
          "root_2",
        ],
        "active": "root_3",
        "chainId": 42431,
      }
    `)
  })

  test('behavior: stores exactly the given value when no other process wrote', async () => {
    const path = await createPath()
    const storage = Storage.filesystem({ key: 'test', path })
    const value = {
      state: { ...without(initial, key_2), limit: 10n, label: undefined },
      version: 0,
    }

    await storage.getItem('store')
    await storage.setItem('store', { state: login(initial), version: 0 })
    await storage.setItem('store', value)

    expect(await readFile(path, 'utf8')).toMatchInlineSnapshot(
      `"{"test.store":{"state":{"accessKeys":[{"access":"0x00000000000000000000000000000000000000a1","address":"0x00000000000000000000000000000000000000b1","chainId":4217,"keyType":"secp256k1","privateKey":"0x01"}],"accounts":[{"address":"0x00000000000000000000000000000000000000a1"},{"address":"0x00000000000000000000000000000000000000a2"}],"activeAccount":1,"chainId":4217,"limit":"10#__bigint"},"version":0}}"`,
    )
  })

  test('behavior: merges the writes of two provider stores', async () => {
    // Two stores on one file stand in for two CLI processes. B acts first, then A.
    const rows: {
      name: string
      a: (store: Store.Store) => void
      b: (store: Store.Store) => void
      maxAccounts?: number | undefined
    }[] = [
      {
        name: 'keeps a login from another store while removing a different key',
        b: (store) => store.setState(login(store.getState())),
        a: (store) =>
          store.accessKeys.remove({ account: root, accessKey: key_1.address, chainId: 4217 }),
      },
      {
        name: 'clears accounts and keys another store added on disconnect',
        b: (store) => store.setState(login(store.getState())),
        a: (store) => store.disconnect(),
      },
      {
        name: 'keeps a disconnect over a stale key change',
        b: (store) => store.disconnect(),
        a: (store) => store.setState(withExpiry(store.getState(), key_1, 200)),
      },
      {
        name: 'clears keys another store added when clearing keys',
        b: (store) => store.setState(login(store.getState())),
        a: (store) => store.accessKeys.clear(),
      },
      {
        name: 'stores at most maxAccounts after concurrent logins',
        maxAccounts: 2,
        b: (store) => store.setState(login(store.getState())),
        a: (store) => store.setState(login(store.getState(), root_4, key_4, 4217)),
      },
    ]

    const results: Record<string, unknown> = {}
    for (const { a, b, maxAccounts, name } of rows) {
      const path = await createPath()
      await Storage.filesystem({ path }).setItem('store', { state: initial, version: 0 })
      const [store_a, store_b] = [0, 1].map(() =>
        Store.create({ chainId: 4217, maxAccounts, storage: Storage.filesystem({ path }) }),
      ) as [Store.Store, Store.Store]
      await Promise.all([Store.waitForHydration(store_a), Store.waitForHydration(store_b)])

      b(store_b)
      a(store_a)

      // Reads queue behind every write to the file.
      const item = await Storage.filesystem({ path }).getItem<{ state: State }>('store')
      results[name] = summarize(item?.state)
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "clears accounts and keys another store added on disconnect": {
          "accessKeys": [],
          "accounts": [],
          "active": null,
          "chainId": 42431,
        },
        "clears keys another store added when clearing keys": {
          "accessKeys": [],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_3",
          "chainId": 42431,
        },
        "keeps a disconnect over a stale key change": {
          "accessKeys": [],
          "accounts": [],
          "active": null,
          "chainId": 4217,
        },
        "keeps a login from another store while removing a different key": {
          "accessKeys": [
            "key_3",
            "key_2",
          ],
          "accounts": [
            "root_3",
            "root",
            "root_2",
          ],
          "active": "root_3",
          "chainId": 42431,
        },
        "stores at most maxAccounts after concurrent logins": {
          "accessKeys": [
            "key_4",
            "key_3",
            "key_1",
            "key_2",
          ],
          "accounts": [
            "root_4",
            "root_3",
          ],
          "active": "root_4",
          "chainId": 42431,
        },
      }
    `)
  })

  test('behavior: keeps every key when processes write at once', async () => {
    const path = await createPath()
    await Storage.filesystem({ key: 'test', path }).setItem('store', { state: initial, version: 0 })

    // Each process loads the store, waits until all have loaded, then adds its own key.
    const writers = Array.from({ length: 6 }, (_, i) =>
      run(`
        import { Hex } from 'ox'
        import * as Storage from ${JSON.stringify(moduleUrl('src/cli/storage.ts'))}
        const storage = Storage.filesystem({ key: 'test', path: ${JSON.stringify(path)} })
        const item = await storage.getItem('store')
        process.stdout.write('loaded\\n')
        await new Promise((resolve) => process.stdin.once('data', resolve))
        const key = { ...item.state.accessKeys[0], address: Hex.fromNumber(${i}, { size: 20 }) }
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
        import { Hex } from 'ox'
        import * as Storage from ${JSON.stringify(moduleUrl('src/cli/storage.ts'))}
        const storage = Storage.filesystem({ key: 'test', path: ${JSON.stringify(path)} })
        const accessKeys = Array.from({ length: 2_000 }, (_, i) => ({
          ...${JSON.stringify(key_1)},
          address: Hex.fromNumber(i, { size: 20 }),
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
