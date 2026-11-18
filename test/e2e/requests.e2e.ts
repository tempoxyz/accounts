/**
 * Tests the request items of a sign-in on the web test app, once per method that takes them: a
 * challenge alone, a challenge with an access key, and a deposit, in the frame, in a popup, through
 * a redirect, with the app's own form, with a passkey, and with `accounts.authorize`. The spec's own
 * process verifies each signature on the node, and each proof with `Challenge.verify`, as an app's
 * backend does. Each access key then sends a transfer.
 * @module
 */
import type { Page } from '@playwright/test'
import { hashMessage, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Messages from '../Messages.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Verify from '../Verify.js'
import * as Web from '../Web.js'

/** The OUSD that the faucet of the deposit page sends to an account, in base units. */
const dripped = parseUnits('1000000', 6)

/** The amount that a sign-in of the suite needs in the Tempo Account: 10 dollars. */
const needed = { amount: '10' } as const

/** The notes of an approval that requests an access key and a plain text challenge. */
const notes = [
  'Spend $100',
  'Approve only if you started this sign-in and expect this message.',
]

/**
 * Asserts that the session of the test app on `page` holds the account's signature of `message`
 * and no access key, and that the signature verifies on the node for the same message and account
 * alone. Returns the Tempo Account.
 */
async function alone(page: Page, options: alone.Options) {
  const { clientId, domain, message, nonce } = options
  const proof = await Playwright.run(page, { name: 'Proof' })

  expect(proof.value).toMatchObject({
    address: expect.stringMatching(/^0x/),
    challengeSignature: expect.stringMatching(/^0x/),
    keyAuthorization: null,
  })
  const address: `0x${string}` = proof.value.address
  const signature: `0x${string}` = proof.value.challengeSignature
  expect(await Verify.message({ address, message, signature })).toBe(true)
  expect(
    await Verify.message({ address, message: `${message} `, signature }),
  ).toBe(false)
  expect(
    await Verify.message({ address: Messages.teammate, message, signature }),
  ).toBe(false)
  if (nonce)
    expect(
      await Verify.siwe({ address, domain, message, nonce, signature }),
    ).toBe(true)
  // The signature is the owner's, so it counts with no access token.
  expect(
    await Verify.accessKey({ address, clientId, message, signature }),
  ).toBe(true)
  return address
}

declare namespace alone {
  type Options = {
    /** The client ID of the page's app. Defaults to the web test app's. */
    clientId?: string | undefined
    /** The host that a Sign-In with Ethereum message names. */
    domain: string
    /** The challenge of the sign-in. */
    message: string
    /** The nonce of a Sign-In with Ethereum message. Absent, the message is plain text. */
    nonce?: string | undefined
  }
}

/**
 * Asserts that the access key of the session of the test app on `page` carries the proof of
 * `message`: its key authorization's `witness` is the message's hash, the session's signature is
 * the key authorization's, and `Challenge.verify` passes for the app's access token, and fails for
 * another message. Returns the session's access key.
 */
async function bound(page: Page, options: bound.Options) {
  const { clientId = Apps.web.clientId, message } = options
  const [proof, session] = [
    await Playwright.run(page, { name: 'Proof' }),
    await Playwright.run(page, { name: 'Session' }),
  ]
  const key: Web.Key = session.value.key
  const { accessToken, challengeSignature, keyAuthorization } = proof.value

  expect(keyAuthorization.witness).toBe(hashMessage(message))
  // The signature is the key authorization's, so it is no `personal_sign` of the message.
  expect(challengeSignature).toMatch(/^0x/)
  expect(
    await Verify.message({
      address: key.account,
      message,
      signature: challengeSignature,
    }),
  ).toBe(false)
  expect(
    await Verify.challenge({
      accessToken,
      challenge: message,
      clientId,
      keyAuthorization,
    }),
  ).toEqual({ accessKey: key.id, account: key.account })
  await expect(
    Verify.challenge({
      accessToken,
      challenge: `${message} `,
      clientId,
      keyAuthorization,
    }),
  ).rejects.toMatchObject({ name: 'Challenge.InvalidError' })
  return key
}

declare namespace bound {
  type Options = {
    /** The client ID of the page's app. Defaults to the web test app's. */
    clientId?: string | undefined
    /** The challenge of the sign-in. */
    message: string
  }
}

/**
 * Sends 5 OUSD from the session of the test app on `page` to a new address, and asserts that the
 * node holds the amount for it.
 */
async function sent(page: Page) {
  const recipient = privateKeyToAddress(generatePrivateKey())
  const transfer = await Playwright.send(page, { amount: '5', to: recipient })

  expect(transfer.state).toBe('fulfilled')
  expect(await Chain.balance({ address: recipient, token: Chain.ousd })).toBe(
    parseUnits('5', 6),
  )
}

test.describe('requests', () => {
  test.describe('in the frame', () => {
    test('binds a challenge to the access key, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      await page.goto(
        Web.url({ challenge: message, path: Apps.web.paths.dialog }),
      )

      await test.step('shows the challenge on the sign-in form, and returns a session with an access key', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const frame = await Playwright.dialog(page)
        await expect(Playwright.grant(frame)).toContainText([message])
        await capture('challenge')
        await Playwright.signIn(frame, { code, email })

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'fulfilled',
          value: { key: { chainId: Chain.chain.id } },
        })
        await capture('signed in')
      })

      await test.step('verifies the proof, and sends a transfer with the access key', async () => {
        const key = await bound(page, { message })
        await Chain.fund({ address: key.account })

        await sent(page)
        await capture('sent')
      })
    })

    test('carries an access key, a challenge, and a deposit in one sign-in', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'signIn' })
      await page.goto(
        Web.url({
          challenge: message,
          funding: needed,
          path: Apps.web.paths.dialog,
        }),
      )

      const deposit =
        await test.step('shows the deposit page in the frame once the user signs in', async () => {
          await Playwright.start(page, { name: 'Sign in' })
          const frame = await Playwright.dialog(page)
          await Playwright.signIn(frame, { code, email })
          const deposit = await Playwright.deposit(frame)

          await expect(deposit.hint).toContainText('at least $10')
          await capture('deposit page')
          return deposit
        })

      await test.step('returns the session once the faucet funds the account', async () => {
        await deposit.faucet.click()

        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        expect(
          await Chain.balance({
            address: session.value.key.account,
            token: Chain.ousd,
          }),
        ).toBe(dripped)
        await Playwright.uncovered(page)
        await capture('signed in')
      })

      await test.step('verifies the proof, and sends a part of the deposit with the access key', async () => {
        await bound(page, { message })

        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('in a popup', () => {
    test('signs a challenge alone, and returns no access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message, nonce } = Messages.from({ shape: 'signIn' })
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: message,
          path: Apps.web.paths.popup,
        }),
      )

      await test.step('shows no note for a message that Tempo ID recognizes, and returns the signature', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await expect(Playwright.form(window)).toBeVisible()
        await expect(Playwright.grant(window)).toHaveCount(0)
        await capture('sign-in form', window)
        const closing = window.waitForEvent('close')
        await Playwright.signIn(window, { code, email })
        await closing

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'fulfilled',
          value: {
            challengeSignature: expect.stringMatching(/^0x/),
            key: null,
          },
        })
        await capture('signed in')
      })

      await test.step('verifies the signature and the message’s fields on the node', async () => {
        await alone(page, { domain, message, nonce })
        await capture('verified')
      })
    })

    test('binds a challenge to the access key, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'lines' })
      await page.goto(
        Web.url({ challenge: message, path: Apps.web.paths.popup }),
      )

      await test.step('shows the challenge in the popup, and returns a session with an access key', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await expect(Playwright.form(window)).toBeVisible()
        await expect(Playwright.grant(window)).toContainText([message])
        await capture('challenge', window)
        const closing = window.waitForEvent('close')
        await Playwright.signIn(window, { code, email })
        await closing

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'fulfilled',
          value: { key: { chainId: Chain.chain.id } },
        })
        await capture('signed in')
      })

      await test.step('verifies the proof, and sends a transfer with the access key', async () => {
        const key = await bound(page, { message })
        await Chain.fund({ address: key.account })

        await sent(page)
        await capture('sent')
      })
    })

    test('carries an access key, a challenge, and a deposit for a user that Tempo ID knows', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      const query = { challenge: message, funding: needed }

      await test.step('signs in, and out of the app, so Tempo ID keeps its session', async () => {
        await page.goto(Web.url({ path: Apps.web.paths.popup }))
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await Playwright.signIn(window, { code, email })
        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        await Playwright.run(page, { name: 'Sign out' })
        await page.goto(Web.url({ ...query, path: Apps.web.paths.popup }))

        await expect(page.locator('#status')).toHaveText('signedOut')
        await capture('signed out')
      })

      const window =
        await test.step('shows the access key and the challenge on the approval page, then the deposit page', async () => {
          const window = await Playwright.popup(page, {
            open: () => Playwright.start(page, { name: 'Sign in' }),
          })
          await expect(Playwright.grant(window)).toContainText(notes)
          await expect(Playwright.grant(window)).toContainText([message])
          await capture('approval', window)
          await Playwright.approve(window)
          const deposit = await Playwright.deposit(window)

          await expect(deposit.hint).toContainText('at least $10')
          await expect(
            page.locator('output[data-action="Sign in"]'),
          ).toHaveAttribute('data-state', 'pending')
          await capture('deposit page', window)
          return { closing: window.waitForEvent('close'), deposit }
        })

      await test.step('returns the session once the faucet funds the account, and verifies the proof', async () => {
        await window.deposit.faucet.click()
        await window.closing

        const session = await Playwright.outcome(page, { name: 'Sign in' })
        expect(session.state).toBe('fulfilled')
        const key = await bound(page, { message })
        expect(
          await Chain.balance({ address: key.account, token: Chain.ousd }),
        ).toBe(dripped)
        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('through a redirect', () => {
    test('signs a challenge alone, and the session keeps the signature after a reload', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message } = Messages.from({ shape: 'text' })
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: message,
          path: Apps.web.paths.redirect,
        }),
      )

      await test.step('shows the challenge on Tempo ID’s page, and returns with the signature', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await page.waitForURL(`${TempoId.url}/**`)
        await expect(Playwright.form(page)).toBeVisible()
        await expect(Playwright.grant(page)).toContainText([message])
        await capture('challenge')
        await Playwright.signIn(page, { code, email })
        await page.waitForURL(`${Apps.web.url}${Apps.web.paths.redirect}`)

        await expect(page.locator('#status')).toHaveText('signedIn')
        await alone(page, { domain, message })
        await capture('signed in')
      })

      await test.step('keeps the signature in the stored session', async () => {
        const before = await Playwright.run(page, { name: 'Session' })
        await page.reload()
        await expect(page.locator('#status')).toHaveText('signedIn')

        expect(await Playwright.run(page, { name: 'Session' })).toEqual(before)
        expect(before.value).toMatchObject({
          challengeSignature: expect.stringMatching(/^0x/),
          key: null,
        })
        await capture('reloaded')
      })
    })

    test('binds a challenge to the access key, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'share' })
      await page.goto(
        Web.url({ challenge: message, path: Apps.web.paths.redirect }),
      )

      await test.step('shows the share on Tempo ID’s page, and returns with an access key', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await page.waitForURL(`${TempoId.url}/**`)
        await expect(Playwright.form(page)).toBeVisible()
        await expect(Playwright.grant(page)).toContainText([
          'Share “notes” with another account',
        ])
        await capture('challenge')
        await Playwright.signIn(page, { code, email })
        await page.waitForURL(`${Apps.web.url}${Apps.web.paths.redirect}`)

        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('signed in')
      })

      await test.step('verifies the proof, and sends a transfer with the access key', async () => {
        const key = await bound(page, { message })
        await Chain.fund({ address: key.account })

        await sent(page)
        await capture('sent')
      })
    })

    test('carries an access key, a challenge, and a deposit, and returns after the deposit page', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'signIn' })
      await page.goto(
        Web.url({
          challenge: message,
          funding: needed,
          path: Apps.web.paths.redirect,
        }),
      )

      await test.step('shows Tempo ID’s deposit page after the sign-in, with the amount', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await page.waitForURL(`${TempoId.url}/**`)
        await Playwright.signIn(page, { code, email })
        await page.waitForURL(`${TempoId.url}/deposit?**`)
        const deposit = await Playwright.deposit(page)

        await expect(deposit.hint).toContainText('at least $10')
        await expect(deposit.skip).toBeVisible()
        await capture('deposit page')
        await deposit.faucet.click()
      })

      await test.step('returns to the page with the session, and no result of a deposit', async () => {
        await page.waitForURL(`${Apps.web.url}${Apps.web.paths.redirect}`)
        await expect(page.locator('#status')).toHaveText('signedIn')

        const key = await bound(page, { message })
        expect(
          await Chain.balance({ address: key.account, token: Chain.ousd }),
        ).toBe(dripped)
        // The return of a sign-in carries a code, and no `deposit_status`.
        expect(
          await Playwright.run(page, { name: 'Complete the deposit' }),
        ).toEqual({ state: 'fulfilled', value: null })
        await capture('signed in')
      })

      await test.step('sends a part of the deposit with the access key', async () => {
        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('with the app’s own form', () => {
    test('signs a challenge alone with `email.signIn`, for an app with `tempo-id:sign`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message, nonce } = Messages.from({ shape: 'signIn' })
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: message,
          clientId: Apps.web.clientIdSign,
        }),
      )

      await test.step('returns the account and its signature, with no page of Tempo ID', async () => {
        const session = await Playwright.signIn_custom(page, { code, email })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            address: expect.stringMatching(/^0x/),
            challengeSignature: expect.stringMatching(/^0x/),
            key: null,
          },
        })
        await expect(Playwright.frame(page)).toHaveCount(0)
        await alone(page, {
          clientId: Apps.web.clientIdSign,
          domain,
          message,
          nonce,
        })
        await capture('signed in')
      })
    })

    test('binds a challenge to the access key with `email.signIn`, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      await Web.enter(page, {
        capture,
        challenge: message,
        clientId: Apps.web.clientIdSign,
        code,
        email,
      })

      await test.step('verifies the proof, and sends a transfer with the access key', async () => {
        await bound(page, { clientId: Apps.web.clientIdSign, message })

        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('with accounts.authorize', () => {
    test('signs a challenge alone for a session without an access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message } = Messages.from({ shape: 'lines' })
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: message,
          clientId: Apps.web.clientIdSign,
        }),
      )

      const before =
        await test.step('signs in with no challenge, and holds no signature', async () => {
          const session = await Playwright.signIn_custom(page, {
            code,
            email,
            name: 'Sign in without an access key',
          })

          expect(session).toMatchObject({
            state: 'fulfilled',
            value: { challengeSignature: null, key: null },
          })
          await capture('signed in')
          return session.value
        })

      await test.step('returns a session with the signature, with no page of Tempo ID', async () => {
        const session = await Playwright.run(page, { name: 'Authorize' })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            address: expect.stringMatching(/^0x/),
            challengeSignature: expect.stringMatching(/^0x/),
            email: before.email,
            key: null,
          },
        })
        await expect(Playwright.frame(page)).toHaveCount(0)
        await alone(page, { clientId: Apps.web.clientIdSign, domain, message })
        await capture('authorized')
      })
    })

    test('binds a challenge to a new access key, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'signIn' })
      await page.goto(
        Web.url({ challenge: message, clientId: Apps.web.clientIdSign }),
      )

      await test.step('signs in with no challenge and no access key', async () => {
        const session = await Playwright.signIn_custom(page, {
          code,
          email,
          name: 'Sign in without an access key',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { challengeSignature: null, key: null },
        })
        await capture('signed in')
      })

      await test.step('returns a session with an access key that carries the proof', async () => {
        const session = await Playwright.run(page, { name: 'Authorize' })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { key: { chainId: Chain.chain.id } },
        })
        await expect(Playwright.frame(page)).toHaveCount(0)
        const key = await bound(page, {
          clientId: Apps.web.clientIdSign,
          message,
        })
        await Chain.fund({ address: key.account })
        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('with a passkey', () => {
    test('signs a challenge alone with the one assertion of `passkey.signIn`', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message, nonce } = Messages.from({ shape: 'signIn' })
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        accessKey: false,
        authenticator,
        capture,
        challenge: message,
        clientId: Apps.web.clientIdSign,
        code,
        email,
      })

      await test.step('returns the passkey’s account and its signature after one assertion', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const [before] = await authenticator.credentials()
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            address: passkey.passkeyAccount,
            challengeSignature: expect.stringMatching(/^0x/),
            key: null,
          },
        })
        // The assertion that signs the user in also signs the challenge, with no second prompt.
        const [after] = await authenticator.credentials()
        expect(after?.signCount).toBe(before!.signCount + 1)
        await capture('signed in')
      })

      await test.step('verifies the passkey’s signature and the message’s fields on the node', async () => {
        const address = await alone(page, {
          clientId: Apps.web.clientIdSign,
          domain,
          message,
          nonce,
        })

        expect(address).toBe(passkey.passkeyAccount)
        await capture('verified')
      })
    })

    test('binds a challenge to the access key of `passkey.signIn`, which sends a transfer', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        challenge: message,
        clientId: Apps.web.clientIdSign,
        code,
        email,
      })

      await test.step('returns a session with an access key of the passkey’s account after one assertion', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const [before] = await authenticator.credentials()
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            key: { account: passkey.passkeyAccount, chainId: Chain.chain.id },
          },
        })
        // The assertion signs the key authorization, whose witness binds the challenge.
        const [after] = await authenticator.credentials()
        expect(after?.signCount).toBe(before!.signCount + 1)
        await expect(Playwright.frame(page)).toHaveCount(0)
        await capture('signed in')
      })

      await test.step('verifies the proof, and sends a transfer with the access key', async () => {
        const key = await bound(page, {
          clientId: Apps.web.clientIdSign,
          message,
        })
        expect(key.account).toBe(passkey.passkeyAccount)
        await Chain.fund({ address: key.account })

        await sent(page)
        await capture('sent')
      })
    })
  })
})
