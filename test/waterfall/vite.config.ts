/**
 * Runs Tempo ID's integration suite with the waterfall's plugin, which records each action of the
 * `accounts` submodule. `scripts/waterfall.ts` passes it to `vp test` in Tempo ID's checkout, with
 * `TEMPO_ID_DIR`, and Tempo ID's own `vite.config.ts` holds the rest of the suite's config.
 * @module
 */
import * as Path from 'node:path'
import { loadConfigFromFile, mergeConfig } from 'vite-plus'
import * as Transform from './Transform.js'

const root = process.env.TEMPO_ID_DIR
if (!root)
  throw new Error(
    'TEMPO_ID_DIR is not set. Run the waterfall with `pnpm waterfall`.',
  )

const loaded = await loadConfigFromFile(
  { command: 'serve', mode: 'test' },
  Path.join(root, 'vite.config.ts'),
  root,
)
if (!loaded)
  throw new Error(
    `No vite.config.ts in ${root}. Set TEMPO_ID_DIR to Tempo ID's checkout.`,
  )

// Each project of Tempo ID's config extends the root, so it receives the plugin.
export default mergeConfig(loaded.config, {
  plugins: [Transform.plugin()],
  root,
})
