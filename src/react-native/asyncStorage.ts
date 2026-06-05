import { Json } from 'ox'

import * as Storage from '../core/Storage.js'

/** Creates a storage adapter backed by `@react-native-async-storage/async-storage`. */
export function asyncStorage(options: asyncStorage.Options = {}): Storage.Storage {
  return Storage.from(
    {
      async getItem(name) {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        const raw = await AsyncStorage.getItem(name)
        if (raw === null) return null
        try {
          return Json.parse(raw)
        } catch {
          return null
        }
      },
      async setItem(name, value) {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        await AsyncStorage.setItem(name, Json.stringify(value))
      },
      async removeItem(name) {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        await AsyncStorage.removeItem(name)
      },
    },
    options,
  )
}

export declare namespace asyncStorage {
  /** Options for `asyncStorage`. */
  type Options = Storage.from.Options
}
