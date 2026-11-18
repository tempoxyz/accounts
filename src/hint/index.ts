/**
 * The entry of the session hint, which imports no other module. A page reads the hint at startup,
 * and loads `accounts` only for a returning visitor.
 *
 * @example
 * ```ts
 * import { Hint } from 'accounts/hint'
 *
 * if (Hint.has(document.cookie)) await import('./tempo.config.js')
 * ```
 * @module
 */
export * as Hint from '../internal/Hint.js'
