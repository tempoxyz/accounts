import * as CoreProvider from '../core/Provider.js'
import * as Storage from '../core/Storage.js'
import { reactNative } from './adapter.js'
import { asyncStorage, secureStorage } from './storage.js'

/** Creates a provider for React Native apps using system browser authentication. */
export function create(options: create.Options): create.ReturnType {
  const { host = 'https://wallet.tempo.xyz', id, name, open, rdns, redirectUri, ...rest } = options
  const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative'

  return CoreProvider.create({
    keyMaterialStorage: isReactNative ? secureStorage() : undefined,
    storage: isReactNative ? asyncStorage() : Storage.memory(),
    ...rest,
    adapter: reactNative({
      host,
      redirectUri,
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(open ? { open } : {}),
      ...(rdns ? { rdns } : {}),
    }),
  })
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
