/**
 * Global setup of `pnpm test:integration`: the Tempo ID checkout and its harness's global setup,
 * whose environment the test files inherit. Returns the teardown.
 * @module
 */
import type { TestProject } from 'vite-plus/test/node'
import * as Id from './id.js'

/** Prepares the checkout and runs its global setup. Returns the teardown. */
export default function setup(project: TestProject) {
  return Id.setup({ project })
}
