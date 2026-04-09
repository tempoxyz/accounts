import * as CoreProvider from '../core/Provider.js'
import { cli } from './adapter.js'
/**
 * Creates a provider that bootstraps access-key authorization through the CLI
 * device-code flow.
 */
export function create(options) {
  const {
    host = 'https://wallet.tempo.xyz/embed/cli-auth',
    keysPath,
    open,
    pollIntervalMs,
    timeoutMs,
    ...rest
  } = options
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
//# sourceMappingURL=Provider.js.map
