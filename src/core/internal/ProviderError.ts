import { Provider as ox_Provider } from 'ox'
import { BaseError } from 'viem'

/**
 * Recovers an EIP-1193 provider error (e.g. a `4001` user rejection) that a viem action wrapped
 * before Ox reparses it. viem's `sendTransaction` wraps a wallet's error in a
 * `TransactionExecutionError`, which has no code, so Ox would report the rejection as an internal
 * error (`-32603`).
 */
export function parse(error: unknown): unknown {
  if (!(error instanceof BaseError) || typeof (error as { code?: unknown }).code === 'number')
    return error
  let current = error.cause
  for (let depth = 0; current && typeof current === 'object' && depth < 10; depth++) {
    const candidate = current as { cause?: unknown; code?: unknown }
    // Only the first coded error names the failure; deeper causes explain it.
    if (typeof candidate.code === 'number')
      return ox_Provider.parseError(candidate) instanceof ox_Provider.ProviderRpcError
        ? candidate
        : error
    current = candidate.cause
  }
  return error
}
