/**
 * Tests the MPP section of the web playground: charges, a proof, and a session that the access key
 * pays to the API playground's `/mpp` routes, on the local node.
 * @module
 */
import type { Page } from '@playwright/test'
import * as Journeys from '../Journeys.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test } from '../Playwright.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('web app (MPP)', () => {
  // Each payment adds a block or two, and the session's open and close add more.
  test.setTimeout(180_000)

  test('pays charges, a proof, and a session with its access key, and closes the session', async ({
    code,
    email,
    errors,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])

    await test.step('signs in with an emailed code and a key, and funds the account', async () => {
      await page.goto(Playgrounds.url('web-cash'))
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
      await expect(page.getByText(`sent to ${email}`)).toBeVisible()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await Journeys.fund(page)
    })

    await test.step('refuses a proof before the access key holds a transaction', async () => {
      const result = await pay(page, 'Prove the account')

      // The API verifies the proof against the chain's keychain, which holds the access key only
      // after its first transaction.
      expect(result).toContain('Proof signature does not match source')
    })

    await test.step('pays a charge that the API broadcasts', async () => {
      const result = JSON.parse(await pay(page, 'Pay a charge (pull)'))

      expect(result.status).toBe(200)
      expect(result.body).toEqual({
        fortune: 'Your code compiles on the first try.',
      })
      expect(result.receipt.status).toBe('success')
    })

    await test.step('pays a charge that the page broadcasts', async () => {
      const result = JSON.parse(await pay(page, 'Pay a charge (push)'))

      expect(result.status).toBe(200)
      expect(result.receipt.status).toBe('success')
    })

    await test.step('proves the account with the access key', async () => {
      const result = JSON.parse(await pay(page, 'Prove the account'))

      expect(result.status).toBe(200)
      expect(result.body).toEqual({ proven: true })
    })

    await test.step('opens a session and pays each request with a voucher of the access key', async () => {
      const opened = JSON.parse(await pay(page, 'Pay with a session'))
      const paid = JSON.parse(await pay(page, 'Pay with a session'))

      expect(opened.status).toBe(200)
      expect(paid.status).toBe(200)
      expect(paid.body).toEqual({ content: 'Paid with a voucher.' })
      // The API accepts the voucher only from the channel's signer, the access key.
      const { acceptedCumulative, spent, status, units } = paid.receipt
      expect({ acceptedCumulative, spent, status, units }).toEqual({
        acceptedCumulative: '20000',
        spent: '20000',
        status: 'success',
        units: 2,
      })
    })

    await test.step('streams with the session, a voucher paying for each chunk', async () => {
      const result = JSON.parse(await pay(page, 'Stream with a session'))

      expect(result.body).toBe('Each chunk is paid for.')
    })

    await test.step('closes the session', async () => {
      const result = JSON.parse(await pay(page, 'Close the session'))

      expect(result.receipt.status).toBe('success')
    })

    // Each payment starts with the API's 402 challenge, which the browser logs.
    expect(
      errors.splice(0).filter((error) => !error.includes('status of 402')),
    ).toEqual([])
  })
})

/**
 * Clicks the MPP section's button `name`, and returns the section's output once the payment
 * settles. Each payment's output differs from the one before it, so the wait ends at the new one.
 */
async function pay(page: Page, name: string) {
  const output = page.locator('#mpp')
  const before = (await output.textContent()) ?? ''
  await page.getByRole('button', { name }).click()
  await expect(output).not.toHaveText(before)
  await expect(output).not.toHaveText('Paying…', { timeout: 60_000 })
  return (await output.textContent()) ?? ''
}
