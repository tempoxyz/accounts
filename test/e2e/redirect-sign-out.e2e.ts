/**
 * Tests the sign-out of a native app that signs in through a redirect in the system browser, as the
 * Expo preset does. The system browser keeps its Tempo ID session after the app signs out, so the
 * next sign-in asks the user to sign in again.
 * @module
 */
import { devices, type Page } from '@playwright/test'
import { tempoTestnet } from 'viem/tempo/chains'
import { Id, Store } from 'accounts'
import { redirect } from 'accounts/plugins'
import * as Admin from '../Admin.js'
import { expect, hydrated, test } from '../Playwright.js'

/** The redirect URI of the app, on its scheme, as the mobile playground's. */
const redirectUri = 'xyz.tempo.example.mobile:/callback'

// The system browser of a phone. Chromium runs it, so the descriptor's browser type stays out.
const { defaultBrowserType: _, ...phone } = devices['Pixel 7']
test.use({ ...phone })

test.describe('redirect sign-in in the system browser', () => {
  test('asks for a new sign-in after the app signs out, also after a restart or during the sign-out, and reuses the session after an expiry', async ({
    baseURL,
    code,
    admin,
    email,
    page,
  }) => {
    // A first-party app, which skips the approval page.
    const clientId = crypto.randomUUID()
    await Admin.createApp(admin, {
      clientId,
      name: 'Mobile playground',
      redirectUris: [redirectUri],
      type: 'native',
    })
    // The code of the first sign-in, which the inbox holds until the second code arrives.
    let first: string | undefined
    const screens: string[] = []
    // The device's store, which outlives each instance, as the secure store outlives the app.
    const store = Store.memory()
    const create = () =>
      Id.create({
        chainId: tempoTestnet.id,
        clientId,
        plugins: [redirect({ open: (url) => open(page, { screens, url }) })],
        redirectUri,
        store,
        url: new URL(baseURL!).origin,
      })
    let tempoId = create()

    await test.step('signs in with the emailed code', async () => {
      const signedIn = tempoId.redirect.signIn({ accessKey: false })
      first = await signIn(page, { code, email })

      expect((await signedIn)?.user.email).toBe(email)
    })

    await test.step('signs out, and opens the sign-in page with the address on the next sign-in after a restart', async () => {
      await tempoId.signOut()
      await page.goto('about:blank')
      screens.length = 0
      tempoId = create()

      const signedIn = tempoId.redirect.signIn({ accessKey: false })
      await expect(page).toHaveURL(/\/login\?/)
      await hydrated(page)
      await expect(page.getByLabel('Email')).toHaveValue(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      let second: string | undefined
      await expect
        .poll(async () => (second = await code(email)))
        .not.toBe(first)
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(second!)

      expect((await signedIn)?.user.email).toBe(email)
      expect(screens).toEqual(['/login'])
    })

    await test.step('reuses the Tempo ID session for a sign-in without a sign-out, such as after an expiry', async () => {
      screens.length = 0

      const signedIn = await tempoId.redirect.signIn({ accessKey: false })

      expect(signedIn?.user.email).toBe(email)
      expect(screens).toEqual([])
    })

    await test.step('opens the sign-in page for a sign-in that starts while the sign-out runs', async () => {
      await page.goto('about:blank')
      screens.length = 0

      const signedOut = tempoId.signOut()
      // The test leaves this sign-in on the sign-in page, so it never settles, and the step does not
      // await it.
      void tempoId.redirect.signIn({ accessKey: false }).catch(() => undefined)
      await expect(page).toHaveURL(/\/login\?/)
      await signedOut

      expect(screens).toEqual(['/login'])
    })
  })
})

/**
 * Opens the URL as the system browser does, and resolves with the callback URL once Tempo ID
 * redirects to the app's scheme. Records the path of each Tempo ID page that it shows.
 */
async function open(page: Page, options: open.Options) {
  const callback = new Promise<string>((resolve) => {
    const listener = (request: { url: () => string }) => {
      if (!request.url().startsWith(redirectUri)) return
      page.off('request', listener)
      page.off('framenavigated', navigated)
      resolve(request.url())
    }
    const navigated = (frame: { url: () => string }) => {
      if (frame !== page.mainFrame()) return
      // A page replaces its own URL as its steps change, which shows no new screen.
      const { pathname } = new URL(frame.url())
      if (
        pathname === '/oauth2/authorize' ||
        options.screens.at(-1) === pathname
      )
        return
      options.screens.push(pathname)
    }
    page.on('request', listener)
    page.on('framenavigated', navigated)
  })
  // The browser aborts the navigation to the app's scheme, which only the app handles.
  await page.goto(options.url).catch(() => undefined)
  return callback
}

declare namespace open {
  type Options = {
    /** The paths of the Tempo ID pages that the browser showed. */
    screens: string[]
    /** The authorization URL. */
    url: string
  }
}

/** Signs in on the sign-in page with the emailed code. Returns the code. */
async function signIn(
  page: Page,
  options: {
    code: (email: string) => Promise<string>
    email: string
  },
) {
  await expect(page).toHaveURL(/\/login\?/)
  await hydrated(page)
  await page.getByLabel('Email').fill(options.email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  const code = await options.code(options.email)
  await page.getByRole('textbox', { exact: true, name: 'Code' }).fill(code)
  return code
}
