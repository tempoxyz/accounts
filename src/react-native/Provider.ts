import * as CoreProvider from '../core/Provider.js'
import * as Storage from '../core/Storage.js'
import { reactNative } from './adapter.js'
import { asyncStorage } from './storage.js'

/** Creates a provider for React Native apps using system browser authentication. */
export function create(options: create.Options): create.ReturnType {
  const { host = 'https://wallet.tempo.xyz', redirectUri, open, secureStorage, ...rest } = options

  return CoreProvider.create({
    storage: defaultStorage(),
    ...rest,
    adapter: reactNative({
      host,
      redirectUri,
      ...(open ? { open } : {}),
      ...(secureStorage ? { secureStorage } : {}),
    }),
  })
}

function defaultStorage(): Storage.Storage {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') return asyncStorage()
  return Storage.memory()
}

export declare namespace create {
  export type Options = Omit<
    CoreProvider.create.Options & reactNative.Options,
    'adapter' | 'host'
  > & {
    /** Host URL for the mobile auth page. @default "https://wallet.tempo.xyz" */
    host?: string | undefined
  }
  export type ReturnType = CoreProvider.create.ReturnType
}
