/**
 * Tests the web playground's sign-in through a redirect to Tempo ID's pages and a PKCE redemption.
 * As `web-cash`, whose realm holds secp256k1 owners, it sends with the key of each case of
 * `Permissions.matrix`.
 * @module
 */
import * as Journeys from '../Journeys.js'
import * as Passkeys from '../Passkeys.js'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test } from '../Playwright.js'
import { Harness, Schema, Sql } from '../TempoId.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('web app (redirect)', () => {
  test('signs in without a key on the Tempo ID page, redeems the code, and calls the API', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])

    await test.step('signs in on the Tempo ID page', async () => {
      await page.goto(Playgrounds.url('web'))
      // Each document that the click loads, by its method, path, and status.
      const documents: string[] = []
      page.on('response', (response) => {
        if (response.request().resourceType() !== 'document') return
        const url = new URL(response.url())
        documents.push(
          `${response.request().method()} ${url.pathname} ${response.status()}`,
        )
      })
      await page.getByRole('button', { name: 'Sign in via redirect' }).click()
      await expect(page).toHaveURL(/\/login\?.*sig=/)
      // The authorization request renders the sign-in page itself, without a redirect.
      expect(documents).toEqual(['GET /oauth2/authorize 200'])
      // A request without a key names its app, and shows no key.
      await expect(
        page.getByText(/Sign in to continue to Playground web/),
      ).toBeVisible()
      await expect(page.getByText('Continue to let')).toHaveCount(0)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('redeems the code for its tokens', async () => {
      await expect(page.locator('#who')).toHaveText(email)
      await expect(
        page.getByText('Signed in without an access key.'),
      ).toBeVisible()
      // The callback takes the tab's copy of the verifier, so none stays behind.
      expect(
        await page.evaluate(() => sessionStorage.getItem('tempo-id:redirect')),
      ).toBeNull()
    })

    await test.step('calls the API with its access token', async () => {
      await page.getByRole('button', { name: 'Call the API' }).click()
      await expect(page.locator('#api')).toContainText(
        Playgrounds.clientId('web'),
      )
    })
  })

  test("completes a redirect after another tab of the app loads while it is away, which keeps the redirect's pending state", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })
    await page.goto(Playgrounds.url('web'))
    await page.getByRole('button', { name: 'Sign in via redirect' }).click()
    await expect(page).toHaveURL(/\/login\?/)

    // Another tab of the app reads the session while the redirect is away, and finds no callback.
    const other = await page.context().newPage()
    await other.goto(Playgrounds.url('web'))
    await hydrated(other)
    await expect(
      other.getByRole('button', { name: 'Sign in via redirect' }),
    ).toBeVisible()
    await other.close()

    await hydrated(page)
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Continue with email' }).click()
    await page
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await expect(page.locator('#who')).toHaveText(email)
  })

  test("hydrates the sign-in page's key card after its expiry crosses to a smaller unit, without a mismatch", async ({
    baseURL,
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    // `in 1 day` turns into `in 24 hours` once less than a day and a minute remains, 2 seconds after
    // the click. The server renders the card before then, and the browser after, since Tempo ID's
    // page script waits for the clock. A mismatch throws on the page, which fails the test.
    // The OAuth section's sign-ins read the permissions of its own form.
    const oauth = page.getByRole('region', { name: 'OAuth' })
    await oauth.getByText('Permissions', { exact: true }).click()
    await oauth.getByLabel('Expiry in seconds').fill(String(86_400 - 60 + 2))
    const flip = (Math.floor(Date.now() / 1000) + 3) * 1000 + 300
    const origin = new URL(baseURL!).origin
    await page.route(
      (url) =>
        url.origin === origin &&
        /^\/assets\/index-[\w-]+\.js$/.test(url.pathname),
      async (route) => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, flip - Date.now())),
        )
        await route.continue()
      },
    )
    await page.getByRole('button', { name: 'Sign in via redirect' }).click()
    await expect(page).toHaveURL(/\/login\?.*sig=/)
    await expect(page.getByText('in 1 day', { exact: true })).toBeVisible()
    await hydrated(page)

    expect(Date.now()).toBeGreaterThan(flip)
  })

  test('restores a session without a key on reload once a passkey owns the account', async ({
    code,
    database,
    email,
    errors,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web')])

    await test.step('signs in without a key', async () => {
      await page.goto(`${Playgrounds.url('web')}?key=false`)
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via redirect' }).click()
      await expect(page).toHaveURL(/\/login\?/)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page.locator('#who')).toHaveText(email)
    })

    await test.step('links a passkey that owns an account in the default realm', async () => {
      const [user] = await database.db
        .select({ id: Schema.user.id })
        .from(Schema.user)
        .where(Sql.eq(Schema.user.email, email))
      if (!user) throw new Error(`No user has the address ${email}.`)
      await Passkeys.create(database, {
        source: 'tempo-wallet',
        userId: user.id,
      })
    })

    await test.step('restores the session without a key on reload', async () => {
      // The instance saved the session without a key, so the reload restores it with no request.
      await page.reload()
      await expect(page.locator('#who')).toHaveText(email)
      await expect(
        page.getByText('Signed in without an access key.'),
      ).toBeVisible()
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      expect(errors.splice(0)).toEqual([])
    })
  })

  test('shows a signed-in user the approval page at once, and returns signed out once the user denies it', async ({
    code,
    email,
    errors,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web')])

    await test.step('signs in on the Tempo ID page first', async () => {
      await page.goto('/login')
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page).not.toHaveURL(/\/login/)
    })

    await test.step('skips the sign-in page, and denies the key on the approval page', async () => {
      await page.goto(Playgrounds.url('web'))
      await page.getByRole('button', { name: 'Sign in via redirect' }).click()
      await expect(page).toHaveURL(/\/authorize\?.*sig=/)
      await expect(
        page.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await hydrated(page)
      await page.getByRole('button', { name: 'Deny' }).click()
    })

    await test.step('returns to the app signed out', async () => {
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#who')).toHaveCount(0)
      // The page shows the denial's `error_description`.
      await expect(page.getByRole('status').last()).not.toBeEmpty()
      // The browser logs the 400 of the headless request's `rejected`, since the user holds no account
      // in the default realm. The page then signs in through the redirect.
      expect(errors.splice(0)).toEqual([
        expect.stringContaining('status of 400'),
      ])
    })
  })

  test("reads the account of a user whom the app's realm creates none for with one request at each sign-in, before and after a sign-out", async ({
    baseURL,
    code,
    email,
    harness,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    // The user's email has a wallet.tempo passkey, which Tempo ID does not hold, and the app's only
    // realm, `default`, creates no account.
    const { credential, passkey } = Passkeys.wallet({ email })
    await Harness.seedWallet(harness!, { credential, id: passkey.id })
    // Each request for the user's account, by its method.
    const reads: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== new URL(baseURL!).origin) return
      if (url.pathname !== '/v1/account' || request.method() === 'OPTIONS')
        return
      reads.push(request.method())
    })
    await page.goto(Playgrounds.url('web'))

    for (const step of ['first sign-in', 'sign-in after the sign-out'])
      await test.step(`reads the account once at the ${step}`, async () => {
        const codes = async () =>
          (await Harness.messages(harness!)).filter((entry) =>
            entry.subject.endsWith('sign-in code'),
          ).length
        const sent = await codes()
        await hydrated(page)
        await page.getByRole('button', { name: 'Sign in via redirect' }).click()
        await expect(page).toHaveURL(/\/login\?/)
        await hydrated(page)
        await page.getByLabel('Email').fill(email)
        await page.getByRole('button', { name: 'Continue with email' }).click()
        await expect.poll(codes).toBeGreaterThan(sent)
        await page
          .getByRole('textbox', { exact: true, name: 'Code' })
          .fill(await code(email))
        await expect(page.locator('#who')).toHaveText(email)
        await expect(page.locator('#account')).toHaveText('none')

        // `GET /v1/account` returns that `POST /v1/account` creates no account, so the page
        // sends none.
        expect(reads.splice(0)).toEqual(['GET'])

        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(page.getByText('Sign in to continue.')).toBeVisible()
      })
  })

  test("loads the sign-in page's scripts and style sheets from the cache that the app's page prefetched", async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })
    const listed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/v1/auth/assets',
    )

    await page.goto(Playgrounds.url('web'))
    const response = await listed
    const { assets } = (await response.json()) as { assets: string[] }
    // The playground's own style sheet loads through a link too, so only Tempo ID's origin counts.
    const origin = new URL(response.url()).origin
    const prefetched = () =>
      page.evaluate(
        (origin) =>
          performance
            .getEntriesByType('resource')
            .filter(
              (entry) =>
                (entry as PerformanceResourceTiming).initiatorType === 'link' &&
                new URL(entry.name).origin === origin,
            ).length,
        origin,
      )
    await expect.poll(prefetched).toBe(assets.length)
    await page.getByRole('button', { name: 'Sign in via redirect' }).click()
    await expect(page).toHaveURL(/\/login\?/)
    await hydrated(page)

    // A response from the cache transfers no bytes.
    const transferred = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.startsWith('/assets/'))
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          transferSize: (entry as PerformanceResourceTiming).transferSize,
        })),
    )
    expect(
      transferred.filter((entry) => assets.includes(entry.path)).length,
    ).toBe(assets.length)
    expect(
      transferred.filter(
        (entry) => assets.includes(entry.path) && entry.transferSize > 0,
      ),
    ).toEqual([])
  })

  test("redeems the code from IndexedDB's state when the tab holds no copy of the verifier", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })
    // The callback page loses the tab's copy before its scripts run, as a blocked storage would.
    await page.addInitScript((origin) => {
      if (
        location.origin === origin &&
        new URLSearchParams(location.search).has('code')
      )
        sessionStorage.removeItem('tempo-id:redirect')
    }, Playgrounds.origin('web'))

    await page.goto(Playgrounds.url('web'))
    await page.getByRole('button', { name: 'Sign in via redirect' }).click()
    await expect(page).toHaveURL(/\/login\?/)
    await hydrated(page)
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Continue with email' }).click()
    await page
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await expect(page.locator('#who')).toHaveText(email)
    await expect(
      page.getByText('Signed in without an access key.'),
    ).toBeVisible()
  })

  test('ignores a code it did not request', async ({ page, playgrounds }) => {
    await playgrounds('web')

    await page.goto(
      `${Playgrounds.origin('web')}/?code=unrequested&state=forged&tab=1`,
    )

    // A code from a request the app did not start redeems for whoever crafted that request.
    await expect(page).toHaveURL(`${Playgrounds.origin('web')}/?tab=1`)
    await expect(page.getByText('Sign in to continue.')).toBeVisible()
  })

  for (const entry of Permissions.matrix)
    test(`signs in via redirect with ${entry.name}, then sends`, async ({
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

      await test.step('signs in on the Tempo ID page, which shows the key that the sign-in grants', async () => {
        await page.goto(Playgrounds.url('web-cash'))
        await page.getByRole('button', { name: 'Sign in via redirect' }).click()
        await expect(page).toHaveURL(/\/login\?/)
        await expect(page.getByText(entry.limit, { exact: true })).toBeVisible()
        await hydrated(page)
        await page.getByLabel('Email').fill(email)
        await page.getByRole('button', { name: 'Continue with email' }).click()
        // The sign-in creates the account, whose secp256k1 owner then signs the key.
        await page
          .getByRole('textbox', { exact: true, name: 'Code' })
          .fill(await code(email))
      })

      await test.step('redeems the code for its tokens and key', async () => {
        await expect(page.locator('#who')).toHaveText(email, {
          timeout: 30_000,
        })
      })

      await test.step('sends with its access key', () => Journeys.send(page))
    })
})
