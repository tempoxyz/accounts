/**
 * Tests the wagmi playground, whose wagmi connector is its own Tempo ID instance. A sign-in through
 * the instance connects wagmi, the access key sends through wagmi, the saved session reconnects wagmi
 * across page loads and tabs, and a sign-out disconnects it.
 * @module
 */
import type { Page, Request } from '@playwright/test'
import * as Journeys from '../Journeys.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test } from '../Playwright.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('wagmi app', () => {
  test('connects wagmi at an emailed-code sign-in, sends with the key through wagmi, reconnects on reload, and disconnects at the sign-out', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    // Funding and sending add a few blocks.
    test.setTimeout(120_000)
    await Promise.all([playgrounds('api'), playgrounds('wagmi')])
    await open(page)

    await test.step('connects wagmi at the sign-in', async () => {
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#status')).toHaveText('disconnected')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
      await expect(page.getByText(`sent to ${email}`)).toBeVisible()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await page.getByRole('button', { name: 'Sign in' }).click()
      // The sign-in creates the account, whose secp256k1 owner then signs the key.
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#status')).toHaveText('connected')
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await expect(page.locator('#realm')).toHaveText('Tempo Cash')
    })

    await test.step('calls the API with its access token', async () => {
      await page.getByRole('button', { name: 'Call the API' }).click()
      await expect(page.locator('#api')).toContainText(
        Playgrounds.clientId('wagmi'),
      )
    })

    await test.step('sends OUSD with the access key through wagmi', () =>
      Journeys.send(page))

    await test.step('reconnects wagmi on reload, without a sign-in or a token request', async () => {
      const address = await page.locator('#account').textContent()
      const requests = record(page)

      await page.reload()
      await hydrated(page)

      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#status')).toHaveText('connected')
      await expect(page.locator('#account')).toHaveText(address!)
      expect(signIns(requests)).toEqual([])
    })

    await test.step('disconnects wagmi at the sign-out, and stays disconnected on reload', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#status')).toHaveText('disconnected')
      // A reload before the sign-out ends Tempo ID's session would cancel its request.
      // The page hides an empty status, so the locator includes hidden elements.
      await expect(
        page.getByRole('status', { includeHidden: true }).last(),
      ).toBeEmpty()

      await page.reload()
      await hydrated(page)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#status')).toHaveText('disconnected')
    })
  })

  test('connects wagmi at a dialog sign-in, and connects a second tab without a sign-in', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('wagmi')
    await open(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    await signInInDialog(page, { code, email })
    await expect(page.locator('#status')).toHaveText('connected', {
      timeout: 30_000,
    })
    await expect(page.locator('#who')).toHaveText(email)
    await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
    await expect(
      page.locator('dialog[data-tempo-id-dialog][open]'),
    ).toHaveCount(0)
    const address = await page.locator('#account').textContent()

    const other = await page.context().newPage()
    const requests = record(other)
    await open(other)

    await expect(other.locator('#status')).toHaveText('connected')
    await expect(other.locator('#account')).toHaveText(address!)
    expect(signIns(requests)).toEqual([])
  })
})

/** Opens the playground's page on `page`, and waits until it takes input. */
async function open(page: Page) {
  await page.goto(Playgrounds.url('wagmi'))
  await hydrated(page)
}

/**
 * Signs `email` in with an emailed code on Tempo ID's page in the open dialog. The app has
 * `tempo-id:iframe`, so the frame acts on input once it hydrates and the dialog's entrance ends.
 */
async function signInInDialog(page: Page, options: signInInDialog.Options) {
  const frame = await dialogFrame(page)
  await frame.getByLabel('Email').fill(options.email)
  await frame.getByRole('button', { name: 'Continue with email' }).click()
  await frame
    .getByRole('textbox', { exact: true, name: 'Code' })
    .fill(await options.code(options.email))
}

declare namespace signInInDialog {
  type Options = {
    /** Returns the code that the inbox holds for an address. */
    code: (email: string) => Promise<string>
    /** The address to sign in. */
    email: string
  }
}

/** Returns the frame of the open dialog, once its page hydrates and the dialog's entrance ends. */
async function dialogFrame(page: Page) {
  const frame = page.frameLocator('dialog[data-tempo-id-dialog][open] iframe')
  await frame
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached' })
  // The entrance scales the dialog, which moves the frame, so a click during it can miss.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector('dialog[data-tempo-id-dialog][open]')
          ?.getAnimations({ subtree: true })
          .every((animation) => animation.playState === 'finished'),
      ),
    )
    .toBe(true)
  return frame
}

/** Returns the list of requests that `page` starts from now on, in each of its frames. */
function record(page: Page) {
  const requests: Request[] = []
  page.on('request', (request) => requests.push(request))
  return requests
}

/**
 * Returns the method and path of each request in `requests` that signs in or issues tokens: a code,
 * a sign-in request of the dialog, an authorization, or a token request.
 */
function signIns(requests: readonly Request[]) {
  return requests
    .map((request) => `${request.method()} ${new URL(request.url()).pathname}`)
    .filter((entry) =>
      /\/(oauth2\/(authorize|token)|v1\/(auth\/code|authorize)|i\/embed\/request)/.test(
        entry,
      ),
    )
}
