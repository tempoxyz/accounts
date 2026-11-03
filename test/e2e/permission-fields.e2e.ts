/**
 * Tests the web playground's permissions form, which lists the verified tokens of its chain from
 * the Tempo API.
 * @module
 */
import { expect, test } from '../Playwright.js'
import * as Playgrounds from '../Playgrounds.js'

test.describe('permission fields', () => {
  test("lists the verified tokens of the playground's chain for a limit, from its Tempo API", async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')

    await page.goto(Playgrounds.url('web'))
    // Each sign-in section folds its own permissions.
    const section = page.getByRole('region', { name: 'Headless API' })
    await section.getByText('Permissions', { exact: true }).click()
    const permissions = section.getByRole('group', { name: 'Permissions' })
    await permissions.getByRole('button', { name: 'Add a limit' }).click()
    const token = permissions.getByRole('combobox', { name: 'Token' })

    // The Tempo API lists the faucet's tokens as verified on the local chain.
    await expect(token.getByRole('option')).toHaveText([
      'Select a token',
      'pathUSD',
      'OUSD',
      'alphaUSD',
      'betaUSD',
      'thetaUSD',
      'Custom address',
    ])
    await expect(permissions.getByText(/No Tempo API/)).toHaveCount(0)

    await token.selectOption('alphaUSD')

    await expect(token).toHaveValue(
      '0x20c0000000000000000000000000000000000001',
    )
  })
})
