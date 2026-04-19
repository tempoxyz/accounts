import * as CoreProvider from '../core/Provider.js'
import { reactNative } from './adapter.js'

/** Creates a provider for React Native apps using system browser authentication. */
export function create(options: create.Options): create.ReturnType {
  const { host = 'https://wallet-next.tempo.xyz', redirectUri, open, secureStorage, ...rest } = options

  return CoreProvider.create({
    ...rest,
    adapter: reactNative({
      host,
      redirectUri,
      ...(open ? { open } : {}),
      ...(secureStorage ? { secureStorage } : {}),
    }),
  })
}

export declare namespace create {
  export type Options = Omit<
    CoreProvider.create.Options & reactNative.Options,
    'adapter' | 'host'
  > & {
    /** Host URL for the mobile auth page. @default "https://wallet-next.tempo.xyz" */
    host?: string | undefined
  }
  export type ReturnType = CoreProvider.create.ReturnType
}
