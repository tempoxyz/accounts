import type * as SecureStoreTypes from 'expo-secure-store'
import { Base64, Bytes } from 'ox'

const key_name = 'tempo.mmkvEncryptionKey'

/** Loads or creates the key used to encrypt an MMKV-backed SDK storage instance. */
export async function getOrCreateMmkvEncryptionKey(
  options: getOrCreateMmkvEncryptionKey.Options = {},
): Promise<string> {
  const SecureStore = await import('expo-secure-store')
  const name = options.name ?? key_name
  const store = options.store ?? {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  }
  const existing = await SecureStore.getItemAsync(name, store)
  if (existing) return existing
  const key = createKey()
  await SecureStore.setItemAsync(name, key, store)
  return key
}

export declare namespace getOrCreateMmkvEncryptionKey {
  /** Options for `getOrCreateMmkvEncryptionKey`. */
  type Options = {
    /** SecureStore item name. @default "tempo.mmkvEncryptionKey" */
    name?: string | undefined
    /** SecureStore options used for reading and writing the key. */
    store?: SecureStoreTypes.SecureStoreOptions | undefined
  }
}

// 24 random bytes encode to 32 base64 characters, MMKV's maximum AES-256 key length.
function createKey(): string {
  return Base64.fromBytes(Bytes.random(24))
}
