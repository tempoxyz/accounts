import * as CoreProvider from '../core/Provider.js'
import * as Storage from '../core/Storage.js'
import { reactNative } from './adapter.js'
import { secureStorage } from './storage.js'

/** Creates a provider for React Native apps using Wata mobile web auth. */
export function create(options: create.Options): create.ReturnType {
  const {
    baseUrl,
    fetch,
    host = 'https://wallet.tempo.xyz',
    open,
    openAuthSession,
    redirectUri,
    ...rest
  } = options

  return CoreProvider.create({
    storage: defaultStorage(),
    ...rest,
    adapter: reactNative({
      baseUrl,
      ...(fetch ? { fetch } : {}),
      host,
      ...(open ? { open } : {}),
      ...(openAuthSession ? { openAuthSession } : {}),
      redirectUri,
    }),
  })
}

function defaultStorage(): Storage.Storage {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative')
    return secureStorage()
  return Storage.memory()
}

export declare namespace create {
  export type Options = Omit<
    CoreProvider.create.Options & reactNative.Options,
    'adapter' | 'host'
  > & {
    /** Host discovery origin or preloaded Wata host document. @default "https://wallet.tempo.xyz" */
    host?: reactNative.Options['host'] | undefined
  }
  export type ReturnType = CoreProvider.create.ReturnType
}
