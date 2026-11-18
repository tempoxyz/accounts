/**
 * Writes the proof of a run of the end-to-end suite that CI split into shards.
 *
 * Each shard runs the suite with `E2E_SHARD`, and its reporter saves the shard's part to
 * `test/e2e/proof`. The script merges every part there into `e2e-proof.html` and `summary.md`. A run
 * that lacks a shard states that in both files. The script imports only Node built-ins, so it runs
 * without an install.
 *
 * ```sh
 * node scripts/e2e-proof.ts
 * ```
 *
 * @module
 */
import * as Proof from '../test/Proof.ts'

Proof.write(Proof.merge({ shards: Proof.load() }))
