import * as CoreProvider from '../core/Provider.js'
import { cli } from './adapter.js'
import * as Storage from './storage.js'

/**
 * Creates a provider that bootstraps access-key authorization through the CLI
 * device-code flow.
 */
export function create(options: create.Options): create.ReturnType {
  const {
    host = 'https://wallet.tempo.xyz/auth/device',
    open,
    pollingInterval,
    storage = Storage.filesystem(),
    timeout,
    ...rest
  } = options

  // CLI defaults `mode` to `'pull'` (local account friendly path).
  const mpp = (() => {
    if (!options.mpp) return undefined
    if (typeof options.mpp === 'object') return { mode: 'pull' as const, ...options.mpp }
    return { mode: 'pull' as const }
  })()

  return CoreProvider.create({
    ...rest,
    adapter: cli({
      host,
      ...(open ? { open } : {}),
      ...(pollingInterval !== undefined ? { pollingInterval } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    }),
    ...(mpp ? { mpp } : {}),
    storage,
  })
}

export declare namespace create {
  export type Options = Omit<
    CoreProvider.create.Options & cli.Options,
    'adapter' | 'authorizeAccessKey' | 'host'
  > & {
    /** Base URL of the wallet's device-code endpoints. @default "https://wallet.tempo.xyz/auth/device" */
    host?: string | undefined
  }
  export type ReturnType = CoreProvider.create.ReturnType
}
