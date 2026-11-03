/** Steps that several end-to-end journeys share. @module */
import { expect, type Page } from '@playwright/test'
import { Chain } from './TempoId.js'

/**
 * Funds the playground's Tempo Account from the node's faucet, as the deposit page's faucet does.
 */
export async function fund(page: Page, options: fund.Options = {}) {
  const { chain = Chain } = options
  const address = await page.locator('#account').textContent()
  if (!address?.startsWith('0x'))
    throw new Error('The page shows no Tempo Account.')
  await chain.fund({ address: address as `0x${string}` })
}

export declare namespace fund {
  type Options = {
    /** The node whose faucet funds the account, such as `ConfigurableChain`. Defaults to `Chain`. */
    chain?:
      | { fund: (options: { address: `0x${string}` }) => Promise<unknown> }
      | undefined
  }
}

/**
 * Funds the playground's Tempo Account, sends 0.01 OUSD with its access key, and expects success.
 * The node also verifies the key's authorization on this first transaction.
 */
export async function send(page: Page, options: send.Options = {}) {
  await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
  await fund(page, options)

  // The web playground sends 0.01 OUSD by default, and the backend playground always does.
  await page.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }).click()
  await expect(page.locator('#transaction')).toContainText('success', {
    timeout: 30_000,
  })
}

export declare namespace send {
  type Options = fund.Options
}
