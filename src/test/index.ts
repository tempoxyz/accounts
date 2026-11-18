/**
 * The entry of the plugins for end-to-end tests, which sign in with no request to Tempo ID. Use it
 * only in test builds.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import * as test from 'accounts/test'
 *
 * const accounts = Accounts.create({ plugins: [test.dialog()] })
 * ```
 * @module
 */
export { dialog } from './dialog.js'
