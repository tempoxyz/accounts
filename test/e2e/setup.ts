/**
 * Playwright's global setup. It starts the suite's Tempo nodes and Tempo ID, or checks the ones that
 * `TEMPO_RPC_URL`, `TEMPO_SECOND_RPC_URL`, and `TEMPO_ID_URL` name, and stops what it started when
 * the run ends. The `tempoApi` fixture of `Playwright.ts` starts the Tempo API, only for the tests
 * that read it.
 * @module
 */
import { privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as TempoId from '../TempoId.js'

/**
 * Starts the nodes and Tempo ID together, since Tempo ID reads a node only at a request. Funds the
 * fee payer of the backend test app and the payee of the MPP test app once the nodes serve. Returns
 * the teardown.
 */
export default async function setup() {
  const started = await Promise.allSettled([
    Chain.start().then(async (chain) => {
      // Each test of a relay route spends the fee payer's balance, and each close of a session and
      // each charge of a subscription spends the payee's, so one funding of each serves the run.
      await Promise.all(
        [Apps.backend.feePayer, Apps.mpp.payee].map((privateKey) =>
          Chain.fund({ address: privateKeyToAddress(privateKey) }),
        ),
      ).catch(async (error: unknown) => {
        await chain.stop()
        throw error
      })
      return chain
    }),
    TempoId.start({ apps: Apps.registrations, resources: Apps.resources }),
  ])
  const stop = async () => {
    for (const result of started.toReversed())
      if (result.status === 'fulfilled') await result.value.stop()
  }
  const failed = started.find((result) => result.status === 'rejected')
  if (failed) {
    await stop()
    throw failed.reason
  }

  return stop
}
