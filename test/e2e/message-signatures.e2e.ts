/**
 * Tests the message signatures of the web playground's Viem client on a page: the account's owner
 * signs until the access key's first transaction registers it on the chain, and the access key signs
 * after. The suite's harness flags the local chain for configurable accounts, so the cloud wallet signs
 * as the account through Tempo ID.
 * @module
 */
import * as Journeys from '../Journeys.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test as base } from '../Playwright.js'
import { Chain, Env, Harness, TempoApi } from '../TempoId.js'

/** The suite's `test`, whose harness flags the local chain for configurable accounts. */
const test = base.extend<object, { harness: Harness.Instance }>({
  harness: [
    async ({ database }, use) => {
      const url = new URL(TempoApi.url)
      url.username = 'tempo'
      url.password = 'sk:admin'
      const harness = Harness.create({
        secrets: {
          CONFIGURABLE_ACCOUNTS: 'local',
          DATABASE_URL: database.url,
          TEMPO_API_URLS: `local:${Chain.chain.id}=${url.href}`,
        },
      })
      await harness.listen()
      await use(harness)
      await harness.close()
    },
    { scope: 'worker' },
  ],
})

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('message signatures', () => {
  // A test that serves a playground forwards its requests through routes, and a request still in
  // flight when the test ends otherwise fails the test.
  test.afterEach(async ({ page }) => {
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  })

  test("signs a message through the account's owner right after a sign-in with an access key, and with the access key once a transfer registers it", async ({
    code,
    email,
    page,
    playgrounds,
    server,
  }) => {
    // Funding and sending add a few blocks.
    test.setTimeout(120_000)
    const { url } = await server.listen()
    // Chromium refuses a request from the page's public origin to the local node, so the page calls
    // the node at a public host that the context forwards.
    const rpc = `https://rpc.${new URL(Env.origin).hostname}`
    // The `web-passkey` app holds `tempo-id:sign`, and its page shares Tempo ID's site.
    await playgrounds('web-passkey', {
      TEMPO_ID_URL: Env.origin,
      TEMPO_RPC_URL: `${rpc}/1`,
    })
    await Playgrounds.serve(page.context(), {
      harness: url,
      name: 'web-passkey',
    })
    await page.context().route(`${rpc}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      // The connection can close as the request reuses it, as `Playgrounds.forward` describes.
      await route.fulfill({
        response: await route.fetch({
          maxRetries: 1,
          url: new URL(path, Chain.rpcUrl).href,
        }),
      })
    })

    await test.step('signs in with an emailed code and an access key', async () => {
      await page.goto(`${Playgrounds.site('web-passkey')}/`)
      await hydrated(page)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
      await expect(page.getByText(`sent to ${email}`)).toBeVisible()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#key')).toBeAttached()
    })

    await test.step("signs through the account's owner before the chain holds the access key", async () => {
      await page.getByRole('button', { name: 'Sign message' }).click()

      await expect(page.locator('#message-signer')).toHaveText('Owner', {
        timeout: 30_000,
      })
      await expect(page.locator('#message-verified')).toHaveText('Yes')
    })

    await test.step('registers the access key with its first transfer', () =>
      Journeys.send(page))

    await test.step('signs with the access key once the chain holds it', async () => {
      await page.getByRole('button', { name: 'Sign message' }).click()

      await expect(page.locator('#message-signer')).toHaveText('Access key', {
        timeout: 30_000,
      })
      await expect(page.locator('#message-verified')).toHaveText('Yes')
    })
  })
})
