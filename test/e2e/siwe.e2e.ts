/**
 * Tests the SIWE page of the backend test app: a sign-in with a message that the backend's `siwe`
 * plugin issues, that the Tempo Account signs in the dialog, and that the backend verifies. Also
 * tests the signed messages that the backend refuses, an approval of a change that the session's
 * account signs, and a guest whose key pair signs the `siwe` plugin's message. The node verifies
 * each signature too.
 * @module
 */
import type { Page, Request } from '@playwright/test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Verify from '../Verify.js'
import * as Web from '../Web.js'

/** A signed message, as the page posts it to the backend. */
type Signed = {
  /** The Tempo Account that signed. Absent in an approval, whose session names the account. */
  address?: `0x${string}` | undefined
  /** The message. */
  message: string
  /** The signature. */
  signature: `0x${string}`
}

/** The URL of the route that issues the message of a sign-in. */
const challengeUrl = `${Apps.backend.url}/api/auth/siwe/challenge`

/** The name of the cookie that holds the session ID. */
const sessionCookie = '__Host-tempo-id.sid'

/** The URL of the route that returns the session of a cookie. */
const sessionUrl = `${Apps.backend.url}/api/auth/session`

/** The statement of each sign-in's message, as the Worker's `siwe` plugin holds it. */
const statement = 'Sign in to the backend test app.'

/** The URL of the SIWE page. */
const url = `${Apps.backend.url}${Apps.backend.paths.siwe}`

/** The URL of the route that verifies the signed message of a sign-in. */
const verifyUrl = `${Apps.backend.url}/api/auth/siwe/verify`

/**
 * Signs `email` in on the SIWE page through the dialog's frame, as the first step of a test. Returns
 * the Tempo Account of the session, and the request that carried the signed message.
 */
function enter(page: Page, options: enter.Options) {
  const { capture, code, email } = options
  return test.step('signs in with a message that the account signs in the dialog', async () => {
    await page.goto(url)
    const verified = posted(page, { url: verifyUrl })
    await Playwright.start(page, { name: 'Sign in' })
    await Playwright.signIn(await Playwright.dialog(page), { code, email })
    const signedIn = await Playwright.outcome(page, { name: 'Sign in' })

    expect(signedIn).toMatchObject({
      state: 'fulfilled',
      value: { method: 'siwe' },
    })
    await capture('signed in')
    return {
      account: signedIn.value.account as `0x${string}`,
      verified: await verified,
    }
  })
}

declare namespace enter {
  type Options = {
    /** Adds a screenshot of the page to the report. */
    capture: (name: string) => Promise<void>
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
  }
}

/** Returns the next request that `page` posts to `options.url`. */
function posted(page: Page, options: posted.Options) {
  return page.waitForRequest(
    (request) => request.method() === 'POST' && request.url() === options.url,
  )
}

declare namespace posted {
  type Options = {
    /** The URL of the route. */
    url: string
  }
}

/** Asserts that the backend's session route returns no session to `page`. */
async function signedOut(page: Page) {
  expect(await Playwright.run(page, { name: 'Session' })).toEqual({
    state: 'fulfilled',
    value: { body: { session: null }, status: 200 },
  })
}

/** Returns the signed message that `request` carried. */
function signed(request: Request) {
  return request.postDataJSON() as Signed
}

test.describe('siwe', () => {
  test.describe('sign-in', () => {
    test('signs in with a message of the backend, which the account signs in the dialog’s frame', async ({
      capture,
      code,
      context,
      email,
      page,
      request,
    }) => {
      const { account, verified } = await enter(page, { capture, code, email })
      const { address, message, signature } = signed(verified)

      await test.step('signs the backend’s message for the app’s origin and the node’s chain', async () => {
        expect(address).toBe(account)
        expect(message).toContain(
          `${new URL(url).host} wants you to sign in with your Ethereum account:`,
        )
        expect(message).toContain(statement)
        expect(message).toContain(`URI: ${Apps.backend.url}`)
        expect(message).toContain(`Chain ID: ${Chain.chain.id}`)
        expect(
          await Verify.message({ address: account, message, signature }),
        ).toBe(true)
        await capture('signed')
      })

      await test.step('holds a session of the account behind the cookie, with no user', async () => {
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: {
            body: { session: { account, method: 'siwe' } },
            status: 200,
          },
        })
        expect(await Playwright.run(page, { name: 'Me' })).toEqual({
          state: 'fulfilled',
          value: {
            body: { address: account, chainId: Chain.chain.id, method: 'siwe' },
            status: 200,
          },
        })
        const cookies = await context.cookies(Apps.backend.url)
        expect(
          cookies.find((entry) => entry.name === sessionCookie),
        ).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true })
        await capture('session')
      })

      await test.step('signs out, which ends the session, also for the cookie that the browser held', async () => {
        const cookies = await context.cookies(Apps.backend.url)
        const held = cookies.find((entry) => entry.name === sessionCookie)
        const replay = () =>
          request.get(sessionUrl, {
            headers: { cookie: `${sessionCookie}=${held!.value}` },
          })
        // The route answers `null` without its cookie, so the replay proves that the session ended.
        const before = await replay()
        expect(await before.json()).toEqual({
          session: { account, method: 'siwe' },
        })

        expect(await Playwright.run(page, { name: 'Sign out' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 204 },
        })

        await signedOut(page)
        const after = await replay()
        expect(await after.json()).toEqual({ session: null })
        await capture('signed out')
      })
    })

    test('signs in in the dialog’s popup', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(url)

      const popup =
        await test.step('opens Tempo ID’s sign-in in a popup', async () => {
          const popup = await Playwright.popup(page, {
            open: () => Playwright.start(page, { name: 'Sign in in a popup' }),
          })
          await expect(Playwright.form(popup)).toBeVisible()
          await capture('Tempo ID', popup)
          return popup
        })

      await test.step('returns the session of the account that signed', async () => {
        await Playwright.signIn(popup, { code, email })
        const signedIn = await Playwright.outcome(page, {
          name: 'Sign in in a popup',
        })

        expect(signedIn).toMatchObject({
          state: 'fulfilled',
          value: { method: 'siwe' },
        })
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: {
            body: {
              session: { account: signedIn.value.account, method: 'siwe' },
            },
            status: 200,
          },
        })
        await capture('signed in')
      })
    })
  })

  test.describe('refusals', () => {
    test('refuses a replay of a signed message, whose challenge is spent', async ({
      capture,
      code,
      email,
      page,
      request,
    }) => {
      const { verified } = await enter(page, { capture, code, email })

      await test.step('refuses the same post with the cookie of the sign-in, and sets no session', async () => {
        const headers = await verified.allHeaders()
        const response = await request.post(verifyUrl, {
          data: signed(verified),
          headers: { cookie: headers.cookie!, origin: Apps.backend.url },
        })

        expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({
          error: 'invalid_request',
          error_description: expect.stringMatching(/^Invalid challenge/),
        })
        const cookies = response
          .headersArray()
          .filter((header) => header.name.toLowerCase() === 'set-cookie')
        expect(
          cookies.filter((header) =>
            header.value.startsWith(`${sessionCookie}=`),
          ),
        ).toEqual([])
        await capture('replay refused')
      })

      await test.step('refuses the same post from a browser that started no sign-in', async () => {
        const response = await request.post(verifyUrl, {
          data: signed(verified),
          headers: { origin: Apps.backend.url },
        })

        expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({
          error: 'invalid_request',
          error_description: expect.stringMatching(/^Missing challenge/),
        })
        await capture('other browser refused')
      })
    })

    test('refuses a message that differs from the one that the backend issued', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(url)
      // The account signs the backend's message. The post then carries another statement.
      await page.route(verifyUrl, (route) => {
        const body = signed(route.request())
        return route.continue({
          postData: JSON.stringify({
            ...body,
            message: body.message.replace(statement, 'Sign in to another app.'),
          }),
        })
      })

      await test.step('rejects the sign-in with `invalid_request`, and sets no session', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await Playwright.signIn(await Playwright.dialog(page), { code, email })

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'rejected',
          value: {
            code: 'invalid_request',
            name: 'Accounts.RequestError',
            status: 400,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        await signedOut(page)
        await capture('refused')
      })
    })

    test('throws `Accounts.RequestError` with status 0 when the backend does not answer the signed message', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(url)
      await page.route(verifyUrl, (route) =>
        route.abort('internetdisconnected'),
      )

      await test.step('rejects the sign-in with `server_error` and status 0, and sets no session', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await Playwright.signIn(await Playwright.dialog(page), { code, email })

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'rejected',
          value: {
            code: 'server_error',
            name: 'Accounts.RequestError',
            status: 0,
          },
        })
        errors.splice(0)
        await signedOut(page)
        await capture('refused')
      })
    })

    test('refuses a signature of another signer than the account', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const stranger = privateKeyToAccount(generatePrivateKey())
      await page.goto(url)
      // The post keeps the account's address, and carries a stranger's signature of the message.
      await page.route(verifyUrl, async (route) => {
        const body = signed(route.request())
        return route.continue({
          postData: JSON.stringify({
            ...body,
            signature: await stranger.signMessage({ message: body.message }),
          }),
        })
      })

      await test.step('rejects the sign-in with `access_denied`, and sets no session', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await Playwright.signIn(await Playwright.dialog(page), { code, email })

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'rejected',
          value: {
            code: 'access_denied',
            name: 'Accounts.RequestError',
            status: 403,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        await signedOut(page)
        await capture('refused')
      })
    })

    test('refuses a challenge and a signed message from another origin', async ({
      request,
    }) => {
      const headers = { origin: 'https://attacker.example' }

      await test.step('issues no message to another site', async () => {
        const response = await request.post(challengeUrl, { headers })

        expect(response.status()).toBe(403)
        expect(await response.json()).toMatchObject({ error: 'forbidden' })
        expect(response.headers()['set-cookie']).toBeUndefined()
      })

      await test.step('verifies no message of another site', async () => {
        const response = await request.post(verifyUrl, { data: {}, headers })

        expect(response.status()).toBe(403)
        expect(await response.json()).toMatchObject({ error: 'forbidden' })
      })

      await test.step('issues a message to the app’s own origin', async () => {
        const response = await request.post(challengeUrl, {
          headers: { origin: Apps.backend.url },
        })

        expect(response.status()).toBe(200)
        expect((await response.json()).message).toContain(statement)
      })
    })
  })

  test.describe('approval', () => {
    test('approves a change with a message that the session’s account signs, once', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { account } = await enter(page, { capture, code, email })
      const approveUrl = `${Apps.backend.url}/app/approval/approve`

      const approved =
        await test.step('signs the approval’s message in the dialog, which the backend accepts', async () => {
          const approved = posted(page, { url: approveUrl })
          await Playwright.start(page, { name: 'Approve' })
          const frame = await Playwright.dialog(page)
          await capture('approval')
          await Playwright.approve(frame)

          expect(await Playwright.outcome(page, { name: 'Approve' })).toEqual({
            state: 'fulfilled',
            value: { body: { approved: account }, status: 200 },
          })
          await capture('approved')
          return signed(await approved)
        })

      await test.step('signs a message that names the change, as the node verifies', async () => {
        const { message, signature } = approved

        expect(message).toContain(`Approve the change of ${account}.`)
        expect(message).toContain(
          `${Apps.backend.url}/app/approval?account=${account}`,
        )
        expect(
          await Verify.message({ address: account, message, signature }),
        ).toBe(true)
        await capture('signed')
      })

      await test.step('refuses a replay of the approval, whose challenge is spent', async () => {
        const response = await page.request.post(approveUrl, {
          data: approved,
        })

        expect(response.status()).toBe(403)
        expect(await response.json()).toMatchObject({
          error: 'access_denied',
          error_description: expect.stringMatching(/^Invalid challenge/),
        })
        await capture('replay refused')
      })
    })
  })

  test.describe('the siwe plugin on the page', () => {
    /** The URL of the route that the plugin's string `auth` names as the verify route. */
    const authUrl = `${Apps.backend.url}/api/auth/siwe`

    /** Holds the challenge route's response until `release`, so the spec sees the dialog first. */
    async function hold(page: Page) {
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const bodies: (string | null)[] = []
      await page.route(challengeUrl, async (route) => {
        bodies.push(route.request().postData())
        await held
        await route.continue()
      })
      return { bodies, release }
    }

    test('shows the dialog at the click, requests the message while the frame loads, and posts the signature to the verify route', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(url)
      const { bodies, release } = await hold(page)
      const verified = posted(page, { url: authUrl })

      await test.step('shows the dialog at the click, before the challenge route answers', async () => {
        await Playwright.start(page, { name: 'Sign in with the plugin' })
        await expect(Playwright.prompt(page)).toBeVisible()
        await expect
          .poll(() => bodies)
          .toEqual([JSON.stringify({ chainId: Chain.chain.id })])
        await capture('shown before the message')
      })

      await test.step('holds the sign-in until the message arrives, signs the message, and returns the verify route’s result', async () => {
        await Playwright.signIn(await Playwright.dialog(page), {
          code,
          email,
          // The sign-in takes no action until its message shows, so the user sees what it signs.
          filled: async (submit) => {
            await expect(submit).toHaveAttribute('aria-busy', 'true')
            await capture('waiting for the message')
            release()
            // The message's statement resizes the dialog, so the click waits until it holds still.
            await expect(submit).toBeEnabled()
            await Playwright.dialog(page)
          },
        })
        const signedIn = await Playwright.outcome(page, {
          name: 'Sign in with the plugin',
        })
        const { address, message, signature } = signed(await verified)

        expect(signedIn).toEqual({
          state: 'fulfilled',
          value: { auth: { session: { account: address, method: 'siwe' } } },
        })
        expect(message).toContain(statement)
        expect(
          await Verify.message({ address: address!, message, signature }),
        ).toBe(true)
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: {
            body: { session: { account: address, method: 'siwe' } },
            status: 200,
          },
        })
        await capture('signed in')
      })
    })

    test('signs a guest in: Continue as guest signs the message with the guest key pair, and posts the signature to the verify route', async ({
      capture,
      page,
    }) => {
      await page.goto(url)
      const verified = posted(page, { url: authUrl })

      await test.step('offers Continue as guest beside the sign-in of the plugin’s challenge', async () => {
        await Playwright.start(page, { name: 'Sign in with the plugin' })
        await expect(Playwright.prompt(page)).toBeVisible()
        const dialog = await Playwright.dialog(page)
        await capture('sign-in with Continue as guest')
        await Playwright.guest(dialog)
      })

      await test.step('returns the verify route’s session of the guest account, whose P256 key signed the message', async () => {
        const signedIn = await Playwright.outcome(page, {
          name: 'Sign in with the plugin',
        })
        const { address, message, signature } = signed(await verified)
        const guest = await Playwright.run(page, { name: 'Guest account' })

        expect(signedIn).toEqual({
          state: 'fulfilled',
          value: { auth: { session: { account: address, method: 'siwe' } } },
        })
        expect(guest).toEqual({ state: 'fulfilled', value: address })
        expect(message).toContain(statement)
        expect(
          await Verify.message({ address: address!, message, signature }),
        ).toBe(true)
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: {
            body: { session: { account: address, method: 'siwe' } },
            status: 200,
          },
        })
        await capture('signed in as a guest')
      })
    })

    test('offers Continue as guest without the plugin too, and posts no challenge or signature', async ({
      capture,
      page,
    }) => {
      await page.goto(url)
      const requests: string[] = []
      page.on('request', (request) => {
        if ([authUrl, challengeUrl].includes(request.url()))
          requests.push(request.url())
      })

      await test.step('offers Continue as guest on the sign-in of a request without a challenge', async () => {
        await Playwright.start(page, {
          name: 'Sign in as a guest without the plugin',
        })
        await expect(Playwright.prompt(page)).toBeVisible()
        const dialog = await Playwright.dialog(page)
        await capture('sign-in with Continue as guest')
        await Playwright.guest(dialog)
      })

      await test.step('returns the guest session of the guest account, with no request', async () => {
        const signedIn = await Playwright.outcome(page, {
          name: 'Sign in as a guest without the plugin',
        })
        const guest = await Playwright.run(page, { name: 'Guest account' })

        expect(signedIn).toEqual({
          state: 'fulfilled',
          value: { address: guest.value, kind: 'guest' },
        })
        expect(requests).toEqual([])
        await capture('signed in as a guest')
      })
    })

    test('shows the payment page while the challenge loads, rejects a payment whose challenge route fails, closes the dialog, and sends nothing', async ({
      capture,
      errors,
      page,
    }) => {
      await page.goto(url)
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const bodies: (string | null)[] = []
      await page.route(challengeUrl, async (route) => {
        bodies.push(route.request().postData())
        await held
        await route.fulfill({
          json: {
            error: 'invalid_request',
            error_description: 'Invalid body.',
          },
          status: 400,
        })
      })
      const verifications: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url() === authUrl)
          verifications.push(request.url())
      })

      await Playwright.start(page, { name: 'Pay with the plugin' })
      await expect(Playwright.prompt(page)).toBeVisible()
      await expect
        .poll(() => bodies)
        .toEqual([JSON.stringify({ chainId: Chain.chain.id })])
      // The payment page loads and takes input while the message loads, and waits for it itself.
      await Playwright.dialog(page)
      await expect(Playwright.prompt(page).locator('iframe')).toHaveJSProperty(
        'inert',
        false,
      )
      await capture('waiting for the message')
      release()

      expect(
        await Playwright.outcome(page, { name: 'Pay with the plugin' }),
      ).toMatchObject({
        state: 'rejected',
        value: {
          message: expect.stringContaining(
            `The request to ${challengeUrl} failed with status 400`,
          ),
        },
      })
      await expect(Playwright.prompt(page)).toHaveCount(0)
      expect(verifications).toEqual([])
      expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
    })

    test('rejects with the reason of the caller’s signal while the message is pending, closes the dialog, and posts no signature', async ({
      capture,
      page,
    }) => {
      await page.goto(url)
      const { bodies, release } = await hold(page)
      const verifications: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url() === authUrl)
          verifications.push(request.url())
      })

      await Playwright.start(page, {
        name: 'Sign in with the plugin and a signal',
      })
      await expect(Playwright.prompt(page)).toBeVisible()
      await expect
        .poll(() => bodies)
        .toEqual([JSON.stringify({ chainId: Chain.chain.id })])
      await page.evaluate(() =>
        window.dispatchEvent(new Event('test-app-backend:abort')),
      )

      expect(
        await Playwright.outcome(page, {
          name: 'Sign in with the plugin and a signal',
        }),
      ).toMatchObject({
        state: 'rejected',
        value: { message: 'The page ended the sign-in.' },
      })
      await expect(Playwright.prompt(page)).toHaveCount(0)
      release()
      await signedOut(page)
      expect(verifications).toEqual([])
      await capture('ended')
    })
  })
})
