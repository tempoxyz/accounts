/**
 * Tests message signatures on the web test app: `dialog.signMessage` with each message shape, in the
 * frame and in a popup, the owner's signature of a message and of typed data with no page, and the
 * bounds of an access key's signature. The spec's own process verifies each signature on the node,
 * as an app's backend does.
 * @module
 */
import type { FrameLocator, Page } from '@playwright/test'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Messages from '../Messages.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Verify from '../Verify.js'
import * as Web from '../Web.js'

/** The rejection of a request that the user denied on Tempo ID's approval page. */
const denied = {
  code: 'access_denied',
  message: 'User denied access',
  name: 'Accounts.RequestError',
  reason: null,
  status: 0,
}

/** The message shapes that `dialog.signMessage` signs, each with a name for its test. */
const shapes = [
  { name: 'plain text', shape: 'text' },
  {
    name: 'several lines, a tab, and characters outside ASCII',
    shape: 'lines',
  },
  { name: 'a Sign-In with Ethereum message', shape: 'signIn' },
  {
    name: 'a Sign-In with Ethereum message that shares an item',
    shape: 'share',
  },
] as const satisfies readonly { name: string; shape: Messages.Shape }[]

/** The rejection of a signature that Tempo ID refuses for an app without `tempo-id:sign`. */
const unpermitted = {
  code: 'unauthorized_client',
  name: 'Accounts.RequestError',
  reason: 'sign_not_permitted',
  status: 403,
}

/**
 * Asserts how Tempo ID's approval page in `target` shows `message` of `shape`: plain text with a
 * warning, a share as a row of what the app receives, and a sign-in message with neither.
 */
async function shown(target: FrameLocator | Page, options: shown.Options) {
  const { message, shape } = options
  const grant = Playwright.grant(target)

  if (shape === 'share')
    await expect(grant).toContainText(['Share “notes” with another account'])
  if (Messages.shapes[shape].recognized)
    return expect(grant).not.toContainText(['expect this message'])
  await expect(grant).toContainText([
    'Approve only if you started this sign-in and expect this message.',
  ])
  await expect(grant).toContainText([message])
}

declare namespace shown {
  type Options = {
    /** The message. */
    message: string
    /** The message's shape. */
    shape: Messages.Shape
  }
}

/**
 * Loads the page of `path` again with `message` in its query, for the session that the page holds,
 * and waits until the page restores the session.
 */
async function load(page: Page, options: load.Options) {
  await page.goto(Web.url(options))
  await expect(page.locator('#status')).toHaveText('signedIn')
}

declare namespace load {
  type Options = Pick<
    Web.url.Options,
    'clientId' | 'message' | 'path' | 'typedData'
  >
}

test.describe('signatures', () => {
  test.describe('dialog.signMessage in the frame', () => {
    for (const { name, shape } of shapes)
      test(`signs ${name} after the user’s approval`, async ({
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
        // A sign-in message names the account, which the app knows after the sign-in.
        const { domain, message, nonce } = Messages.from({
          address: key.account,
          shape,
        })
        await load(page, { message, path: Apps.web.paths.dialog })
        const before = await Playwright.run(page, { name: 'Session' })

        await test.step('shows the message on the approval page of the frame', async () => {
          await Playwright.start(page, { name: 'Sign a message' })
          const frame = await Playwright.dialog(page)

          await shown(frame, { message, shape })
          await capture('approval')
          await Playwright.approve(frame)
        })

        await test.step('returns a signature that verifies for the account and the message alone', async () => {
          const signed = await Playwright.outcome(page, {
            name: 'Sign a message',
          })

          expect(signed).toEqual({
            state: 'fulfilled',
            value: {
              address: key.account,
              message,
              signature: expect.stringMatching(/^0x/),
            },
          })
          const { signature } = signed.value
          expect(
            await Verify.message({ address: key.account, message, signature }),
          ).toBe(true)
          expect(
            await Verify.message({
              address: key.account,
              message: `${message} `,
              signature,
            }),
          ).toBe(false)
          expect(
            await Verify.message({
              address: Messages.teammate,
              message,
              signature,
            }),
          ).toBe(false)
          if (Messages.shapes[shape].siwe)
            expect(
              await Verify.siwe({
                address: key.account,
                domain,
                message,
                nonce,
                signature,
              }),
            ).toBe(true)
          // A signature changes no session.
          expect(await Playwright.run(page, { name: 'Session' })).toEqual(
            before,
          )
          await capture('signed')
        })
      })

    test('rejects once the user denies the request, and returns no signature', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await Web.enter_dialog(page, { capture, code, email, fund: false })

      await test.step('rejects with the denial, and keeps the session', async () => {
        await Playwright.start(page, { name: 'Sign a message' })
        await Playwright.deny(await Playwright.dialog(page))

        expect(
          await Playwright.outcome(page, { name: 'Sign a message' }),
        ).toEqual({ state: 'rejected', value: denied })
        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('denied')
      })
    })
  })

  test.describe('dialog.signMessage in a popup', () => {
    test('signs with `mode` on a page that signs in in a frame', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const name = 'Sign a message in a popup'
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        fund: false,
      })
      const { message } = Messages.from({ shape: 'text' })
      await load(page, { message, path: Apps.web.paths.dialog })

      await test.step('shows the message in the popup, which closes at the approval', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name }),
        })
        await shown(window, { message, shape: 'text' })
        await capture('approval', window)
        const closing = window.waitForEvent('close')
        await Playwright.approve(window)
        await closing

        const signed = await Playwright.outcome(page, { name })
        expect(signed).toMatchObject({
          state: 'fulfilled',
          value: { address: key.account, message },
        })
        expect(
          await Verify.message({
            address: key.account,
            message,
            signature: signed.value.signature,
          }),
        ).toBe(true)
        await capture('signed')
      })
    })

    test('signs on a page that signs in in a popup, and rejects at a denial', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      await page.goto(Web.url({ message, path: Apps.web.paths.popup }))

      const account =
        await test.step('signs in through the popup', async () => {
          const window = await Playwright.popup(page, {
            open: () => Playwright.start(page, { name: 'Sign in' }),
          })
          await Playwright.signIn(window, { code, email })
          const session = await Playwright.outcome(page, { name: 'Sign in' })

          expect(session.state).toBe('fulfilled')
          await capture('signed in')
          return session.value.key.account as `0x${string}`
        })

      await test.step('rejects once the user denies the request in the popup', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign a message' }),
        })
        const closing = window.waitForEvent('close')
        await Playwright.deny(window)
        await closing

        expect(
          await Playwright.outcome(page, { name: 'Sign a message' }),
        ).toEqual({ state: 'rejected', value: denied })
        await capture('denied')
      })

      await test.step('signs once the user approves the request in the popup', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign a message' }),
        })
        await shown(window, { message, shape: 'text' })
        await capture('approval', window)
        const closing = window.waitForEvent('close')
        await Playwright.approve(window)
        await closing

        const signed = await Playwright.outcome(page, {
          name: 'Sign a message',
        })
        expect(signed.state).toBe('fulfilled')
        expect(
          await Verify.message({
            address: account,
            message,
            signature: signed.value.signature,
          }),
        ).toBe(true)
        await capture('signed')
      })
    })
  })

  test.describe('the owner’s signature with no page', () => {
    test('signs a message and typed data for an app with `tempo-id:sign`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const key = await Web.enter(page, {
        capture,
        clientId: Apps.web.clientIdSign,
        code,
        email,
      })
      const { domain, message, nonce } = Messages.from({
        address: key.account,
        shape: 'share',
      })
      const typedData = {
        domain: { chainId: Chain.chain.id, name: 'Web test app', version: '1' },
        message: { contents: 'Hello', from: Messages.teammate },
        primaryType: 'Mail',
        types: {
          Mail: [
            { name: 'from', type: 'address' },
            { name: 'contents', type: 'string' },
          ],
        },
      } as const
      await load(page, { clientId: Apps.web.clientIdSign, message, typedData })

      await test.step('signs the message, with no frame of Tempo ID', async () => {
        const signed = await Playwright.run(page, {
          name: 'Sign a message as the owner',
        })

        expect(signed).toMatchObject({
          state: 'fulfilled',
          value: { address: key.account, message },
        })
        const { signature } = signed.value
        expect(
          await Verify.message({ address: key.account, message, signature }),
        ).toBe(true)
        expect(
          await Verify.siwe({
            address: key.account,
            domain,
            message,
            nonce,
            signature,
          }),
        ).toBe(true)
        // The signature does not verify for another account.
        expect(
          await Verify.message({
            address: Messages.teammate,
            message,
            signature,
          }),
        ).toBe(false)
        await expect(Playwright.frame(page)).toHaveCount(0)
        await capture('signed a message')
      })

      await test.step('signs the typed data, which verifies for its contents alone', async () => {
        const signed = await Playwright.run(page, {
          name: 'Sign typed data as the owner',
        })

        expect(signed).toMatchObject({
          state: 'fulfilled',
          value: { address: key.account },
        })
        const { signature } = signed.value
        expect(
          await Verify.typedData({
            address: key.account,
            signature,
            typedData,
          }),
        ).toBe(true)
        expect(
          await Verify.typedData({
            address: key.account,
            signature,
            typedData: {
              ...typedData,
              message: { ...typedData.message, contents: 'Bye' },
            },
          }),
        ).toBe(false)
        await capture('signed typed data')
      })
    })

    test('refuses a message and typed data for an app without `tempo-id:sign`', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await Web.enter(page, { capture, code, email })
      await load(page, {
        typedData: {
          domain: { chainId: Chain.chain.id, name: 'Web test app' },
          message: { contents: 'Hello' },
          primaryType: 'Mail',
          types: { Mail: [{ name: 'contents', type: 'string' }] },
        },
      })

      await test.step('rejects each signature with the reason, and keeps the session', async () => {
        const message = await Playwright.run(page, {
          name: 'Sign a message as the owner',
        })
        const typedData = await Playwright.run(page, {
          name: 'Sign typed data as the owner',
        })

        expect(message).toMatchObject({ state: 'rejected', value: unpermitted })
        expect(typedData).toMatchObject({
          state: 'rejected',
          value: unpermitted,
        })
        await expect(page.locator('#status')).toHaveText('signedIn')
        // The browser logs each refused request.
        expect(errors.splice(0)).toEqual([
          Web.consoleErrors[403],
          Web.consoleErrors[403],
        ])
        await capture('refused')
      })
    })
  })

  test.describe('an access key’s signature', () => {
    test('counts for the app’s access token alone, once the node holds the access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const name = 'Sign a message with the access key'
      const other = `accounts-test+${crypto.randomUUID()}@example.org`
      const { message } = Messages.from({ shape: 'text' })

      const stranger =
        await test.step('signs another user in, and out, for that user’s access token', async () => {
          await page.goto(Web.url())
          const session = await Playwright.signIn_custom(page, {
            code,
            email: other,
          })
          expect(session.state).toBe('fulfilled')
          const proof = await Playwright.run(page, { name: 'Proof' })
          await Playwright.run(page, { name: 'Sign out' })

          await capture('signed out')
          return proof.value.accessToken as string
        })

      const key = await Web.enter(page, { capture, code, email, message })

      await test.step('does not count before the access key’s first transaction', async () => {
        const signed = await Playwright.run(page, { name })

        // The node holds an access key from its first transaction.
        expect(signed).toMatchObject({
          state: 'fulfilled',
          value: { address: key.account, message, verified: false },
        })
        await capture('not verified')
      })

      await test.step('counts once the node holds the access key, with the app’s access token alone', async () => {
        const transfer = await Playwright.send(page, {
          amount: '1',
          to: privateKeyToAddress(generatePrivateKey()),
        })
        expect(transfer.state).toBe('fulfilled')
        const signed = await Playwright.run(page, { name })
        const proof = await Playwright.run(page, { name: 'Proof' })

        expect(signed.value.verified).toBe(true)
        const { address, signature } = signed.value
        const accessToken: string = proof.value.accessToken
        expect(
          await Verify.accessKey({ accessToken, address, message, signature }),
        ).toBe(true)
        expect(await Verify.accessKey({ address, message, signature })).toBe(
          false,
        )
        expect(
          await Verify.accessKey({
            accessToken,
            address,
            message: `${message} `,
            signature,
          }),
        ).toBe(false)
        expect(
          await Verify.accessKey({
            accessToken,
            address: Messages.teammate,
            message,
            signature,
          }),
        ).toBe(false)
        expect(
          await Verify.accessKey({
            accessToken: stranger,
            address,
            message,
            signature,
          }),
        ).toBe(false)
        await expect(
          Verify.accessKey({
            accessToken,
            address,
            clientId: Apps.web.clientIdSign,
            message,
            signature,
          }),
        ).rejects.toMatchObject({ name: 'AccessToken.InvalidError' })
        // The node alone counts the owner's signature.
        expect(await Verify.message({ address, message, signature })).toBe(
          false,
        )
        await capture('verified')
      })
    })
  })
})
