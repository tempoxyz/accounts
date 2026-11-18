/**
 * Tests the backend page of the backend test app: a sign-in whose session the app's backend holds,
 * through a redirect, the dialog's popup, and the dialog's frame, the cookie that names the session,
 * the callbacks and the origins that the backend refuses, the calls that the backend sends with the
 * session's access token and access key, the refresh of a short access token, and a sign-in that
 * needs an amount in the Tempo Account. The page holds no token, so each case reads the session
 * through the backend's routes.
 * @module
 */
import type { BrowserContext, Page } from '@playwright/test'
import { parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The URL of the asserted page, of the app that authenticates with a client assertion. */
const assertedUrl = `${Apps.backend.url}${Apps.backend.paths.asserted}`

/** The OUSD that the faucet of the deposit page sends to an account, in base units. */
const dripped = parseUnits('1000000', 6)

/** The URL of the emailed page, whose backend signs users in with an emailed code. */
const emailedUrl = `${Apps.backend.url}${Apps.backend.paths.emailed}`

/** The name of the cookie that holds the session ID of the funded page's routes, under `/fund`. */
const fundCookie = 'fund'

/** The amount that the funded page's sign-in needs in the Tempo Account: 5 dollars. */
const needed = { amount: '5' } as const

/** The name of the cookie that holds the session ID. */
const sessionCookie = '__Host-tempo-id.sid'

/** The URL of the backend page. */
const url = `${Apps.backend.url}${Apps.backend.paths.backend}`

/** The ID of a user of Tempo ID: `user_` and a ULID, which holds no secret. */
const userId = /^user_[0-9A-HJKMNP-TV-Z]{26}$/

/** The URL of the backend page of the app whose access tokens are short. */
const shortUrl = `${Apps.backend.url}${Apps.backend.paths.short}`

/** Returns the session's cookie that `context` holds for the app, or `undefined` without one. */
async function cookie(context: BrowserContext) {
  const cookies = await context.cookies(Apps.backend.url)
  return cookies.find((entry) => entry.name === sessionCookie)
}

/**
 * Signs `email` in with a redirect that the backend's route starts on the page at `options.url`, as
 * the first step of a test. Returns the Tempo Account of the session.
 */
function enter(page: Page, options: enter.Options) {
  const { capture, code, email, url: target = url } = options
  return test.step('signs in with a redirect that the backend starts', async () => {
    await page.goto(target)
    await Playwright.start(page, { name: 'Sign in with a redirect' })
    await page.waitForURL(`${TempoId.url}/**`)
    await Playwright.signIn(page, { code, email })
    await page.waitForURL((value) => value.href === target)

    const account = await session(page, { email })
    await capture('signed in')
    return account
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
    /** The URL of the page. Defaults to the backend page. */
    url?: string | undefined
  }
}

/**
 * Asserts that the backend's session route returns the session of `email` to `page`, and returns
 * the session's Tempo Account.
 */
async function session(page: Page, options: session.Options) {
  const read = await Playwright.run(page, { name: 'Session' })
  expect(read).toMatchObject({
    state: 'fulfilled',
    value: {
      body: {
        session: {
          account: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
          method: 'tempo-id',
          user: { email: options.email },
        },
      },
      status: 200,
    },
  })
  return read.value.body.session.account as `0x${string}`
}

declare namespace session {
  type Options = {
    /** The user's address. */
    email: string
  }
}

/** Asserts that the backend's session route returns no session to `page`. */
async function signedOut(page: Page) {
  expect(await Playwright.run(page, { name: 'Session' })).toEqual({
    state: 'fulfilled',
    value: { body: { session: null }, status: 200 },
  })
}

test.describe('backend', () => {
  test.describe('sign-in', () => {
    test('loads no frame of Tempo ID on the reload of a signed-in page, and loads it once the page is signed out', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await enter(page, { capture, code, email })

      await test.step('reloads signed in, and sends no request to Tempo ID', async () => {
        const requests: string[] = []
        page.on('request', (request) => {
          if (request.url().startsWith(TempoId.url))
            requests.push(request.url())
        })
        await page.reload({ waitUntil: 'networkidle' })

        await session(page, { email })
        await expect(Playwright.frame(page)).toHaveCount(0)
        expect(requests).toEqual([])
        await capture('signed in without a frame')
      })

      await test.step('loads the hidden frame on the reload of a signed-out page', async () => {
        await Playwright.run(page, { name: 'Sign out' })
        await page.reload()

        await expect(Playwright.frame(page)).toHaveCount(1)
        await signedOut(page)
        await capture('signed out with a hidden frame')
      })
    })

    test('restores the session on the reload of a signed-in page with one read of the session route', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await enter(page, { capture, code, email })

      await test.step('reloads signed in, and restores the session with one read', async () => {
        const reads: string[] = []
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/api/auth/session')
            reads.push(request.method())
        })
        await page.reload({ waitUntil: 'networkidle' })

        const restored = await Playwright.run(page, { name: 'Restore' })
        expect(restored).toMatchObject({
          state: 'fulfilled',
          value: { method: 'tempo-id', user: { email } },
        })
        // The preload's read on load is the restore's, so the page reads the route once.
        expect(reads).toEqual(['GET'])
        await capture('restored with one read')
      })
    })

    test('signs in with a redirect, and holds the session behind a cookie that no script reads', async ({
      capture,
      code,
      context,
      email,
      page,
    }) => {
      await page.goto(url)

      await test.step('leaves the page for Tempo ID’s sign-in, which the backend’s route starts', async () => {
        const started = page.waitForResponse((response) =>
          response.url().startsWith(`${Apps.backend.url}/api/auth/login?`),
        )
        await Playwright.start(page, { name: 'Sign in with a redirect' })
        const authorize = new URL((await started).headers().location!)

        await page.waitForURL(`${TempoId.url}/**`)
        expect(authorize.origin).toBe(TempoId.url)
        expect(authorize.searchParams.get('client_id')).toBe(
          Apps.backend.clientId,
        )
        // A confidential app pushes its request, so the URL names the push, and no parameter of it.
        expect(authorize.searchParams.get('request_uri')).toMatch(
          /^urn:ietf:params:oauth:request_uri:/,
        )
        expect(authorize.searchParams.has('redirect_uri')).toBe(false)
        await capture('Tempo ID')
      })

      await test.step('returns through the backend’s callback, which redeems the code', async () => {
        const returned = page.waitForRequest(
          (request) =>
            request.isNavigationRequest() &&
            request.url().startsWith(`${Apps.backend.url}/api/auth/callback?`),
        )
        await Playwright.signIn(page, { code, email })
        expect(new URL((await returned).url()).searchParams.has('code')).toBe(
          true,
        )

        await page.waitForURL((value) => value.href === url)
        await session(page, { email })
        await capture('signed in')
      })

      await test.step('holds the session ID in an `HttpOnly` cookie, and no token on the page', async () => {
        expect(await cookie(context)).toMatchObject({
          httpOnly: true,
          path: '/',
          sameSite: 'Lax',
          secure: true,
        })
        expect(await Playwright.run(page, { name: 'Storage' })).toEqual({
          state: 'fulfilled',
          value: { cookie: '', holdsToken: false },
        })
        expect(await Playwright.run(page, { name: 'Me' })).toMatchObject({
          state: 'fulfilled',
          value: {
            body: {
              accessToken: expect.stringMatching(/^[0-9a-f]{16}$/),
              email,
              key: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
              method: 'tempo-id',
            },
            status: 200,
          },
        })
        await capture('session')
      })
    })

    test('signs in in the dialog’s popup, and receives the session’s cookie', async ({
      capture,
      code,
      context,
      email,
      page,
    }) => {
      await page.goto(url)

      const popup =
        await test.step('opens Tempo ID’s sign-in in a popup', async () => {
          const popup = await Playwright.popup(page, {
            open: () => Playwright.start(page, { name: 'Sign in in a popup' }),
          })
          await popup.waitForURL(`${TempoId.url}/**`)
          await capture('Tempo ID', popup)
          return popup
        })

      await test.step('returns the page’s session, which holds no token', async () => {
        await Playwright.signIn(popup, { code, email })
        const signedIn = await Playwright.outcome(page, {
          name: 'Sign in in a popup',
        })

        // The whole value, so no field holds a token, a session ID, or an access key.
        expect(signedIn).toEqual({
          state: 'fulfilled',
          value: {
            account: await session(page, { email }),
            method: 'tempo-id',
            user: { email, id: expect.stringMatching(userId) },
          },
        })
        expect(await cookie(context)).toMatchObject({ httpOnly: true })
        expect(page.url()).toBe(url)
        await capture('signed in')
      })
    })

    test('continues in a popup when Tempo ID refuses the frame of a confidential app', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(url)

      await test.step('shows a prompt in place of the frame, which Tempo ID refuses', async () => {
        await Playwright.start(page, { name: 'Sign in' })

        await expect(Playwright.prompt(page)).toContainText(
          'Continue in a new window to finish signing in.',
        )
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        await capture('prompt')
      })

      await test.step('signs in in the popup that the prompt opens', async () => {
        const popup = await Playwright.popup(page, {
          open: () => Playwright.choose(page, { name: 'Continue' }),
        })
        await capture('Tempo ID', popup)
        await Playwright.signIn(popup, { code, email })

        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'fulfilled',
          value: { method: 'tempo-id', user: { email } },
        })
        await session(page, { email })
        await capture('signed in')
      })
    })

    test('returns to the app’s own origin for a `returnTo` of another origin', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const requests: string[] = []
      page.on('request', (request) => {
        if (request.isNavigationRequest()) requests.push(request.url())
      })

      await test.step('starts the sign-in with a `returnTo` of another site', async () => {
        const returnTo = 'https://attacker.example/'
        await page.goto(
          `${Apps.backend.url}/api/auth/login?${new URLSearchParams({ returnTo })}`,
        )

        await page.waitForURL(`${TempoId.url}/**`)
        await capture('Tempo ID')
      })

      await test.step('returns to the app’s root, and requests no other site', async () => {
        await Playwright.signIn(page, { code, email })
        await page.waitForURL((value) => value.href === url)

        await session(page, { email })
        const origins = new Set(requests.map((value) => new URL(value).origin))
        expect([...origins].toSorted()).toEqual(
          [Apps.backend.url, TempoId.url].toSorted(),
        )
        await capture('signed in')
      })
    })
  })

  test.describe('refusals', () => {
    test('throws `Accounts.RequestError` with status 0 when the backend does not answer the sign-in', async ({
      capture,
      errors,
      page,
    }) => {
      await page.goto(url)
      await page.route('**/api/auth/login', (route) =>
        route.abort('internetdisconnected'),
      )

      await test.step('rejects with `server_error` and status 0, as a refusal without a response', async () => {
        await Playwright.start(page, { name: 'Sign in' })

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
        await capture('signed out')
      })
    })

    test('throws `Accounts.RequestError` with `signedIn` when the backend does not answer the callback', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(url)
      await page.route('**/api/auth/callback', (route) =>
        route.abort('internetdisconnected'),
      )

      await test.step('signs in on Tempo ID in the popup', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await expect(Playwright.prompt(page)).toContainText(
          'Continue in a new window to finish signing in.',
        )
        const popup = await Playwright.popup(page, {
          open: () => Playwright.choose(page, { name: 'Continue' }),
        })
        await Playwright.signIn(popup, { code, email })
        await capture('Tempo ID', popup)
      })

      await test.step('rejects with `server_error`, status 0, and `signedIn`', async () => {
        expect(
          await Playwright.outcome(page, { name: 'Sign in' }),
        ).toMatchObject({
          state: 'rejected',
          value: {
            code: 'server_error',
            name: 'Accounts.RequestError',
            signedIn: true,
            status: 0,
          },
        })
        errors.splice(0)
        await capture('rejected')
      })
    })

    test('drops a callback that no sign-in of the browser started', async ({
      capture,
      context,
      page,
    }) => {
      await test.step('returns to the app with `invalid_request`, and sets no session', async () => {
        await page.goto(
          `${Apps.backend.url}/api/auth/callback?code=forged&state=forged`,
        )
        await page.waitForURL(
          (value) => value.href === `${url}?error=invalid_request`,
        )

        expect(await cookie(context)).toBeUndefined()
        await signedOut(page)
        await capture('signed out')
      })
    })

    test('returns the refusal of a sign-in that the user denies, and sets no session', async ({
      capture,
      code,
      context,
      email,
      page,
    }) => {
      await enter(page, { capture, code, email })

      await test.step('signs out of the app alone', async () => {
        await Playwright.run(page, { name: 'Sign out' })

        await signedOut(page)
        await capture('signed out of the app')
      })

      await test.step('returns to the page with `access_denied` at the denial', async () => {
        await Playwright.start(page, { name: 'Sign in with a redirect' })
        await page.waitForURL(`${TempoId.url}/**`)
        await capture('approval')
        await Playwright.deny(page)
        await page.waitForURL(
          (value) => value.href === `${url}?error=access_denied`,
        )

        expect(await cookie(context)).toBeUndefined()
        await signedOut(page)
        await capture('refused')
      })
    })

    test('refuses a sign-out from another origin, then ends the session at the app’s own', async ({
      capture,
      code,
      context,
      email,
      errors,
      page,
      request,
    }) => {
      await enter(page, { capture, code, email })
      const held = await cookie(context)

      await test.step('refuses a post of another site that carries the cookie', async () => {
        const response = await page.request.post(
          `${Apps.backend.url}/api/auth/logout`,
          { headers: { origin: 'https://attacker.example' } },
        )

        expect(response.status()).toBe(403)
        expect(await response.json()).toMatchObject({ error: 'forbidden' })
        await session(page, { email })
        await capture('still signed in')
      })

      await test.step('signs out, which deletes the cookie', async () => {
        expect(await Playwright.run(page, { name: 'Sign out' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 204 },
        })

        expect(await cookie(context)).toBeUndefined()
        await signedOut(page)
        expect(await Playwright.run(page, { name: 'Me' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 401 },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
        await capture('signed out')
      })

      await test.step('holds no session for the cookie that the browser held', async () => {
        const response = await request.get(
          `${Apps.backend.url}/api/auth/session`,
          { headers: { cookie: `${sessionCookie}=${held!.value}` } },
        )

        expect(await response.json()).toEqual({ session: null })
        await capture('no session')
      })
    })
  })

  test.describe('session', () => {
    test('shares the session between the tabs of a browser, and with no other browser', async ({
      browser,
      capture,
      code,
      context,
      email,
      page,
    }) => {
      const account = await enter(page, { capture, code, email })

      await test.step('reads the session in a second tab', async () => {
        const tab = await context.newPage()
        await tab.goto(url)

        expect(await session(tab, { email })).toBe(account)
        await capture('second tab', tab)
      })

      const other = await browser.newContext()
      const visitor = await other.newPage()
      const visitorEmail = `accounts-test+${crypto.randomUUID()}@example.org`

      await test.step('reads no session in a second browser', async () => {
        await visitor.goto(url)

        await signedOut(visitor)
        await capture('second browser', visitor)
      })

      await test.step('signs another user in there, and keeps each session apart', async () => {
        await Playwright.start(visitor, { name: 'Sign in with a redirect' })
        await visitor.waitForURL(`${TempoId.url}/**`)
        await Playwright.signIn(visitor, { code, email: visitorEmail })
        await visitor.waitForURL((value) => value.href === url)

        expect(await session(visitor, { email: visitorEmail })).not.toBe(
          account,
        )
        expect(await session(page, { email })).toBe(account)
        await capture('second user', visitor)
        await other.close()
      })
    })

    test('refreshes a short access token at each read, and keeps the cookie', async ({
      capture,
      code,
      context,
      email,
      page,
    }) => {
      await enter(page, { capture, code, email, url: shortUrl })
      const held = await cookie(context)

      await test.step('reads another access token at the second read', async () => {
        const first = await Playwright.run(page, { name: 'Me' })
        const second = await Playwright.run(page, { name: 'Me' })

        expect(first.value.status).toBe(200)
        expect(second.value).toMatchObject({
          body: {
            accessToken: expect.stringMatching(/^[0-9a-f]{16}$/),
            account: first.value.body.account,
            email,
            key: first.value.body.key,
          },
          status: 200,
        })
        expect(second.value.body.accessToken).not.toBe(
          first.value.body.accessToken,
        )
        await capture('refreshed')
      })

      await test.step('reads Tempo ID with the new access token, under the same cookie', async () => {
        expect(await Playwright.run(page, { name: 'User info' })).toEqual({
          state: 'fulfilled',
          value: { body: { email, status: 200 }, status: 200 },
        })

        expect((await cookie(context))?.value).toBe(held!.value)
        await session(page, { email })
        await capture('user info')
      })
    })
  })

  test.describe('calls of the backend', () => {
    test('reads Tempo ID with the session’s access token, and sends OUSD with its access key', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const account = await enter(page, { capture, code, email })
      const recipient = privateKeyToAddress(generatePrivateKey())

      await test.step('reads the user from Tempo ID with `session.fetch`', async () => {
        expect(await Playwright.run(page, { name: 'User info' })).toEqual({
          state: 'fulfilled',
          value: { body: { email, status: 200 }, status: 200 },
        })
        await capture('user info')
      })

      await test.step('sends OUSD on the backend, which the node lands', async () => {
        await Chain.fund({ address: account })
        const transfer = await Playwright.send(page, {
          amount: '3',
          to: recipient,
        })

        expect(transfer).toMatchObject({
          state: 'fulfilled',
          value: { status: 200 },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(3_000_000n)
        const feePayer = await Chain.feePayer({
          hash: transfer.value.body.transactionHash,
        })
        expect(feePayer?.toLowerCase()).toBe(account.toLowerCase())
        await capture('sent')
      })

      await test.step('pays OUSD with `accounts.pay` and the session, which the node lands', async () => {
        const payee = privateKeyToAddress(generatePrivateKey())
        await page.getByLabel('Payee').fill(payee)
        const payment = await Playwright.run(page, { name: 'Pay 2 OUSD' })

        expect(payment).toMatchObject({
          state: 'fulfilled',
          value: {
            body: { transaction: expect.stringMatching(/^0x[0-9a-f]{64}$/) },
            status: 200,
          },
        })
        expect(await Chain.balance({ address: payee, token: Chain.ousd })).toBe(
          2_000_000n,
        )
        await capture('paid')
      })
    })

    test('introspects the session’s access token, and reads Tempo ID’s key set', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await enter(page, { capture, code, email })

      await test.step('reads the token as active, for the app and the user', async () => {
        expect(await Playwright.run(page, { name: 'Introspect' })).toEqual({
          state: 'fulfilled',
          value: {
            body: {
              active: true,
              clientId: Apps.backend.clientId,
              userId: expect.any(String),
            },
            status: 200,
          },
        })
        await capture('active')
      })

      await test.step('reads a token with a forged signature as inactive', async () => {
        expect(
          await Playwright.run(page, { name: 'Introspect a forged token' }),
        ).toEqual({
          state: 'fulfilled',
          value: { body: { active: false }, status: 200 },
        })
        await capture('inactive')
      })

      await test.step('reads the keys that sign Tempo ID’s tokens', async () => {
        const keys = await Playwright.run(page, { name: 'Key set' })

        expect(keys.value.status).toBe(200)
        expect(keys.value.body.keys).toContain('RSA')
        await capture('key set')
      })
    })

    test('updates the limit of the session’s access key, which the page names from the backend', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const account = await enter(page, { capture, code, email })
      const recipient = privateKeyToAddress(generatePrivateKey())
      const me = await Playwright.run(page, { name: 'Me' })
      const key = { accessKey: me.value.body.key, address: account } as const
      const held = () => Chain.balance({ address: account, token: Chain.ousd })

      await test.step('sends OUSD within the limit of 100, which counts the fee too', async () => {
        await Chain.fund({ address: account })
        const before = await held()
        const transfer = await Playwright.send(page, {
          amount: '10',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        const spent = before - (await held())
        expect(spent).toBeGreaterThan(10_000_000n)
        expect(await Chain.remaining({ ...key, token: Chain.ousd })).toBe(
          100_000_000n - spent,
        )
        await capture('sent')
      })

      await test.step('approves the new limit in the dialog', async () => {
        await Playwright.start(page, { name: 'Update the limit to 50' })
        const frame = await Playwright.dialog(page)
        await capture('approval')
        await Playwright.approve(frame)

        expect(
          await Playwright.outcome(page, { name: 'Update the limit to 50' }),
        ).toMatchObject({ state: 'fulfilled' })
        expect(await Chain.remaining({ ...key, token: Chain.ousd })).toBe(
          50_000_000n,
        )
        await capture('updated')
      })

      await test.step('sends OUSD on the backend within the new limit', async () => {
        const before = await held()
        const transfer = await Playwright.send(page, {
          amount: '20',
          to: recipient,
        })

        expect(transfer.state).toBe('fulfilled')
        expect(await Chain.remaining({ ...key, token: Chain.ousd })).toBe(
          50_000_000n - (before - (await held())),
        )
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(30_000_000n)
        await capture('sent again')
      })
    })
  })

  test.describe('funding', () => {
    test('signs in with an amount that the account needs, through the plugin’s own calls', async ({
      capture,
      code,
      context,
      email,
      page,
      request,
    }) => {
      const funded = `${Apps.backend.url}${Apps.backend.paths.funded}`
      await page.goto(
        `${funded}?${new URLSearchParams({ funding: JSON.stringify(needed) })}`,
      )

      await test.step('shows Tempo ID’s deposit page after the sign-in, with the amount', async () => {
        await Playwright.start(page, { name: 'Sign in with a redirect' })
        await page.waitForURL(`${TempoId.url}/**`)
        await Playwright.signIn(page, { code, email })
        await page.waitForURL(`${TempoId.url}/deposit?**`)
        const deposit = await Playwright.deposit(page)

        await expect(deposit.hint).toContainText('at least $5')
        await capture('deposit page')
        await deposit.faucet.click()
      })

      await test.step('returns through the backend’s callback with the session, and the deposit', async () => {
        await page.waitForURL((value) => value.href === funded)
        const read = await Playwright.run(page, { name: 'Session' })

        expect(read).toMatchObject({
          state: 'fulfilled',
          value: { body: { email }, status: 200 },
        })
        expect(
          await Chain.balance({
            address: read.value.body.account,
            token: Chain.ousd,
          }),
        ).toBe(dripped)
        await capture('signed in')
      })

      await test.step('ends the session with the plugin’s `end`, also for the cookie that the browser held', async () => {
        const cookies = await context.cookies(Apps.backend.url)
        const held = cookies.find((entry) => entry.name === fundCookie)
        const replay = () =>
          request.get(`${Apps.backend.url}/fund/session`, {
            headers: { cookie: `${fundCookie}=${held!.value}` },
          })
        // The route answers `null` without its cookie, so the replay proves that `end` ran.
        const before = await replay()
        expect(await before.json()).toMatchObject({ email })

        expect(await Playwright.run(page, { name: 'Sign out' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 204 },
        })

        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        const after = await replay()
        expect(await after.json()).toBeNull()
        await capture('signed out')
      })
    })
  })

  test.describe('sign-in with an emailed code', () => {
    test('signs in from the app’s own form, with no page and no request of the browser to Tempo ID', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const requests: string[] = []
      page.on('request', (sent) => {
        if (sent.url().startsWith(`${TempoId.url}/`)) requests.push(sent.url())
      })
      await page.goto(emailedUrl)

      const account =
        await test.step('redeems the code in the backend, which holds the session', async () => {
          const signedIn = await Playwright.signIn_custom(page, { code, email })

          expect(signedIn).toEqual({
            state: 'fulfilled',
            value: {
              body: {
                account: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
                email,
                key: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
                proved: null,
              },
              status: 200,
            },
          })
          expect(await Playwright.run(page, { name: 'Session' })).toEqual({
            state: 'fulfilled',
            value: {
              body: { account: signedIn.value.body.account, email },
              status: 200,
            },
          })
          expect(await Playwright.run(page, { name: 'Storage' })).toEqual({
            state: 'fulfilled',
            value: { cookie: '', holdsToken: false },
          })
          expect(requests).toEqual([])
          await capture('signed in')
          return signedIn.value.body.account as `0x${string}`
        })

      await test.step('sends 1 OUSD with the session’s access key, from the backend', async () => {
        const recipient = privateKeyToAddress(generatePrivateKey())
        await Chain.fund({ address: account })
        const sent = await Playwright.send(page, { amount: '1', to: recipient })

        expect(sent).toMatchObject({
          state: 'fulfilled',
          value: { status: 200 },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(parseUnits('1', 6))
        await capture('sent')
      })

      await test.step('ends the session at the sign-out', async () => {
        expect(await Playwright.run(page, { name: 'Sign out' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 204 },
        })

        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        expect(requests).toEqual([])
        await capture('signed out')
      })
    })

    test('returns a proof of the backend’s challenge, which the backend verifies on the node', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(emailedUrl)

      await test.step('proves the Tempo Account and the access key of the session', async () => {
        const signedIn = await Playwright.signIn_custom(page, {
          code,
          email,
          name: 'Sign in with a challenge',
        })

        expect(signedIn).toMatchObject({
          state: 'fulfilled',
          value: { body: { email }, status: 200 },
        })
        const { account, key, proved } = signedIn.value.body
        expect(proved).toEqual({ accessKey: key, account })
        await capture('proved')
      })
    })

    test('rejects for an app without backend sign-in, and sets no session', async ({
      capture,
      email,
      errors,
      page,
    }) => {
      await page.goto(`${emailedUrl}?refused=1`)

      await test.step('returns Tempo ID’s refusal of the app', async () => {
        await page.getByLabel('Email').fill(email)
        const sent = await Playwright.run(page, { name: 'Send code' })

        expect(sent).toMatchObject({
          state: 'fulfilled',
          value: {
            body: { error: 'backend_sign_in_not_permitted' },
            status: 403,
          },
        })
        // The browser logs each response with a failure status.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[403]])
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        await capture('refused')
      })
    })
  })

  test.describe('client assertion', () => {
    test('signs in with a client assertion, and ends the session at a logout token of Tempo ID', async ({
      capture,
      code,
      context,
      email,
      page,
      request,
    }) => {
      await page.goto(assertedUrl)

      await test.step('exchanges the code with an assertion that the app’s private key signs', async () => {
        await Playwright.start(page, { name: 'Sign in with a redirect' })
        await page.waitForURL(`${TempoId.url}/**`)
        await Playwright.signIn(page, { code, email })
        await page.waitForURL((value) => value.href === assertedUrl)

        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: {
            body: {
              account: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
              email,
            },
            status: 200,
          },
        })
        await capture('signed in')
      })

      await test.step('refuses a logout token that Tempo ID did not sign, and keeps the session', async () => {
        const forged = await request.post(
          `${Apps.backend.url}/assertion/logout-token`,
          { form: { logout_token: 'eyJhbGciOiJub25lIn0.e30.' } },
        )

        expect(forged.status()).toBe(400)
        expect(await Playwright.run(page, { name: 'Session' })).toMatchObject({
          state: 'fulfilled',
          value: { body: { email } },
        })
        await capture('forged token refused')
      })

      await test.step('ends the backend’s session when another app signs the user out everywhere', async () => {
        const tab = await context.newPage()
        await tab.goto(Web.url({ path: Apps.web.paths.dialog }))
        await Playwright.start(tab, { name: 'Sign in' })
        await Playwright.approve(await Playwright.dialog(tab))
        expect((await Playwright.outcome(tab, { name: 'Sign in' })).state).toBe(
          'fulfilled',
        )
        expect(
          (await Playwright.run(tab, { name: 'Sign out everywhere' })).state,
        ).toBe('fulfilled')

        // Tempo ID posts the logout token after the sign-out's response.
        await expect
          .poll(async () => {
            const read = await Playwright.run(page, { name: 'Session' })
            return read.value
          })
          .toEqual({ body: null, status: 200 })
        await capture('session ended')
      })
    })
  })
})
