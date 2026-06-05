import { Json } from 'ox'

import * as Storage from '../core/Storage.js'

/** Creates a storage adapter backed by `expo-secure-store`. */
export function secureStorage(options: secureStorage.Options = {}): Storage.Storage {
  return Storage.from(
    {
      async getItem(name) {
        const { getItemAsync } = await import('expo-secure-store')
        const raw = await getItemAsync(name)
        if (raw === null) return null
        try {
          return Json.parse(raw)
        } catch {
          return null
        }
      },
      async setItem(name, value) {
        const { setItemAsync } = await import('expo-secure-store')
        await setItemAsync(name, Json.stringify(value))
      },
      async removeItem(name) {
        const { deleteItemAsync } = await import('expo-secure-store')
        await deleteItemAsync(name)
      },
    },
    options,
  )
}

export declare namespace secureStorage {
  /** Options for `secureStorage`. */
  type Options = Storage.from.Options
}
