import * as SecureStore from 'expo-secure-store'

const key_name = 'tempo.mmkvEncryptionKey'
const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Loads or creates the key used to encrypt an MMKV-backed SDK storage instance. */
export async function getOrCreateMmkvEncryptionKey(
  options: getOrCreateMmkvEncryptionKey.Options = {},
): Promise<string> {
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
    store?: SecureStore.SecureStoreOptions | undefined
  }
}

function createKey(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i]! % charset.length]
  return out
}
