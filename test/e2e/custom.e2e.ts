/**
 * Tests a sign-in with the app's own form on the custom page of the web test app: the `email` plugin
 * sends a code and signs in with no page of Tempo ID, `accounts.authorize` requests an access key
 * for a session that holds none, and the `passkey` plugin registers a passkey and signs in with it.
 * An app whose first account is a passkey registers one at the sign-in of a new user.
 * A virtual authenticator of the browser holds each passkey, and answers each ceremony.
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

/**
 * The rejection of a passkey ceremony that the authenticator refused, as the page shows it. The
 * browser rejects it with a `NotAllowedError`, as a closed prompt, so the call throws an `AbortError`.
 */
const closed = {
  message: 'The user closed the passkey prompt.',
  name: 'AbortError',
}

/**
 * Returns the requests of `page` to Tempo ID's passkey routes, as the method and the path of each.
 * The list grows as the page sends them.
 */
function ceremonies(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => {
    const { origin, pathname } = new URL(request.url())
    if (origin === TempoId.url && pathname.startsWith('/v1/auth/passkey/'))
      requests.push(`${request.method()} ${pathname}`)
  })
  return requests
}

/**
 * Returns the passkeys that each options response of Tempo ID to `page` allows, as their count, or
 * `all` for every passkey of the relying party. The list grows as the page receives them.
 */
function offered(page: Page) {
  const counts: string[] = []
  page.on('response', async (response) => {
    const { origin, pathname } = new URL(response.url())
    if (origin !== TempoId.url || pathname !== '/v1/auth/passkey/options')
      return
    const body = (await response.json()) as {
      options: { publicKey: { allowCredentials?: readonly unknown[] } }
    }
    const allowed = body.options.publicKey.allowCredentials
    counts.push(allowed ? String(allowed.length) : 'all')
  })
  return counts
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

/** Returns the number of assertions that the one passkey of `authenticator` signed. */
async function signed(authenticator: Playwright.authenticator.ReturnType) {
  const [passkey] = await authenticator.credentials()
  return passkey?.signCount
}

/** The URL of the custom page. */
const url = `${Apps.web.url}${Apps.web.paths.custom}`

test.describe('custom', () => {
  test('signs in with the app’s own form, and sends OUSD with the access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    const account =
      await test.step('signs in with a code, on a page that holds no frame of Tempo ID', async () => {
        const session = await Playwright.signIn_custom(page, { code, email })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            email,
            key: {
              account: expect.stringMatching(/^0x/),
              chainId: Chain.chain.id,
            },
            upgradeAvailable: false,
          },
        })
        // The user holds one Tempo Account, which the access key acts for.
        expect(session.value.accounts).toEqual([session.value.key.account])
        await expect(page.locator('#status')).toHaveText('signedIn')
        await expect(Playwright.frame(page)).toHaveCount(0)
        await capture('signed in')
        return session.value.key.account as `0x${string}`
      })

    await test.step('sends OUSD with the access key, which the node registers', async () => {
      await Chain.fund({ address: account })
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

  test('signs in without an access key, then authorizes one with no page', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    await test.step('signs in with a session that holds no access key', async () => {
      const session = await Playwright.signIn_custom(page, {
        code,
        email,
        name: 'Sign in without an access key',
      })

      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { email, key: null },
      })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in without an access key')
    })

    await test.step('authorizes an access key, and sends OUSD with it', async () => {
      const session = await Playwright.run(page, { name: 'Authorize' })
      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { email, key: { account: expect.stringMatching(/^0x/) } },
      })
      await Chain.fund({ address: session.value.key.account })
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(1_000_000n)
      await expect(Playwright.frame(page)).toHaveCount(0)
      await capture('authorized')
    })
  })

  test('refuses a wrong code, then signs in with the code of the inbox', async ({
    capture,
    code,
    email,
    errors,
    page,
  }) => {
    await page.goto(url)
    await page.getByLabel('Email').fill(email)
    expect(await Playwright.run(page, { name: 'Send code' })).toMatchObject({
      state: 'fulfilled',
    })
    const right = await code(email)

    await test.step('rejects a code that the inbox does not hold, with the refusal’s reason', async () => {
      const wrong = `${right.slice(0, -1)}${right.endsWith('0') ? '1' : '0'}`
      await page.getByLabel('Code', { exact: true }).fill(wrong)
      const session = await Playwright.run(page, { name: 'Sign in' })

      expect(session).toMatchObject({
        state: 'rejected',
        value: {
          code: 'invalid_grant',
          name: 'Accounts.RequestError',
          reason: 'invalid_code',
          status: 401,
        },
      })
      expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('refused')
    })

    await test.step('signs in with the code of the inbox, which the refusal did not spend', async () => {
      await page.getByLabel('Code', { exact: true }).fill(right)
      const session = await Playwright.run(page, { name: 'Sign in' })

      expect(session).toMatchObject({ state: 'fulfilled', value: { email } })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })
  })

  test.describe('passkeys', () => {
    test('registers a passkey for a signed-in user, then signs in with it, and sends OUSD', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        code,
        email,
      })

      await test.step('keeps the session of the email, whose account the passkey does not own', async () => {
        const session = await Playwright.run(page, { name: 'Session' })

        expect(passkey.passkeyAccount).not.toBe(passkey.account)
        expect(session.value.key.account).toBe(passkey.account)
        await capture('session of the email')
      })

      await test.step('signs in with the passkey after a sign-out, with no code and one assertion', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const before = await signed(authenticator)
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: {
            email,
            key: { account: passkey.passkeyAccount, chainId: Chain.chain.id },
            upgradeAvailable: false,
          },
        })
        expect(await signed(authenticator)).toBe(before! + 1)
        await expect(page.locator('#status')).toHaveText('signedIn')
        await expect(Playwright.frame(page)).toHaveCount(0)
        await capture('signed in with the passkey')
      })

      await test.step('sends OUSD from the passkey’s account with the access key', async () => {
        await Chain.fund({ address: passkey.passkeyAccount })

        await sent(page)
        await capture('sent')
      })
    })

    test('rejects a second passkey on an authenticator that holds the user’s passkey, and keeps the session', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        code,
        email,
      })

      await test.step('rejects with an `InvalidStateError`, since the options exclude the passkey', async () => {
        const result = await Playwright.run(page, {
          name: 'Register a passkey',
        })

        expect(result).toMatchObject({
          state: 'rejected',
          value: {
            message:
              'The authenticator already holds a passkey of the user. Sign in with that passkey, or register on another authenticator.',
            name: 'InvalidStateError',
          },
        })
        expect(await authenticator.credentials()).toHaveLength(1)
        await capture('rejected the second passkey')
      })

      await test.step('keeps the session of the email', async () => {
        const session = await Playwright.run(page, { name: 'Session' })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.account } },
        })
        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('session of the email')
      })
    })

    test('requests the options of a passkey sign-in before the click, which then sends one request', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        code,
        email,
      })
      const requests = ceremonies(page)

      await test.step('reports that the page’s origin and browser take a passkey', async () => {
        expect(
          await Playwright.run(page, { name: 'Passkey available' }),
        ).toEqual({ state: 'fulfilled', value: true })
        await capture('available')
      })

      await test.step('requests the options once the browser holds no session of Tempo ID', async () => {
        await Playwright.run(page, { name: 'Sign out everywhere' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const prepared = await Playwright.run(page, {
          name: 'Prepare a passkey sign-in',
        })

        expect(prepared).toEqual({
          state: 'fulfilled',
          value: { available: true },
        })
        expect(requests.splice(0)).toEqual(['POST /v1/auth/passkey/options'])
        await capture('prepared')
      })

      await test.step('signs in with the prepared options, and sends OUSD', async () => {
        const session = await Playwright.run(page, {
          name: 'Sign in with the prepared passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.passkeyAccount } },
        })
        expect(requests).toEqual(['POST /v1/auth/passkey/verify'])
        await Chain.fund({ address: passkey.passkeyAccount })
        await sent(page)
        await capture('signed in and sent')
      })
    })

    test('offers every passkey after a sign-out that keeps the session of Tempo ID, also through a prepared sign-in', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        code,
        email,
      })
      const allowed = offered(page)

      await test.step('offers every passkey at the sign-in after the sign-out', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.passkeyAccount } },
        })
        await expect.poll(() => allowed).toEqual(['all'])
        await capture('signed in with every passkey offered')
      })

      await test.step('offers every passkey at the prepared sign-in after the sign-out', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        await Playwright.run(page, { name: 'Prepare a passkey sign-in' })
        const session = await Playwright.run(page, {
          name: 'Sign in with the prepared passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.passkeyAccount } },
        })
        await expect.poll(() => allowed).toEqual(['all', 'all'])
        await capture('signed in through the prepared sign-in')
      })

      await test.step('offers every passkey at a sign-in prepared before the sign-out', async () => {
        await expect(page.locator('#status')).toHaveText('signedIn')
        await Playwright.run(page, { name: 'Prepare a passkey sign-in' })
        await expect.poll(() => allowed).toEqual(['all', 'all', '1'])
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const session = await Playwright.run(page, {
          name: 'Sign in with the prepared passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.passkeyAccount } },
        })
        await expect.poll(() => allowed).toEqual(['all', 'all', '1', 'all'])
        await capture(
          'signed in through a sign-in prepared before the sign-out',
        )
      })
    })

    test('rejects a passkey sign-in that the authenticator refuses, then signs in once it verifies the user', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      await page.goto(url)

      await test.step('rejects on an authenticator that holds no passkey', async () => {
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({ state: 'rejected', value: closed })
        await expect(page.locator('#status')).toHaveText('signedOut')
        await capture('no passkey')
      })

      const passkey = await Web.enroll(page, {
        authenticator,
        capture,
        code,
        email,
      })

      await test.step('rejects while the authenticator does not verify the user, as a dismissed prompt does', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await expect(page.locator('#status')).toHaveText('signedOut')
        const before = await signed(authenticator)
        await authenticator.verifies(false)
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({ state: 'rejected', value: closed })
        expect(await signed(authenticator)).toBe(before)
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('dismissed')
      })

      await test.step('signs in once the authenticator verifies the user', async () => {
        await authenticator.verifies(true)
        const session = await Playwright.run(page, {
          name: 'Sign in with a passkey',
        })

        expect(session).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: passkey.passkeyAccount } },
        })
        await capture('signed in')
      })
    })

    test('refuses a passkey registration with an access key for an app without `tempo-id:sign`', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const key = await Web.enter(page, { capture, code, email })

      await test.step('rejects with the refusal’s reason, and keeps the session', async () => {
        const passkey = await Playwright.run(page, {
          name: 'Register a passkey with an access key',
        })

        expect(passkey).toMatchObject({
          state: 'rejected',
          value: {
            code: 'unauthorized_client',
            name: 'Accounts.RequestError',
            reason: 'passkey_register_not_permitted',
            status: 403,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        expect(await authenticator.credentials()).toEqual([])
        const session = await Playwright.run(page, { name: 'Session' })
        expect(session.value.key).toEqual(key)
        await capture('refused')
      })
    })

    test('registers a passkey with an access key, which moves the session to the passkey’s account', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)
      const key = await Web.enter(page, {
        capture,
        clientId: Apps.web.clientIdSign,
        code,
        email,
      })

      const account =
        await test.step('returns a session whose access key acts for the passkey’s account', async () => {
          const session = await Playwright.run(page, {
            name: 'Register a passkey with an access key',
          })

          expect(session).toMatchObject({
            state: 'fulfilled',
            value: {
              email,
              id: expect.any(String),
              key: { chainId: Chain.chain.id },
              upgradeAvailable: false,
            },
          })
          const account: `0x${string}` = session.value.passkeyAccount
          expect(account).not.toBe(key.account)
          expect(session.value.key.account).toBe(account)
          expect(session.value.key.id).not.toBe(key.id)
          // The registration signs once, and the proof of the access key once more.
          expect(await signed(authenticator)).toBe(2)
          expect(await Playwright.run(page, { name: 'Account' })).toEqual({
            state: 'fulfilled',
            value: { address: account, owner: 'webAuthn' },
          })
          await capture('registered')
          return account
        })

      await test.step('sends OUSD from the passkey’s account with the access key', async () => {
        await Chain.fund({ address: account })

        await sent(page)
        await capture('sent')
      })
    })
  })

  test.describe('app whose first account is a passkey', () => {
    test('registers a passkey account at the sign-in of a new user, for which Tempo ID neither signs nor upgrades', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const authenticator = await Playwright.authenticator(page)

      const account =
        await test.step('signs in with the code, and registers the passkey that signs the access key', async () => {
          await page.goto(Web.url({ clientId: Apps.web.clientIdPasskey }))
          const session = await Playwright.signIn_custom(page, { code, email })

          expect(session).toMatchObject({
            state: 'fulfilled',
            value: {
              email,
              key: { chainId: Chain.chain.id },
              upgradeAvailable: false,
            },
          })
          const account: `0x${string}` = session.value.key.account
          // The registration signs once, and the proof of the access key once more.
          expect(await signed(authenticator)).toBe(2)
          expect(await Playwright.run(page, { name: 'Account' })).toEqual({
            state: 'fulfilled',
            value: { address: account, owner: 'webAuthn' },
          })
          await capture('signed in')
          return account
        })

      await test.step('sends OUSD from the passkey’s account with the access key', async () => {
        await Chain.fund({ address: account })

        await sent(page)
        await capture('sent')
      })

      await test.step('rejects a signature that Tempo ID would sign as the owner', async () => {
        const signature = await Playwright.run(page, {
          name: 'Sign a message as the owner',
        })

        expect(signature).toMatchObject({
          state: 'rejected',
          value: {
            code: 'interaction_required',
            name: 'Accounts.RequestError',
            reason: 'webauthn_required',
            status: 403,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        expect(await signed(authenticator)).toBe(2)
        await capture('refused')
      })

      await test.step('rejects an upgrade of the account, since the chain holds no configurable accounts', async () => {
        const upgraded = await Playwright.run(page, {
          name: 'Upgrade the account',
        })

        expect(upgraded).toMatchObject({
          state: 'rejected',
          value: {
            code: 'invalid_request',
            name: 'Accounts.RequestError',
            reason: 'configurable_accounts_disabled',
            status: 400,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        expect(await Playwright.run(page, { name: 'Account' })).toEqual({
          state: 'fulfilled',
          value: { address: account, owner: 'webAuthn' },
        })
        await capture('not upgraded')
      })
    })
  })
})
