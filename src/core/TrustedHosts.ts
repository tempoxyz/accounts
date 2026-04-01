/**
 * Trusted host mappings for dialog adapters.
 *
 * Each key is a dialog host (e.g. `tempo.xyz`), and its value is the
 * list of third-party origins that the dialog trusts to embed it.
 */
export const hosts = {
  'tempo.xyz': [
    'localhost',
    'promptgolf.sh',
    'app.polyhedge.capital',
    'tempodex.vercel.app',
    'currencycompetition.com',
    'tempai.town',
    'print-a-tshirt.com',
  ],
} as const satisfies Record<string, readonly string[]>
