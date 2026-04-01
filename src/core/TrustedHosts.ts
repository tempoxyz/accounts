/**
 * Trusted host mappings for dialog adapters.
 *
 * Each key is a dialog host (e.g. `tempo.xyz`), and its value is the
 * list of third-party origins that the dialog trusts to embed it.
 * Supports wildcard patterns (e.g. `*.workers.dev`).
 */
export const hosts = {
  'tempo.xyz': [
    'localhost',
    '*.tempo.xyz',
    'promptgolf.sh',
    'app.polyhedge.capital',
    'tempodex.vercel.app',
    'currencycompetition.com',
    'tempai.town',
    'print-a-tshirt.com',
    '*.porto.workers.dev',
  ],
} as const satisfies Record<string, readonly string[]>

/**
 * Returns `true` if `hostname` matches any pattern in `trustedHosts`.
 * Patterns starting with `*.` match any subdomain suffix
 * (e.g. `*.workers.dev` matches `foo.workers.dev`).
 */
export function match(trustedHosts: readonly string[], hostname: string) {
  return trustedHosts.some((pattern) => {
    if (pattern.startsWith('*.'))
      return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1
    return pattern === hostname
  })
}
