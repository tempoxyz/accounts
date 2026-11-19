/**
 * The entry of `accounts` without default plugins. Its `Accounts.create` adds no `dialog`,
 * `funding`, or `mpp` plugin, so an app bundles only the plugins that it names, such as from
 * `accounts/plugins` and `accounts/mpp`. The other modules are the root entry's.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts/lite'
 * import { dialog } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ plugins: [dialog()] })
 * ```
 * @module
 */
export * as AccessToken from '../AccessToken.js'
export * as Accounts from '../Accounts.js'
export * as Challenge from '../Challenge.js'
export * as LogoutToken from '../LogoutToken.js'
export * as Permissions from '../Permissions.js'
export * as Plugin from '../Plugin.js'
export * as Session from '../Session.js'
export * as Store from '../Store.js'
