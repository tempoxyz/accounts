/**
 * The entry of the built-in plugins, each of which adds a namespace to an instance. Each plugin is
 * a module of its own, so a bundle holds only the plugins that an app imports.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { email, passkey, viem } from 'accounts/plugins'
 *
 * const tempoId = Accounts.create({ plugins: [email(), passkey(), viem({ chain: tempo })] })
 * ```
 * @module
 */
export { backend } from './backend.js'
export { device } from './device.js'
export { dialog } from './dialog.js'
export { email } from './email.js'
export { funding } from './funding.js'
export { passkey } from './passkey.js'
export { redirect } from './redirect.js'
export { relay } from './relay.js'
export { viem } from './viem.js'
