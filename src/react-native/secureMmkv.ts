import { Json } from 'ox'
import { createMMKV, type Configuration } from 'react-native-mmkv'

import * as Storage from '../core/Storage.js'
import { getOrCreateMmkvEncryptionKey } from './expoSecureStore.js'

/** Creates an encrypted storage adapter backed by `react-native-mmkv`. */
export function secureMmkv(options: secureMmkv.Options = {}): Storage.Storage {
  let mmkv: ReturnType<typeof createMMKV> | undefined
  let pending: Promise<ReturnType<typeof createMMKV>> | undefined

  async function getMmkv() {
    if (mmkv) return mmkv
    pending ??= create(options)
      .then((value) => {
        mmkv = value
        return value
      })
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return pending
  }

  return Storage.from(
    {
      async getItem(name) {
        const mmkv = await getMmkv()
        const raw = mmkv.getString(name)
        if (raw == null) return null
        try {
          return Json.parse(raw)
        } catch {
          return null
        }
      },
      async setItem(name, value) {
        const mmkv = await getMmkv()
        mmkv.set(name, Json.stringify(value))
      },
      async removeItem(name) {
        const mmkv = await getMmkv()
        mmkv.remove(name)
      },
    },
    options,
  )
}

export declare namespace secureMmkv {
  /** Options for `secureMmkv`. */
  type Options = Storage.from.Options & {
    /** MMKV instance id. @default "tempo-secure" */
    id?: string | undefined
    /** MMKV root path. */
    path?: string | undefined
    /** MMKV encryption key. Defaults to a key loaded from Expo SecureStore. */
    encryptionKey?: string | undefined
    /** MMKV encryption type. @default "AES-256" */
    encryptionType?: Configuration['encryptionType'] | undefined
    /** MMKV process mode. */
    mode?: Configuration['mode'] | undefined
    /** Whether the MMKV instance is read-only. */
    readOnly?: boolean | undefined
    /** Whether MMKV should skip writes when the value is unchanged. */
    compareBeforeSet?: boolean | undefined
  }
}

async function create(options: secureMmkv.Options): Promise<ReturnType<typeof createMMKV>> {
  const encryption_key = options.encryptionKey ?? (await getOrCreateMmkvEncryptionKey())
  const configuration: Configuration = { id: options.id ?? 'tempo-secure' }
  if (options.path) configuration.path = options.path
  configuration.encryptionKey = encryption_key
  configuration.encryptionType = options.encryptionType ?? 'AES-256'
  if (options.mode) configuration.mode = options.mode
  if (options.readOnly !== undefined) configuration.readOnly = options.readOnly
  if (options.compareBeforeSet !== undefined)
    configuration.compareBeforeSet = options.compareBeforeSet
  return createMMKV(configuration)
}
