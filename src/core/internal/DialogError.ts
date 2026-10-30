import * as Dialog from '../Dialog.js'

/** Recover safe dialog diagnostics before Ox reparses a viem wrapper and drops its cause. */
export function parse(error: unknown): unknown {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 10; depth++) {
    const candidate = current as { cause?: unknown; code?: unknown; data?: unknown }
    const data = candidate.data
    if (candidate.code === -32000 && data && typeof data === 'object') {
      const { origin, stage } = data as { origin?: unknown; stage?: unknown }
      if (
        typeof origin === 'string' &&
        (stage === 'dialog_ready' || stage === 'dispatch' || stage === 'closed')
      )
        try {
          // Rebuild rather than retain the wrapper's message, request details or raw cause.
          return new Dialog.TransportError(origin, stage)
        } catch {}
    }
    current = candidate.cause
  }
  return error
}
