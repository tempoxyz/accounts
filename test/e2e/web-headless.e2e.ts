/**
 * Tests the web playground's headless sign-in, which calls Tempo ID's API with no redirect. It runs
 * as `web-cash` with each case of `Permissions.matrix`, and as `web-passkey` with a passkey.
 * @module
 */
import * as Journeys from '../Journeys.js'
import * as Passkeys from '../Passkeys.js'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, signIn, test } from '../Playwright.js'
import { Chain, Env, Schema, TempoApi } from '../TempoId.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('web app (headless)', () => {
  // A test that serves a playground forwards its requests through routes, and a request still in
  // flight when the test ends otherwise fails the test.
  test.afterEach(async ({ page }) => {
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('signs in with an emailed code and a key, calls the API, and restores the session on reload', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])

    await test.step('signs in with an emailed code', async () => {
      await page.goto(Playgrounds.url('web-cash'))
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
      await expect(page.getByText(`sent to ${email}`)).toBeVisible()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await page.getByRole('button', { name: 'Sign in' }).click()
      // The sign-in creates the account, whose secp256k1 owner then signs the key.
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    })

    await test.step('holds a key on its Tempo Account', async () => {
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await expect(page.locator('#realm')).toHaveText('Tempo Cash')
      await expect(
        page.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }),
      ).toBeVisible()
    })

    await test.step('calls the API with its access token', async () => {
      await page.getByRole('button', { name: 'Call the API' }).click()
      await expect(page.locator('#api')).toContainText(
        Playgrounds.clientId('web-cash'),
      )
    })

    await test.step('restores the session, its account, and its key on reload, without a new authorization', async () => {
      const address = await page.locator('#account').textContent()
      const expiry = await page.locator('#key dd').nth(1).textContent()
      const authorizations: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/authorize')
          authorizations.push(request.url())
      })

      await page.reload()

      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      // The saved sign-in shows at once, and the account's read follows. The sign-out waits for the
      // read, since a read that reaches Tempo ID after the sign-out ends the session responds 401.
      await expect(page.locator('#account')).toHaveText(address!)
      await expect(page.locator('#key dd').nth(1)).toHaveText(expiry!)
      expect(authorizations).toEqual([])
    })

    await test.step('signs out and stays signed out on reload', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await page.reload()
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
    })
  })

  test("forgets the session in the app's other tabs once the user signs out in one, and shows their next sign-in", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    // Tempo ID's session signs the visitor in on load, as it does a returning user.
    await signIn(page, { code, email })
    await page.goto(Playgrounds.url('web-cash'))
    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    const other = await page.context().newPage()
    await other.goto(Playgrounds.url('web-cash'))
    await expect(other.locator('#who')).toHaveText(email)

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByText('Sign in to continue.')).toBeVisible()
    // The other tab stops signing with the access key at once, without a reload.
    await expect(other.getByText('Sign in to continue.')).toBeVisible()
    await expect(
      other.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }),
    ).toHaveCount(0)

    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
    await expect(page.getByText(`sent to ${email}`)).toBeVisible()
    await page
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    // The other tab shows the sign-in of the first without a reload.
    await expect(other.locator('#who')).toHaveText(email)
  })

  test('signs in a new user with an emailed code, and shows the Tempo Account with no request after the verify', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
    await expect(page.getByText(`sent to ${email}`)).toBeVisible()
    const value = await code(email)
    // The verify response carries the account, so the page sends Tempo ID no request after it.
    const requests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.origin !== new URL(TempoApi.url).origin &&
        url.pathname.startsWith('/v1/')
      )
        requests.push(`${request.method()} ${url.pathname}`)
    })

    await page.getByRole('textbox', { exact: true, name: 'Code' }).fill(value)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
    await expect(page.locator('#realm')).toHaveText('Tempo Cash')
    expect(requests).toEqual(['POST /v1/auth/code/verify'])
  })

  test('signs in with a passkey on its own page, and holds a key on its Tempo Account', async ({
    database,
    email,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    // The page calls Tempo ID at its configured origin, which shares the page's site.
    await playgrounds('web-passkey', { TEMPO_ID_URL: Env.origin })
    await Playgrounds.serve(page.context(), {
      harness: url,
      name: 'web-passkey',
    })
    const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`
    await database.db
      .insert(Schema.user)
      .values({ email, emailVerified: true, id: userId, name: '' })

    await test.step('signs in with a passkey', async () => {
      await page.goto(`${Playgrounds.site('web-passkey')}/`)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await Passkeys.attach(database, { page, userId })
      await page.getByRole('button', { name: 'Continue with passkey' }).click()
      // The sign-in creates the account in the app's first realm, whose secp256k1 owner then signs
      // the key.
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    })

    await test.step('holds a key on its Tempo Account', async () => {
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await expect(page.locator('#realm')).toHaveText('Tempo Cash')
      await expect(
        page.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }),
      ).toBeVisible()
    })
  })

  test("signs in and signs the key of a wallet.tempo passkey's account with one assertion, and sends", async ({
    database,
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
    const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`
    await database.db
      .insert(Schema.user)
      .values({ email, emailVerified: true, id: userId, name: '' })
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin === Env.origin)
        requests.push(new URL(request.url()).pathname)
    })

    await test.step('signs in and signs the key with one passkey assertion', async () => {
      await page.goto(`${Playgrounds.site('web-passkey')}/`)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      const account = await Passkeys.attach(database, {
        page,
        source: 'tempo-wallet',
        userId,
      })
      await page.getByRole('button', { name: 'Continue with passkey' }).click()
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#account')).toHaveText(account)
      // The verify response carries the authorization, so the page sends no other request for it.
      expect(requests).not.toContain('/v1/authorize')
    })

    await test.step('sends with its access key', () => Journeys.send(page))
  })

  for (const entry of Permissions.matrix)
    test(`signs in with an emailed code and ${entry.name}, and sends`, async ({
      code,
      email,
      page,
      playgrounds,
    }) => {
      // Funding and sending add a few blocks.
      test.setTimeout(120_000)
      await Promise.all([
        playgrounds('api'),
        playgrounds('web-cash', Permissions.env(entry.permissions)),
      ])

      await test.step('signs in with an emailed code', async () => {
        await page.goto(Playgrounds.url('web-cash'))
        await expect(page.getByText('Sign in to continue.')).toBeVisible()
        await page.getByLabel('Email').fill(email)
        await page.getByRole('button', { exact: true, name: 'Sign in' }).click()
        await expect(page.getByText(`sent to ${email}`)).toBeVisible()
        await page
          .getByRole('textbox', { exact: true, name: 'Code' })
          .fill(await code(email))
        await page.getByRole('button', { name: 'Sign in' }).click()
        // The key fits the headless ceiling, so the account's secp256k1 owner signs it without a page.
        await expect(page.locator('#who')).toHaveText(email, {
          timeout: 30_000,
        })
      })

      await test.step('sends with its access key', () => Journeys.send(page))
    })
})
