/**
 * Trusted host mappings for dialog adapters.
 *
 * Each key is a dialog host (e.g. `tempo.xyz`), and its value is the
 * list of third-party origins that the dialog trusts to embed it.
 * Supports wildcard patterns (e.g. `*.workers.dev`).
 */
export declare const hosts: Record<string, readonly string[]>
/**
 * Returns `true` if `hostname` matches any pattern in `trustedHosts`.
 * Patterns starting with `*.` match any subdomain suffix
 * (e.g. `*.workers.dev` matches `foo.workers.dev`).
 */
export declare function match(trustedHosts: readonly string[], hostname: string): boolean
//# sourceMappingURL=TrustedHosts.d.ts.map
