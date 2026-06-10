import { vi } from 'vitest'
import { beforeEach, describe, expect, test } from 'vp/test'

const mmkv_mock = vi.hoisted(() => ({
  instances: [] as {
    configuration: Record<string, unknown>
    store: Map<string, string>
  }[],
  stores: new Map<string, Map<string, string>>(),
}))

const secure_store_mock = vi.hoisted(() => ({
  fail_once: false,
  get_calls: [] as unknown[][],
  items: new Map<string, string>(),
  set_calls: [] as unknown[][],
}))

vi.mock('react-native-mmkv', () => ({
  createMMKV(configuration: Record<string, unknown>) {
    const id = String(configuration.id)
    const store = mmkv_mock.stores.get(id) ?? new Map<string, string>()
    mmkv_mock.stores.set(id, store)
    mmkv_mock.instances.push({ configuration, store })
    return {
      getString: (name: string) => store.get(name),
      remove: (name: string) => {
        store.delete(name)
      },
      set: (name: string, value: string) => {
        store.set(name, value)
      },
    }
  },
}))

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync(name: string, store: unknown) {
    if (secure_store_mock.fail_once) {
      secure_store_mock.fail_once = false
      return Promise.reject(new Error('keychain unavailable'))
    }
    secure_store_mock.get_calls.push([name, store])
    return Promise.resolve(secure_store_mock.items.get(name) ?? null)
  },
  setItemAsync(name: string, value: string, store: unknown) {
    secure_store_mock.set_calls.push([name, value, store])
    secure_store_mock.items.set(name, value)
    return Promise.resolve()
  },
}))

import { secureMmkv } from './secureMmkv.js'

beforeEach(() => {
  mmkv_mock.instances.length = 0
  mmkv_mock.stores.clear()
  secure_store_mock.fail_once = false
  secure_store_mock.get_calls.length = 0
  secure_store_mock.items.clear()
  secure_store_mock.set_calls.length = 0
  vi.stubGlobal('crypto', {
    getRandomValues(bytes: Uint8Array) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = i
      return bytes
    },
  })
})

describe('secureMmkv', () => {
  test('default: creates an encrypted tempo-secure MMKV storage with a SecureStore key', async () => {
    const storage = secureMmkv()

    await storage.setItem('store', { count: 1n })

    expect(mmkv_mock.instances[0]?.configuration).toMatchInlineSnapshot(`
      {
        "encryptionKey": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX",
        "encryptionType": "AES-256",
        "id": "tempo-secure",
      }
    `)
    expect(mmkv_mock.instances[0]?.store.get('tempo.store')).toMatchInlineSnapshot(
      `"{"count":"1#__bigint"}"`,
    )
    expect(secure_store_mock.set_calls).toMatchInlineSnapshot(`
      [
        [
          "tempo.mmkvEncryptionKey",
          "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX",
          {
            "keychainAccessible": 1,
          },
        ],
      ]
    `)
    expect(await storage.getItem('store')).toMatchInlineSnapshot(`
      {
        "count": 1n,
      }
    `)
  })

  test('behavior: scopes keys and removes values', async () => {
    const storage = secureMmkv({ encryptionKey: 'a'.repeat(32), key: 'wallet' })

    await storage.setItem('store', { ok: true })
    await storage.removeItem('store')

    expect(mmkv_mock.instances[0]?.store).toMatchInlineSnapshot(`Map {}`)
  })

  test('behavior: malformed values read as null', async () => {
    const storage = secureMmkv({ encryptionKey: 'a'.repeat(32) })
    await storage.setItem('other', { ok: true })
    mmkv_mock.instances[0]?.store.set('tempo.store', '{')

    expect(await storage.getItem('store')).toMatchInlineSnapshot(`null`)
  })

  test('behavior: retries MMKV creation after an encryption key failure', async () => {
    const storage = secureMmkv()
    secure_store_mock.fail_once = true

    await expect(storage.getItem('store')).rejects.toThrow('keychain unavailable')

    await storage.setItem('store', { ok: true })
    expect(await storage.getItem('store')).toMatchInlineSnapshot(`
      {
        "ok": true,
      }
    `)
  })

  test('behavior: forwards custom MMKV options', async () => {
    const storage = secureMmkv({
      compareBeforeSet: true,
      encryptionKey: 'a'.repeat(32),
      encryptionType: 'AES-128',
      id: 'custom',
      mode: 'multi-process',
      path: '/tmp/mmkv',
      readOnly: true,
    })
    await storage.getItem('store')

    expect(mmkv_mock.instances[0]?.configuration).toMatchInlineSnapshot(`
      {
        "compareBeforeSet": true,
        "encryptionKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "encryptionType": "AES-128",
        "id": "custom",
        "mode": "multi-process",
        "path": "/tmp/mmkv",
        "readOnly": true,
      }
    `)
  })
})
