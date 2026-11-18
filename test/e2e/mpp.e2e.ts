/**
 * Tests the MPP page of the web test app: the payments that the session's access key signs for the
 * routes of the MPP test app, a merchant that answers a request without a payment with a 402
 * challenge. The cases cover a charge that the merchant broadcasts and one that the page
 * broadcasts, a proof of the account, the maximum of a call, which rejects before a signature, a
 * charge above the limit of the access key, which Tempo ID's payment page pays from the account, a
 * charge whose challenge follows another tab's sign-out, and one
 * in each mode whose transaction waits for its fill at a sign-out, which reject too, the screen for
 * a charge above the limit that remains, a session that pays each request with a voucher of one
 * channel, and a subscription that the merchant charges after one approval. Each case reads the
 * payment in the transaction that the receipt names.
 * @module
 */
import type { Page } from '@playwright/test'
import { parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Web from '../Web.js'

/** The amount of each route, in the base units of OUSD. */
const amounts = {
  charge: parseUnits(Apps.mpp.amounts.charge, 6),
  chargeLarge: parseUnits(Apps.mpp.amounts.chargeLarge, 6),
  chargeMedium: parseUnits(Apps.mpp.amounts.chargeMedium, 6),
  session: parseUnits(Apps.mpp.amounts.session, 6),
  sessionDeposit: parseUnits(Apps.mpp.amounts.sessionDeposit, 6),
  subscription: parseUnits(Apps.mpp.amounts.subscription, 6),
}

/** The content of each route, which the merchant returns for a payment. */
const content = {
  charge: { fortune: 'Your code compiles on the first try.' },
  proof: { proven: true },
  session: { content: 'Paid with a voucher.' },
  subscription: { fortune: 'Your next build is green.' },
}

/** More than the fee of one transaction of the suite, in the base units of OUSD: 0.02. */
const fee = 20_000n

/** The merchant's account, which receives each payment. */
const payee = privateKeyToAddress(Apps.mpp.payee)

/** The time that a payment takes at most, in milliseconds: its transaction adds a block or two. */
const timeout = 30_000

/** Returns the OUSD of `address` on the node. */
function balance(address: `0x${string}`) {
  return Chain.balance({ address, token: Chain.ousd })
}

/**
 * Asserts that `errors` holds only the console error of a 402 challenge, which the browser logs for
 * each payment, and removes them.
 */
function challenged(errors: string[]) {
  expect(
    errors.splice(0).filter((error) => !error.includes('status of 402')),
  ).toEqual([])
}

/** Runs the control `name` of the MPP page, and returns what its payment returned or threw. */
function pay(page: Page, name: string) {
  return Playwright.run(page, { name, timeout })
}

test.describe('mpp', () => {
  // A session opens and closes a channel, and a subscription waits for its next period.
  test.setTimeout(120_000)

  test.describe('charge', () => {
    test('pays a charge that the merchant broadcasts, one that the page broadcasts, and proves the account', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        path: Apps.web.paths.mpp,
      })

      await test.step('pays 0.01 OUSD with a transaction that the merchant broadcasts', async () => {
        const paid = await pay(page, 'Pay a charge')

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.charge,
            receipt: { method: 'tempo', status: 'success' },
            status: 200,
          },
        })
        expect(
          await Chain.transfers({ hash: paid.value.receipt.reference }),
        ).toContainEqual({
          amount: amounts.charge,
          from: key.account,
          to: payee,
        })
        await capture('paid in pull mode')
      })

      await test.step('pays 0.01 OUSD with a transaction that the page broadcasts', async () => {
        const first = await Playwright.outcome(page, { name: 'Pay a charge' })
        const paid = await pay(page, 'Pay a charge in push mode')

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.charge,
            receipt: { method: 'tempo', status: 'success' },
            status: 200,
          },
        })
        expect(paid.value.receipt.reference).not.toBe(
          first.value.receipt.reference,
        )
        expect(
          await Chain.transfers({ hash: paid.value.receipt.reference }),
        ).toContainEqual({
          amount: amounts.charge,
          from: key.account,
          to: payee,
        })
        await capture('paid in push mode')
      })

      await test.step('proves the account with a signature of the access key, which moves nothing', async () => {
        const before = await balance(key.account)
        const proven = await pay(page, 'Prove the account')

        expect(proven).toMatchObject({
          state: 'fulfilled',
          value: { body: content.proof, status: 200 },
        })
        expect(await balance(key.account)).toBe(before)
        await capture('proven')
      })

      challenged(errors)
    })

    test('rejects a charge above the maximum of the call before a signature, and pays one above the limit of the access key on the payment page', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        path: Apps.web.paths.mpp,
      })
      const before = await balance(key.account)

      await test.step('rejects a charge of 0.01 OUSD for a call with a maximum of 0.001', async () => {
        const paid = await pay(page, 'Pay a charge with a maximum of 0.001')

        expect(paid).toMatchObject({
          state: 'rejected',
          value: { name: 'mpp.MaxAmountError' },
        })
        expect(await balance(key.account)).toBe(before)
        await capture('above the maximum')
      })

      await test.step('shows the payment page for a charge of 150 OUSD with an access key of a limit of 100, and rejects the charge on Reject', async () => {
        await Playwright.start(page, { name: 'Pay the large charge' })
        const payment = await Playwright.payment(await Playwright.dialog(page))

        await expect(payment.pay).toHaveText('Pay $150.00')
        await capture('payment page')
        await payment.reject.click()
        const paid = await Playwright.outcome(page, {
          name: 'Pay the large charge',
          timeout,
        })

        expect(paid).toMatchObject({
          state: 'rejected',
          value: { code: 'access_denied', name: 'Accounts.RequestError' },
        })
        await Playwright.uncovered(page)
        expect(await balance(key.account)).toBe(before)
        await capture('rejected on the payment page')
      })

      await test.step('pays the charge of 150 OUSD on the payment page, from the account', async () => {
        await Playwright.start(page, { name: 'Pay the large charge' })
        const payment = await Playwright.payment(await Playwright.dialog(page))

        await payment.pay.click()
        const paid = await Playwright.outcome(page, {
          name: 'Pay the large charge',
          timeout,
        })

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.charge,
            receipt: { method: 'tempo', status: 'success' },
            status: 200,
          },
        })
        await Playwright.uncovered(page)
        expect(
          await Chain.transfers({ hash: paid.value.receipt.reference }),
        ).toContainEqual({
          amount: amounts.chargeLarge,
          from: key.account,
          to: payee,
        })
        await capture('paid on the payment page')
      })

      await test.step('pays the charge of 0.01 OUSD with no maximum', async () => {
        const paid = await pay(page, 'Pay a charge')

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: { receipt: { status: 'success' }, status: 200 },
        })
        expect(await balance(key.account)).toBeLessThan(before)
        await capture('paid')
      })

      challenged(errors)
    })

    test('rejects a charge whose challenge follows a sign-out in another tab, before a signature', async ({
      capture,
      code,
      context,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        path: Apps.web.paths.mpp,
      })
      const before = await balance(key.account)
      const tab = await context.newPage()
      await tab.goto(Web.url({ path: Apps.web.paths.mpp }))
      await expect(tab.locator('#status')).toHaveText('signedIn')

      // The merchant's challenge waits until the session ended. `credentials` holds whether each
      // request of the charge carries a credential.
      const credentials: boolean[] = []
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      await context.route(`${Apps.mpp.url}/charge`, async (route) => {
        const headers = await route.request().allHeaders()
        credentials.push('authorization' in headers)
        await held
        await route.continue()
      })

      await test.step('rejects the charge of a request that waits for its challenge at the sign-out', async () => {
        await Playwright.start(page, { name: 'Pay a charge' })
        await expect.poll(() => credentials).toEqual([false])
        const signedOut = await Playwright.run(tab, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        release()
        const paid = await Playwright.outcome(page, {
          name: 'Pay a charge',
          timeout,
        })

        expect(signedOut.state).toBe('fulfilled')
        expect(paid).toMatchObject({
          state: 'rejected',
          value: { name: 'Accounts.SignedOutError' },
        })
        expect(credentials).toEqual([false])
        expect(await balance(key.account)).toBe(before)
        await capture('signed out in the other tab', tab)
        await capture('rejected')
      })

      challenged(errors)
    })

    // The control of each mode of a charge: the merchant broadcasts in pull mode, the page in push mode.
    for (const { mode, name } of [
      { mode: 'pull', name: 'Pay a charge' },
      { mode: 'push', name: 'Pay a charge in push mode' },
    ] as const)
      test(`rejects a charge in ${mode} mode whose transaction waits for its fill at a sign-out, before a signature`, async ({
        capture,
        code,
        email,
        errors,
        page,
      }) => {
        const key = await Web.enter_dialog(page, {
          capture,
          code,
          email,
          path: Apps.web.paths.mpp,
        })
        const before = await balance(key.account)

        // The node's fill of the charge's transaction, which follows the challenge, waits until the
        // session ended. In push mode, Viem's action of the page signs after the fill. `credentials` holds whether each request of the charge carries a credential.
        const credentials: boolean[] = []
        const fills: string[] = []
        let release = () => {}
        const held = new Promise<void>((resolve) => (release = resolve))
        await page.route(`${Apps.mpp.url}/charge`, async (route) => {
          const headers = await route.request().allHeaders()
          credentials.push('authorization' in headers)
          await route.continue()
        })
        await page.route(Chain.rpcUrl, async (route) => {
          const body = route.request().postData() ?? ''
          if (body.includes('eth_fillTransaction')) {
            fills.push('eth_fillTransaction')
            await held
          }
          await route.continue()
        })

        await test.step('rejects the charge of a transaction that waits for its fill at the sign-out', async () => {
          await Playwright.start(page, { name })
          await expect.poll(() => fills).toEqual(['eth_fillTransaction'])
          const signedOut = await Playwright.run(page, { name: 'Sign out' })
          release()
          const paid = await Playwright.outcome(page, {
            name,
            timeout,
          })

          expect(signedOut.state).toBe('fulfilled')
          expect(paid).toMatchObject({
            state: 'rejected',
            value: { name: 'Accounts.SignedOutError' },
          })
          expect(credentials).toEqual([false])
          expect(await balance(key.account)).toBe(before)
          await capture('rejected')
        })

        challenged(errors)
      })

    test('requests a new access key for a charge above the limit that remains, and pays it', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        name: 'Sign in with a limit of 5',
        path: Apps.web.paths.mpp,
      })

      await test.step('sends 4 OUSD within the limit of 5', async () => {
        const transfer = await Playwright.send(page, {
          amount: '4',
          to: privateKeyToAddress(generatePrivateKey()),
        })

        expect(transfer.state).toBe('fulfilled')
        await capture('sent within the limit')
      })

      await test.step('opens the sign-in for a new limit at a charge of 2 OUSD', async () => {
        await Playwright.start(page, { name: 'Pay the medium charge' })
        const frame = await Playwright.dialog(page)

        await expect(Playwright.grant(frame)).toContainText(['Spend $5'])
        await capture('new limit')
      })

      await test.step('pays the charge with the access key that the user approves', async () => {
        await Playwright.approve(await Playwright.dialog(page))
        const paid = await Playwright.outcome(page, {
          name: 'Pay the medium charge',
          timeout,
        })

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.charge,
            receipt: { status: 'success' },
            status: 200,
          },
        })
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.transfers({ hash: paid.value.receipt.reference }),
        ).toContainEqual({
          amount: amounts.chargeMedium,
          from: key.account,
          to: payee,
        })
        await capture('paid')
      })

      challenged(errors)
    })
  })

  test.describe('session', () => {
    test('pays each request with a voucher of one channel, and settles the channel at its close', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        path: Apps.web.paths.mpp,
      })
      const before = await balance(key.account)

      await test.step('opens a channel at the first request, and pays it with a voucher', async () => {
        const opened = await pay(page, 'Pay with a session')

        expect(opened).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.session,
            receipt: {
              acceptedCumulative: String(amounts.session),
              status: 'success',
              units: 1,
            },
            status: 200,
          },
        })
        await capture('opened')
      })

      await test.step('pays a second request with a voucher of the same channel', async () => {
        const opened = await Playwright.outcome(page, {
          name: 'Pay with a session',
        })
        const paid = await pay(page, 'Pay with a session')

        expect(paid).toMatchObject({
          state: 'fulfilled',
          value: {
            body: content.session,
            receipt: {
              acceptedCumulative: String(2n * amounts.session),
              channelId: opened.value.receipt.channelId,
              spent: String(2n * amounts.session),
              status: 'success',
              units: 2,
            },
            status: 200,
          },
        })
        await capture('paid again')
      })

      await test.step('closes the channel, which pays the merchant the two requests', async () => {
        const closed = await pay(page, 'Close the session')

        expect(closed).toMatchObject({
          state: 'fulfilled',
          value: { receipt: { status: 'success' } },
        })
        const settled = await Chain.transfers({
          hash: closed.value.receipt.txHash,
        })
        expect(settled).toContainEqual(
          expect.objectContaining({ amount: 2n * amounts.session, to: payee }),
        )
        // The channel returns what the requests did not spend of the deposit.
        expect(settled).toContainEqual(
          expect.objectContaining({
            amount: amounts.sessionDeposit - 2n * amounts.session,
            to: key.account,
          }),
        )
        // The payer paid the two requests, and the fee of the channel's opening.
        const spent = before - (await balance(key.account))
        expect(spent).toBeGreaterThan(2n * amounts.session)
        expect(spent).toBeLessThan(2n * amounts.session + fee)
        await capture('closed')
      })

      challenged(errors)
    })
  })

  test.describe('subscription', () => {
    test('subscribes with one approval of the merchant’s access key, and the merchant charges the next period', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        path: Apps.web.paths.mpp,
      })

      await test.step('shows the amount and the period of the merchant’s access key in the dialog', async () => {
        await Playwright.start(page, { name: 'Subscribe' })
        const frame = await Playwright.dialog(page)

        await expect(Playwright.grant(frame)).toContainText([
          'Spend $0.01 every 5 seconds',
        ])
        await capture('subscription')
      })

      const subscribed =
        await test.step('approves, which pays the first period', async () => {
          await Playwright.approve(await Playwright.dialog(page))
          const subscribed = await Playwright.outcome(page, {
            name: 'Subscribe',
            timeout,
          })

          expect(subscribed).toMatchObject({
            state: 'fulfilled',
            value: {
              body: content.subscription,
              receipt: {
                status: 'success',
                subscriptionId: expect.any(String),
              },
              status: 200,
            },
          })
          // The page's own access key stays, beside the merchant's.
          const session = await Playwright.run(page, { name: 'Session' })
          expect(session.value.key.id).toBe(key.id)
          expect(
            await Chain.transfers({ hash: subscribed.value.receipt.reference }),
          ).toContainEqual({
            amount: amounts.subscription,
            from: key.account,
            to: payee,
          })
          await capture('subscribed')
          return subscribed.value.receipt
        })

      await test.step('charges the next period from the merchant, with no approval', async () => {
        let renewed: { reference: `0x${string}` } | null = null
        // A period lasts five seconds on the node, and a period that has not ended charges nothing.
        await expect
          .poll(
            async () => {
              const response = await fetch(
                `${Apps.mpp.url}${Apps.mpp.paths.renew}`,
                {
                  body: JSON.stringify({
                    subscriptionId: subscribed.subscriptionId,
                  }),
                  headers: { 'content-type': 'application/json' },
                  method: 'POST',
                },
              )
              const body = (await response.json()) as {
                receipt: typeof renewed
              }
              return (renewed = body.receipt)
            },
            { timeout },
          )
          .not.toBeNull()

        expect(renewed!.reference).not.toBe(subscribed.reference)
        expect(
          await Chain.transfers({ hash: renewed!.reference }),
        ).toContainEqual({
          amount: amounts.subscription,
          from: key.account,
          to: payee,
        })
        await Playwright.uncovered(page)
        await capture('renewed')
      })

      challenged(errors)
    })
  })
})
