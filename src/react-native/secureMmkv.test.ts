import { vi } from 'vitest'
import { beforeEach, describe, expect, test } from 'vp/test'

type MmkvMock = {
  instances: {
    configuration: Record<string, unknown>
    store: Map<string, string>
  }[]
  stores: Map<string, Map<string, string>>
}

type SecureStoreMock = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: number
  get_calls: unknown[][]
  items: Map<string, string>
  set_calls: unknown[][]
}

type Global = typeof globalThis & {
  __tempo_mmkv_mock?: MmkvMock | undefined
  __tempo_secure_store_mock?: SecureStoreMock | undefined
}

vi.mock('react-native-mmkv', () => {
  const root = globalThis as Global
  root.__tempo_mmkv_mock ??= {
    instances: [],
    stores: new Map<string, Map<string, string>>(),
  }
  return {
    createMMKV(configuration: Record<string, unknown>) {
      const id = String(configuration.id)
      const store = root.__tempo_mmkv_mock!.stores.get(id) ?? new Map<string, string>()
      root.__tempo_mmkv_mock!.stores.set(id, store)
      root.__tempo_mmkv_mock!.instances.push({ configuration, store })
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
  }
})

vi.mock('expo-secure-store', () => {
  const root = globalThis as Global
  root.__tempo_secure_store_mock ??= {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    get_calls: [],
    items: new Map<string, string>(),
    set_calls: [],
  }
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      root.__tempo_secure_store_mock.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    getItemAsync(name: string, store: unknown) {
      root.__tempo_secure_store_mock!.get_calls.push([name, store])
      return Promise.resolve(root.__tempo_secure_store_mock!.items.get(name) ?? null)
    },
    setItemAsync(name: string, value: string, store: unknown) {
      root.__tempo_secure_store_mock!.set_calls.push([name, value, store])
      root.__tempo_secure_store_mock!.items.set(name, value)
      return Promise.resolve()
    },
  }
})

import { secureMmkv } from './secureMmkv.js'

const mmkv_mock = (globalThis as Global).__tempo_mmkv_mock!
const secure_store_mock = (globalThis as Global).__tempo_secure_store_mock!

beforeEach(() => {
  mmkv_mock.instances.length = 0
  mmkv_mock.stores.clear()
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
        "encryptionKey": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
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
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
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
