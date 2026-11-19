/**
 * Tests a sign-in in a popup window of Tempo ID: on the popup pages of the web test app, on the
 * dialog page with `mode: 'popup'`, the ways that the sign-in ends without a session, the browser's
 * popup blocker, and a page whose `Cross-Origin-Opener-Policy` severs the popup's handle to it.
 * @module
 */
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The URL of each page. */
const urls = {
  dialog: `${Apps.web.url}${Apps.web.paths.dialog}`,
  isolated: `${Apps.web.url}${Apps.web.paths.isolated}`,
  popup: `${Apps.web.url}${Apps.web.paths.popup}`,
  severed: `${Apps.web.url}${Apps.web.paths.severed}`,
}

/** The error of a sign-in that the user closed. */
const closed = {
  message: 'The user closed the sign-in.',
  name: 'AbortError',
}

test.describe('popup', () => {
  test('signs in through a popup, and sends OUSD with the access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(urls.popup)

    await test.step('signs in on the Tempo ID page in the popup, which closes', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await window.waitForURL(`${TempoId.url}/**`)
      await expect(Playwright.prompt(page)).toContainText(
        'Continue in the Tempo ID window.',
      )
      await capture('waiting for the popup')
      const closing = window.waitForEvent('close')
      await Playwright.signIn(window, { code, email })
      await closing

      const session = await Playwright.outcome(page, { name: 'Sign in' })
      expect(session).toMatchObject({ state: 'fulfilled', value: { email } })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(Playwright.prompt(page)).toHaveCount(0)
      await capture('signed in')
    })

    await test.step('sends OUSD with the access key, which the node registers', async () => {
      const account = await page.locator('#account').innerText()
      await Chain.fund({ address: account as `0x${string}` })
      const transfer = await Playwright.send(page, {
        amount: '2.5',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(2_500_000n)
      await capture('sent')
    })
  })

  test('signs in through a popup with `mode` on a page that signs in in a frame', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(urls.dialog)

    const window =
      await test.step('opens a popup for the one call', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in in a popup' }),
        })
        await window.waitForURL(`${TempoId.url}/**`)
        await capture('popup', window)
        return window
      })

    await test.step('signs in in the popup', async () => {
      await Playwright.signIn(window, { code, email })

      expect(
        await Playwright.outcome(page, { name: 'Sign in in a popup' }),
      ).toMatchObject({
        state: 'fulfilled',
        value: { email },
      })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })
  })

  test('fills the email field of the sign-in in a popup with `loginHint`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(Web.url({ loginHint: email, path: Apps.web.paths.dialog }))

    const window = await Playwright.popup(page, {
      open: () => Playwright.start(page, { name: 'Sign in in a popup' }),
    })
    await window.waitForURL(`${TempoId.url}/**`)

    await test.step('fills the email field with the hint', async () => {
      await expect(Playwright.form(window)).toHaveValue(email)
      await capture('filled', window)
    })

    await test.step('signs in with the filled address', async () => {
      await window.getByRole('button', { name: 'Continue with email' }).click()
      await window
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))

      expect(
        await Playwright.outcome(page, { name: 'Sign in in a popup' }),
      ).toMatchObject({ state: 'fulfilled', value: { email } })
    })
  })

  test('signs in through a popup for a request with `resource` on a page that signs in in a frame, and receives a token for the resource', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(
      Web.url({ path: Apps.web.paths.dialog, resource: Apps.mcp.resource }),
    )

    await test.step('opens a popup, since the frame issues tokens for Tempo ID alone', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await window.waitForURL(`${TempoId.url}/**`)
      await Playwright.signIn(window, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        { state: 'fulfilled', value: { email } },
      )
      await capture('signed in')
    })

    await test.step('holds an access token whose audience is the resource', async () => {
      const proof = await Playwright.run(page, { name: 'Proof' })
      const [, payload] = (
        proof.value as { accessToken: string }
      ).accessToken.split('.')
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString())

      expect([claims.aud].flat()).toContain(Apps.mcp.resource)
      expect([claims.aud].flat()).not.toContain(TempoId.url)
    })
  })

  test('rejects a sign-in whose popup the user closes, or cancels on the page', async ({
    capture,
    page,
  }) => {
    await page.goto(urls.popup)

    await test.step('rejects once the popup closes', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await window.waitForURL(`${TempoId.url}/**`)
      await window.close()

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
        state: 'rejected',
        value: expect.objectContaining(closed),
      })
      await expect(Playwright.prompt(page)).toHaveCount(0)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('popup closed')
    })

    await test.step('closes the popup at Cancel on the page', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await window.waitForURL(`${TempoId.url}/**`)
      const closing = window.waitForEvent('close')
      await Playwright.choose(page, { name: 'Cancel' })
      await closing

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
        state: 'rejected',
        value: expect.objectContaining(closed),
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('cancelled')
    })
  })

  test('rejects a sign-in whose popup the user closes before its page loads, such as offline', async ({
    capture,
    context,
    page,
  }) => {
    await page.goto(urls.popup)
    // Tempo ID's page never loads in the popup, so it reports nothing to the page.
    await context.route(`${TempoId.url}/**`, (route) =>
      route.request().frame().page() === page
        ? route.fallback()
        : route.abort('internetdisconnected'),
    )

    // The page's clock runs past the time that the popup takes to count as open, and past the
    // close's grace for a late callback.
    await page.clock.install()

    const window =
      await test.step('opens the popup, which shows an error page', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        // The popup shows the browser's error page in place of Tempo ID's.
        await expect.poll(() => window.url()).toMatch(/^chrome-error:/)
        await page.clock.runFor(1_000)
        await capture('offline popup', window)
        return window
      })

    await test.step('rejects once the popup closes', async () => {
      await window.close()
      await page.clock.runFor(2_000)

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
        state: 'rejected',
        value: expect.objectContaining(closed),
      })
      await expect(Playwright.prompt(page)).toHaveCount(0)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('popup closed')
    })
  })

  test('closes the popup of a sign-in whose signal aborts', async ({
    capture,
    page,
  }) => {
    await page.goto(urls.popup)

    const window =
      await test.step('opens the popup of a sign-in with a signal', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in with a signal' }),
        })
        await capture('popup', window)
        return window
      })

    await test.step('closes the popup and rejects, once the signal aborts', async () => {
      await Promise.all([window.waitForEvent('close'), Playwright.abort(page)])

      expect(
        await Playwright.outcome(page, { name: 'Sign in with a signal' }),
      ).toEqual({
        state: 'rejected',
        value: expect.objectContaining({
          message: 'The page ended the sign-in.',
          name: 'Error',
        }),
      })
      await expect(Playwright.prompt(page)).toHaveCount(0)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('aborted')
    })
  })

  test('rejects a sign-in in a popup that the browser blocks, outside a click', async ({
    capture,
    page,
  }) => {
    const windows: string[] = []
    page.on('popup', (window) => windows.push(window.url()))
    await page.goto(urls.popup)

    await test.step('rejects the sign-in, and opens no window', async () => {
      await Playwright.call(page, { name: 'Sign in' })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
        state: 'rejected',
        value: expect.objectContaining({ name: 'Actions.dialog.BlockedError' }),
      })
      expect(windows).toEqual([])
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('blocked')
    })
  })

  test('offers the popup of a sign-in that starts outside a click', async ({
    capture,
    code,
    email,
    page,
  }) => {
    // A pushed request signs in with a popup, which the frame's mode falls back to.
    await page.goto(`${urls.dialog}?par=1`)

    await test.step('offers the popup in a dialog', async () => {
      await Playwright.call(page, { name: 'Sign in' })

      await expect(Playwright.prompt(page)).toContainText(
        'Continue in a Tempo ID window to finish signing in.',
      )
      await capture('offer')
    })

    await test.step('signs in after a click on Continue', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.choose(page, { name: 'Continue' }),
      })
      await Playwright.signIn(window, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await capture('signed in')
    })
  })

  test('redeems the code on a page that names its `Cross-Origin-Opener-Policy`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    const response = await page.goto(urls.isolated)
    expect(response?.headers()['cross-origin-opener-policy']).toBe(
      'same-origin',
    )

    await test.step('signs in with the callback that the popup posts from the page’s own URL', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      const returned = window.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          request.url().startsWith(`${urls.isolated}?`),
      )
      await Playwright.signIn(window, { code, email })
      expect(new URL((await returned).url()).searchParams.has('code')).toBe(
        true,
      )

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })

    await test.step('sends OUSD with the access key', async () => {
      const account = await page.locator('#account').innerText()
      await Chain.fund({ address: account as `0x${string}` })
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(1_000_000n)
      await capture('sent')
    })
  })

  test('signs in again with a code on a page that severs the popup and names no policy', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(urls.severed)

    await test.step('receives no response of the first popup, and offers a second', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      // The page's second attempt starts outside the click, as it does once a user took the
      // seconds of a sign-in.
      await Playwright.idle(page)
      const closing = window.waitForEvent('close')
      await Playwright.signIn(window, { code, email })
      await closing

      await expect(Playwright.prompt(page)).toContainText(
        'Continue in a Tempo ID window to finish signing in.',
      )
      await capture('offer')
    })

    await test.step('signs in with the code of the second popup', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.choose(page, { name: 'Continue' }),
      })
      await Playwright.approve(window)

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })
  })
})
