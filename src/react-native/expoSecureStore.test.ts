import { vi } from 'vitest'
import { beforeEach, describe, expect, test } from 'vp/test'

const mock = vi.hoisted(() => ({
  get_calls: [] as unknown[][],
  items: new Map<string, string>(),
  set_calls: [] as unknown[][],
}))

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync(name: string, store: unknown) {
    mock.get_calls.push([name, store])
    return Promise.resolve(mock.items.get(name) ?? null)
  },
  setItemAsync(name: string, value: string, store: unknown) {
    mock.set_calls.push([name, value, store])
    mock.items.set(name, value)
    return Promise.resolve()
  },
}))

import { getOrCreateMmkvEncryptionKey } from './expoSecureStore.js'

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
      `"AAECAwQFBgcICQoLDA0ODxAREhMUFRYX"`,
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
          "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX",
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
