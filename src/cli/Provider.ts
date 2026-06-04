import * as CoreProvider from '../core/Provider.js'
import { cli } from './adapter.js'
import * as Storage from './storage.js'

/**
 * Creates a provider that bootstraps access-key authorization through the CLI
 * device-code flow.
 */
export function create(options: create.Options): create.ReturnType {
  const {
    host = 'https://wallet.tempo.xyz/api/auth/cli',
    open,
    pollIntervalMs,
    storage = Storage.filesystem(),
    timeoutMs,
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
      ...(typeof pollIntervalMs !== 'undefined' ? { pollIntervalMs } : {}),
      ...(typeof timeoutMs !== 'undefined' ? { timeoutMs } : {}),
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
    /** Host URL for the device-code flow. @default "https://wallet.tempo.xyz/api/auth/cli" */
    host?: string | undefined
  }
  export type ReturnType = CoreProvider.create.ReturnType
}
