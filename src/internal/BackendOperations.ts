/**
 * The key of the `backend` namespace that holds its sessions' operations. The `siwe` plugin, and the
 * instance's `session.get(request)` and `session.fetch(request, parameters)`, call them. The module
 * holds no code of the plugin, so the instance reads the key without the plugin in its bundle.
 * @module
 */

/**
 * The key of the operations on the `backend` namespace. The entries of the package do not export
 * it, so only the package's own modules read it.
 *
 * @example
 * ```ts
 * const operations = accounts.backend[BackendOperations.key] as backend.Operations
 * ```
 */
export const key = Symbol('backend.operations')

/**
 * The key of the configuration property that holds the store of `backend({ store })`. The `viem`
 * actions read it, from the `viem` plugin or another plugin that builds them, such as `mpp`, and
 * keep their marks of registered access keys there when the instance has no `store`.
 *
 * @example
 * ```ts
 * const store = (config as Record<symbol, unknown>)[BackendOperations.store] as Store | undefined
 * ```
 */
export const store = Symbol('backend.store')

/**
 * The key of the `siwe` namespace that holds the plugin's settings that its routes read: its
 * `origin`, and whether they hand the session to the page as a token.
 *
 * @example
 * ```ts
 * const settings = (accounts.siwe as Record<symbol, unknown>)[BackendOperations.siwe] as siwe.Settings
 * ```
 */
export const siwe = Symbol('siwe.settings')
