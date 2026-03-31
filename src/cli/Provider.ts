import * as CoreProvider from '../core/Provider.js'
import { cli } from './adapter.js'

/**
 * Creates a provider that bootstraps access-key authorization through the CLI
 * device-code flow.
 */
export function create(options: create.Options): create.ReturnType {
  const { host, keysPath, open, pollIntervalMs, timeoutMs, ...rest } = options

  return CoreProvider.create({
    ...rest,
    adapter: cli({
      host,
      ...(keysPath ? { keysPath } : {}),
      ...(open ? { open } : {}),
      ...(typeof pollIntervalMs !== 'undefined' ? { pollIntervalMs } : {}),
      ...(typeof timeoutMs !== 'undefined' ? { timeoutMs } : {}),
    }),
  })
}

export declare namespace create {
  export type Options = Omit<CoreProvider.create.Options, 'adapter' | 'authorizeAccessKey'> &
    cli.Options
  export type ReturnType = CoreProvider.create.ReturnType
}
