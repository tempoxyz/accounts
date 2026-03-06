import { parseUnits } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { afterAll, beforeAll } from 'vitest'

import { accounts, getClient, nodeEnv, rpcUrl, webAuthnAccounts } from './config.js'

const client = getClient()

beforeAll(async () => {
  if (nodeEnv === 'localnet') {
    // Mint liquidity for fee tokens.
    await Promise.all(
      [1n, 2n, 3n].map((id) =>
        Actions.amm.mintSync(client, {
          account: accounts[0],
          feeToken: Addresses.pathUsd,
          nonceKey: 'expiring',
          userTokenAddress: id,
          validatorTokenAddress: Addresses.pathUsd,
          validatorTokenAmount: parseUnits('1000', 6),
          to: accounts[0].address,
        }),
      ),
    )

    // Fund first webAuthn account for provider tests.
    await Actions.token.transferSync(client, {
      account: accounts[0],
      feeToken: Addresses.pathUsd,
      to: webAuthnAccounts[0].address,
      token: Addresses.pathUsd,
      amount: parseUnits('100', 6),
    })
    
    return
  }

  await Actions.faucet.fundSync(client, {
    account: accounts[0].address,
  })
})

afterAll(async () => {
  if (nodeEnv !== 'localnet') return
  await fetch(`${rpcUrl}/stop`)
})
