import _hosts from '../trusted-hosts.json' with { type: 'json' }

/**
 * Trusted host mappings for dialog adapters.
 *
 * Each key is a dialog host (e.g. `tempo.xyz`), and its value is the
 * list of third-party origins that the dialog trusts to embed it.
 * Supports wildcard patterns (e.g. `*.workers.dev`).
 */
export const hosts: Record<string, readonly string[]> = _hosts

/**
 * Returns `true` if `hostname` matches any pattern in `trustedHosts`,
 * or (when `source` is provided) if `hostname` shares the same
 * registrable domain ("eTLD+1") as `source`.
 *
 * Patterns starting with `*.` match any subdomain suffix
 * (e.g. `*.workers.dev` matches `foo.workers.dev`).
 */
export function match(trustedHosts: readonly string[], hostname: string, source?: string) {
  if (source && sameRegistrableDomain(hostname, source)) return true
  return trustedHosts.some((pattern) => {
    if (pattern.startsWith('*.'))
      return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1
    return pattern === hostname
  })
}

/** Returns `true` if `a` and `b` share the same registrable domain ("eTLD+1"). */
export function sameRegistrableDomain(a: string, b: string) {
  return registrableDomain(a) === registrableDomain(b)
}

/** Returns the registrable domain ("eTLD+1") for a hostname. */
function registrableDomain(host: string) {
  const hostname = host.split(':')[0]!.toLowerCase()
  const labels = hostname.split('.')
  if (labels.length <= 2) return hostname
  return labels.slice(-2).join('.')
}
