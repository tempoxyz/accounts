/**
 * Tests the wagmi page of the web test app: a wagmi app whose wallet is Tempo ID. The cases cover
 * the `tempoId` connector, which signs in through the dialog at wagmi's `connect`, a transfer with
 * the hook of `wagmi/tempo`, a message that the access key signs, the connection after a reload, the
 * disconnection, a dialog that the user closes, a switch to a second chain of the config, and the
 * config of the `wagmi` plugin over the app's own instance.
 * @module
 */
import type { Page } from '@playwright/test'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Verify from '../Verify.js'
import * as Web from '../Web.js'

/** The message that the page's "Sign a message" control signs. */
const message = 'Sign in to the wagmi page'

/**
 * Connects wagmi on the wagmi page with a sign-in of `email` through the dialog, and funds the
 * Tempo Account, as the first step of a test. Returns the Tempo Account that wagmi shows.
 */
function connect(page: Page, options: connect.Options) {
  const { capture, code, email, plugin = false, second = false } = options
  return test.step('connects wagmi with a sign-in through the dialog', async () => {
    await page.goto(
      Web.url({
        message,
        path: Apps.web.paths.wagmi,
        ...(plugin ? { plugin: '1' } : {}),
        ...(second ? { second: '1' } : {}),
      }),
    )
    await expect(status(page)).toHaveText('disconnected')
    await Playwright.start(page, { name: 'Connect' })
    await Playwright.signIn(await Playwright.dialog(page), { code, email })
    const connected = await Playwright.outcome(page, { name: 'Connect' })

    expect(connected).toEqual({
      state: 'fulfilled',
      value: {
        accounts: [expect.stringMatching(/^0x[0-9a-fA-F]{40}$/)],
        chainId: Chain.chain.id,
      },
    })
    const account: `0x${string}` = connected.value.accounts[0]
    await expect(status(page)).toHaveText('connected')
    await expect(page.locator('#account')).toHaveText(account)
    await Chain.fund({ address: account })

    await capture('connected')
    return account
  })
}

declare namespace connect {
  type Options = {
    /** Adds a screenshot of the page to the report. */
    capture: (name: string) => Promise<void>
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
    /** Whether the page's config is the `wagmi` plugin's. Defaults to the connector's. */
    plugin?: boolean | undefined
    /** Whether the config also holds the second node's chain. Defaults to `false`. */
    second?: boolean | undefined
  }
}

/** Returns the element that shows the status of wagmi's connection on `page`. */
function status(page: Page) {
  return page.locator('#status')
}

test.describe('wagmi', () => {
  test.describe('connector', () => {
    test('connects through the dialog, sends OUSD with the hook of wagmi, and signs a message with the access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const account = await connect(page, { capture, code, email })

      await test.step('holds the session of the sign-in in the connector’s instance', async () => {
        const session = await Playwright.run(page, { name: 'Session' })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account, chainId: Chain.chain.id } },
        })
        await capture('session')
      })

      await test.step('sends OUSD with `useTransferSync`, which the access key signs', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1.5',
          to: recipient,
        })
        const session = await Playwright.run(page, { name: 'Session' })

        expect(transfer).toEqual({
          state: 'fulfilled',
          value: { transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_500_000n)
        expect(
          await Chain.transfers({ hash: transfer.value.transactionHash }),
        ).toContainEqual({ amount: 1_500_000n, from: account, to: recipient })
        // The node registers the access key at its first transaction.
        expect(
          await Chain.accessKey({
            accessKey: session.value.key.id,
            address: account,
          }),
        ).toMatchObject({ isRevoked: false })
        await capture('sent')
      })

      await test.step('signs a message with `useSignMessage`, which a verifier accepts with the access token', async () => {
        const signed = await Playwright.run(page, { name: 'Sign a message' })
        const proof = await Playwright.run(page, { name: 'Proof' })

        expect(signed).toMatchObject({
          state: 'fulfilled',
          value: { address: account, message },
        })
        const { signature } = signed.value
        const accessToken: string = proof.value.accessToken
        expect(
          await Verify.accessKey({
            accessToken,
            address: account,
            message,
            signature,
          }),
        ).toBe(true)
        expect(
          await Verify.accessKey({
            accessToken,
            address: account,
            message: `${message} `,
            signature,
          }),
        ).toBe(false)
        // The signature is the access key's, so it counts only with the app's access token.
        expect(
          await Verify.accessKey({ address: account, message, signature }),
        ).toBe(false)
        await capture('signed')
      })
    })

    test('connects again after a reload with no sign-in, and ends the session at a disconnection', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const account = await connect(page, { capture, code, email })

      await test.step('connects after a reload, with no dialog and no request of a sign-in', async () => {
        const requests: string[] = []
        page.on('request', (request) => {
          const url = new URL(request.url())
          if (url.origin === new URL(TempoId.url).origin)
            requests.push(url.pathname)
        })
        await page.reload()

        await expect(status(page)).toHaveText('connected')
        await expect(page.locator('#account')).toHaveText(account)
        expect(await Playwright.run(page, { name: 'Session' })).toMatchObject({
          state: 'fulfilled',
          value: { email },
        })
        await Playwright.uncovered(page)
        expect(requests).toEqual([])
        await capture('connected after a reload')
      })

      await test.step('sends OUSD with the access key of the stored session', async () => {
        const recipient = privateKeyToAddress(generatePrivateKey())
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

      await test.step('disconnects, which signs the user out of the instance', async () => {
        const disconnected = await Playwright.run(page, { name: 'Disconnect' })

        expect(disconnected.state).toBe('fulfilled')
        await expect(status(page)).toHaveText('disconnected')
        await expect(page.locator('#account')).toHaveCount(0)
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('disconnected')
      })

      await test.step('stays disconnected after a reload', async () => {
        await page.reload()

        await expect(
          page.getByRole('button', { exact: true, name: 'Connect' }),
        ).toBeVisible()
        await expect(status(page)).toHaveText('disconnected')
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('disconnected after a reload')
      })
    })

    test('rejects a connection with code 4001 when the user closes the dialog', async ({
      capture,
      page,
    }) => {
      await page.goto(Web.url({ path: Apps.web.paths.wagmi }))

      await test.step('opens the dialog at wagmi’s `connect`', async () => {
        await Playwright.start(page, { name: 'Connect' })
        await Playwright.dialog(page)
        await capture('dialog')
      })

      await test.step('closes the dialog, and wagmi stays disconnected', async () => {
        await page.keyboard.press('Escape')

        expect(
          await Playwright.outcome(page, { name: 'Connect' }),
        ).toMatchObject({
          state: 'rejected',
          value: { code: 4001, name: 'UserRejectedRequestError' },
        })
        await Playwright.uncovered(page)
        await expect(status(page)).toHaveText('disconnected')
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('closed')
      })
    })

    test('switches to a second chain of the config, and sends OUSD there with a new access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const second = Chain.second.chain.id
      const account = await connect(page, {
        capture,
        code,
        email,
        second: true,
      })

      await test.step('switches wagmi and the connector’s instance to the second chain', async () => {
        await expect(page.locator('#chain')).toHaveText(String(Chain.chain.id))
        const switched = await Playwright.run(page, {
          name: 'Switch to the second chain',
        })
        const session = await Playwright.run(page, { name: 'Session' })

        expect(switched).toEqual({
          state: 'fulfilled',
          value: { chainId: second },
        })
        await expect(page.locator('#chain')).toHaveText(String(second))
        await expect(status(page)).toHaveText('connected')
        await expect(page.locator('#account')).toHaveText(account)
        // The session holds no access key on the second chain before its first transaction there.
        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: null },
        })
        await Chain.fund({ address: account, chainId: second })
        await capture('switched')
      })

      await test.step('sends OUSD on the second chain with the access key that the user approves', async () => {
        await Playwright.submit(page, { amount: '1.5', to: recipient })
        await Playwright.approve(await Playwright.dialog(page))
        const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })
        const session = await Playwright.run(page, { name: 'Session' })

        expect(transfer.state).toBe('fulfilled')
        expect(
          await Chain.balance({
            address: recipient,
            chainId: second,
            token: Chain.ousd,
          }),
        ).toBe(1_500_000n)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(0n)
        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { key: { account, chainId: second } },
        })
        expect(
          await Chain.accessKey({
            accessKey: session.value.key.id,
            address: account,
            chainId: second,
          }),
        ).toMatchObject({ isRevoked: false })
        await capture('sent on the second chain')
      })
    })
  })

  test.describe('plugin', () => {
    test('connects the app’s own instance through its config, sends OUSD, and disconnects at a sign-out of the instance', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const account = await connect(page, {
        capture,
        code,
        email,
        plugin: true,
      })

      await test.step('sends OUSD with `useTransferSync` from the instance’s session', async () => {
        const transfer = await Playwright.send(page, {
          amount: '2',
          to: recipient,
        })
        const session = await Playwright.run(page, { name: 'Session' })

        expect(transfer.state).toBe('fulfilled')
        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account } },
        })
        expect(
          await Chain.transfers({ hash: transfer.value.transactionHash }),
        ).toContainEqual({ amount: 2_000_000n, from: account, to: recipient })
        await capture('sent')
      })

      await test.step('signs out with the instance’s own action, which disconnects wagmi', async () => {
        const signedOut = await Playwright.run(page, {
          name: 'Sign out of the instance',
        })

        expect(signedOut.state).toBe('fulfilled')
        await expect(status(page)).toHaveText('disconnected')
        await expect(page.locator('#account')).toHaveCount(0)
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('signed out')
      })

      await test.step('stays disconnected after a reload', async () => {
        await page.reload()

        await expect(
          page.getByRole('button', { exact: true, name: 'Connect' }),
        ).toBeVisible()
        await expect(status(page)).toHaveText('disconnected')
        await capture('disconnected after a reload')
      })
    })
  })
})
