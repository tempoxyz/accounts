import { vi } from 'vitest'
import { beforeEach, describe, expect, test } from 'vp/test'

type Mock = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: number
  get_calls: unknown[][]
  items: Map<string, string>
  set_calls: unknown[][]
}

type Global = typeof globalThis & {
  __tempo_secure_store_mock?: Mock | undefined
}

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

import { getOrCreateMmkvEncryptionKey } from './expoSecureStore.js'

const mock = (globalThis as Global).__tempo_secure_store_mock!

beforeEach(() => {
  mock.get_calls.length = 0
  mock.items.clear()
  mock.set_calls.length = 0
  vi.stubGlobal('crypto', {
    getRandomValues(bytes: Uint8Array) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = i
      return bytes
    },
  })
})

describe('getOrCreateMmkvEncryptionKey', () => {
  test('default: returns an existing key', async () => {
    mock.items.set('tempo.mmkvEncryptionKey', 'existing')

    await expect(getOrCreateMmkvEncryptionKey()).resolves.toMatchInlineSnapshot(`"existing"`)
    expect(mock.set_calls).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: creates and stores a key when one does not exist', async () => {
    await expect(getOrCreateMmkvEncryptionKey()).resolves.toMatchInlineSnapshot(
      `"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"`,
    )
    expect(mock.get_calls).toMatchInlineSnapshot(`
      [
        [
          "tempo.mmkvEncryptionKey",
          {
            "keychainAccessible": 1,
          },
        ],
      ]
    `)
    expect(mock.set_calls).toMatchInlineSnapshot(`
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
  })

  test('behavior: accepts a custom key name and SecureStore options', async () => {
    await getOrCreateMmkvEncryptionKey({
      name: 'custom',
      store: { keychainService: 'wallet' },
    })

    expect(mock.get_calls[0]).toMatchInlineSnapshot(`
      [
        "custom",
        {
          "keychainService": "wallet",
        },
      ]
    `)
  })
})
