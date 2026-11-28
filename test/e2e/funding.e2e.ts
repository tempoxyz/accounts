/**
 * Tests deposits on the web test app: `funding.open` in a frame, in a popup, and through a redirect
 * with `funding.complete`, the ways that a user ends the deposit page, `funding.preload`, the hint of
 * an amount, the options that the package refuses, and a sign-in that needs an amount in the Tempo
 * Account. The faucet of Tempo ID's deposit page funds the account, and the node holds the balance.
 * @module
 */
import type { Page } from '@playwright/test'
import { parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The OUSD that the faucet of the deposit page sends to an account, in base units. */
const dripped = parseUnits('1000000', 6)

/** The options of a deposit that names an amount, its currency, and its token. */
const hinted = { amount: '1000', currency: 'USD', token: 'ousd' } as const

/** The amount that a sign-in of the suite needs in the Tempo Account: 10 dollars. */
const needed = { amount: '10' } as const

/** Returns the OUSD that the node holds for `address`, in base units. */
function balance(address: `0x${string}`) {
  return Chain.balance({ address, token: Chain.ousd })
}

/**
 * Loads the dialog page again with the deposit options of `options` in its query, for the session
 * that the page holds, and waits until the page restores the session.
 */
async function load(page: Page, options: load.Options) {
  await page.goto(Web.url({ ...options, path: Apps.web.paths.dialog }))
  await expect(page.locator('#status')).toHaveText('signedIn')
}

declare namespace load {
  type Options = Required<Pick<Web.url.Options, 'deposit'>>
}

/**
 * Records the URL of each load of Tempo ID's deposit page in a frame of `page`, from now on. Returns
 * the list, which grows with each load.
 */
function loads(page: Page) {
  const urls: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.isNavigationRequest() && url.pathname === '/embed/deposit')
      urls.push(url)
  })
  return urls
}

test.describe('funding', () => {
  test.describe('funding.open', () => {
    test('funds the account from the faucet of the deposit page in a frame', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        fund: false,
      })
      expect(await balance(key.account)).toBe(0n)

      const deposit =
        await test.step('shows the deposit page in the frame, with no amount', async () => {
          // The deposit page's document waits until the skeleton is checked, so the dialog shows it.
          let release = () => {}
          const released = new Promise<void>((resolve) => {
            release = resolve
          })
          await page.route(`${TempoId.url}/embed/deposit?*`, async (route) => {
            await released
            await route.continue()
          })
          await Playwright.start(page, { name: 'Deposit' })
          const skeleton = Playwright.prompt(page).getByRole('progressbar', {
            name: 'Loading',
          })
          await expect(skeleton).toBeVisible()
          // The skeleton's address sits where the frame's bar draws its own: 8 pixels from the
          // dialog's top and side, 24 pixels tall. The dialog's entrance moves both until it ends.
          await expect
            .poll(async () => {
              const dialog = await Playwright.prompt(page).boundingBox()
              const bar = await skeleton.locator('[data-bar]').boundingBox()
              return {
                height: bar?.height,
                left: (bar?.x ?? 0) - (dialog?.x ?? 0),
                top: (bar?.y ?? 0) - (dialog?.y ?? 0),
              }
            })
            .toEqual({ height: 24, left: 8, top: 8 })
          await capture('skeleton before the deposit page loads')
          release()
          const deposit = await Playwright.deposit(
            await Playwright.dialog(page),
          )

          await expect(deposit.hint).toHaveCount(0)
          await expect(deposit.skip).toHaveCount(0)
          await capture('deposit page')
          return deposit
        })

      await test.step('resolves once the faucet funds the account, and the node holds the balance', async () => {
        await deposit.faucet.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'received' },
        })
        expect(await balance(key.account)).toBe(dripped)
        await Playwright.uncovered(page)
        await capture('received')
      })
    })

    test.describe('with the preference of the browser', () => {
      // Playwright's emulation of a scheme also overrides the scheme that a frame receives.
      test.use({ colorScheme: null })

      test("draws the dialog and the deposit page in the scheme of the app's page, not the browser's", async ({
        capture,
        code,
        email,
        page,
      }) => {
        await Web.enter_dialog(page, { capture, code, email, fund: false })
        // The page's own theme is dark, and the browser prefers light.
        await page.evaluate(() => {
          document.documentElement.style.colorScheme = 'dark'
        })
        expect(
          await page.evaluate(
            () => matchMedia('(prefers-color-scheme: dark)').matches,
          ),
        ).toBe(false)

        await test.step('draws the skeleton dark', async () => {
          let release = () => {}
          const released = new Promise<void>((resolve) => {
            release = resolve
          })
          await page.route(`${TempoId.url}/embed/deposit?*`, async (route) => {
            await released
            await route.continue()
          })
          await Playwright.start(page, { name: 'Deposit' })
          await expect(
            Playwright.prompt(page).getByRole('progressbar', {
              name: 'Loading',
            }),
          ).toBeVisible()

          // The frame's URL names the scheme, since some browsers give a frame the browser's.
          const src = await Playwright.prompt(page)
            .locator('iframe')
            .getAttribute('src')
          expect(new URL(src ?? '').searchParams.get('color_scheme')).toBe(
            'dark',
          )
          expect(
            await Playwright.prompt(page).evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          ).toBe('rgb(26, 26, 26)')
          await capture('dark skeleton')
          release()
        })

        await test.step('draws the deposit page dark', async () => {
          const frame = await Playwright.dialog(page)
          await Playwright.deposit(frame)

          expect(await Playwright.scheme(frame)).toBe('dark')
          await capture('dark deposit page')
        })
      })
    })

    test('funds the account in a popup with `mode`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: { mode: 'popup' },
        email,
        fund: false,
      })

      await test.step('shows the deposit page in a window, which closes once the faucet funds the account', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Deposit' }),
        })
        const deposit = await Playwright.deposit(window)
        expect(new URL(window.url()).searchParams.get('display')).toBe('popup')
        await capture('deposit page', window)
        const closing = window.waitForEvent('close')
        await deposit.faucet.click()
        await closing

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'received' },
        })
        expect(await balance(key.account)).toBe(dripped)
        await capture('received')
      })
    })

    test('leaves the page for the deposit page with `mode`, and `funding.complete` returns the result once', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: { ...needed, mode: 'redirect' },
        email,
        fund: false,
      })

      await test.step('navigates to Tempo ID’s deposit page, which names the amount', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        await page.waitForURL(`${TempoId.url}/deposit?**`)
        const deposit = await Playwright.deposit(page)

        expect(new URL(page.url()).searchParams.get('funding_hint')).toBe(
          needed.amount,
        )
        await expect(deposit.hint).toContainText('at least $10')
        await capture('deposit page')
        await deposit.faucet.click()
      })

      await test.step('returns to the app with the result, which `complete` reads once', async () => {
        await page.waitForURL(`${Apps.web.url}/?deposit_status=received`)
        await expect(page.locator('#status')).toHaveText('signedIn')

        expect(
          await Playwright.run(page, { name: 'Complete the deposit' }),
        ).toEqual({ state: 'fulfilled', value: { status: 'received' } })
        // `complete` removes the result from the URL.
        expect(page.url()).toBe(`${Apps.web.url}/`)
        expect(
          await Playwright.run(page, { name: 'Complete the deposit' }),
        ).toEqual({ state: 'fulfilled', value: null })
        expect(await balance(key.account)).toBe(dripped)
        await capture('completed')
      })
    })

    test('resolves without a deposit once the user closes or skips the deposit page', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: hinted,
        email,
        fund: false,
      })

      await test.step('resolves as closed at the button of the frame’s bar', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await capture('deposit page')
        await deposit.close.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'closed' },
        })
        await Playwright.uncovered(page)
        await capture('closed by the button')
      })

      await test.step('resolves as closed at Escape, in a page that holds no frame of a sign-in', async () => {
        // The hidden frame of the sign-in holds the browser's key focus until the page loads again.
        await page.reload()
        await expect(page.locator('#status')).toHaveText('signedIn')
        await Playwright.start(page, { name: 'Deposit' })
        await Playwright.deposit(await Playwright.dialog(page))
        await page.keyboard.press('Escape')

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'closed' },
        })
        await Playwright.uncovered(page)
        await capture('closed by Escape')
      })

      await test.step('resolves as continued at the link beside the hint, and the node holds no balance', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await deposit.skip.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'continued' },
        })
        expect(await balance(key.account)).toBe(0n)
        await Playwright.uncovered(page)
        await capture('skipped')
      })
    })

    test('names the amount, the currency, and the token to the deposit page as a hint', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: hinted,
        email,
        fund: false,
      })
      const urls = loads(page)

      await test.step('shows the hint, and the node holds at least the amount after the faucet', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))

        expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual(
          [
            expect.objectContaining({
              address: key.account,
              chain: String(Chain.chain.id),
              client_id: Apps.web.clientId,
              funding_currency: hinted.currency,
              funding_hint: hinted.amount,
              funding_token: hinted.token,
              redirect_uri: `${Apps.web.url}/`,
            }),
          ],
        )
        // The deposit page names the app by the host of its redirect URI.
        await expect(deposit.hint).toHaveText(
          `${new URL(Apps.web.url).host} recommends you have at least $1,000 in OUSD in your wallet.`,
        )
        await capture('hint')
        await deposit.faucet.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'received' },
        })
        expect(await balance(key.account)).toBeGreaterThanOrEqual(
          parseUnits(hinted.amount, 6),
        )
        await capture('received')
      })
    })

    test('refuses a deposit to a Tempo Account that the user does not hold, with `address`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const other = privateKeyToAddress(generatePrivateKey())
      await Web.enter_dialog(page, {
        capture,
        code,
        deposit: { address: other },
        email,
        fund: false,
      })

      await test.step('names the user’s account, offers no deposit, and resolves as closed', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await expect(deposit.refusal).toContainText(email)
        await expect(deposit.faucet).toHaveCount(0)
        await capture('refusal')
        await deposit.close.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'closed' },
        })
        expect(await balance(other)).toBe(0n)
        await capture('closed')
      })
    })

    test("opens the deposit page of another chain for the account of the session's access key there, without a read of the account", async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: { chainId: Chain.chain.id },
        email,
        fund: false,
        path: Apps.web.paths.chains,
      })

      await test.step('switches to the second chain, which moves the access key to `accessKeys`', async () => {
        expect(
          await Playwright.run(page, { name: 'Switch to the second chain' }),
        ).toEqual({
          state: 'fulfilled',
          value: { chainId: Chain.second.chain.id },
        })
        await capture('switched')
      })

      await test.step("shows the first chain's deposit page for the access key's account, and reads no account", async () => {
        // The page's own reads run in the deposit frame, so only the app's main frame counts.
        const reads: string[] = []
        page.on('request', (request) => {
          const url = new URL(request.url())
          if (
            request.frame() === page.mainFrame() &&
            url.origin === new URL(TempoId.url).origin &&
            url.pathname === '/v1/account'
          )
            reads.push(request.method())
        })
        const urls = loads(page)
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))

        await expect(deposit.faucet).toBeVisible()
        expect(urls.map((url) => url.searchParams.get('address'))).toEqual([
          key.account,
        ])
        expect(reads).toEqual([])
        await capture('deposit page of the first chain')
      })
    })

    test('rejects a redirect URI of another origin, and a popup outside a click', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const redirectUri = 'https://example.com/'
      const origin = {
        message: `Invalid redirect URI: ${redirectUri} is not on this page's origin, ${Apps.web.url}. Call \`open\` on a page of the redirect URI's origin, or open the deposit page through a redirect.`,
        name: 'Actions.funding.OriginError',
      }
      await Web.enter_dialog(page, {
        capture,
        code,
        deposit: { redirectUri },
        email,
        fund: false,
      })
      const urls = loads(page)
      const windows: string[] = []
      page.on('popup', (window) => windows.push(window.url()))

      await test.step('rejects the redirect URI in a frame, and loads no deposit page', async () => {
        expect(await Playwright.run(page, { name: 'Deposit' })).toMatchObject({
          state: 'rejected',
          value: origin,
        })
        expect(urls).toEqual([])
        await Playwright.uncovered(page)
        await capture('refused in a frame')
      })

      await test.step('rejects the redirect URI in a popup, and opens no window', async () => {
        await load(page, { deposit: { mode: 'popup', redirectUri } })

        expect(await Playwright.run(page, { name: 'Deposit' })).toMatchObject({
          state: 'rejected',
          value: origin,
        })
        expect(windows).toEqual([])
        await capture('refused in a popup')
      })

      await test.step('rejects a popup that a script of the page opens, with no window', async () => {
        await load(page, { deposit: { mode: 'popup' } })
        await Playwright.call(page, { name: 'Deposit' })

        expect(
          await Playwright.outcome(page, { name: 'Deposit' }),
        ).toMatchObject({
          state: 'rejected',
          value: { name: 'Actions.funding.BlockedError' },
        })
        expect(windows).toEqual([])
        await capture('blocked')
      })
    })
  })

  test.describe('funding.preload', () => {
    test('loads the deposit page in a hidden frame, which the next `open` shows', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        deposit: hinted,
        email,
        fund: false,
      })
      const urls = loads(page)

      await test.step('loads the deposit page once, and shows no dialog', async () => {
        expect(
          await Playwright.run(page, { name: 'Preload the deposit page' }),
        ).toEqual({ state: 'fulfilled', value: null })

        await expect.poll(() => urls.length).toBe(1)
        expect(urls[0]?.searchParams.get('address')).toBe(key.account)
        await Playwright.uncovered(page)
        await capture('preloaded')
      })

      await test.step('shows the loaded frame at `open`, with no second load', async () => {
        await Playwright.start(page, { name: 'Deposit' })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await capture('deposit page')
        await deposit.faucet.click()

        expect(await Playwright.outcome(page, { name: 'Deposit' })).toEqual({
          state: 'fulfilled',
          value: { status: 'received' },
        })
        expect(urls).toHaveLength(1)
        expect(await balance(key.account)).toBe(dripped)
        await capture('received')
      })
    })
  })

  test.describe('a sign-in with `funding`', () => {
    test('shows the deposit page after the sign-in, and the access key sends the deposit', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      await page.goto(Web.url({ funding: needed, path: Apps.web.paths.dialog }))

      const deposit =
        await test.step('shows the deposit page in the frame once the user signs in, and holds the sign-in', async () => {
          await Playwright.start(page, { name: 'Sign in' })
          const frame = await Playwright.dialog(page)
          await Playwright.signIn(frame, { code, email })
          const deposit = await Playwright.deposit(frame)

          await expect(deposit.hint).toContainText('at least $10')
          await expect(
            page.locator('output[data-action="Sign in"]'),
          ).toHaveAttribute('data-state', 'pending')
          await capture('deposit page')
          return deposit
        })

      const key =
        await test.step('returns the session once the faucet funds the account', async () => {
          await deposit.faucet.click()
          const session = await Playwright.outcome(page, { name: 'Sign in' })

          expect(session.state).toBe('fulfilled')
          const key: Web.Key = session.value.key
          expect(await balance(key.account)).toBe(dripped)
          await Playwright.uncovered(page)
          await capture('signed in')
          return key
        })

      await test.step('sends the needed amount of the deposit with the access key', async () => {
        const transfer = await Playwright.send(page, {
          amount: needed.amount,
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(await balance(recipient)).toBe(parseUnits(needed.amount, 6))
        expect(await balance(key.account)).toBeLessThan(dripped)
        await capture('sent')
      })
    })

    test('returns the session without a deposit once the user skips the deposit page', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(Web.url({ funding: needed, path: Apps.web.paths.dialog }))

      await test.step('returns the session at the link beside the hint, and the node holds no balance', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const frame = await Playwright.dialog(page)
        await Playwright.signIn(frame, { code, email })
        const deposit = await Playwright.deposit(frame)
        await capture('deposit page')
        await deposit.skip.click()

        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        expect(await balance(session.value.key.account)).toBe(0n)
        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('signed in')
      })
    })

    test('shows no deposit page for an account that holds the amount', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter_dialog(page, { capture, code, email })
      const held = await balance(key.account)

      await test.step('signs out of the app, and keeps Tempo ID’s session', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await page.goto(
          Web.url({ funding: needed, path: Apps.web.paths.dialog }),
        )

        await expect(page.locator('#status')).toHaveText('signedOut')
        await capture('signed out')
      })

      await test.step('returns the session at the approval, with no deposit page', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await Playwright.approve(await Playwright.dialog(page))

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'fulfilled',
          value: { key: { account: key.account } },
        })
        await Playwright.uncovered(page)
        expect(await balance(key.account)).toBe(held)
        await capture('signed in')
      })
    })
  })
})
