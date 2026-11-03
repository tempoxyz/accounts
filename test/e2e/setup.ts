/**
 * Global setup of `pnpm test:e2e`: the Tempo ID checkout, its harness's global setup, the local
 * Tempo node, and the Tempo API, until the run ends. Returns the teardown.
 * @module
 */
import * as Id from '../id.js'

/** Prepares the checkout and starts its services. Returns the teardown. */
export default function setup() {
  return Id.setup({ chain: true })
}
