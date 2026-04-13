import { parseUnits } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { afterAll, beforeAll } from 'vp/test'

import { accounts, getClient, nodeEnv, rpcUrl, webAuthnAccounts } from './config.js'

const client = getClient()
const localnetSetupKey = '__accounts_localnet_setup__'

type SetupState = {
  promise?: Promise<void> | undefined
}

function getSetupState() {
  const globalState = globalThis as typeof globalThis & {
    [localnetSetupKey]?: SetupState | undefined
  }
  globalState[localnetSetupKey] ??= {}
  return globalState[localnetSetupKey]!
}

beforeAll(async () => {
  if (nodeEnv === 'localnet') {
    const state = getSetupState()
    if (state.promise) {
      await state.promise
      return
    }

    async function wait(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function withRetry(fn: () => Promise<void>) {
      let error: unknown
      for (let i = 0; i < 12; i++) {
        try {
          await fn()
          return
        } catch (e) {
          error = e
          const message = e instanceof Error ? e.message : String(e)
          const isTransientRpcError =
            message.includes('HTTP request failed') ||
            message.includes('request timed out') ||
            message.includes('eth_getBlockByNumber') ||
            message.includes('Bad Request')
          if (!isTransientRpcError) throw e
          await wait(200 * (i + 1))
        }
      }
      throw error
    }

    state.promise = (async () => {
      // Mint liquidity for fee tokens.
      for (const id of [1n, 2n, 3n])
        await withRetry(async () => {
          await Actions.amm.mintSync(client, {
            account: accounts[0],
            feeToken: Addresses.pathUsd,
            userTokenAddress: id,
            validatorTokenAddress: Addresses.pathUsd,
            validatorTokenAmount: parseUnits('1000', 6),
            to: accounts[0].address,
          })
        })

      // Fund first account for provider tests.
      await withRetry(async () => {
        await Actions.token.transferSync(client, {
          account: accounts[0],
          feeToken: Addresses.pathUsd,
          to: webAuthnAccounts[0].address,
          token: Addresses.pathUsd,
          amount: parseUnits('100', 6),
        })
      })
    })()
    await state.promise

    return
  }

  await Actions.faucet.fundSync(client, {
    account: accounts[0].address,
  })
}, 120_000)

afterAll(async () => {
  if (nodeEnv !== 'localnet') return
  await fetch(`${rpcUrl}/stop`)
})
