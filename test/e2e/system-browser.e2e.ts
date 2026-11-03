/**
 * Tests the browser history of a sign-in in the system browser, as the Expo preset opens it. Each
 * Tempo ID step replaces the one before it, so the back button leaves Tempo ID, which closes the
 * system browser on a phone, rather than showing a step that the user already finished.
 * @module
 */
import { devices, type Page } from '@playwright/test'
import { Id, Store } from 'accounts'
import { redirect } from 'accounts/plugins'
import * as Admin from '../Admin.js'
import { expect, hydrated, test } from '../Playwright.js'
import { Chain } from '../TempoId.js'

/** The redirect URI of the app, on its scheme, as the mobile playground's. */
const redirectUri = 'xyz.tempo.example.mobile:/callback'

// The system browser of a phone. Chromium runs it, so the descriptor's browser type stays out.
const { defaultBrowserType: _, ...phone } = devices['Pixel 7']
test.use({ ...phone })

test.describe('redirect sign-in in the system browser', () => {
  test('leaves Tempo ID on the back button from the approval page, without the sign-in page again', async ({
    baseURL,
    code,
    admin,
    email,
    page,
  }) => {
    const clientId = crypto.randomUUID()
    await Admin.createApp(admin, {
      clientId,
      name: 'Mobile playground',
      redirectUris: [redirectUri],
      type: 'native',
    })
    const tempoId = Id.create({
      accessKey: { expiry: '1d', limits: [{ limit: '1000', token: 'ousd' }] },
      chainId: Chain.chain.id,
      clientId,
      plugins: [redirect({ open: (url) => open(page, { url }) })],
      redirectUri,
      store: Store.memory(),
      url: new URL(baseURL!).origin,
    })

    await test.step('signs in with the emailed code, and reaches the approval page', async () => {
      // The test leaves the system browser with the back button, so the sign-in never settles.
      void tempoId.redirect.signIn().catch(() => undefined)
      await expect(page).toHaveURL(/\/login\?/)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))

      await expect(
        page.getByRole('heading', { name: 'Authorize this app' }),
      ).toBeVisible()
    })

    await test.step('goes back to the page before Tempo ID, with no request to Tempo ID', async () => {
      await hydrated(page)
      const requests: string[] = []
      page.on('request', (request) => {
        if (request.url().startsWith(new URL(baseURL!).origin))
          requests.push(new URL(request.url()).pathname)
      })

      await page.goBack()

      await expect(page).toHaveURL('about:blank')
      expect(requests).toEqual([])
    })
  })
})

/**
 * Opens the URL as the system browser does, and resolves with the callback URL once Tempo ID
 * redirects to the app's scheme.
 */
async function open(page: Page, options: open.Options) {
  const callback = new Promise<string>((resolve) => {
    const listener = (request: { url: () => string }) => {
      if (!request.url().startsWith(redirectUri)) return
      page.off('request', listener)
      resolve(request.url())
    }
    page.on('request', listener)
  })
  // The browser aborts the navigation to the app's scheme, which only the app handles.
  await page.goto(options.url).catch(() => undefined)
  return callback
}

declare namespace open {
  type Options = {
    /** The authorization URL. */
    url: string
  }
}
