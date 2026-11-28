/**
 * Tests the web test app as a third-party app: a build whose client ID is its own origin, which
 * Tempo ID holds no registration of. The user grants each access key on a page of Tempo ID, in the
 * frame or in a popup. Tempo ID serves the routes of an app's own form, and of an owner's signature,
 * to first-party apps alone, and `useSession` authorizes nothing at a mount.
 *
 * The frame of a third-party app holds each action until its content shows. `signIn` detects the
 * hold, and each other helper of the frame takes `held`.
 * @module
 */
import type { Page } from '@playwright/test'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The origin of the third-party build, which is also its client ID. */
const origin = Apps.thirdParty.url

/** The rejection of `accounts.authorize` for a third-party client ID, as the page shows it. */
const rejected = {
  code: 'invalid_request',
  message:
    'Headless authorization refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with `dialog.signIn` or `redirect.signIn`.',
  name: 'Accounts.RequestError',
  reason: 'rejected',
  status: 400,
}

/** The URL of each page of the third-party build. */
const urls = {
  custom: Web.url({ origin, path: Apps.thirdParty.paths.custom }),
  dialog: Web.url({ origin, path: Apps.thirdParty.paths.dialog }),
  popup: Web.url({ origin, path: Apps.thirdParty.paths.popup }),
} as const

/**
 * Returns the console errors of a request to `path` of Tempo ID that the browser blocked, since
 * Tempo ID's response names no origin that may read it.
 */
function blocked(path: string) {
  const address = `${TempoId.url}${path}`.replaceAll(/[.?]/g, '\\$&')
  return [
    expect.stringMatching(
      new RegExp(
        `^Access to fetch at '${address}[^']*' from origin '${origin}' has been blocked by CORS policy`,
      ),
    ),
    'Failed to load resource: net::ERR_FAILED',
  ]
}

/**
 * Signs `email` in through the dialog of the dialog page of the third-party build, as the first step
 * of a test. Returns the session's access key.
 */
function enter(page: Page, options: enter.Options) {
  const { capture, code, email } = options
  return test.step('signs in through the dialog', async () => {
    await page.goto(urls.dialog)
    await Playwright.start(page, { name: 'Sign in' })
    await Playwright.signIn(await Playwright.dialog(page), {
      code,
      email,
      held: true,
    })
    const session = await Playwright.outcome(page, { name: 'Sign in' })
    expect(session.state).toBe('fulfilled')
    const key: Web.Key = session.value.key

    await capture('signed in')
    return key
  })
}

declare namespace enter {
  type Options = Pick<Web.enter.Options, 'capture' | 'code' | 'email'>
}

/**
 * Returns the requests of `page` to Tempo ID, as the method and the path of each. The list grows as
 * the page sends them.
 */
function requests(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => {
    const { origin, pathname } = new URL(request.url())
    if (origin === TempoId.url) requests.push(`${request.method()} ${pathname}`)
  })
  return requests
}

/**
 * Sends 2.5 OUSD from the session of the test app on `page` to a new address, and asserts that the
 * node holds the amount for it.
 */
async function sent(page: Page) {
  const recipient = privateKeyToAddress(generatePrivateKey())
  const transfer = await Playwright.send(page, { amount: '2.5', to: recipient })

  expect(transfer.state).toBe('fulfilled')
  expect(await Chain.balance({ address: recipient, token: Chain.ousd })).toBe(
    2_500_000n,
  )
}

test.describe('third-party app', () => {
  test('signs in through the frame, which shows the grant, and sends OUSD', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(urls.dialog)

    const first =
      await test.step('shows the grant on the sign-in form, and signs a new user in with no approval page', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const frame = await Playwright.dialog(page)
        await expect(Playwright.form(frame)).toBeVisible()
        await expect(Playwright.grant(frame)).toContainText(['Spend $100'])
        await capture('grant on the sign-in form')
        await Playwright.signIn(frame, { code, email, held: true })

        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            email,
            key: {
              account: expect.stringMatching(/^0x/),
              chainId: Chain.chain.id,
            },
          },
        })
        await capture('signed in')
        return session.value.key as Web.Key
      })

    await test.step('sends OUSD with the access key, which the node registers', async () => {
      await Chain.fund({ address: first.account })

      await sent(page)
      await capture('sent')
    })

    await test.step('shows the approval page to a signed-in user, and returns another access key', async () => {
      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await Playwright.start(page, { name: 'Sign in' })
      const frame = await Playwright.dialog(page)
      await expect(Playwright.grant(frame)).toContainText(['Spend $100'])
      await expect(Playwright.form(frame)).toHaveCount(0)
      await capture('approval page')
      await Playwright.approve(frame, { held: true })

      const session = await Playwright.outcome(page, { name: 'Sign in' })
      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { email, key: { account: first.account } },
      })
      expect(session.value.key.id).not.toBe(first.id)
      await sent(page)
      await capture('approved and sent')
    })
  })

  test('signs a new user in through the frame with `signIn` without `held`, which waits until a cover over the content goes', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(urls.dialog)

    await test.step('signs in while a cover hides the content of the frame', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), {
        code,
        email,
        // The cover lets clicks through, and stays past the code's arrival, so the frame holds the
        // email's submit and the code until it goes.
        filled: () =>
          page.evaluate(() => {
            const cover = document.createElement('div')
            cover.popover = 'manual'
            cover.style.cssText =
              'background: white; border: 0; height: 100vh; inset: 0; margin: 0; opacity: 0.5; pointer-events: none; width: 100vw;'
            document.body.append(cover)
            cover.showPopover()
            setTimeout(() => cover.remove(), 3_000)
          }),
      })
      const session = await Playwright.outcome(page, { name: 'Sign in' })

      expect(session).toMatchObject({ state: 'fulfilled', value: { email } })
      await capture('signed in')
    })
  })

  test('signs in through a popup, which closes after the code, and sends OUSD', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(urls.popup)

    const key =
      await test.step('shows the grant in the window, and returns the session to the page', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await expect(Playwright.form(window)).toBeVisible()
        await expect(Playwright.grant(window)).toContainText(['Spend $100'])
        await capture('grant in the popup', window)
        const closing = window.waitForEvent('close')
        await Playwright.signIn(window, { code, email })
        await closing

        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { chainId: Chain.chain.id } },
        })
        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('signed in')
        return session.value.key as Web.Key
      })

    await test.step('sends OUSD with the access key', async () => {
      await Chain.fund({ address: key.account })

      await sent(page)
      await capture('sent')
    })
  })

  test('signs in and pays in popups that open at the click in a browser without IntersectionObserver v2, in place of the frame', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await test.step('loads the dialog page with `par=0`, without IntersectionObserver v2', async () => {
      // Safari reports no visibility of a frame, so the frame of a third-party app cannot show that
      // nothing covers it. With `par: false`, the plugin's copy of the configuration holds the
      // preloaded frame, which `accounts.pay` reads through the instance's configuration. The page
      // records the types of the frames' messages.
      await page.context().addInitScript(() => {
        delete (IntersectionObserverEntry.prototype as { isVisible?: boolean })
          .isVisible
        const messages: string[] = []
        ;(window as { messages?: string[] }).messages = messages
        window.addEventListener('message', (event) => {
          const type = (event.data as { type?: unknown } | null)?.type
          if (typeof type === 'string') messages.push(type)
        })
      })
      await page.goto(
        Web.url({ origin, par: '0', path: Apps.thirdParty.paths.dialog }),
      )
      await expect
        .poll(() =>
          page.evaluate(() => (window as { messages?: string[] }).messages),
        )
        .toContain('tempo-id:embed.loaded')
    })

    // The sign-in takes the preloaded frame, which the page does not load again, so the payment
    // reads the trust that the frame reported.
    const key =
      await test.step('signs in through a popup, which opens at the click', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await Playwright.signIn(window, { code, email })
        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        await capture('signed in')
        return session.value.key as Web.Key
      })
    await Chain.fund({ address: key.account })

    await test.step('pays 150 OUSD on the payment page in the popup, which opens at the click', async () => {
      // 150 OUSD exceeds the access key's limit of 100, so no access key sends it.
      const recipient = '0x000000000000000000000000000000000000dEaD'
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Pay 150 OUSD' }),
      })
      const payment = await Playwright.payment(window)
      // The page shows the popup's offer to show its window, in place of a frame's offer of a popup.
      await expect(Playwright.prompt(page)).toHaveText(
        /^Continue in the Tempo ID window\./,
      )
      await capture('payment page in the popup', window)
      await payment.pay.click()
      const result = await Playwright.outcome(page, { name: 'Pay 150 OUSD' })

      expect(result.state).toBe('fulfilled')
      await expect.poll(() => window.isClosed()).toBe(true)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 150_000_000n,
        from: key.account,
        to: recipient,
      })
      await capture('paid in the popup')
    })

    await test.step('sends 96 OUSD with the access key, within its limit of 100', async () => {
      const transfer = await Playwright.send(page, {
        amount: '96',
        to: '0x000000000000000000000000000000000000dEaD',
      })

      expect(transfer.state).toBe('fulfilled')
    })

    await test.step('pays 5 OUSD in a popup that opens within the click once the chain refuses the access key, without a frame', async () => {
      // The access key sends first. The chain refuses it, since the first transfer and its fee spent
      // all but 4 of the limit. The popup then opens within the same click.
      const framed: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/embed/pay')
          framed.push(request.url())
      })
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Pay 5 OUSD' }),
      })
      const payment = await Playwright.payment(window)

      await expect(payment.pay).toHaveText('Pay $5.00')
      await expect(Playwright.prompt(page)).toHaveText(
        /^Continue in the Tempo ID window\./,
      )
      expect(framed).toEqual([])
      await capture('payment page in the popup after the refusal', window)

      await payment.pay.click()
      const result = await Playwright.outcome(page, { name: 'Pay 5 OUSD' })

      expect(result.state).toBe('fulfilled')
      await expect.poll(() => window.isClosed()).toBe(true)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 5_000_000n,
        from: key.account,
        to: '0x000000000000000000000000000000000000dEaD',
      })
    })
  })

  test('refuses or receives no response for a request of the app’s own form', async ({
    capture,
    email,
    errors,
    page,
  }) => {
    await page.goto(urls.custom)

    await test.step('rejects `email.sendCode` with `rejected` before any request', async () => {
      await page.getByLabel('Email').fill(email)
      const before = requests(page)
      const sent = await Playwright.run(page, { name: 'Send code' })

      expect(sent).toEqual({
        state: 'rejected',
        value: {
          code: 'invalid_request',
          message:
            "Email sign-in refused: the client ID is an origin, which names a third-party app. Pass `clientId`, the ID of the app's first-party registration, or sign in with `dialog.signIn` or `redirect.signIn`.",
          name: 'Accounts.RequestError',
          reason: 'rejected',
          status: 400,
        },
      })
      expect(before).toEqual([])
      expect(errors.splice(0)).toEqual([])
      await capture('no code')
    })

    await test.step('returns `false` from `passkey.available`', async () => {
      const available = await Playwright.run(page, {
        name: 'Passkey available',
      })

      expect(available).toEqual({ state: 'fulfilled', value: false })
      expect(errors.splice(0)).toEqual(blocked('/v1/realms'))
      await capture('no passkey')
    })

    await test.step('rejects `accounts.authorize` before any request', async () => {
      const sent = requests(page)
      const session = await Playwright.run(page, { name: 'Authorize' })

      expect(session).toEqual({ state: 'rejected', value: rejected })
      expect(sent).toEqual([])
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('no authorization')
    })
  })

  test('rejects `accounts.authorize` for a signed-in user, whose session stays', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await enter(page, { capture, code, email })

    await test.step('rejects on the custom page, and keeps the session and its access key', async () => {
      await page.goto(urls.custom)
      await expect(page.locator('#history')).toHaveText('pending signedIn')
      const before = await Playwright.run(page, { name: 'Session' })
      const sent = requests(page)
      const session = await Playwright.run(page, { name: 'Authorize' })

      expect(session).toEqual({ state: 'rejected', value: rejected })
      expect(sent).toEqual([])
      expect(before.value.key).toEqual(key)
      expect(await Playwright.run(page, { name: 'Session' })).toEqual(before)
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('session stays')
    })

    await test.step('sends OUSD with the access key that the session keeps', async () => {
      await Chain.fund({ address: key.account })

      await sent(page)
      await capture('sent')
    })
  })

  test('reads no account of the user, so it requests no signature of the owner', async ({
    capture,
    code,
    email,
    errors,
    page,
  }) => {
    await enter(page, { capture, code, email })

    await test.step('rejects `account.get`, whose response the browser blocks', async () => {
      const signature = await Playwright.run(page, {
        name: 'Sign a message as the owner',
      })

      expect(signature).toMatchObject({
        state: 'rejected',
        value: { message: 'Failed to fetch', name: 'TypeError' },
      })
      expect(errors.splice(0)).toEqual(blocked('/v1/account'))
      await capture('no account')
    })

    await test.step('refreshes the session, and reads the user info, as any OAuth app does', async () => {
      const before = await Playwright.run(page, { name: 'Session' })
      const session = await Playwright.run(page, { name: 'Refresh' })
      const user = await Playwright.run(page, { name: 'User info' })

      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { email, key: before.value.key },
      })
      expect(session.value.accessToken).not.toBe(before.value.accessToken)
      expect(user).toEqual({
        state: 'fulfilled',
        value: { email, status: 200 },
      })
      await capture('refreshed')
    })
  })

  test('rejects `funding.open` with `AddressRequiredError` after a sign-in without an access key, before any page or account read', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await test.step('signs in through the dialog without an access key', async () => {
      await page.goto(
        Web.url({
          accessKey: false,
          origin,
          path: Apps.thirdParty.paths.dialog,
        }),
      )
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), {
        code,
        email,
        held: true,
      })

      expect((await Playwright.outcome(page, { name: 'Sign in' })).state).toBe(
        'fulfilled',
      )
      await capture('signed in')
    })

    await test.step('rejects the deposit with no deposit page, no popup, and no read of the account', async () => {
      const requests: string[] = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (
          url.origin === new URL(TempoId.url).origin &&
          ['/embed/deposit', '/v1/account'].includes(url.pathname)
        )
          requests.push(`${request.method()} ${url.pathname}`)
      })
      const popups: string[] = []
      page.on('popup', (popup) => popups.push(popup.url()))
      const deposit = await Playwright.run(page, { name: 'Deposit' })

      expect(deposit).toEqual({
        state: 'rejected',
        value: expect.objectContaining({
          message:
            'No account address: a third-party app reads no account from Tempo ID. Sign in with an access key on the deposit chain, or pass `address`.',
          name: 'Plugins.funding.AddressRequiredError',
        }),
      })
      expect(requests).toEqual([])
      expect(popups).toEqual([])
      await capture('address required')
    })
  })

  test('ends a session whose access key expired at a mount, with no authorization request', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(
      Web.url({ expiry: '15s', origin, path: Apps.thirdParty.paths.dialog }),
    )

    const key =
      await test.step('signs in with an access key that expires in 15 seconds', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await Playwright.signIn(await Playwright.dialog(page), {
          code,
          email,
          held: true,
        })
        const session = await Playwright.outcome(page, { name: 'Sign in' })

        expect(session.state).toBe('fulfilled')
        await capture('signed in')
        return session.value.key as Web.Key
      })

    await test.step('waits for the expiry of the access key', async () => {
      await expect
        .poll(() => Date.now() / 1000 > key.expiry!, { timeout: 30_000 })
        .toBe(true)
      await capture('expired')
    })

    await test.step('shows `signedOut` at the next page load, and requests no access key', async () => {
      const sent = requests(page)
      await page.goto(urls.dialog)

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      expect(await Playwright.run(page, { name: 'Session' })).toEqual({
        state: 'fulfilled',
        value: null,
      })
      // `reauthorizeOnMount` defaults to `false` for a client ID that is an origin. The frame loads
      // Tempo ID's own chunks, such as `/assets/authorize-*.js`, which request nothing.
      expect(
        sent.filter(
          (request) =>
            !request.includes('/assets/') &&
            /authorize|\/oauth2\/token/.test(request),
        ),
      ).toEqual([])
      await capture('signed out')
    })
  })
})
