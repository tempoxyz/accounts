/**
 * Tests `accounts.pay` on the dialog page of the web test app: a payment that the session's access
 * key sends with no dialog, one that the chain refuses for the access key, which the page then
 * sends, one for a low balance, which the access key sends after a deposit, one above the access key's limit, or of its whole limit, whose fee the limit cannot also pay, that Tempo ID's payment page sends from
 * the account in the dialog's frame or in a popup, a session without an access key, whose Viem
 * `token.transferSync` the payment page also sends, and a payment
 * that the user rejects or closes, or whose amount the instance refuses, which sends nothing. Each case reads the transfer in the
 * transaction that the call returns.
 * @module
 */
import type { Page, Route } from '@playwright/test'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The recipient of each payment of the dialog page. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/** The time that a payment takes at most, in milliseconds: its transaction adds a block or two. */
const timeout = 30_000

/** Returns the OUSD of `address` on the node. */
function balance(address: `0x${string}`) {
  return Chain.balance({ address, token: Chain.ousd })
}

/** Records on `page` the report of the frame that it draws its skeleton, which `covered` reads. */
async function watch(page: Page) {
  await page.evaluate(() => {
    // The frame reports the skeleton that it draws while the hidden dialog holds it.
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'tempo-id:embed.covered')
        document.body.dataset.covered = ''
    })
  })
}

/** Returns whether the frame reported its skeleton since `watch`. */
async function covered(page: Page) {
  return await page.evaluate(() => document.body.dataset.covered !== undefined)
}

/** Returns whether a dialog shows on `page`. */
async function open(page: Page) {
  return (await Playwright.prompt(page).count()) > 0
}

/**
 * Holds each fill of a transaction on the node until `release`, so the access key's send waits
 * meanwhile. Other requests to the node pass. `fills` holds each held fill, and `unhold` removes
 * the route once every held fill continued.
 */
async function hold(page: Page) {
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  // Each held fill, which settles once its request continues after the release.
  const fills: Promise<void>[] = []
  const handler = async (route: Route) => {
    if (!route.request().postData()?.includes('eth_fillTransaction'))
      return route.fallback()
    const fill = held.then(async () => {
      try {
        await route.continue()
      } catch (error) {
        // A request that ended meanwhile, such as with its page, needs no continue.
        if (!String(error).includes('Route is already handled')) throw error
      }
    })
    fills.push(fill)
    await fill
  }
  await page.route(Chain.rpcUrl, handler)
  return {
    fills,
    release,
    async unhold() {
      // The held fill continues before its handler goes, so no other handler takes its request.
      await Promise.all(fills)
      await page.unroute(Chain.rpcUrl, handler)
    },
  }
}

/** Returns what the control `name` of the dialog page returned or threw, once it settles. */
function paid(page: Page, name: string) {
  return Playwright.outcome(page, { name, timeout })
}

test.describe('pay', () => {
  test('sends a payment within the limit with the access key and no dialog, and one above it on the payment page', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('sends 5 OUSD with the access key, and shows no dialog', async () => {
      // Records each dialog that shows while the access key sends.
      await page.evaluate(() => {
        const observer = new MutationObserver(() => {
          if (!document.querySelector('dialog[data-tempo-id-dialog][open]'))
            return
          // The record changes the body, so the observer stops before it.
          observer.disconnect()
          document.body.dataset.shown = ''
        })
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        })
      })
      const payment = await Playwright.run(page, {
        name: 'Pay 5 OUSD',
        timeout,
      })

      expect(payment.state).toBe('fulfilled')
      expect(
        await page.evaluate(() => document.body.dataset.shown !== undefined),
      ).toBe(false)
      expect(
        await Chain.transfers({ hash: payment.value.transaction }),
      ).toContainEqual({ amount: 5_000_000n, from: key.account, to: recipient })
      await capture('sent with the access key')
    })

    await test.step('shows the payment page in the dialog for 150 OUSD, with the note and the memo', async () => {
      await Playwright.start(page, { name: 'Pay 150 OUSD' })
      const frame = await Playwright.dialog(page)
      const payment = await Playwright.payment(frame)

      await expect(payment.pay).toHaveText('Pay $150.00')
      await expect(
        frame.getByRole('main', { name: 'Payment request' }),
      ).toContainText('Web test app order')
      await expect(
        frame.getByRole('main', { name: 'Payment request' }),
      ).toContainText('order-42')
      await capture('payment page')

      await payment.pay.click()
      const result = await paid(page, 'Pay 150 OUSD')

      expect(result.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 150_000_000n,
        from: key.account,
        to: recipient,
      })
      await capture('paid on the payment page')
    })
  })

  test('loads the payment page in a hidden dialog until the chain refuses the access key, and pays on the page', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('sends 96 OUSD within the limit of 100', async () => {
      const transfer = await Playwright.send(page, {
        amount: '96',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
    })
    const fills = await hold(page)

    await test.step('loads the payment page for 5 OUSD in a hidden dialog while the access key sends', async () => {
      // The access key's authorization holds 5 OUSD and its fee, so the access key sends first. The
      // chain refuses it, since the first transfer and its fee spent all but 4 of the limit.
      await watch(page)
      // The page's server renders the covered screen as its skeleton, so its first paint shows it.
      const response = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/embed/pay',
      )
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      const html = await (await response).text()

      await expect.poll(() => fills.fills.length).toBe(1)
      await expect.poll(() => covered(page)).toBe(true)
      expect(await open(page)).toBe(false)
      expect(new URL((await response).url()).searchParams.get('covered')).toBe(
        'true',
      )
      expect(html).toContain('aria-label="Payment request"')
      expect(html).toContain('skullet-loading')
      await capture('no dialog while the access key sends')
    })

    await test.step('shows the payment page after the refusal, and pays 5 OUSD on it', async () => {
      fills.release()
      await fills.unhold()
      const payment = await Playwright.payment(await Playwright.dialog(page))

      await expect(payment.pay).toHaveText('Pay $5.00')
      await capture('payment page after the refusal')

      await payment.pay.click()
      const result = await paid(page, 'Pay 5 OUSD')

      expect(result.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({ amount: 5_000_000n, from: key.account, to: recipient })
      await capture('paid on the payment page')
    })
  })

  test('shows the deposit page for a low balance, and sends the payment with the access key after the deposit', async ({
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

    await test.step('rejects the payment once the user closes the deposit page, and sends nothing', async () => {
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      const deposit = await Playwright.deposit(await Playwright.dialog(page))
      await capture('deposit page for the payment')
      await deposit.close.click()

      expect(await paid(page, 'Pay 5 OUSD')).toMatchObject({
        state: 'rejected',
        value: { name: 'Plugins.viem.RetryClosedError' },
      })
      await Playwright.uncovered(page)
      expect(await balance(key.account)).toBe(0n)
    })

    await test.step('sends 5 OUSD with the access key once the faucet of the deposit page funds the account', async () => {
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      const deposit = await Playwright.deposit(await Playwright.dialog(page))
      await deposit.faucet.click()
      const result = await paid(page, 'Pay 5 OUSD')

      // The access key sent the payment, since no payment page showed for the owner's approval.
      expect(result.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({ amount: 5_000_000n, from: key.account, to: recipient })
      await capture('sent with the access key after the deposit')
    })
  })

  test('offers the popup of a method that the hidden payment page requests, in place of opening it, and opens it from Continue once the dialog shows', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('sends 96 OUSD within the limit of 100', async () => {
      const transfer = await Playwright.send(page, {
        amount: '96',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
    })
    const before = await balance(key.account)
    // The access key's fill of the send of 5 OUSD, which the chain refuses, waits on the node until
    // the release, so the dialog stays hidden meanwhile.
    const fills = await hold(page)
    const popups: string[] = []
    page.on('popup', (window) => popups.push(window.url()))

    await test.step('offers the popup that the hidden page requests, and opens no popup or dialog', async () => {
      await watch(page)
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      await expect.poll(() => fills.fills.length).toBe(1)
      await expect.poll(() => covered(page)).toBe(true)
      // The hidden page requests the popup of a method, as its Buy MACH does, from Tempo ID's origin.
      const frame = page
        .frames()
        .find((frame) => new URL(frame.url()).pathname === '/embed/pay')
      expect(frame).toBeDefined()
      await frame!.evaluate(() =>
        window.parent.postMessage(
          { amount: '5', method: 'mach', type: 'tempo-id:embed.popup' },
          '*',
        ),
      )

      await expect(
        page.locator('dialog[data-tempo-id-dialog] [data-panel]'),
      ).toHaveCount(1)
      expect(await open(page)).toBe(false)
      expect(popups).toEqual([])
    })

    await test.step('shows the offer once the chain refuses the access key, opens the popup from Continue, and sends nothing at its close', async () => {
      fills.release()
      await fills.unhold()
      const prompt = Playwright.prompt(page)
      await expect(prompt.locator('[data-panel]')).toBeVisible()
      expect(
        await prompt
          .locator('[data-panel]')
          .evaluate((panel) => (panel as HTMLElement).inert),
      ).toBe(false)
      await capture('offer of the popup after the refusal')
      const window = await Playwright.popup(page, {
        open: () =>
          prompt.getByRole('button', { exact: true, name: 'Continue' }).click(),
      })

      await window.waitForURL((url) => url.origin === TempoId.url)
      await capture('popup from Continue', window)
      await window.close()

      expect(await paid(page, 'Pay 5 OUSD')).toMatchObject({
        state: 'rejected',
        value: { name: 'AbortError' },
      })
      await Playwright.uncovered(page)
      expect(await balance(key.account)).toBe(before)
      await capture('closed the popup')
    })
  })

  test('rejects a payment that the user rejects on the payment page, or closes, and sends nothing', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })
    const before = await balance(key.account)

    await test.step('rejects the payment with `access_denied` on Reject', async () => {
      await Playwright.start(page, { name: 'Pay 150 OUSD' })
      const payment = await Playwright.payment(await Playwright.dialog(page))
      await payment.reject.click()

      expect(await paid(page, 'Pay 150 OUSD')).toMatchObject({
        state: 'rejected',
        value: { code: 'access_denied', name: 'Accounts.RequestError' },
      })
      await Playwright.uncovered(page)
      expect(await balance(key.account)).toBe(before)
      await capture('rejected')
    })

    await test.step('rejects an amount below 0 with `invalid_field`, and opens no page', async () => {
      const pages: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/pay'))
          pages.push(request.url())
      })

      expect(
        await Playwright.run(page, { name: 'Pay -5 OUSD', timeout }),
      ).toMatchObject({
        state: 'rejected',
        value: {
          code: 'invalid_request',
          name: 'Accounts.RequestError',
        },
      })
      await Playwright.uncovered(page)
      expect(pages).toEqual([])
      expect(await balance(key.account)).toBe(before)
      await capture('refused amount')
    })

    await test.step('rejects the payment with an `AbortError` once the user closes the dialog', async () => {
      await Playwright.start(page, { name: 'Pay 150 OUSD' })
      const payment = await Playwright.payment(await Playwright.dialog(page))
      await payment.close.click()

      expect(await paid(page, 'Pay 150 OUSD')).toMatchObject({
        state: 'rejected',
        value: { name: 'AbortError' },
      })
      await Playwright.uncovered(page)
      expect(await balance(key.account)).toBe(before)
      await capture('closed')
    })
  })

  test("shows the payment page in the dialog of a page whose plugin sets `par: false`, in a browser without IntersectionObserver v2, since the preloaded frame reports Tempo ID's trust of the app", async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('loads the page again with `par=0`, without IntersectionObserver v2', async () => {
      // Safari reports no visibility of a frame. The page records the types of the frames' messages.
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
      await page.goto(Web.url({ par: '0', path: Apps.web.paths.dialog }))
      await expect(page.locator('#status')).toHaveText('signedIn')
      // The plugin's copy of the configuration, with `par: false`, holds the preloaded frame.
      await expect
        .poll(() =>
          page.evaluate(() => (window as { messages?: string[] }).messages),
        )
        .toContain('tempo-id:embed.loaded')
    })

    await test.step('pays 150 OUSD on the payment page in the dialog, without a popup', async () => {
      await Playwright.start(page, { name: 'Pay 150 OUSD' })
      const frame = await Playwright.dialog(page)
      const payment = await Playwright.payment(frame)
      await capture('payment page in the dialog')
      await payment.pay.click()
      const result = await paid(page, 'Pay 150 OUSD')

      expect(result.state).toBe('fulfilled')
      expect(page.context().pages()).toHaveLength(1)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 150_000_000n,
        from: key.account,
        to: recipient,
      })
      await capture('paid in the dialog')
    })
  })

  test('sends a payment on the payment page in a popup', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('pays 150 OUSD on the payment page in the popup, which closes', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Pay 150 OUSD in a popup' }),
      })
      const payment = await Playwright.payment(window)
      await capture('payment page in the popup', window)
      await payment.pay.click()
      const result = await paid(page, 'Pay 150 OUSD in a popup')

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
  })

  test("shows the payment page for the access key's whole limit, whose fee the limit cannot also pay, in the dialog and in a popup", async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('pays 100 OUSD on the payment page in the dialog', async () => {
      await Playwright.start(page, { name: 'Pay 100 OUSD' })
      const frame = await Playwright.dialog(page)
      const payment = await Playwright.payment(frame)

      await expect(payment.pay).toHaveText('Pay $100.00')
      await capture('payment page for the whole limit')

      await payment.pay.click()
      const result = await paid(page, 'Pay 100 OUSD')

      expect(result.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 100_000_000n,
        from: key.account,
        to: recipient,
      })
      await capture('paid the whole limit on the payment page')
    })

    await test.step('pays 100 OUSD on the payment page in the popup, which closes', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Pay 100 OUSD in a popup' }),
      })
      const payment = await Playwright.payment(window)
      await capture('payment page for the whole limit in the popup', window)
      await payment.pay.click()
      const result = await paid(page, 'Pay 100 OUSD in a popup')

      expect(result.state).toBe('fulfilled')
      await expect.poll(() => window.isClosed()).toBe(true)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 100_000_000n,
        from: key.account,
        to: recipient,
      })
      await capture('paid the whole limit in the popup')
    })
  })

  test("sends a payment and Viem's transfer on the payment page for a session without an access key", async ({
    capture,
    code,
    email,
    page,
  }) => {
    await Web.enter_dialog(page, {
      capture,
      code,
      email,
      fund: false,
      name: 'Sign in without an access key',
    })
    const account = await Playwright.run(page, { name: 'Account' })
    await Chain.fund({ address: account.value.address })

    await test.step('shows the payment page for 5 OUSD, which the access key would send, and pays it', async () => {
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      const payment = await Playwright.payment(await Playwright.dialog(page))

      await expect(payment.pay).toHaveText('Pay $5.00')
      await capture('payment page')
      await payment.pay.click()
      const result = await paid(page, 'Pay 5 OUSD')

      expect(result.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: result.value.transaction }),
      ).toContainEqual({
        amount: 5_000_000n,
        from: account.value.address,
        to: recipient,
      })
      await capture('paid without an access key')
    })

    await test.step("sends Viem's `token.transferSync` of 2 OUSD on the same payment page", async () => {
      await Playwright.submit(page, { amount: '2', to: recipient })
      const payment = await Playwright.payment(await Playwright.dialog(page))

      await expect(payment.pay).toHaveText('Pay $2.00')
      await capture('payment page of the transfer')
      await payment.pay.click()
      const transfer = await Playwright.outcome(page, {
        name: 'Send OUSD',
        timeout,
      })

      expect(transfer.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      expect(
        await Chain.transfers({ hash: transfer.value.transactionHash }),
      ).toContainEqual({
        amount: 2_000_000n,
        from: account.value.address,
        to: recipient,
      })
      await capture('transfer paid on the payment page')
    })
  })
})
