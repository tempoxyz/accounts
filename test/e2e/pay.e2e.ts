/**
 * Tests `accounts.pay` on the dialog page of the web test app: a payment that the session's access
 * key sends while the dialog covers the page, one that the chain refuses for the access key, which the
 * page then sends, one above the access key's limit, or of its whole limit, whose fee the limit cannot also pay, that Tempo ID's payment page sends from
 * the account in the dialog's frame or in a popup, a session without an access key, whose Viem
 * `token.transferSync` the payment page also sends, and a payment
 * that the user rejects or closes, or whose amount the instance refuses, which sends nothing. Each case reads the transfer in the
 * transaction that the call returns.
 * @module
 */
import type { Page } from '@playwright/test'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Web from '../Web.js'

/** The recipient of each payment of the dialog page. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/** The time that a payment takes at most, in milliseconds: its transaction adds a block or two. */
const timeout = 30_000

/** Returns the OUSD of `address` on the node. */
function balance(address: `0x${string}`) {
  return Chain.balance({ address, token: Chain.ousd })
}

/**
 * Records the first state of the next dialog that shows on `page`: whether the skeleton covers it,
 * the skeleton's dividers, the frame's height, and whether the frame is inert. `shown` returns the
 * record, and `covered` whether the frame reported its own skeleton.
 */
async function watch(page: Page) {
  await page.evaluate(() => {
    // The frame reports the skeleton that it draws while the dialog covers it.
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'tempo-id:embed.covered')
        document.body.dataset.covered = ''
    })
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector(
        'dialog[data-tempo-id-dialog][open]',
      )
      if (!dialog) return
      observer.disconnect()
      document.body.dataset.shown = JSON.stringify({
        covered: dialog.querySelector('[data-skeleton]') !== null,
        dividers: dialog.querySelectorAll('[data-skeleton] [data-line]').length,
        height: dialog.querySelector('iframe')?.style.height,
        inert: dialog.querySelector('iframe')?.inert,
      })
    })
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

/** Returns whether the frame reported its skeleton since `watch`. */
async function covered(page: Page) {
  return await page.evaluate(() => document.body.dataset.covered !== undefined)
}

/** Returns the record of `watch`, or `undefined` if no dialog showed. */
async function shown(page: Page) {
  const value = await page.evaluate(() => document.body.dataset.shown)
  return value === undefined ? undefined : JSON.parse(value)
}

/** Returns what the control `name` of the dialog page returned or threw, once it settles. */
function paid(page: Page, name: string) {
  return Playwright.outcome(page, { name, timeout })
}

test.describe('pay', () => {
  test('sends a payment within the limit with the access key under the covered dialog, and one above it on the payment page', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const key = await Web.enter_dialog(page, { capture, code, email })

    await test.step('sends 5 OUSD with the access key under the covered dialog, which closes', async () => {
      await watch(page)
      const payment = await Playwright.run(page, {
        name: 'Pay 5 OUSD',
        timeout,
      })

      expect(payment.state).toBe('fulfilled')
      await Playwright.uncovered(page)
      // The dialog showed before the transfer landed, with the page under the cover.
      // The payment skeleton's second card has two rows, the currency and the account, so one divider.
      expect(await shown(page)).toEqual({
        covered: true,
        dividers: 1,
        height: '542px',
        inert: true,
      })
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

  test('covers the payment page in the dialog until the chain refuses the access key, and pays on the page', async ({
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

    await test.step('shows the covered dialog at once for 5 OUSD, and the payment page after the refusal', async () => {
      // The access key's authorization holds 5 OUSD and its fee, so the access key sends first. The
      // chain refuses it, since the first transfer and its fee spent all but 4 of the limit.
      await watch(page)
      // The page's server renders the covered screen as its skeleton, so its first paint shows it.
      const response = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/embed/pay',
      )
      await Playwright.start(page, { name: 'Pay 5 OUSD' })
      const html = await (await response).text()
      const payment = await Playwright.payment(await Playwright.dialog(page))

      await expect(payment.pay).toHaveText('Pay $5.00')
      // The payment skeleton's second card has two rows, the currency and the account, so one divider.
      expect(await shown(page)).toEqual({
        covered: true,
        dividers: 1,
        height: '542px',
        inert: true,
      })
      expect(new URL((await response).url()).searchParams.get('covered')).toBe(
        'true',
      )
      expect(html).toContain('aria-label="Payment request"')
      expect(html).toContain('skullet-loading')
      expect(await covered(page)).toBe(true)
      await capture('payment page after the refusal')
    })

    await test.step('pays 5 OUSD on the payment page', async () => {
      const payment = await Playwright.payment(await Playwright.dialog(page))
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
