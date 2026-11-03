/**
 * Tests the web playground's dialog sign-in in its default `iframe` mode: Tempo ID's embedded
 * sign-in in a dialog on the app's page, which posts the callback to the page. The frame shows the
 * approval page itself, and a browser's Tempo ID session, from Tempo ID's own page or the frame on
 * another site, continues in the frame on any site. When a cover hides the frame of an app without
 * `tempo-id:iframe`, the dialog offers a popup, which the user's click opens with the same request. A
 * passkey that owns its account signs in and signs the key in the frame with one assertion. An
 * instance that pushes its requests signs in through a popup, and so does a sign-in with a funding hint.
 * @module
 */
import type {
  ElementHandle,
  FrameLocator,
  Locator,
  Page,
} from '@playwright/test'
import { Base64, Bytes, Hash } from 'ox'
import * as Journeys from '../Journeys.js'
import * as Passkeys from '../Passkeys.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test } from '../Playwright.js'
import { Env, Schema, Sql } from '../TempoId.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('web app (dialog)', () => {
  test('signs in without a key in the dialog, and redeems the code in the page', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)

    await test.step('signs in on the Tempo ID page in the dialog', async () => {
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(
        frame.getByText(/Sign in to continue to Playground web/),
      ).toBeVisible()
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      await frame
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('closes the dialog, and redeems the code for its tokens', async () => {
      await expect(page.locator('#who')).toHaveText(email)
      await expect(
        page.getByText('Signed in without an access key.'),
      ).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
  })

  test('signs in through a popup for an instance that pushes its requests, whose push holds display=popup, and loads no frame', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false', VITE_PAR: 'true' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    // The frame takes the request's own parameters, so the page preloads none.
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(0)

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Sign in via dialog' }).click(),
    ])

    await test.step('signs in on the compact Tempo ID page in the popup', async () => {
      // Tempo ID reads only `client_id` and `request_uri` from the URL, so the push holds `display`.
      await expect(popup).toHaveURL(/\/login\?.*display=popup/)
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

    await test.step('closes the popup, and redeems the code in the page', async () => {
      if (!popup.isClosed()) await popup.waitForEvent('close')
      await expect(page.locator('#who')).toHaveText(email)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
  })

  test('signs in through a popup for a sign-in with a funding hint, whose request holds the hint, and shows no frame', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByText('Funding hint', { exact: true }).click()
    await page.locator('input[name="funding_hint"]').fill('10')
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Sign in via dialog' }).click(),
    ])

    // The frame cannot show the funding page, so the request goes to a popup from the start. The
    // page shows the popup's waiting dialog, which holds no frame.
    await expect(popup).toHaveURL(/[?&]funding_hint=10(&|$)/)
    await expect(
      page.getByRole('dialog', { name: 'Continue with Tempo' }),
    ).toBeVisible()
    await expect(page.locator('dialog[open] iframe')).toHaveCount(0)
  })

  test('shows the preloaded sign-in at once, in the frame that loaded before the click', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    // The page preloads the frame in a hidden dialog, whose page hydrates before the click.
    await page
      .frameLocator('dialog[data-tempo-id-dialog] iframe')
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: 'attached' })
    const preloaded = await page
      .locator('dialog[data-tempo-id-dialog] iframe')
      .elementHandle()
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)

    await expect(frame.getByText('Welcome to Tempo')).toBeVisible()
    expect(await shows(page, { frame: preloaded })).toBe(true)
  })

  test('signs in after the page removes the preloaded dialog, as a framework that mounts into the body does', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page
      .frameLocator('dialog[data-tempo-id-dialog] iframe')
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: 'attached' })

    await page.evaluate(() =>
      document.querySelector('dialog[data-tempo-id-dialog]')?.remove(),
    )
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await frame
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await expect(page.locator('#who')).toHaveText(email)
    // The sign-in loaded a dialog of its own, which the page keeps for the next one.
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(1)
  })

  test('shows the dialog at once after a close, in the same frame, which starts the sign-in again', async ({
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const first = await dialogFrame(page)
    await first.getByLabel('Email').fill(email)
    await first.getByRole('button', { name: 'Continue with email' }).click()
    await expect(
      first.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()
    await fitted(page, { frame: first })
    const frame = await page
      .locator('dialog[data-tempo-id-dialog][open] iframe')
      .elementHandle()

    await first.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const second = await dialogFrame(page)

    // The second sign-in starts at the email step, with an empty form, in the one frame of the page.
    await expect(second.getByLabel('Email')).toHaveValue('')
    await expect(
      second.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toHaveCount(0)
    expect(await shows(page, { frame })).toBe(true)
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(1)
  })

  test('replaces a sign-in in the frame that a second click starts before the dialog shows, so one dialog signs in, none stays open, and its frame stays loaded', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    // Both clicks land in one task, before the page disables its button, as a double click can.
    await page
      .getByRole('button', { name: 'Sign in via dialog' })
      .evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) return
        button.click()
        button.click()
      })
    const frame = await dialogFrame(page)
    const signedIn = await page
      .locator('dialog[data-tempo-id-dialog][open] iframe')
      .elementHandle()
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await frame
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await expect(page.locator('#who')).toHaveText(email)
    // The first sign-in ended at the second click, so no dialog of its own stays open.
    await expect(
      page.locator('dialog[data-tempo-id-dialog][open]'),
    ).toHaveCount(0)
    // The frame that signed in holds the session, so it takes the next sign-in, and the replaced
    // sign-in's frame closed.
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(1)
    expect(
      await page
        .locator('dialog[data-tempo-id-dialog] iframe')
        .evaluate((element, other) => element === other, signedIn),
    ).toBe(true)
  })

  test('keeps the frame of a sign-in without a preload, and shows it at once on the next click', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false', VITE_PRELOAD: 'false' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const first = await dialogFrame(page)
    await expect(first.getByLabel('Email')).toBeVisible()
    const frame = await page
      .locator('dialog[data-tempo-id-dialog][open] iframe')
      .elementHandle()

    await first.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    await dialogFrame(page)

    expect(await shows(page, { frame })).toBe(true)
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(1)
  })

  test('lays out the dialog on a page whose policy refuses inline styles', async ({
    page,
    playgrounds,
  }) => {
    // The page's policy refuses every `<style>` element and `style` attribute, as a strict policy
    // does.
    await playgrounds('web', { CSP: "style-src 'self'", VITE_KEY: 'false' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.getByLabel('Email')).toBeVisible()

    // The dialog's styles size the frame to the dialog, not to the browser's default of 300 pixels.
    const box = await page
      .locator('dialog[data-tempo-id-dialog][open] iframe')
      .boundingBox()
    expect(box?.width).not.toBe(300)
  })

  test("takes the preloaded frame whatever the sign-in's permissions, and shows the key of the click", async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page
      .frameLocator('dialog[data-tempo-id-dialog] iframe')
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: 'attached' })

    // The permissions change after the frame loads, and the expiry counts from the click.
    // The OAuth section's sign-ins read the permissions of its own form.
    const oauth = page.getByRole('region', { name: 'OAuth' })
    await oauth.getByText('Permissions', { exact: true }).click()
    await oauth.getByLabel('Expiry in seconds').fill('7200')
    const preloaded = await page
      .locator('dialog[data-tempo-id-dialog] iframe')
      .elementHandle()
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)

    await expect(
      frame.getByText(/Continue to let [\s\S]+use your Tempo Account/),
    ).toBeVisible()
    await expect(frame.getByText('in 2 hours')).toBeVisible()
    expect(await shows(page, { frame: preloaded })).toBe(true)
  })

  test('shows no dialog until the frame is ready, so it never shows an empty frame', async ({
    page,
    playgrounds,
  }) => {
    // Without a preload, the click builds the request and loads the frame.
    await playgrounds('web', { VITE_KEY: 'false', VITE_PRELOAD: 'false' })

    // The page's response waits until the test releases it, so the frame cannot become ready.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/embed?**', async (route) => {
      await held
      await route.continue()
    })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()

    await expect(
      page.getByText('Continue in the Tempo ID dialog…'),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    release()
    const frame = await dialogFrame(page)

    await expect(frame.getByText('Welcome to Tempo')).toBeVisible()
  })

  test('offers no popup at the timeout of a canceled sign-in while the next sign-in waits for the same frame, and shows the next sign-in once the frame is ready', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web', { VITE_KEY: 'false' })

    // The preloaded frame's response waits until the test releases it, so neither sign-in is ready.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = () => {}
    const preloaded = new Promise<void>((resolve) => {
      requested = resolve
    })
    await page.route('**/embed?**', async (route) => {
      requested()
      await held
      await route.continue()
    })
    // The instance inserts the frame as its module loads, and a pending frame holds the page's `load`
    // event and its network, so neither `load` nor `hydrated` can end before the release. The page
    // renders the button only once React mounts and the session settles as signed out.
    await page.goto(Playgrounds.url('web'), { waitUntil: 'domcontentloaded' })
    await preloaded
    const signIn = page.getByRole('button', { name: 'Sign in via dialog' })
    await expect(signIn).toBeEnabled()

    // The first sign-in starts the default timeout of 10 seconds, then the page cancels it.
    await signIn.click()
    const first = await page.evaluate(() => performance.now())
    await page.getByRole('button', { exact: true, name: 'Cancel' }).click()
    await expect(
      page.getByText('Sign-in canceled. Sign in again.'),
    ).toBeVisible()

    // The second sign-in takes the same frame, and its own timeout ends after the first one's.
    await page.waitForFunction(
      (start) => performance.now() > start + 6_000,
      first,
    )
    await signIn.click()
    await expect(
      page.getByText('Continue in the Tempo ID dialog…'),
    ).toBeVisible()

    // The first sign-in's timeout passes, and the second sign-in still waits for its frame.
    await page.waitForFunction(
      (start) => performance.now() > start + 11_000,
      first,
      { timeout: 15_000 },
    )
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByText('Sign in with Tempo in a new window.'),
    ).toHaveCount(0)

    release()
    const frame = await dialogFrame(page)

    await expect(frame.getByText('Welcome to Tempo')).toBeVisible()
    await expect(page.locator('dialog[data-tempo-id-dialog]')).toHaveCount(1)
  })

  test('rejects when the user closes the dialog with its close button, and takes no input in its exit', async ({
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    // The exit plays for 240 milliseconds, so the check runs on each frame of the page.
    const exiting = page.waitForFunction(
      () => {
        const dialog = document.querySelector<HTMLDialogElement>(
          'dialog[data-tempo-id-dialog][data-closing]',
        )
        return dialog ? { inert: dialog.inert } : undefined
      },
      undefined,
      { polling: 'raf' },
    )
    await frame.getByRole('button', { name: 'Close' }).click()

    // A focused control or a second click in the exit would act for a sign-in that already ended.
    expect(await (await exiting).jsonValue()).toEqual({ inert: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
  })

  test('rejects when the user presses Escape in the frame, as on the dialog itself', async ({
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('web')
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    // The frame focuses its email field, so the key reaches the frame's document, not the dialog's.
    await frame.getByLabel('Email').fill(email)
    await expect(frame.getByLabel('Email')).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
  })

  test("signs in with a passkey in the dialog, whose assertion signs the key of the passkey's account, and sends", async ({
    database,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    // Funding and sending add a few blocks.
    test.setTimeout(120_000)
    const { url } = await server.listen()
    // The frame runs the ceremony at the relying party's domain, so the page frames Tempo ID at its
    // configured origin, which the context forwards to the harness.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin }),
    ])
    await forward(page, { harness: url })
    const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`
    await database.db
      .insert(Schema.user)
      .values({ email, emailVerified: true, id: userId, name: '' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    // A wallet.tempo passkey owns its address's Tempo Account.
    await Passkeys.attach(database, { page, source: 'tempo-wallet', userId })
    const options: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/v1/auth/passkey/options'))
        options.push(request.url())
    })

    await test.step('signs in and signs the key with one assertion in the frame', async () => {
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      // The frame requests the passkey options once the request arrives, before the click.
      await expect.poll(() => options.length).toBe(1)
      await frame.getByRole('button', { name: 'Continue with passkey' }).click()
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#key')).toBeAttached()
      // The sign-in finished in the frame, so the dialog closed without an offer of a popup.
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // The click took the prefetched options, so it requested none of its own.
      expect(options).toHaveLength(1)
      // The passkey button stays busy after the callback, through the dialog's exit, until the next
      // request starts the frame's sign-in again.
      await expect(
        page
          .frameLocator('dialog[data-tempo-id-dialog] iframe')
          .locator('button[aria-busy="true"]', {
            hasText: 'Continue with passkey',
          }),
      ).toHaveCount(1)
    })

    // The key's first transaction carries its authorization, so the chain verifies the frame's
    // assertion as the key's signature.
    await test.step('sends with its access key', async () => {
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await Journeys.fund(page)
      await page.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }).click()
      await expect(page.locator('#transaction')).toContainText('success', {
        timeout: 30_000,
      })
    })

    // The page reads the Tempo Account with the session's access token, so no read is refused.
    expect(errors.splice(0)).toEqual([])
  })

  test('requests the passkey options in the frame of an app without tempo-id:iframe only at the click', async ({
    database,
    email,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    // The frame runs the ceremony at the relying party's domain, which the page's site shares.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-passkey', { TEMPO_ID_URL: Env.origin }),
    ])
    await Playgrounds.serve(page.context(), {
      harness: url,
      name: 'web-passkey',
    })
    const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`
    await database.db
      .insert(Schema.user)
      .values({ email, emailVerified: true, id: userId, name: '' })
    await page.goto(`${Playgrounds.site('web-passkey')}/`)
    await hydrated(page)
    await Passkeys.attach(database, { page, userId })
    // The app's page prepares a passkey sign-in of its own, so only the frame's requests count.
    const options: string[] = []
    page.on('request', (request) => {
      if (
        request.url().endsWith('/v1/auth/passkey/options') &&
        new URL(request.frame().url()).pathname === '/embed'
      )
        options.push(request.url())
    })

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    const button = frame.getByRole('button', { name: 'Continue with passkey' })
    await expect(button).toBeVisible()
    await acts(frame)
    // The app's page can post requests without a click, so the frame requests no options before one.
    expect(options).toEqual([])
    await button.click()

    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    expect(options).toHaveLength(1)
    // The signed-in page keeps reading its account, so the routes drop the reads in flight as the
    // test ends instead of failing them.
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  })

  test("continues as the user whom the browser's Tempo ID session signs in, in the frame on another site, with one click", async ({
    code,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    // The page frames Tempo ID at its configured origin, on another site than the page, so the frame
    // reads the session only through the frame cookies.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin, VITE_KEY: 'false' }),
    ])
    await forward(page, { harness: url })

    await test.step('signs in on Tempo ID first', async () => {
      await page.goto(`${Env.origin}/login`)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page).not.toHaveURL(/\/login/)
    })

    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await test.step('continues as the signed-in user in the frame', async () => {
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      // The frame offers the session's account in place of the sign-in's form.
      await expect(frame.getByLabel('Email')).toHaveCount(0)
      await frame.getByRole('button', { name: `Continue as ${email}` }).click()
      await expect(page.locator('#who')).toHaveText(email)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    // The page reads the Tempo Account with the session's access token, so no read is refused.
    expect(errors.splice(0)).toEqual([])
  })

  test('continues as the user who signed in in the frame of one app, in the frame of another app on another site, with one click', async ({
    code,
    database,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    const { url } = await server.listen()
    // Both pages frame Tempo ID at its configured origin. The first page is on `127.0.0.1` and the
    // second on `localhost`, so the three sites differ, and the partitioned frame cookie of the first
    // site never reaches the second.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin, VITE_KEY: 'false' }),
    ])
    await forward(page, { harness: url })
    const other = new URL(Playgrounds.url('web'))
    other.hostname = 'localhost'
    const clientId = `tempo-example-other-${crypto.randomUUID()}`
    // An app without `tempo-id:iframe`, so its frame acts only while nothing covers it.
    await database.db.insert(Schema.oauthClient).values({
      clientId,
      enableEndSession: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      id: crypto.randomUUID(),
      name: 'Other site',
      redirectUris: [other.href],
      responseTypes: ['code'],
      skipConsent: true,
      tokenEndpointAuthMethod: 'none',
    })

    await test.step('signs in with an emailed code in the frame on the first site', async () => {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      await frame
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page.locator('#who')).toHaveText(email)
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // A browser stores no `SameSite=Lax` cookie from a frame on another site, so only the frame
      // cookies hold the session, and only the device cookie's copies name the user.
      const cookies = await page.context().cookies(Env.origin)
      expect(cookies.map((cookie) => cookie.name).sort()).toEqual([
        '__Host-tempo-id-device-frame',
        '__Host-tempo-id-device-frame-partitioned',
        '__Host-tempo-id-frame',
        '__Host-tempo-id-frame-partitioned',
      ])
    })

    // The context's routes fetch Tempo ID outside the browser's cookie partitions, so they would
    // send the partitioned cookie to the frame on every site. A browser sends it only on the first
    // site, so the test removes it, and the second site reads the cookie of every site alone.
    await page
      .context()
      .clearCookies({ name: '__Host-tempo-id-frame-partitioned' })

    await test.step('continues as that user in the frame of another app on the second site', async () => {
      other.searchParams.set('client_id', clientId)
      await page.goto(other.href)
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      const proceed = frame.getByRole('button', {
        name: `Continue as ${email}`,
      })
      // IntersectionObserver v2 reports the button unobscured once the dialog's entrance ends.
      await acts(frame)
      // The frame offers the session's account in place of the sign-in's form.
      await expect(frame.getByLabel('Email')).toHaveCount(0)
      await proceed.click()
      await expect(page.locator('#who')).toHaveText(email)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    // The page reads the Tempo Account with the session's access token, so no read is refused.
    expect(errors.splice(0)).toEqual([])
  })

  for (const query of [{ max_age: '0' }, { prompt: 'login' }])
    test(`signs in again in the frame of a third-party app for a request with ${new URLSearchParams(query)}, in place of the browser's session, and issues an ID token of the new sign-in`, async ({
      code,
      email,
      page,
      playgrounds,
      request,
    }) => {
      // The test signs in twice, each with an emailed code.
      test.setTimeout(60_000)
      await Promise.all([
        playgrounds('api'),
        playgrounds('web', { VITE_KEY: 'false' }),
      ])
      // A third-party app whose client ID is the page's origin, and whose redirect URI is its root.
      const clientId = Playgrounds.origin('web')
      const redirectUri = `${clientId}/`
      const url = new URL(Playgrounds.url('web'))
      url.searchParams.set('client_id', clientId)
      await page.goto(url.href)
      await hydrated(page)

      await test.step('signs in through the dialog, approves the app, and signs out of the app', async () => {
        await page.getByRole('button', { name: 'Sign in via dialog' }).click()
        const frame = await dialogFrame(page)
        await acts(frame)
        await frame.getByLabel('Email').fill(email)
        await frame.getByRole('button', { name: 'Continue with email' }).click()
        const field = frame.getByRole('textbox', { exact: true, name: 'Code' })
        await expect(field).toBeVisible()
        await acts(frame)
        await field.fill(await code(email))
        const approve = frame.getByRole('button', { name: 'Approve' })
        await expect(approve).toBeEnabled()
        await acts(frame)
        await approve.click()
        await expect(page.locator('#who')).toHaveText(email)

        // A third-party app ends no Tempo ID session, so the browser's session stays.
        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(
          page.getByRole('button', { name: 'Sign in via dialog' }),
        ).toBeEnabled()
      })

      const verifier = Base64.fromBytes(Bytes.random(32), {
        pad: false,
        url: true,
      })
      const authorization = new URLSearchParams({
        client_id: clientId,
        code_challenge: Base64.fromBytes(
          Hash.sha256(Bytes.fromString(verifier)),
          { pad: false, url: true },
        ),
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state: 'reauthentication',
        ...query,
      })

      // The client package sends neither parameter, so the page posts the request to the preloaded
      // frame itself, as the protocol of the embedded sign-in describes, and shows the dialog.
      await page.evaluate((value) => {
        const dialog = document.querySelector<HTMLDialogElement>(
          'dialog[data-tempo-id-dialog]',
        )
        const frame = dialog?.querySelector('iframe')
        if (!dialog || !frame?.contentWindow)
          throw new Error('The page holds no preloaded frame.')
        const target = new URL(frame.src).origin
        const messages: unknown[] = []
        Object.assign(window, { messages })
        window.addEventListener('message', (event) => {
          if (event.origin === target) messages.push(event.data)
        })
        frame.contentWindow.postMessage(
          {
            id: 'reauthentication',
            request: value,
            type: 'tempo-id:embed.request',
          },
          target,
        )
        // The client package keeps the preloaded dialog inert until it shows it.
        dialog.inert = false
        dialog.showModal()
      }, authorization.toString())
      const frame = await dialogFrame(page)
      await acts(frame)

      await test.step('shows the sign-in form, not the browser session to continue with one click', async () => {
        await expect(frame.getByLabel('Email')).toBeVisible()
        await expect(
          frame.getByRole('button', { name: `Continue as ${email}` }),
        ).toHaveCount(0)
      })

      const reauthenticated = Math.floor(Date.now() / 1000)
      await test.step('signs in with an emailed code', async () => {
        await frame.getByLabel('Email').fill(email)
        await frame.getByRole('button', { name: 'Continue with email' }).click()
        const field = frame.getByRole('textbox', { exact: true, name: 'Code' })
        await expect(field).toBeVisible()
        await acts(frame)
        await field.fill(await code(email))
      })

      await test.step('posts the callback, whose code issues an ID token of the new sign-in', async () => {
        // The page collects the frame's messages, so the callback's URL is the first one of its type.
        const callback = () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  messages: readonly { type: string; url?: string }[]
                }
              ).messages.find(
                (message) => message.type === 'tempo-id:embed.callback',
              )?.url,
          )
        await expect.poll(callback).toEqual(expect.any(String))
        const redirect = new URL((await callback())!)
        const response = await request.post('/oauth2/token', {
          form: {
            client_id: clientId,
            code: redirect.searchParams.get('code') ?? '',
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          },
        })
        const body = (await response.json()) as { id_token: string }
        const claims = JSON.parse(
          Base64.toString(body.id_token.split('.')[1]!),
        ) as { auth_time: number; email: string }
        expect(response.status()).toBe(200)
        expect(claims.email).toBe(email)
        expect(claims.auth_time).toBeGreaterThanOrEqual(reauthenticated)
      })
    })

  test('shows the approval page in the frame when the sign-in needs it, and returns the denial to the page', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web')])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await frame
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await test.step('shows the approval page in the frame', async () => {
      // The user holds no account in the default realm, so the key needs the approval page, where no
      // account can approve it.
      await expect(
        frame.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await expect(frame.getByRole('alert')).toContainText(
        'You have no Tempo Account for this app yet',
      )
      await expect(
        frame.getByRole('button', { name: 'Approve' }),
      ).toBeDisabled()
      await expect(
        page.getByText('Continue in a new window to finish signing in.'),
      ).toHaveCount(0)
    })

    await test.step('returns the denial to the page, which stays signed out', async () => {
      await frame.getByRole('button', { name: 'Deny' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByText('Sign in to continue.')).toBeVisible()
      await expect(page.locator('#who')).toHaveCount(0)
      // The page shows the denial's `error_description`.
      await expect(page.getByRole('status').last()).not.toBeEmpty()
    })
  })

  test("continues at the approval page in the same frame after the frame's own sign-in, without a second sign-in", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web')])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const first = await dialogFrame(page)
    await first.getByLabel('Email').fill(email)
    await first.getByRole('button', { name: 'Continue with email' }).click()
    await first
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))
    await expect(
      first.getByRole('heading', { name: 'Authorize this app' }),
    ).toBeVisible()
    // The page settles once the account loads, and its alert makes the frame taller.
    await expect(first.getByRole('alert')).toContainText(
      'You have no Tempo Account for this app yet',
    )
    await fitted(page, { frame: first })
    await first.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const second = await dialogFrame(page)

    // The frame's sign-in set the browser's session, so its next request continues for it.
    await expect(
      second.getByRole('heading', { name: 'Authorize this app' }),
    ).toBeVisible()
    await expect(second.getByLabel('Email')).toHaveCount(0)
  })

  test("switches from the approval page of the browser's session to the sign-in of another account in the frame, whose approval page names it", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    const other = `tempo-id-test+${crypto.randomUUID()}@example.org`
    await Promise.all([playgrounds('api'), playgrounds('web')])
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const first = await dialogFrame(page)
    await first.getByLabel('Email').fill(email)
    await first.getByRole('button', { name: 'Continue with email' }).click()
    await first
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))
    await expect(first.getByRole('alert')).toContainText(
      'You have no Tempo Account for this app yet',
    )
    await fitted(page, { frame: first })

    await test.step('names the signed-in user on the approval page, which offers another account', async () => {
      await expect(
        first.getByRole('group', { name: 'Tempo Account' }),
      ).toContainText(email)
      await first.getByRole('button', { name: /Use another account/ }).click()
      await expect(first.getByLabel('Email')).toBeVisible()
    })

    await test.step('signs in as the other account, whose approval page names it', async () => {
      await first.getByLabel('Email').fill(other)
      await first.getByRole('button', { name: 'Continue with email' }).click()
      await first
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(other))
      await expect(
        first.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await expect(
        first.getByRole('group', { name: 'Tempo Account' }),
      ).toContainText(other)
    })
  })

  test("holds the approval of a key when the frame cannot read the user's account", async ({
    code,
    email,
    errors,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web')])
    // The read of the account that approval signs for fails, as an unavailable database would.
    await page.route('**/v1/authorize/request?**', (route) => route.abort())
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await frame
      .getByRole('textbox', { exact: true, name: 'Code' })
      .fill(await code(email))

    await expect(frame.getByRole('alert')).toContainText(
      'Tempo ID cannot read your Tempo Account right now',
    )
    await expect(frame.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(
      errors.splice(0).every((entry) => entry.includes('ERR_FAILED')),
    ).toBe(true)
  })

  test('approves the key of a passkey-owned account in the frame, whose passkey signs it there, after an emailed-code sign-in, and sends', async ({
    code,
    database,
    email,
    errors,
    page,
    playgrounds,
    server,
  }) => {
    // Funding and sending add a few blocks.
    test.setTimeout(120_000)
    const { url } = await server.listen()
    // The frame runs the passkey step at the relying party's domain, so the page frames Tempo ID at
    // its configured origin, on another site than the page. The frame then holds no session cookie.
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { TEMPO_ID_URL: Env.origin }),
    ])
    await forward(page, { harness: url })
    const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`
    await database.db
      .insert(Schema.user)
      .values({ email, emailVerified: true, id: userId, name: '' })
    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    // A wallet.tempo passkey owns the user's account, so only the passkey signs its key.
    await Passkeys.attach(database, { page, source: 'tempo-wallet', userId })

    await test.step('signs in with an emailed code in the frame', async () => {
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      await frame
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
    })

    await test.step('approves the key in the frame, whose passkey step signs it there', async () => {
      const frame = await dialogFrame(page)
      await expect(
        frame.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
      await expect(frame.getByRole('button', { name: 'Approve' })).toBeEnabled()
      await frame.getByRole('button', { name: 'Approve' }).click()
      await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
      await expect(page.locator('#key')).toBeAttached()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    // The key's first transaction carries its authorization, so the chain verifies the signature of
    // the frame's passkey step.
    await test.step('sends with its access key', async () => {
      await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
      await Journeys.fund(page)
      await page.getByRole('button', { name: /^Send (0\.01 )?OUSD$/ }).click()
      await expect(page.locator('#transaction')).toContainText('success', {
        timeout: 30_000,
      })
    })

    // The page reads the Tempo Account with the session's access token, so no read is refused.
    expect(errors.splice(0)).toEqual([])
  })

  test('signs in on the dialog of an app without tempo-id:iframe while nothing covers the frame', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    const proceed = frame.getByRole('button', { name: 'Continue with email' })
    // IntersectionObserver v2 reports the button unobscured once the dialog's entrance ends.
    await acts(frame)
    await frame.getByLabel('Email').fill(email)
    await proceed.click()
    const field = frame.getByRole('textbox', { exact: true, name: 'Code' })
    await expect(field).toBeVisible()
    // The code step changes the frame's size, which starts the time in view again.
    await acts(frame)
    await field.fill(await code(email))

    await expect(page.locator('#who')).toHaveText(email)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('refuses an action while a cover hides the frame of an app without tempo-id:iframe, and offers a popup', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    // A page that wants a click on the frame covers it with its own content, which lets the click
    // through. A popover joins the top layer after the dialog, so it paints over the dialog.
    await page.evaluate(() => {
      const cover = document.createElement('div')
      cover.setAttribute('popover', 'manual')
      cover.style.cssText =
        'background: rgb(255 255 255 / 0.9); border: 0; height: 100vh; inset: 0; margin: 0; pointer-events: none; width: 100vw;'
      cover.textContent = 'Claim your prize'
      document.body.appendChild(cover)
      cover.showPopover()
    })
    // IntersectionObserver v2 reports the cover.
    await expect(frame.locator('main[data-visible]')).toHaveCount(0)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })
    await frame.getByLabel('Email').fill(email)
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))

    await expect(
      page
        .getByRole('dialog')
        .getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    // The frame sent no code, since the sign-in stopped before its request.
    expect(sent).toEqual([])
  })

  test('rejects when the user closes the popup that the dialog offers in place of a covered frame', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)

    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await page.evaluate(() => {
      const cover = document.createElement('div')
      cover.setAttribute('popover', 'manual')
      cover.style.cssText =
        'background: rgb(255 255 255 / 0.9); border: 0; height: 100vh; inset: 0; margin: 0; pointer-events: none; width: 100vw;'
      document.body.appendChild(cover)
      cover.showPopover()
    })
    await expect(frame.locator('main[data-visible]')).toHaveCount(0)
    await frame.getByLabel('Email').fill(email)
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))
    const offer = page.getByRole('dialog')
    await expect(
      offer.getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    await page.evaluate(() =>
      document.querySelector<HTMLElement>('[popover]')?.hidePopover(),
    )

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      offer.getByRole('button', { exact: true, name: 'Continue' }).click(),
    ])
    await expect(popup).toHaveURL(/\/login\?/)
    // The popup's page reports once it loads that the popup shows it, so a close counts from then.
    await hydrated(popup)
    await popup.close()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'closed the sign-in' }),
    ).toBeVisible()
  })

  test('ignores the trust in the late response of a replaced request, and keeps the check of visibility after the app loses tempo-id:iframe', async ({
    database,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    const clientId = Playgrounds.clientId('web')
    const [row] = await database.db
      .select({ scopes: Schema.oauthClient.scopes })
      .from(Schema.oauthClient)
      .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    const scopes = row?.scopes ?? []
    // The check of the first request responds while the app holds `tempo-id:iframe`. The page holds
    // that response until the check of the next request returned.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let fetched = () => {}
    const first = new Promise<void>((resolve) => {
      fetched = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      const response = await route.fetch()
      fetched()
      await held
      await route.fulfill({ response })
    })

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await first
      await frame.getByRole('button', { name: 'Close' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // The app loses the scope, so the check of the next request reports it untrusted, and the
      // frame checks its visibility.
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes: scopes.filter((scope) => scope !== 'tempo-id:iframe') })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      await dialogFrame(page)
      await frame.locator('main[data-in-view]').waitFor({ state: 'attached' })

      // The response of the first request arrives last, with the trust from before the change.
      const finished = page.waitForEvent(
        'requestfinished',
        (request) => new URL(request.url()).pathname === '/i/embed/request',
      )
      release()
      await finished
      await acts(frame)

      const sent: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/auth/code')
          sent.push(request.url())
      })
      await page.evaluate(() => {
        const cover = document.createElement('div')
        cover.setAttribute('popover', 'manual')
        cover.style.cssText =
          'background: rgb(255 255 255 / 0.9); border: 0; height: 100vh; inset: 0; margin: 0; pointer-events: none; width: 100vw;'
        document.body.appendChild(cover)
        cover.showPopover()
      })
      // The frame still checks its visibility, so IntersectionObserver v2 reports the cover.
      await expect(frame.locator('main[data-in-view]')).toHaveCount(0)
      await frame.getByLabel('Email').fill(email)
      await refuse(frame.getByRole('button', { name: 'Continue with email' }))

      await expect(
        page
          .getByRole('dialog')
          .getByText('Continue in a new window to finish signing in.'),
      ).toBeVisible()
      expect(sent).toEqual([])
    } finally {
      release()
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    }
  })

  test('ignores the trust in the late response of a request that the page replaces with one of the same ID, after the app loses tempo-id:iframe', async ({
    database,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    const clientId = Playgrounds.clientId('web')
    const [row] = await database.db
      .select({ scopes: Schema.oauthClient.scopes })
      .from(Schema.oauthClient)
      .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    const scopes = row?.scopes ?? []
    // The check of the first request responds while the app holds `tempo-id:iframe`. The page holds
    // that response until the check of the next request returned.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let fetched = () => {}
    const first = new Promise<void>((resolve) => {
      fetched = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      const response = await route.fetch()
      fetched()
      await held
      await route.fulfill({ response })
    })

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      // The frame names the ID of each request that it shows, which the page reads.
      const ready = page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            window.addEventListener('message', (event) => {
              const data = event.data as { id?: unknown; type?: unknown } | null
              if (
                data?.type === 'tempo-id:embed.ready' &&
                typeof data.id === 'string'
              )
                resolve(data.id)
            })
          }),
      )
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      const id = await ready
      await first

      // The app loses the scope, and the page posts the next request with the ID of the first one,
      // so the check of the next request reports it untrusted.
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes: scopes.filter((scope) => scope !== 'tempo-id:iframe') })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
      await page.evaluate((value) => {
        const element = document.querySelector<HTMLIFrameElement>(
          'dialog[data-tempo-id-dialog] iframe',
        )
        if (!element?.contentWindow) return
        const url = new URL(element.src)
        const request = new URLSearchParams({
          client_id: url.searchParams.get('client_id') ?? '',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          redirect_uri: url.searchParams.get('redirect_uri') ?? '',
          response_type: 'code',
          scope: 'openid email',
          state: 'reused',
        })
        element.contentWindow.postMessage(
          {
            id: value,
            request: request.toString(),
            type: 'tempo-id:embed.request',
          },
          url.origin,
        )
      }, id)
      await frame.locator('main[data-in-view]').waitFor({ state: 'attached' })

      // The response of the first request arrives last, with the trust from before the change.
      const finished = page.waitForEvent(
        'requestfinished',
        (request) => new URL(request.url()).pathname === '/i/embed/request',
      )
      release()
      await finished
      await acts(frame)

      const sent: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/auth/code')
          sent.push(request.url())
      })
      await page.evaluate(() => {
        const cover = document.createElement('div')
        cover.setAttribute('popover', 'manual')
        cover.style.cssText =
          'background: rgb(255 255 255 / 0.9); border: 0; height: 100vh; inset: 0; margin: 0; pointer-events: none; width: 100vw;'
        document.body.appendChild(cover)
        cover.showPopover()
      })
      // The frame still checks its visibility, so IntersectionObserver v2 reports the cover.
      await expect(frame.locator('main[data-in-view]')).toHaveCount(0)
      await frame.getByLabel('Email').fill(email)
      await refuse(frame.getByRole('button', { name: 'Continue with email' }))

      await expect(
        page
          .getByRole('dialog')
          .getByText('Continue in a new window to finish signing in.'),
      ).toBeVisible()
      expect(sent).toEqual([])
    } finally {
      release()
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    }
  })

  test('ignores the refusal of a request that the page replaces with one of the same ID, and signs in for the next one', async ({
    email,
    errors,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    // The check refuses the second request, and the page holds that refusal until the check of the
    // next request returned.
    const fetched = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks !== 2) return await route.continue()
      const response = await route.fetch()
      fetched.resolve()
      await released.promise
      await route.fulfill({ response })
    })
    // Posts a request with the ID of the dialog's own, as a page that reuses IDs does.
    const post = (options: { challenge: string; id: string; state: string }) =>
      page.evaluate((value) => {
        const element = document.querySelector<HTMLIFrameElement>(
          'dialog[data-tempo-id-dialog] iframe',
        )
        if (!element?.contentWindow) return
        const url = new URL(element.src)
        const request = new URLSearchParams({
          client_id: url.searchParams.get('client_id') ?? '',
          code_challenge: value.challenge,
          code_challenge_method: 'S256',
          redirect_uri: url.searchParams.get('redirect_uri') ?? '',
          response_type: 'code',
          scope: 'openid email',
          state: value.state,
        })
        element.contentWindow.postMessage(
          {
            id: value.id,
            request: request.toString(),
            type: 'tempo-id:embed.request',
          },
          url.origin,
        )
      }, options)

    await page.goto(Playgrounds.url('web'))
    await hydrated(page)
    // The page records the type of each message from the frame, and reads the ID of its request.
    const ready = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const messages: string[] = []
          Object.assign(window, { messages })
          window.addEventListener('message', (event) => {
            const data = event.data as { id?: unknown; type?: unknown } | null
            if (typeof data?.type === 'string') messages.push(data.type)
            if (
              data?.type === 'tempo-id:embed.ready' &&
              typeof data.id === 'string'
            )
              resolve(data.id)
          })
        }),
    )
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    const id = await ready

    // A malformed `code_challenge` fails the check with `invalid_field`.
    await post({ challenge: 'short', id, state: 'refused' })
    await fetched.promise
    const next = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/i/embed/request',
    )
    await post({
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      id,
      state: 'reused',
    })
    await next

    // The refusal of the replaced request arrives last, and the frame handles it in tasks that run
    // before one that the test queues after them.
    const finished = page.waitForEvent(
      'requestfinished',
      (request) => new URL(request.url()).pathname === '/i/embed/request',
    )
    released.resolve()
    await finished
    await frame
      .locator('main')
      .evaluate(
        () => new Promise((resolve) => setTimeout(() => setTimeout(resolve))),
      )
    const messages = await page.evaluate(
      () => (window as unknown as { messages: readonly string[] }).messages,
    )
    expect(messages).not.toContain('tempo-id:embed.popup')

    // The frame signs in for the next request.
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await expect(
      frame.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()
    // The browser logs the 400 of the refused check.
    expect(errors.splice(0)).toEqual([expect.stringContaining('status of 400')])
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test("runs an action that lands before the request's check returns once the check reports the app trusted", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    // The page holds the check's response, as a slow network does, while the user submits the email.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = () => {}
    const checking = new Promise<void>((resolve) => {
      requested = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      const response = await route.fetch()
      requested()
      await held
      await route.fulfill({ response })
    })

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await checking
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      release()

      // The submit waited for the check, and then sent the code, with no second click.
      await frame
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))

      await expect(page.locator('#who')).toHaveText(email)
    } finally {
      release()
    }
  })

  test("runs only the first of two submits that land before the request's check returns, so it sends one code", async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = () => {}
    const checking = new Promise<void>((resolve) => {
      requested = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      const response = await route.fetch()
      requested()
      await held
      await route.fulfill({ response })
    })
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await checking
      await frame.getByLabel('Email').fill(email)
      const submit = frame.getByRole('button', { name: 'Continue with email' })
      await submit.click()
      await submit.click()
      release()

      await frame
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page.locator('#who')).toHaveText(email)
      expect(sent).toHaveLength(1)
    } finally {
      release()
    }
  })

  test("runs no submit that waited for the check of a request that the page replaced, and sends the code of the next request's submit alone", async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    // The page holds the check's response of the first request while the user submits an email.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = () => {}
    const checking = new Promise<void>((resolve) => {
      requested = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      const response = await route.fetch()
      requested()
      await held
      await route.fulfill({ response })
    })
    const sent: unknown[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push((request.postDataJSON() as { email?: unknown }).email)
    })
    const replaced = `tempo-id-test+${crypto.randomUUID()}@example.org`

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await checking
      await frame.getByLabel('Email').fill(replaced)
      await frame.getByRole('button', { name: 'Continue with email' }).click()

      // The page posts the next request before the first one's check returns, which mounts the
      // sign-in again with an empty form.
      await page.evaluate(() => {
        const element = document.querySelector<HTMLIFrameElement>(
          'dialog[data-tempo-id-dialog] iframe',
        )
        if (!element?.contentWindow) return
        const url = new URL(element.src)
        const request = new URLSearchParams({
          client_id: url.searchParams.get('client_id') ?? '',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          redirect_uri: url.searchParams.get('redirect_uri') ?? '',
          response_type: 'code',
          scope: 'openid email',
          state: 'next',
        })
        element.contentWindow.postMessage(
          {
            id: 'next',
            request: request.toString(),
            type: 'tempo-id:embed.request',
          },
          url.origin,
        )
      })
      await expect(frame.getByLabel('Email')).toHaveValue('')
      const finished = page.waitForEvent(
        'requestfinished',
        (request) => new URL(request.url()).pathname === '/i/embed/request',
      )
      release()
      await finished

      // The next request's own submit sends its code, after the first one's check returned.
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      await expect(
        frame.getByRole('textbox', { exact: true, name: 'Code' }),
      ).toBeVisible()

      expect(sent).toEqual([email])
    } finally {
      release()
    }
  })

  test("holds an action until the request's check returns, and offers a popup once it reports that the app lost tempo-id:iframe after the frame loaded", async ({
    database,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', { VITE_KEY: 'false' }),
    ])
    const clientId = Playgrounds.clientId('web')
    const [row] = await database.db
      .select({ scopes: Schema.oauthClient.scopes })
      .from(Schema.oauthClient)
      .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    const scopes = row?.scopes ?? []
    // The frame loads while the app holds `tempo-id:iframe`. The app loses the scope before Tempo ID
    // checks the request, and the page holds the check's response.
    let requested = () => {}
    const checking = new Promise<void>((resolve) => {
      requested = resolve
    })
    let revoke = () => {}
    const revoked = new Promise<void>((resolve) => {
      revoke = resolve
    })
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let checks = 0
    await page.route('**/i/embed/request', async (route) => {
      checks += 1
      if (checks > 1) return await route.continue()
      requested()
      await revoked
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })

    try {
      await page.goto(Playgrounds.url('web'))
      await hydrated(page)
      await page.getByRole('button', { name: 'Sign in via dialog' }).click()
      const frame = await dialogFrame(page)
      await checking
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes: scopes.filter((scope) => scope !== 'tempo-id:iframe') })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
      revoke()

      const sent: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/auth/code')
          sent.push(request.url())
      })
      // The trust from the frame's load predates the change, so the action waits for the check.
      await frame.getByLabel('Email').fill(email)
      await frame.getByRole('button', { name: 'Continue with email' }).click()
      await expect(
        frame.getByRole('textbox', { exact: true, name: 'Code' }),
      ).toHaveCount(0)

      // The check returns that Tempo ID no longer trusts the app. The frame showed no report of its
      // visibility before the action, so the action continues in a popup.
      release()

      await expect(
        page
          .getByRole('dialog')
          .getByText('Continue in a new window to finish signing in.'),
      ).toBeVisible()
      expect(sent).toEqual([])
    } finally {
      revoke()
      release()
      await database.db
        .update(Schema.oauthClient)
        .set({ scopes })
        .where(Sql.eq(Schema.oauthClient.clientId, clientId))
    }
  })

  test('ignores an action just after a cover leaves the frame of an app without tempo-id:iframe, and acts once the frame was in view', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await frame.getByLabel('Email').fill(email)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A cover leaves just before the click it lures, so the frame is in view only for a moment.
    await page.evaluate(() => {
      const cover = document.createElement('div')
      cover.id = 'cover'
      cover.setAttribute('popover', 'manual')
      cover.style.cssText =
        'background: rgb(255 255 255 / 0.9); border: 0; height: 100vh; inset: 0; margin: 0; pointer-events: none; width: 100vw;'
      document.body.appendChild(cover)
      cover.showPopover()
    })
    await expect(frame.locator('main[data-in-view]')).toHaveCount(0)
    await page.evaluate(() => document.getElementById('cover')?.remove())
    await frame.locator('main[data-in-view]').waitFor({ state: 'attached' })
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await acts(frame)

    expect(sent).toEqual([])
    await expect(
      page.getByText('Continue in a new window to finish signing in.'),
    ).toHaveCount(0)

    await frame.getByRole('button', { name: 'Continue with email' }).click()

    await expect(
      frame.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()
  })

  test('ignores an action just after the page replaces the request in the frame of an app without tempo-id:iframe, and acts once the frame was in view', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A page can post another request, such as one with other permissions, just before the click
    // it lures.
    await page.evaluate(() => {
      const element = document.querySelector<HTMLIFrameElement>(
        'dialog[data-tempo-id-dialog] iframe',
      )
      if (!element?.contentWindow) return
      const url = new URL(element.src)
      const request = new URLSearchParams({
        client_id: url.searchParams.get('client_id') ?? '',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        redirect_uri: url.searchParams.get('redirect_uri') ?? '',
        response_type: 'code',
        scope: 'openid email',
        state: 'replaced',
      })
      element.contentWindow.postMessage(
        {
          id: 'replaced',
          request: request.toString(),
          type: 'tempo-id:embed.request',
        },
        url.origin,
      )
    })
    await expect(frame.locator('main[data-visible]')).toHaveCount(0)
    // Playwright's checks before a fill and a click can outlast the time in view, so the frame
    // submits the form at once.
    await frame.getByLabel('Email').evaluate((field, value) => {
      if (!(field instanceof HTMLInputElement)) return
      field.value = value
      field.form?.requestSubmit()
    }, email)

    // The frame acts once the time in view ends, after the ignored submit sent any request.
    await acts(frame)
    expect(sent).toEqual([])

    await frame.getByRole('button', { name: 'Continue with email' }).click()

    await expect(
      frame.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()
  })

  test('ignores a click on a control that the next step adds in the frame of an app without tempo-id:iframe, and acts once the step was in view', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await acts(frame)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A page can lure a second click onto the place where the next step shows a control. The click
    // lands as the step adds the control, before the resize of the content reports.
    await frame.locator('main').evaluate((main) => {
      new MutationObserver((records, observer) => {
        const added = records.flatMap((record) => [...record.addedNodes])
        for (const node of added) {
          if (!(node instanceof Element)) continue
          const button = [...node.querySelectorAll('button')].find((entry) =>
            entry.textContent?.includes('Resend code'),
          )
          if (!button) continue
          observer.disconnect()
          button.click()
          return
        }
      }).observe(main, { childList: true, subtree: true })
    })
    await frame.getByLabel('Email').fill(email)
    await frame.getByRole('button', { name: 'Continue with email' }).click()
    await expect(
      frame.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()

    // The frame acts once the step was in view, after the ignored click sent any request.
    await acts(frame)
    expect(sent).toHaveLength(1)
    await expect(
      page.getByText('Continue in a new window to finish signing in.'),
    ).toHaveCount(0)

    await frame.getByRole('button', { name: 'Resend code' }).click()

    await expect(frame.getByRole('button', { name: 'Code sent' })).toBeVisible()
    expect(sent).toHaveLength(2)
  })

  test('refuses an action while the page makes the frame of an app without tempo-id:iframe too short for the key card beside the button, and offers a popup', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await frame.getByLabel('Email').fill(email)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A page sets the frame's size, so it can keep the frame shorter than its content, which then
    // scrolls in the frame and shows one button alone, without the key card. Nothing covers or clips
    // the frame.
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent =
        'dialog[data-tempo-id-dialog] iframe { height: 120px !important; }'
      document.head.appendChild(style)
    })
    // The frame's content scrolls to the button, as a user scrolls it, so the click needs no scroll
    // of its own, which would start the time in view again.
    await frame
      .getByRole('button', { name: 'Continue with email' })
      .evaluate((button) => button.scrollIntoView({ block: 'end' }))
    // The frame acts only while it shows the key card beside the button, however long nothing covers
    // it.
    await acts(frame)
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))

    await expect(
      page
        .getByRole('dialog')
        .getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    expect(sent).toEqual([])
  })

  test('acts in a frame of an app without tempo-id:iframe that is shorter than its content, while the key card and the button are in view', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)

    // A short screen holds the frame below its content, which scrolls in the frame. The frame keeps
    // the key card and the form in view, and the title above them scrolls out.
    const height = await frame.locator('main').evaluate((main) => {
      const card = main.querySelector('[data-grant]')
      if (!card) throw new Error('The sign-in shows no key card.')
      return Math.ceil(
        main.getBoundingClientRect().bottom -
          card.getBoundingClientRect().top +
          8,
      )
    })
    await page.evaluate((value) => {
      const style = document.createElement('style')
      style.textContent = `dialog[data-tempo-id-dialog] iframe { height: ${value}px !important; }`
      document.head.appendChild(style)
    }, height)
    await frame
      .locator('main')
      .evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

    await frame.getByLabel('Email').fill(email)
    // The scroll starts the time in view again, since it changes what the frame shows.
    await acts(frame)
    await frame.getByRole('button', { name: 'Continue with email' }).click()

    await expect(
      frame.getByRole('textbox', { exact: true, name: 'Code' }),
    ).toBeVisible()
    await expect(
      page.getByText('Continue in a new window to finish signing in.'),
    ).toHaveCount(0)
  })

  test('refuses an action while the page clips the frame of an app without tempo-id:iframe, and offers a popup', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await frame.getByLabel('Email').fill(email)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A page can clip the frame to one button without the key card, which nothing covers: the frame
    // keeps its height, and the dialog around it shows only a strip of it. The strip holds the
    // button, so the click needs no scroll.
    const strip = await frame.locator('main').evaluate((main) => {
      const button = [...main.querySelectorAll('button')]
        .find((entry) => entry.textContent?.includes('Continue with email'))
        ?.getBoundingClientRect()
      if (!button) throw new Error('The sign-in shows no button.')
      return {
        height: Math.ceil(button.height + 8),
        top: Math.floor(button.top - 4),
      }
    })
    await clip(page, strip)
    // The frame acts only while it shows the key card beside the button, however long nothing covers
    // it.
    await acts(frame)
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))

    await expect(
      page
        .getByRole('dialog')
        .getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    expect(sent).toEqual([])
  })

  test('refuses an action while the page clips a step without a key card in the frame of an app without tempo-id:iframe to its button, and offers a popup', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web-cash', { VITE_KEY: 'false' }),
    ])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await frame.getByLabel('Email').fill(email)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // A step without a key card names what the action grants only in its other text, such as the
    // app's name, so the page clips the frame to a strip that shows the button alone.
    const strip = await frame.locator('main').evaluate((main) => {
      const button = [...main.querySelectorAll('button')]
        .find((entry) => entry.textContent?.includes('Continue with email'))
        ?.getBoundingClientRect()
      if (!button) throw new Error('The sign-in shows no button.')
      return {
        height: Math.ceil(button.height + 8),
        top: Math.floor(button.top - 4),
      }
    })
    await clip(page, strip)
    await acts(frame)
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))

    await expect(
      page
        .getByRole('dialog')
        .getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    expect(sent).toEqual([])
  })

  test('refuses an action after the page moves a clip of the same size off the key card in the frame of an app without tempo-id:iframe, and offers a popup', async ({
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([playgrounds('api'), playgrounds('web-cash')])
    await page.goto(Playgrounds.url('web-cash'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Sign in via dialog' }).click()
    const frame = await dialogFrame(page)
    await expect(frame.locator('main[data-visible]')).toHaveCount(1)
    await frame.getByLabel('Email').fill(email)
    const sent: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/auth/code')
        sent.push(request.url())
    })

    // The page first clips the frame to a strip that shows the key card beside the button.
    const strip = await frame.locator('main').evaluate((main) => {
      const card = main.querySelector('[data-grant]')?.getBoundingClientRect()
      const button = [...main.querySelectorAll('button')]
        .find((entry) => entry.textContent?.includes('Continue with email'))
        ?.getBoundingClientRect()
      if (!card || !button)
        throw new Error('The sign-in shows no key card or button.')
      return {
        below: main.getBoundingClientRect().bottom - button.bottom,
        height: Math.ceil(button.bottom - card.top + 8),
        top: Math.floor(card.top - 4),
      }
    })
    await clip(page, strip)
    await acts(frame)

    // The page then moves the strip down at the same size, so the share of the frame in view stays
    // the same, and the top of the key card leaves the view.
    expect(strip.below).toBeGreaterThan(24)
    await clip(page, { ...strip, top: strip.top + 20 })
    // The frame reports the key card out of view at its next rendering step. The browser notifies
    // its observers in the order of their creation, so an observer that the test adds notifies last.
    await frame.locator('[data-grant]').evaluate(
      (card) =>
        new Promise<void>((resolve) => {
          const observer = new IntersectionObserver(
            (entries) => {
              if (!entries.some((entry) => entry.intersectionRatio < 0.99))
                return
              observer.disconnect()
              resolve()
            },
            { threshold: 0.99 },
          )
          observer.observe(card)
        }),
    )
    await refuse(frame.getByRole('button', { name: 'Continue with email' }))

    await expect(
      page
        .getByRole('dialog')
        .getByText('Continue in a new window to finish signing in.'),
    ).toBeVisible()
    expect(sent).toEqual([])
  })
})

/**
 * Resolves once the frame of an app without `tempo-id:iframe` acts on the user's actions: after the
 * frame's next two rendering steps, whose resize or scroll starts the time in view again, and once
 * IntersectionObserver v2 reported nothing over the frame for that time.
 */
async function acts(frame: FrameLocator) {
  await frame
    .locator('main')
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
  await expect(frame.locator('main[data-visible]')).toHaveCount(1)
}

/**
 * Clips the frame of the dialog on `page` to a strip of `height` pixels from `top` in the frame. The
 * dialog keeps the frame's full height, and shows only the strip, which nothing covers.
 */
async function clip(page: Page, options: { height: number; top: number }) {
  await page.evaluate((value) => {
    const dialog = document.querySelector<HTMLElement>(
      'dialog[data-tempo-id-dialog]',
    )
    const frame = dialog?.querySelector('iframe')
    if (!dialog || !frame) throw new Error('The page shows no dialog.')
    frame.style.maxHeight = 'none'
    dialog.style.maxHeight = `${value.height}px`
    dialog.scrollTop = frame.offsetTop + value.top
  }, options)
}

/** Returns the frame of the dialog on `page`, once its page hydrates and the dialog's entrance ends. */
async function dialogFrame(page: Page) {
  const frame = page.frameLocator('dialog[data-tempo-id-dialog][open] iframe')
  await frame
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached' })
  // The entrance scales the dialog, which moves the frame. Playwright checks that an element is
  // stable in its frame's own viewport, so a click during the entrance can miss the element.
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

/**
 * Waits until the open dialog on `page` sizes its frame to the content of `frame`, and the browser
 * draws the new size. The dialog centers the frame, so a change of the content's height moves each
 * control on the page. Playwright checks that a control is stable in its frame alone. The browser
 * hit-tests a click against the page as it last drew it, so a click as the frame moves can miss.
 */
async function fitted(page: Page, options: { frame: FrameLocator }) {
  await expect
    .poll(async () => {
      const content = await options.frame
        .locator('main')
        .evaluate((main) => Math.ceil(main.getBoundingClientRect().height))
      const height = await page
        .locator('dialog[data-tempo-id-dialog][open] iframe')
        .evaluate((element) => element.style.height)
      return height === `${content}px`
    })
    .toBe(true)
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
}

/** Serves Tempo ID's configured origin from the harness at `harness`, for the pages of `page`'s context. */
async function forward(page: Page, options: { harness: URL }) {
  await page.context().route(`${Env.origin}/**`, (route) =>
    // A read that the playground retries as the test ends outlives the page, and the context's close
    // disposes its response before the route fulfills it.
    Playgrounds.forward(route, { target: options.harness.href }).catch(
      (error: unknown) => {
        if (!page.isClosed()) throw error
      },
    ),
  )
}

/**
 * Clicks `locator` for an action that the frame refuses. The dialog removes the frame for the popup
 * offer as the click lands, so the click skips Playwright's check of its target, which the removed
 * frame never answers. The click also skips the wait for a stable position, so `locator` is in view
 * before it: a scroll of the dialog in the click can move the control after Playwright reads its
 * position.
 */
async function refuse(locator: Locator) {
  await locator.click({ force: true })
}

/** Returns whether the open dialog shows the frame element `frame`, which loaded before it opened. */
async function shows(page: Page, options: { frame: ElementHandle | null }) {
  const shown = await page
    .locator('dialog[data-tempo-id-dialog][open] iframe')
    .elementHandle()
  return await shown?.evaluate(
    (element, other) => element === other,
    options.frame,
  )
}
