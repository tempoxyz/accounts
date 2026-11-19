/**
 * Tests the access key of a sign-in on the web test app: its update and its revocation, the screen
 * that the Viem client shows for a transaction that the node refuses, its limits, its expiry, its
 * scopes, and the requests that the package or Tempo ID refuses. Each case reads the access key on
 * the node, and sends transactions inside and outside its bounds.
 * @module
 */
import type { Permissions } from 'accounts'
import { formatUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Actions, Addresses, Scopes } from 'viem/tempo'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The error of the Viem client's screen that the user closed, for each kind of refusal. */
const closed = {
  balance: {
    message:
      'The user closed the deposit page before a deposit arrived. The transaction did not send. Send it again to retry.',
    name: 'Plugins.viem.RetryClosedError',
  },
  key: {
    message:
      'The user closed the sign-in for a new access key. The transaction did not send. Send it again to retry.',
    name: 'Plugins.viem.RetryClosedError',
  },
  limit: {
    message:
      'The user closed the sign-in for a new access key with a new limit. The transaction did not send. Send it again to retry.',
    name: 'Plugins.viem.RetryClosedError',
  },
}

/** More than the fee of one transaction of the suite, in the base units of a USD token: 0.02. */
const fee = 20_000n

/** An access key that sends up to 5 OUSD for a day. */
const five = {
  expiry: '1d',
  limits: [{ limit: '5', token: 'ousd' }],
} as const satisfies Permissions.Permissions

/** An access key that sends up to 10 OUSD for a day. */
const ten = {
  expiry: '1d',
  limits: [{ limit: '10', token: 'ousd' }],
} as const satisfies Permissions.Permissions

/** The largest expiry of the node, which an access key that never expires holds. */
const never = 2n ** 64n - 1n

/**
 * The requests of an access key that Tempo ID refuses from the app's own form, each with the
 * `reason` and the status of its refusal.
 */
const refusals = [
  {
    accessKey: { expiry: '1d', limits: [{ limit: '1001', token: 'ousd' }] },
    name: 'a limit above 1,000 OUSD',
    reason: 'limit_exceeds_maximum',
    status: 403,
  },
  {
    accessKey: {
      expiry: '30d',
      limits: [{ limit: '100', period: '1d', token: 'ousd' }],
    },
    name: 'a limit per day that totals above 1,000 OUSD before the expiry',
    reason: 'limit_exceeds_maximum',
    status: 403,
  },
  {
    accessKey: { expiry: '57w', limits: [{ limit: '5', token: 'ousd' }] },
    name: 'an expiry above one year',
    reason: 'expiry_exceeds_maximum',
    status: 403,
  },
  {
    accessKey: {},
    name: 'no limits and no scopes',
    reason: 'missing_permissions',
    status: 400,
  },
  {
    accessKey: { ...five, expiry: false },
    name: 'no expiry',
    reason: 'invalid_expiry',
    status: 400,
  },
  {
    accessKey: {
      ...five,
      scopes: [Scopes.target(Addresses.feeManager).any()],
    },
    name: 'a scope on a contract that is no token',
    reason: 'unsupported_call',
    status: 400,
  },
] as const satisfies readonly (Pick<Web.url.Options, 'accessKey'> & {
  name: string
  reason: string
  status: keyof typeof Web.consoleErrors
})[]

/**
 * The requests of an access key that the package refuses from the app's own form, before the
 * request that carries the access key, each with the `reason` of its refusal.
 */
const refusals_local = [
  {
    accessKey: { expiry: '1d', limits: [] },
    name: 'an empty list of limits',
    reason: 'empty_limits',
  },
  {
    accessKey: { ...five, scopes: [] },
    name: 'an empty list of scopes',
    reason: 'empty_scopes',
  },
] as const satisfies readonly (Pick<Web.url.Options, 'accessKey'> & {
  name: string
  reason: string
})[]

/** Waits until the time of the node's latest block passes the expiry of `key`. */
async function expired(key: Web.Key) {
  await expect
    .poll(() => Chain.time(), { timeout: 30_000 })
    .toBeGreaterThan(key.expiry!)
}

/** Returns what `key` may still send of a token, as the node holds it, in the token's base units. */
function remaining(key: Web.Key, options: remaining.Options = {}) {
  return Chain.remaining({
    accessKey: key.id,
    address: key.account,
    token: options.token ?? Chain.ousd,
  })
}

declare namespace remaining {
  type Options = {
    /** The address of the token. Defaults to OUSD. */
    token?: `0x${string}` | undefined
  }
}

test.describe('access keys', () => {
  test.describe('updates, revocations, and retries', () => {
    test('updates the access key in the dialog, and sends above the old limit', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        name: 'Sign in with a limit of 5',
      })

      await test.step('sends 1 OUSD within the limit of 5', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        const left = await remaining(key)
        expect(left).toBeLessThan(4_000_000n)
        expect(left).toBeGreaterThan(4_000_000n - fee)
        await capture('sent within the limit')
      })

      await test.step('approves a limit of 50 OUSD on the page of the dialog', async () => {
        const name = 'Update the access key to a limit of 50'
        await Playwright.start(page, { name })
        const target = await Playwright.dialog(page)
        await capture('update')
        await Playwright.approve(target)

        expect(await Playwright.outcome(page, { name })).toEqual({
          state: 'fulfilled',
          value: { transaction: expect.stringMatching(/^0x/) },
        })
        expect(await remaining(key)).toBe(50_000_000n)
        await capture('updated')
      })

      await test.step('sends 20 OUSD, above the old limit', async () => {
        const transfer = await Playwright.send(page, {
          amount: '20',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(21_000_000n)
        await capture('sent above the old limit')
      })
    })

    test('updates the access key in a popup', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(
        Web.url({ accessKey: five, path: Apps.web.paths.popup, retry: '0' }),
      )

      const key =
        await test.step('signs in through a popup with a limit of 5 OUSD', async () => {
          const window = await Playwright.popup(page, {
            open: () => Playwright.start(page, { name: 'Sign in' }),
          })
          await Playwright.signIn(window, { code, email })
          const session = await Playwright.outcome(page, { name: 'Sign in' })
          expect(session.state).toBe('fulfilled')
          const key: Web.Key = session.value.key
          await Chain.fund({ address: key.account })

          // The node holds an access key from its first transaction.
          const transfer = await Playwright.send(page, {
            amount: '1',
            to: privateKeyToAddress(generatePrivateKey()),
          })
          expect(transfer.state).toBe('fulfilled')
          await capture('signed in')
          return key
        })

      await test.step('approves a limit of 50 OUSD on the page of a popup', async () => {
        const name = 'Update the access key to a limit of 50'
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name }),
        })
        await window.waitForURL(`${TempoId.url}/access-keys/update**`)
        await capture('update', window)
        await Playwright.approve(window)

        expect(await Playwright.outcome(page, { name })).toEqual({
          state: 'fulfilled',
          value: { transaction: expect.stringMatching(/^0x/) },
        })
        expect(await remaining(key)).toBe(50_000_000n)
        await capture('updated')
      })
    })

    test('revokes the access key in the dialog, and a later transfer requests a new access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, { capture, code, email })

      await test.step('sends 1 OUSD, and revokes the access key on the page of the dialog', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(transfer.state).toBe('fulfilled')
        const name = 'Revoke the access key'
        await Playwright.start(page, { name })
        const target = await Playwright.dialog(page)
        await capture('revocation')
        await Playwright.revoke(target)

        expect(await Playwright.outcome(page, { name })).toEqual({
          state: 'fulfilled',
          value: { transaction: expect.stringMatching(/^0x/) },
        })
        expect(
          await Chain.accessKey({ accessKey: key.id, address: key.account }),
        ).toMatchObject({ isRevoked: true })
        await capture('revoked')
      })

      await test.step('rejects the transfer once the user closes the sign-in for a new access key', async () => {
        await Playwright.submit(page, { amount: '1', to: recipient })
        await Playwright.dialog(page)
        await capture('new access key')
        await page.keyboard.press('Escape')

        expect(await Playwright.outcome(page, { name: 'Send OUSD' })).toEqual({
          state: 'rejected',
          value: expect.objectContaining(closed.key),
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('closed')
      })

      await test.step('sends the transfer again with the access key that the user approves', async () => {
        await Playwright.submit(page, { amount: '1', to: recipient })
        await Playwright.approve(await Playwright.dialog(page))

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('sent again')
      })
    })

    test('requests a new access key for a transfer above the limit, and sends it again', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        name: 'Sign in with a limit of 5',
      })

      await test.step('sends 3 OUSD within the limit of 5', async () => {
        const transfer = await Playwright.send(page, {
          amount: '3',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        await capture('sent within the limit')
      })

      await test.step('rejects 4 OUSD more once the user closes the sign-in for a new limit', async () => {
        await Playwright.submit(page, { amount: '4', to: recipient })
        await Playwright.dialog(page)
        await capture('new limit')
        await page.keyboard.press('Escape')

        expect(await Playwright.outcome(page, { name: 'Send OUSD' })).toEqual({
          state: 'rejected',
          value: expect.objectContaining(closed.limit),
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(3_000_000n)
        await capture('closed')
      })

      await test.step('sends the 4 OUSD with the access key that the user approves', async () => {
        await Playwright.submit(page, { amount: '4', to: recipient })
        await Playwright.approve(await Playwright.dialog(page))

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(7_000_000n)
        await capture('sent again')
      })
    })

    test('requests a higher limit for a transfer above the whole limit, and sends it again', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        name: 'Sign in with a limit of 5',
      })

      await test.step('sends 6 OUSD with an access key of a limit of 11 that the user approves', async () => {
        await Playwright.submit(page, { amount: '6', to: recipient })
        await Playwright.approve(await Playwright.dialog(page))

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(6_000_000n)
        const left = await remaining(session.value.key)
        expect(left).toBeLessThan(5_000_000n)
        expect(left).toBeGreaterThan(5_000_000n - fee)
        await capture('sent above the whole limit')
      })
    })

    // The second transfer is above the limit of 11 that the first one's sign-in grants, or
    // equal to it, so the limit also pays its fee.
    for (const entry of [
      { amount: 20, left: 11_000_000n, limit: '31' },
      { amount: 11, left: 100_000n, limit: '11.1' },
    ] as const)
      test(`requests a higher limit again for a transfer of ${entry.amount} OUSD that joins the sign-in of a smaller one`, async ({
        capture,
        code,
        email,
        page,
      }) => {
        const recipient = privateKeyToAddress(generatePrivateKey())
        const name = `Send ${entry.amount} OUSD`
        await Web.enter_dialog(page, {
          capture,
          code,
          email,
          name: 'Sign in with a limit of 5',
        })

        await test.step(`starts ${entry.amount} OUSD while the sign-in for the 6 OUSD transfer shows`, async () => {
          await Playwright.submit(page, { amount: '6', to: recipient })
          await Playwright.dialog(page)
          // The open dialog makes the page inert, so the page's own script clicks the control.
          await page
            .getByRole('button', { exact: true, name })
            .evaluate((button: HTMLButtonElement) => button.click())
          await capture('both transfers wait')
        })

        await test.step(`sends 6 OUSD with the limit of 11, and ${entry.amount} OUSD with a limit of ${entry.limit} after a second approval`, async () => {
          await Playwright.approve(await Playwright.dialog(page))
          expect(
            (await Playwright.outcome(page, { name: 'Send OUSD' })).state,
          ).toBe('fulfilled')
          await Playwright.approve(await Playwright.dialog(page))

          expect((await Playwright.outcome(page, { name })).state).toBe(
            'fulfilled',
          )
          expect(
            await Chain.balance({ address: recipient, token: Chain.ousd }),
          ).toBe(6_000_000n)
          const session = await Playwright.run(page, { name: 'Session' })
          const left = await remaining(session.value.key)
          expect(left).toBeLessThan(entry.left)
          expect(left).toBeGreaterThan(entry.left - fee)
          await capture('sent both')
        })
      })

    test('requests a higher limit for a transfer of the whole limit after a spend, since the limit pays its fee too', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        name: 'Sign in with a limit of 5',
      })

      await test.step('sends 1 OUSD within the limit of 5', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        await capture('sent within the limit')
      })

      // A new access key with a limit of 5 would pay the fee from the limit, and then revert the
      // transfer of 5.
      await test.step('sends 5 OUSD with an access key of a limit of 5.1 that the user approves', async () => {
        await Playwright.submit(page, { amount: '5', to: recipient })
        await Playwright.approve(await Playwright.dialog(page))

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(6_000_000n)
        const left = await remaining(session.value.key)
        expect(left).toBeLessThan(100_000n)
        expect(left).toBeGreaterThan(100_000n - fee)
        await capture('sent the whole limit')
      })
    })

    test('opens the deposit page for a transfer above the balance, and sends it again', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      await Web.enter_dialog(page, { capture, code, email, fund: false })

      await test.step('rejects the transfer once the user closes the deposit page', async () => {
        await Playwright.submit(page, { amount: '1', to: recipient })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await capture('deposit page')
        await deposit.close.click()

        expect(await Playwright.outcome(page, { name: 'Send OUSD' })).toEqual({
          state: 'rejected',
          value: expect.objectContaining(closed.balance),
        })
        await capture('closed')
      })

      await test.step('sends the transfer once the faucet funds the account', async () => {
        await Playwright.submit(page, { amount: '1', to: recipient })
        const deposit = await Playwright.deposit(await Playwright.dialog(page))
        await deposit.faucet.click()

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('sent')
      })
    })

    test('rejects a refused transfer with the node’s error, and no screen, with `retry: false`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        fund: false,
        name: 'Sign in with a limit of 5',
        retry: '0',
      })

      await test.step('rejects a transfer above the balance', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'TokenInsufficientBalanceError' },
        })
        await Playwright.uncovered(page)
        await capture('above the balance')
      })

      await test.step('rejects a transfer above the limit', async () => {
        await Chain.fund({ address: key.account })
        const transfer = await Playwright.send(page, {
          amount: '6',
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'AccessKeySpendingLimitExceededError' },
        })
        await Playwright.uncovered(page)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(0n)
        await capture('above the limit')
      })
    })

    test('updates and revokes the access key with no page, for an app with `tempo-id:sign`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: five,
        capture,
        clientId: Apps.web.clientIdSign,
        code,
        email,
        retry: '0',
      })

      await test.step('updates the limit to 50 OUSD, and sends above the old limit', async () => {
        // The node holds an access key from its first transaction.
        const first = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(first.state).toBe('fulfilled')
        const update = await Playwright.run(page, {
          name: 'Update the limit to 50 without a dialog',
        })

        expect(update).toEqual({
          state: 'fulfilled',
          value: {
            limit: '50000000',
            transactionHash: expect.stringMatching(/^0x/),
          },
        })
        expect(await remaining(key)).toBe(50_000_000n)
        const transfer = await Playwright.send(page, {
          amount: '20',
          to: recipient,
        })
        expect(transfer.state).toBe('fulfilled')
        await capture('updated')
      })

      await test.step('revokes the access key, which then sends nothing', async () => {
        const revocation = await Playwright.run(page, {
          name: 'Revoke the access key without a dialog',
        })

        expect(revocation).toEqual({
          state: 'fulfilled',
          value: { transactionHash: expect.stringMatching(/^0x/) },
        })
        expect(
          await Chain.accessKey({ accessKey: key.id, address: key.account }),
        ).toMatchObject({ isRevoked: true })
        // The session keeps the revoked access key without its material, as another app's access
        // key. A `token.transferSync` of such a session opens Tempo ID's payment page, so the
        // transaction sends its call through Viem's own action. On a page, Viem's error wraps the
        // refusal of the account.
        const transfer = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 1_000_000n,
              to: recipient,
              token: Chain.ousd,
            }),
          ],
        })
        expect(transfer).toMatchObject({
          state: 'rejected',
          value: {
            message: expect.stringContaining(
              'Sign in with an access key to send transactions.',
            ),
            name: 'TransactionExecutionError',
          },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(21_000_000n)
        await capture('revoked')
      })
    })

    test('refuses an update with no page, and revokes with the access token, for an app without `tempo-id:sign`', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const key = await Web.enter(page, {
        accessKey: five,
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('rejects the update, and keeps the limit', async () => {
        // The node holds an access key from its first transaction.
        const first = await Playwright.send(page, {
          amount: '1',
          to: privateKeyToAddress(generatePrivateKey()),
        })
        expect(first.state).toBe('fulfilled')
        const left = await remaining(key)
        const update = await Playwright.run(page, {
          name: 'Update the limit to 50 without a dialog',
        })

        expect(update).toMatchObject({
          state: 'rejected',
          value: {
            name: 'Accounts.RequestError',
            reason: 'sign_not_permitted',
            status: 403,
          },
        })
        expect(await remaining(key)).toBe(left)
        await capture('update refused')
      })

      await test.step('revokes the session’s own access key with its access token', async () => {
        const revocation = await Playwright.run(page, {
          name: 'Revoke the access key without a dialog',
        })

        expect(revocation).toMatchObject({
          state: 'fulfilled',
          value: { transactionHash: expect.stringMatching(/^0x/) },
        })
        expect(
          await Chain.accessKey({ accessKey: key.id, address: key.account }),
        ).toMatchObject({ isRevoked: true })
        await capture('revoked')
      })

      // The browser logs the refused update.
      expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
    })
  })

  test.describe('limits and expiry', () => {
    test('spends a one-time limit, and rejects a transfer of one base unit above the remainder', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: five,
        capture,
        code,
        email,
        retry: '0',
      })

      const left =
        await test.step('sends 1 OUSD, which lowers the remainder by the amount and the fee', async () => {
          const transfer = await Playwright.send(page, {
            amount: '1',
            to: recipient,
          })

          expect(transfer.state).toBe('fulfilled')
          const left = await remaining(key)
          expect(left).toBeLessThan(4_000_000n)
          expect(left).toBeGreaterThan(4_000_000n - fee)
          await capture('sent')
          return left
        })

      await test.step('rejects a transfer of the remainder and one base unit', async () => {
        const transfer = await Playwright.send(page, {
          amount: formatUnits(left + 1n, 6),
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'AccessKeySpendingLimitExceededError' },
        })
        expect(await remaining(key)).toBe(left)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('rejected')
      })

      await test.step('sends 2 OUSD more within the remainder', async () => {
        const transfer = await Playwright.send(page, {
          amount: '2',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(3_000_000n)
        await capture('sent within the remainder')
      })
    })

    test('resolves a decimal string, base units, a symbol, and an address to the same limit', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter(page, {
        accessKey: {
          expiry: '1d',
          limits: [
            { limit: '5', token: 'ousd' },
            { limit: 5_000_000n, token: Chain.alphaUsd },
            { limit: '5.0', token: 'betaUSD' },
          ],
        },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('holds 5 units of each token as its limit on the node', async () => {
        // The node holds an access key from its first transaction, whose fee OUSD pays.
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: privateKeyToAddress(generatePrivateKey()),
        })

        expect(transfer.state).toBe('fulfilled')
        expect(await remaining(key, { token: Chain.alphaUsd })).toBe(5_000_000n)
        expect(await remaining(key, { token: Chain.betaUsd })).toBe(5_000_000n)
        expect(await remaining(key)).toBeGreaterThan(4_000_000n - fee)
        await capture('limits')
      })
    })

    test('spends the limit of each token alone, and rejects a token without a limit', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: {
          expiry: '1d',
          limits: [
            { limit: '5', token: 'ousd' },
            { limit: '5', token: Chain.alphaUsd },
          ],
        },
        capture,
        code,
        email,
        retry: '0',
      })

      const left =
        await test.step('sends 1 OUSD from the limit of OUSD alone', async () => {
          const transfer = await Playwright.send(page, {
            amount: '1',
            to: recipient,
          })

          expect(transfer.state).toBe('fulfilled')
          expect(await remaining(key, { token: Chain.alphaUsd })).toBe(
            5_000_000n,
          )
          await capture('sent OUSD')
          return remaining(key)
        })

      await test.step('sends 2 alphaUSD from the limit of alphaUSD alone', async () => {
        const transfer = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 2_000_000n,
              to: recipient,
              token: Chain.alphaUsd,
            }),
          ],
        })

        expect(transfer.state).toBe('fulfilled')
        const alpha = await remaining(key, { token: Chain.alphaUsd })
        expect(alpha).toBeLessThan(3_000_000n)
        expect(alpha).toBeGreaterThan(3_000_000n - fee)
        expect(await remaining(key)).toBe(left)
        expect(
          await Chain.balance({ address: recipient, token: Chain.alphaUsd }),
        ).toBe(2_000_000n)
        await capture('sent alphaUSD')
      })

      await test.step('rejects a transfer of betaUSD, which holds no limit', async () => {
        const transfer = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 1_000_000n,
              to: recipient,
              token: Chain.betaUsd,
            }),
          ],
        })

        expect(transfer.state).toBe('rejected')
        expect(transfer.value.message).toContain('CallNotAllowed')
        expect(
          await Chain.balance({ address: recipient, token: Chain.betaUsd }),
        ).toBe(0n)
        await capture('rejected betaUSD')
      })
    })

    test('resets a limit per period once the period ends', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: {
          expiry: '5m',
          limits: [{ limit: '2', period: '12s', token: 'ousd' }],
        },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('sends 1.5 OUSD, and rejects 1 OUSD more within the period', async () => {
        const first = await Playwright.send(page, {
          amount: '1.5',
          to: recipient,
        })
        expect(first.state).toBe('fulfilled')
        const second = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(second.state).toBe('rejected')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_500_000n)
        await capture('rejected within the period')
      })

      await test.step('sends the 1 OUSD after the period', async () => {
        await expect
          .poll(() => remaining(key), { timeout: 30_000 })
          .toBe(2_000_000n)
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_500_000n)
        await capture('sent after the period')
      })
    })

    for (const form of [
      {
        expiry: () => undefined,
        name: 'the day that the package fills for an absent expiry',
        seconds: 24 * 60 * 60,
        tolerance: 120,
      },
      {
        expiry: () => '2h' as const,
        name: 'the expiry of a duration of 2 hours',
        seconds: 2 * 60 * 60,
        tolerance: 120,
      },
      {
        expiry: (now: number) => now + 3 * 60 * 60,
        name: 'the expiry of Unix seconds',
        seconds: 3 * 60 * 60,
        tolerance: 0,
      },
    ])
      test(`holds ${form.name} in the session and on the node`, async ({
        capture,
        code,
        email,
        page,
      }) => {
        const now = Math.floor(Date.now() / 1_000)
        const expiry = form.expiry(now)
        const expected = now + form.seconds
        const key = await Web.enter(page, {
          accessKey: {
            ...(expiry === undefined ? {} : { expiry }),
            limits: five.limits,
          },
          capture,
          code,
          email,
          retry: '0',
        })

        await test.step('holds the expiry in the session and on the node', async () => {
          // The node holds an access key from its first transaction.
          const transfer = await Playwright.send(page, {
            amount: '1',
            to: privateKeyToAddress(generatePrivateKey()),
          })
          expect(transfer.state).toBe('fulfilled')
          const held = await Chain.accessKey({
            accessKey: key.id,
            address: key.account,
          })

          expect(Number(held.expiry)).toBe(key.expiry)
          expect(key.expiry).toBeGreaterThanOrEqual(expected - form.tolerance)
          expect(key.expiry).toBeLessThanOrEqual(expected + form.tolerance)
          await capture('expiry')
        })
      })

    test('rejects a transfer after the expiry, ends the session, and authorizes a new access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: { ...five, expiry: '15s' },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('rejects a transfer after the expiry, and ends the session', async () => {
        // The node holds an access key from its first transaction, and names the expiry of one that
        // it holds.
        const first = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(first.state).toBe('fulfilled')
        await expired(key)
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'AccessKeyExpiredError' },
        })
        expect((await Playwright.run(page, { name: 'Session' })).value).toBe(
          null,
        )
        await expect(page.locator('#status')).toHaveText('signedOut')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('expired')
      })

      await test.step('authorizes a new access key with no page, and sends with it', async () => {
        const session = await Playwright.run(page, { name: 'Authorize' })

        expect(session.state).toBe('fulfilled')
        expect(session.value.key.id).not.toBe(key.id)
        await expect(page.locator('#status')).toHaveText('signedIn')
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('authorized again')
      })
    })

    test('renews the access key with no screen and no read of the fees for a transfer after the expiry, and sends it again', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        accessKey: { ...five, expiry: '15s' },
        capture,
        code,
        email,
      })

      await test.step('sends a transfer after the expiry with a new access key, and shows no screen', async () => {
        const first = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(first.state).toBe('fulfilled')
        await expired(key)
        // The requests that fill, estimate, or send a transaction of the expired access key, which
        // the page knows from its clock, so the node receives none.
        const carried: string[] = []
        // Each request to the node. The refused fill ends the preparation, so the node receives no
        // read of the fees or estimate before the renewal.
        const methods: string[] = []
        page.on('request', (request) => {
          if (!request.url().startsWith(Chain.rpcUrl)) return
          const body = request.postDataJSON() as
            | { method?: string; params?: readonly { keyId?: string }[] }
            | undefined
          if (body?.method) methods.push(body.method)
          if (body?.params?.[0]?.keyId?.toLowerCase() === key.id.toLowerCase())
            carried.push(body.method!)
        })
        // A screen would hold the transfer until an approval, and the step approves none.
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(carried).toEqual([])
        expect(methods).toEqual([
          'eth_fillTransaction',
          'eth_sendRawTransactionSync',
        ])
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('sent again')
      })
    })

    test('renews the access key with no screen for a transaction after the expiry whose fields are all given, and the node receives no send of the expired access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        accessKey: { ...five, expiry: '15s' },
        capture,
        code,
        email,
      })
      // With its nonce, gas, and fees given, Viem fills and estimates nothing, so only its signature
      // precedes its send.
      const given = {
        calls: [
          Actions.token.transfer.call({
            amount: 1_000_000n,
            to: recipient,
            token: Chain.ousd,
          }),
        ],
        feeToken: Chain.ousd,
        fields: {
          gas: 8_000_000n,
          maxFeePerGas: 50_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          nonceKey: 'expiring' as const,
        },
      }

      await test.step('sends the transaction after the expiry with a new access key, and the node receives one send', async () => {
        const first = await Playwright.calls(page, given)
        expect(first.state).toBe('fulfilled')
        await expired(key)
        // Each send reaches the node signed, so the count tells a send of the expired access key,
        // which the node refuses before the retry renews it, from the send of the new one.
        const sent: string[] = []
        page.on('request', (request) => {
          if (!request.url().startsWith(Chain.rpcUrl)) return
          const body = request.postDataJSON() as { method?: string } | undefined
          if (body?.method?.startsWith('eth_sendRawTransaction'))
            sent.push(body.method)
        })
        const transfer = await Playwright.calls(page, given)

        expect(transfer.state).toBe('fulfilled')
        expect(sent).toHaveLength(1)
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('sent again')
      })
    })

    test('shows the sign-in for a transfer after the expiry in a browser without a Tempo ID session, and sends it again', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter_dialog(page, {
        accessKey: { ...five, expiry: '15s' },
        capture,
        code,
        email,
      })

      await test.step('shows the sign-in for a transfer after the expiry, once the browser holds no Tempo ID session', async () => {
        const first = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        expect(first.state).toBe('fulfilled')
        // The app holds its session in the page's storage, so only Tempo ID's session ends.
        await page
          .context()
          .clearCookies({ domain: new URL(TempoId.url).hostname })
        await expired(key)
        await Playwright.submit(page, { amount: '1', to: recipient })
        const target = await Playwright.dialog(page)
        // The renewal sends the authorization with no check of the session, so the browser logs
        // Tempo ID's `session_required` refusal.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
        await capture('sign-in')
        await Playwright.signIn(target, { code, email })

        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        expect(transfer.state).toBe('fulfilled')
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key.id).not.toBe(key.id)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('sent again')
      })
    })

    test('holds an access key without an expiry, a limit, or scopes, for an app with `tempo-id:sign`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: { expiry: false, scopes: 'any' },
        capture,
        clientId: Apps.web.clientIdSign,
        code,
        email,
        retry: '0',
      })

      await test.step('sends OUSD, and holds no bound on the node', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(key.expiry).toBe(null)
        expect(
          await Chain.accessKey({ accessKey: key.id, address: key.account }),
        ).toMatchObject({
          expiry: never,
          isRevoked: false,
          spendPolicy: 'unlimited',
        })
        await capture('sent')
      })

      await test.step('calls the fee manager, which is no token', async () => {
        const call = await Playwright.calls(page, {
          calls: [Actions.fee.setUserToken.call({ token: Chain.alphaUsd })],
        })

        expect(call.state).toBe('fulfilled')
        expect(
          (await Chain.feeToken({ address: key.account }))?.toLowerCase(),
        ).toBe(Chain.alphaUsd.toLowerCase())
        await capture('called the fee manager')
      })
    })
  })

  test.describe('scopes', () => {
    test('fills the scopes of a limit with `transfer` and `transferWithMemo` alone', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      await Web.enter(page, {
        accessKey: ten,
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('sends a transfer, and a transfer with a memo', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })
        const memo = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 1_000_000n,
              memo: '0x01',
              to: recipient,
              token: Chain.ousd,
            }),
          ],
        })

        expect(transfer.state).toBe('fulfilled')
        expect(memo.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('inside the scopes')
      })

      await test.step('rejects an approval, and a transfer of another token', async () => {
        const approval = await Playwright.calls(page, {
          calls: [
            Actions.token.approve.call({
              amount: 1_000_000n,
              spender: recipient,
              token: Chain.ousd,
            }),
          ],
          feeToken: Chain.ousd,
        })
        const other = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 1_000_000n,
              to: recipient,
              token: Chain.alphaUsd,
            }),
          ],
        })

        expect(approval.state).toBe('rejected')
        expect(approval.value.message).toContain('CallNotAllowed')
        expect(other.state).toBe('rejected')
        expect(other.value.message).toContain('CallNotAllowed')
        expect(
          await Chain.balance({ address: recipient, token: Chain.alphaUsd }),
        ).toBe(0n)
        await capture('outside the scopes')
      })
    })

    test('sends a batch of calls inside the scopes, and rejects a batch with one call outside', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      await Web.enter(page, {
        accessKey: ten,
        capture,
        code,
        email,
        retry: '0',
      })
      const transfer = Actions.token.transfer.call({
        amount: 1_000_000n,
        to: recipient,
        token: Chain.ousd,
      })

      await test.step('sends two transfers as one transaction', async () => {
        const batch = await Playwright.calls(page, {
          calls: [transfer, transfer],
        })

        expect(batch.state).toBe('fulfilled')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('batch')
      })

      await test.step('rejects a transfer and an approval as a whole', async () => {
        const batch = await Playwright.calls(page, {
          calls: [
            transfer,
            Actions.token.approve.call({
              amount: 1_000_000n,
              spender: recipient,
              token: Chain.ousd,
            }),
          ],
        })

        expect(batch.state).toBe('rejected')
        expect(batch.value.message).toContain('CallNotAllowed')
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(2_000_000n)
        await capture('rejected batch')
      })
    })

    test('approves a spender of the limit’s `spenders`, and rejects another spender', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const privateKey = generatePrivateKey()
      const spender = privateKeyToAddress(privateKey)
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: {
          expiry: '1d',
          limits: [{ limit: '10', spenders: [spender], token: 'ousd' }],
        },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('approves 3 OUSD to the spender, which counts against the limit', async () => {
        const approval = await Playwright.calls(page, {
          calls: [
            Actions.token.approve.call({
              amount: 3_000_000n,
              spender,
              token: Chain.ousd,
            }),
          ],
          feeToken: Chain.ousd,
        })

        expect(approval.state).toBe('fulfilled')
        const left = await remaining(key)
        expect(left).toBeLessThan(7_000_000n)
        expect(left).toBeGreaterThan(7_000_000n - fee)
        await capture('approved')
      })

      await test.step('moves the 3 OUSD as the spender', async () => {
        await Chain.fund({ address: spender })
        await Chain.pull({
          amount: 3_000_000n,
          from: key.account,
          privateKey,
          to: recipient,
          token: Chain.ousd,
        })

        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(3_000_000n)
        await capture('moved')
      })

      await test.step('rejects an approval to another spender', async () => {
        const approval = await Playwright.calls(page, {
          calls: [
            Actions.token.approve.call({
              amount: 1_000_000n,
              spender: recipient,
              token: Chain.ousd,
            }),
          ],
          feeToken: Chain.ousd,
        })

        expect(approval.state).toBe('rejected')
        expect(approval.value.message).toContain('CallNotAllowed')
        await capture('rejected')
      })
    })

    test('sends to a recipient of a named scope, and rejects another recipient and another function', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const other = privateKeyToAddress(generatePrivateKey())
      await Web.enter(page, {
        accessKey: {
          ...ten,
          scopes: [
            Scopes.tip20(Chain.ousd).transfer({ recipients: [recipient] }),
          ],
        },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('sends to the recipient of the scope', async () => {
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

      await test.step('rejects another recipient, and a transfer with a memo', async () => {
        const transfer = await Playwright.send(page, { amount: '1', to: other })
        const memo = await Playwright.calls(page, {
          calls: [
            Actions.token.transfer.call({
              amount: 1_000_000n,
              memo: '0x01',
              to: recipient,
              token: Chain.ousd,
            }),
          ],
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'AccessKeyCallNotAllowedError' },
        })
        expect(memo.state).toBe('rejected')
        expect(memo.value.message).toContain('CallNotAllowed')
        expect(await Chain.balance({ address: other, token: Chain.ousd })).toBe(
          0n,
        )
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('rejected')
      })
    })

    test('calls any function of a contract of a scope without a selector, and no token', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const key = await Web.enter(page, {
        accessKey: {
          ...ten,
          scopes: [Scopes.target(Addresses.feeManager).any()],
        },
        capture,
        clientId: Apps.web.clientIdSign,
        code,
        email,
        retry: '0',
      })

      await test.step('calls the fee manager, with the fee in the limited token', async () => {
        const call = await Playwright.calls(page, {
          calls: [Actions.fee.setUserToken.call({ token: Chain.alphaUsd })],
          feeToken: Chain.ousd,
        })

        expect(call.state).toBe('fulfilled')
        expect(
          (await Chain.feeToken({ address: key.account }))?.toLowerCase(),
        ).toBe(Chain.alphaUsd.toLowerCase())
        await capture('called the fee manager')
      })

      await test.step('rejects a transfer of the limited token', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'rejected',
          value: { name: 'AccessKeyCallNotAllowedError' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(0n)
        await capture('rejected')
      })
    })
  })

  test.describe('refusals before the request', () => {
    for (const refusal of refusals_local)
      test(`refuses ${refusal.name} from the app’s own form, before the request`, async ({
        capture,
        code,
        email,
        errors,
        page,
      }) => {
        await page.goto(Web.url({ accessKey: refusal.accessKey }))

        await test.step('rejects the sign-in with the reason and status 0, and holds no session', async () => {
          const session = await Playwright.signIn_custom(page, { code, email })

          expect(session).toMatchObject({
            state: 'rejected',
            value: {
              name: 'Accounts.RequestError',
              reason: refusal.reason,
              status: 0,
            },
          })
          await expect(page.locator('#status')).toHaveText('signedOut')
          expect((await Playwright.run(page, { name: 'Session' })).value).toBe(
            null,
          )
          // The sign-in sends no request, so the browser logs no refusal.
          expect(errors).toEqual([])
          await capture('refused')
        })
      })

    test('refuses an expiry in milliseconds from the dialog’s sign-in, before the dialog opens', async ({
      capture,
      errors,
      page,
    }) => {
      await page.goto(
        Web.url({
          accessKey: {
            expiry: Date.now() + 3_600_000,
            limits: [{ limit: '5', token: 'ousd' }],
          },
          path: Apps.web.paths.dialog,
        }),
      )

      await test.step('rejects the sign-in with invalid_expiry and status 0, and shows no dialog', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const session = await Playwright.outcome(page, { name: 'Sign in' })

        expect(session).toMatchObject({
          state: 'rejected',
          value: {
            name: 'Accounts.RequestError',
            reason: 'invalid_expiry',
            status: 0,
          },
        })
        await expect(Playwright.prompt(page)).toHaveCount(0)
        await expect(page.locator('#status')).toHaveText('signedOut')
        // The sign-in sends no request, so the browser logs no refusal.
        expect(errors).toEqual([])
        await capture('refused')
      })
    })
  })

  test.describe('refusals of Tempo ID', () => {
    for (const refusal of refusals)
      test(`refuses ${refusal.name} from the app’s own form`, async ({
        capture,
        code,
        email,
        errors,
        page,
      }) => {
        await page.goto(Web.url({ accessKey: refusal.accessKey }))

        await test.step('rejects the sign-in with the reason, and holds no session', async () => {
          const session = await Playwright.signIn_custom(page, { code, email })

          expect(session).toMatchObject({
            state: 'rejected',
            value: {
              name: 'Accounts.RequestError',
              reason: refusal.reason,
              status: refusal.status,
            },
          })
          await expect(page.locator('#status')).toHaveText('signedOut')
          expect((await Playwright.run(page, { name: 'Session' })).value).toBe(
            null,
          )
          // The browser logs the refused request.
          expect(errors.splice(0)).toEqual([Web.consoleErrors[refusal.status]])
          await capture('refused')
        })
      })

    test('refuses a challenge from the app’s own form, for an app without `tempo-id:sign`', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(
        Web.url({ accessKey: five, challenge: 'Sign in to the web test app.' }),
      )

      await test.step('rejects the sign-in with the reason, and holds no session', async () => {
        const session = await Playwright.signIn_custom(page, { code, email })

        expect(session).toMatchObject({
          state: 'rejected',
          value: {
            name: 'Accounts.RequestError',
            reason: 'challenge_not_permitted',
            status: 403,
          },
        })
        await expect(page.locator('#status')).toHaveText('signedOut')
        // The browser logs the refused request.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        await capture('refused')
      })
    })

    test('accepts a limit of 1,000 OUSD from the app’s own form', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter(page, {
        accessKey: { expiry: '1d', limits: [{ limit: '1000', token: 'ousd' }] },
        capture,
        code,
        email,
        retry: '0',
      })

      await test.step('holds the limit of 1,000 OUSD on the node', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: privateKeyToAddress(generatePrivateKey()),
        })

        expect(transfer.state).toBe('fulfilled')
        const left = await remaining(key)
        expect(left).toBeLessThan(999_000_000n)
        expect(left).toBeGreaterThan(999_000_000n - fee)
        await capture('limit')
      })
    })

    test('moves a sign-in whose limit the frame refuses to a popup, which accepts the limit', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(
        Web.url({
          accessKey: {
            expiry: '1d',
            limits: [{ limit: '1001', token: 'ousd' }],
          },
          path: Apps.web.paths.dialog,
        }),
      )

      const window =
        await test.step('offers a popup in place of the frame', async () => {
          await Playwright.start(page, { name: 'Sign in' })
          await expect(Playwright.prompt(page)).toContainText(
            'Continue in a new window to finish signing in.',
          )
          await capture('popup offer')
          const window = await Playwright.popup(page, {
            open: () => Playwright.choose(page, { name: 'Continue' }),
          })
          await window.waitForURL(`${TempoId.url}/**`)
          await capture('popup', window)
          return window
        })

      await test.step('signs in in the popup, and holds the limit of 1,001 OUSD on the node', async () => {
        await Playwright.signIn(window, { code, email })
        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        const key: Web.Key = session.value.key
        await Chain.fund({ address: key.account })
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: privateKeyToAddress(generatePrivateKey()),
        })

        expect(transfer.state).toBe('fulfilled')
        const left = await remaining(key)
        expect(left).toBeLessThan(1_000_000_000n)
        expect(left).toBeGreaterThan(1_000_000_000n - fee)
        // The browser logs the request that the frame's check refused.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        await capture('signed in')
      })
    })
  })
})
