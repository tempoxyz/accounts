/**
 * Tests the web playground's sign-in on Tempo ID's pages in a popup. Tempo ID's page in the popup
 * posts the callback to the opening page in place of the redirect URI's page, and closes the popup.
 * @module
 */
import type { Page, Route } from '@playwright/test'
import * as Passkeys from '../Passkeys.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, signIn, test } from '../Playwright.js'
import { Env, Schema, Sql } from '../TempoId.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('web app (popup)', () => {
  test('signs in without a key in the popup, and redeems the code in the opening page', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(popupUrl('web'))
    await hydrated(page)

    const popup = await open(page)
    const loaded = callbacks(popup)

    await test.step('signs in on the Tempo ID page in the popup', async () => {
      await expect(popup).toHaveURL(/\/login\?/)
      await expect(
        popup.getByText(/Sign in to continue to Playground web/),
      ).toBeVisible()
      await hydrated(popup)
      await popup.getByLabel('Email').fill(email)
      await popup.getByRole('button', { name: 'Continue with email' }).click()
      await popup
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('closes the popup, and redeems the code for its tokens', async () => {
      await closed(popup)
      await expect(page.locator('#who')).toHaveText(email)
      // The waiting dialog leaves after its exit animation.
      await expect(
        page.getByRole('dialog', { name: 'Continue with Tempo' }),
      ).toHaveCount(0)
      await expect(
        page.getByText('Signed in without an access key.'),
      ).toBeVisible()
      // The popup posts the callback in place of loading the redirect URI.
      expect(loaded).toEqual([])
    })

    await test.step('calls the API with its access token', async () => {
      await page.getByRole('button', { name: 'Call the API' }).click()
      await expect(page.locator('#api')).toContainText(
        Playgrounds.clientId('web'),
      )
    })
  })

  test('signs in with a key in the popup', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(popupUrl('web-cash'))
    await hydrated(page)

    const popup = await open(page)

    await test.step('signs in on the Tempo ID page, which shows the key', async () => {
      await expect(popup).toHaveURL(/\/login\?/)
      await expect(popup.getByText('Continue to let')).toBeVisible()
      await hydrated(popup)
      await popup.getByLabel('Email').fill(email)
      await popup.getByRole('button', { name: 'Continue with email' }).click()
      // The sign-in creates the account, whose secp256k1 owner then signs the key.
      await popup
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('closes the popup, and redeems the code for its tokens and key', async () => {
      await closed(popup)
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#key')).toBeAttached()
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
    })
  })

  test('rejects with `access_denied` when the user denies the key, and stays signed out', async ({
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

    await page.goto(popupUrl('web'))
    await expect(page.getByText('Sign in to continue.')).toBeVisible()
    await hydrated(page)

    const popup = await open(page)

    await test.step('denies the key on the approval page in the popup', async () => {
      await expect(popup).toHaveURL(/\/authorize\?.*sig=/)
      await expect(
        popup.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await hydrated(popup)
      await popup.getByRole('button', { name: 'Deny' }).click()
    })

    await test.step('closes the popup, and stays signed out', async () => {
      await closed(popup)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#who')).toHaveCount(0)
      // The page shows the denial's `error_description`.
      await expect(page.getByRole('status').last()).not.toBeEmpty()
      // The browser logs the 400 of the headless request's `rejected` on load, since the user holds
      // no account in the default realm.
      expect(errors.splice(0)).toEqual([
        expect.stringContaining('status of 400'),
      ])
    })
  })

  test('signs a returning user in on load without a key or a popup, when the app requests no key', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-shared', { VITE_KEY: 'false' }),
    ])
    await signIn(page, { code, email })
    const popups: Page[] = []
    page.on('popup', (popup) => popups.push(popup))
    const keys: boolean[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/authorize')
        keys.push(Boolean(request.postDataJSON()?.key_authorization))
    })

    await page.goto(popupUrl('web-shared'))

    // The Tempo ID session signs the user in through the headless request, with no click.
    await expect(page.locator('#who')).toHaveText(email)
    await expect(
      page.getByText('Signed in without an access key.'),
    ).toBeVisible()
    // The request names no key, since the app requests none.
    expect(keys).toEqual([false])
    expect(popups).toEqual([])
  })

  test('rejects with the signal’s reason when the app cancels the sign-in', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(popupUrl('web'))
    await hydrated(page)

    const popup = await open(page)
    await expect(popup).toHaveURL(/\/login\?/)

    // The page's dialog covers the app's own Cancel while the popup is open, so the test dispatches
    // its click, as an app's code aborts the signal. The signal ends the sign-in and closes the popup.
    await expect(
      page.getByRole('dialog', { name: 'Continue with Tempo' }),
    ).toBeVisible()
    await Promise.all([
      popup.waitForEvent('close'),
      page
        .locator('#root')
        .getByRole('button', { name: 'Cancel' })
        .dispatchEvent('click'),
    ])
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await expect(
      page.getByRole('status').filter({ hasText: 'Sign-in canceled.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign in via dialog' }),
    ).toBeEnabled()
  })

  test('rejects with the signal’s reason when the app cancels the sign-in while its code redeems', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(popupUrl('web'))
    await hydrated(page)
    // The redemption waits, as on a stalled network, until the test releases it.
    const held: Route[] = []
    await page.route('**/oauth2/token', (route) => {
      held.push(route)
    })

    const popup = await open(page)
    await hydrated(popup)
    await popup.getByLabel('Email').fill(email)
    await popup.getByRole('button', { name: 'Continue with email' }).click()
    await popup
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))
    await closed(popup)
    await expect.poll(() => held.length).toBe(1)
    // The page's dialog closes once the callback arrives, so the app's own Cancel takes the click.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('#root').getByRole('button', { name: 'Cancel' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Sign-in canceled.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign in via dialog' }),
    ).toBeEnabled()
    await Promise.all(held.map((route) => route.continue()))
  })

  test('rejects when the user closes the popup, and signs in through a new one', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(popupUrl('web'))
    await hydrated(page)

    const first = await open(page)
    await expect(first).toHaveURL(/\/login\?/)
    // The popup's page reports once it loads that the popup shows it, so a close counts from then.
    await hydrated(first)
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Continue in the Tempo ID window' }),
    ).toBeVisible()
    await first.close()

    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign in via dialog' }),
    ).toBeEnabled()
    const second = await open(page)
    await expect(second).toHaveURL(/\/login\?/)
    await hydrated(second)
    await second.getByLabel('Email').fill(email)
    await second.getByRole('button', { name: 'Continue with email' }).click()
    await second
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await closed(second)
    await expect(page.locator('#who')).toHaveText(email)
  })

  test('rejects when the user closes the popup before its page hydrates', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(popupUrl('web'))
    await hydrated(page)
    // Tempo ID's scripts never load, as on a slow network, so the page in the popup never hydrates.
    // Its stylesheets load, since the head's inline script waits for them.
    const playground = new URL(Playgrounds.url('web')).origin
    await page.context().route(
      (url) =>
        url.origin !== playground &&
        url.pathname.startsWith('/assets/') &&
        url.pathname.endsWith('.js'),
      () => {},
    )

    const popup = await open(page)
    await expect(popup).toHaveURL(/\/login\?/)
    await expect(popup.getByLabel('Email')).toBeVisible()
    await popup.close()

    // The page reports from its head, before it hydrates, so the close counts.
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
  })

  test('rejects when the user closes the popup while it loads another page', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(popupUrl('web'))
    await hydrated(page)

    const popup = await open(page)
    await expect(popup).toHaveURL(/\/login\?/)
    await hydrated(popup)
    // The next page never loads, as on a slow network, so the popup is between two pages when the
    // user closes it.
    let loading = () => {}
    const left = new Promise<void>((resolve) => {
      loading = resolve
    })
    await popup.route(
      (url) => url.pathname === '/login',
      () => loading(),
    )
    const reload = popup.reload().catch(() => undefined)
    await left
    await popup.close()
    await reload

    // Every page of the popup's sign-in keeps the app's handle to the popup, so the close counts.
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
  })

  test("cancels a pending sign-in in a popup from the page's dialog, which closes the popup", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(popupUrl('web'))
    await hydrated(page)

    const first = await open(page)
    await expect(first).toHaveURL(/\/login\?/)
    await hydrated(first)
    // The page's dialog covers the page while the popup is open, and Show window keeps it open.
    const dialog = page.getByRole('dialog', { name: 'Continue with Tempo' })
    await expect(
      dialog.getByText('Continue in the Tempo ID window.'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Show window' }).click()
    expect(first.isClosed()).toBe(false)

    await Promise.all([
      first.waitForEvent('close'),
      dialog.getByRole('button', { name: 'Cancel' }).click(),
    ])
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const second = await open(page)
    await expect(second).toHaveURL(/\/login\?/)
    await hydrated(second)
    await second.getByLabel('Email').fill(email)
    await second.getByRole('button', { name: 'Continue with email' }).click()
    await second
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await closed(second)
    await expect(page.locator('#who')).toHaveText(email)
  })

  test('creates a passkey wallet with the approval of a new user of a third-party app, and signs its key with one click', async ({
    code,
    database,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    // The passkey's relying party is Tempo ID's configured origin, so the page opens Tempo ID there.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin }),
    ])
    await page
      .context()
      .route(`${Env.origin}/**`, (route) =>
        Playgrounds.forward(route, { target: url.href }),
      )
    // A third-party app whose client ID is the page's origin. Its realm is `default`, which holds
    // passkeys and creates no account on the server.
    const target = new URL(popupUrl('web'))
    target.searchParams.set('client_id', Playgrounds.origin('web'))
    await page.goto(target.href)
    await hydrated(page)

    const popup = await open(page)
    await authenticator(popup)

    await test.step('signs in a new user with an emailed code in the popup', async () => {
      await expect(popup).toHaveURL(/\/login\?/)
      await hydrated(popup)
      await popup.getByLabel('Email').fill(email)
      await popup.getByRole('button', { name: 'Continue with email' }).click()
      await popup
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('creates the passkey wallet on Approve, which signs the key', async () => {
      await expect(
        popup.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await expect(
        popup.getByText('You have no Tempo Account for this app yet'),
      ).toHaveCount(0)
      await popup.getByRole('button', { name: 'Approve' }).click()
      await closed(popup)
      const passkeys = await database.db
        .select({ address: Schema.keys.address })
        .from(Schema.keys)
        .innerJoin(Schema.user, Sql.eq(Schema.user.id, Schema.keys.userId))
        .where(
          Sql.and(
            Sql.eq(Schema.user.email, email),
            Sql.eq(Schema.keys.type, 'passkey'),
          ),
        )
      expect(passkeys).toHaveLength(1)
      expect(passkeys[0]?.address).toMatch(/^0x[0-9a-f]{40}$/)
    })

    await test.step('returns the key to the app', async () => {
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#key')).toBeAttached()
    })

    // The page reads the Tempo Account with Tempo ID's session cookie, which a page on another site
    // never holds, so the browser logs each 401 of that read.
    expect(
      errors.splice(0).every((entry) => entry.includes('status of 401')),
    ).toBe(true)
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('signs the key with the account that the user gained after the approval page loaded, and creates no passkey wallet', async ({
    code,
    database,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin }),
    ])
    await page
      .context()
      .route(`${Env.origin}/**`, (route) =>
        Playgrounds.forward(route, { target: url.href }),
      )
    const target = new URL(popupUrl('web'))
    target.searchParams.set('client_id', Playgrounds.origin('web'))
    await page.goto(target.href)
    await hydrated(page)

    const popup = await open(page)
    await expect(popup).toHaveURL(/\/login\?/)
    await hydrated(popup)
    await popup.getByLabel('Email').fill(email)
    await popup.getByRole('button', { name: 'Continue with email' }).click()
    await popup
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))
    await expect(popup.getByRole('button', { name: 'Approve' })).toBeEnabled()

    // Another tab links a wallet.tempo passkey, which owns the user's first account, after the page
    // offered a passkey wallet.
    const [user] = await database.db
      .select({ id: Schema.user.id })
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const address = await Passkeys.attach(database, {
      page: popup,
      source: 'tempo-wallet',
      userId: user!.id,
    })
    await popup.getByRole('button', { name: 'Approve' }).click()
    await closed(popup)

    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    const passkeys = await database.db
      .select({ address: Schema.keys.address })
      .from(Schema.keys)
      .where(
        Sql.and(
          Sql.eq(Schema.keys.userId, user!.id),
          Sql.eq(Schema.keys.type, 'passkey'),
        ),
      )
    expect(passkeys).toEqual([{ address: address.toLowerCase() }])
    expect(
      errors.splice(0).every((entry) => entry.includes('status of 401')),
    ).toBe(true)
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  })
})

/** Adds an empty virtual authenticator to `popup`, whose ceremonies create passkeys in it. */
async function authenticator(popup: Page) {
  const cdp = await popup.context().newCDPSession(popup)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: 'ctap2',
      transport: 'internal',
    },
  })
}

/** Returns the paths of the redirect URI that `popup` requests with a callback from then on. */
function callbacks(popup: Page) {
  const origin = new URL(Playgrounds.url('web')).origin
  const paths: string[] = []
  popup.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === origin && url.searchParams.has('code'))
      paths.push(url.pathname)
  })
  return paths
}

/**
 * Resolves once `popup` closes. A popup can close as the action that ends its sign-in settles,
 * before the wait starts, and Playwright reports no close of a closed page.
 */
async function closed(popup: Page) {
  if (popup.isClosed()) return
  await popup.waitForEvent('close')
}

/** Clicks "Sign in via dialog" on `page`, which opens a popup with `?dialog=popup`, and returns the popup. */
async function open(page: Page) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Sign in via dialog' }).click(),
  ])
  return popup
}

/** Returns the URL of the playground `name`, whose dialog signs in through a popup. */
function popupUrl(name: Playgrounds.AppName) {
  const url = new URL(Playgrounds.url(name))
  url.searchParams.set('dialog', 'popup')
  return url.href
}
