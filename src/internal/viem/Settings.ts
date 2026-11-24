/**
 * The key of `accounts.viem` that returns the `viem` plugin's chains and transports. The `mpp`,
 * `relay`, `siwe`, and `tokens` plugins, the `wagmi` connector, and the instance's guest payments
 * read it. The module holds no code of the plugin, so the instance reads the key without the plugin
 * in its bundle.
 * @module
 */

/**
 * The key of `accounts.viem` that returns the plugin's `viem.Settings`. The entries of the package
 * do not export it, so only the package's own modules read it.
 *
 * @example
 * ```ts
 * const settings = (accounts.viem as Record<symbol, unknown>)[Settings.key] as viem.Settings
 * ```
 */
export const key = Symbol('viem.settings')
