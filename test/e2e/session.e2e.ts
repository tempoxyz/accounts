/**
 * Tests the session that a sign-in on the dialog page of the web test app saves: its restore at a
 * page load, its refresh, the refusals that end it, its tokens' use, its sign-out, and its sync
 * between the tabs of a browser. `useSession` shows each status that a page renders.
 * @module
 */
import type { BrowserContext, Page } from '@playwright/test'
import { Hint } from 'accounts/hint'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'

/** The URL of the dialog page. */
const url = `${Apps.web.url}${Apps.web.paths.dialog}`

/** The URL of the dialog page whose `useSession` authorizes nothing at a mount. */
const passive = `${url}?reauthorize=0`

/** The URL of Tempo ID's token endpoint. */
const tokenUrl = `${TempoId.url}/oauth2/token`

/**
 * Returns each request that `page` sends to Tempo ID from now on, except its assets, as
 * `METHOD /path`, in order. The list grows as the requests leave.
 */
function record(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => {
    const { origin, pathname } = new URL(request.url())
    if (origin === TempoId.url && !pathname.startsWith('/assets/'))
      requests.push(`${request.method()} ${pathname}`)
  })
  return requests
}

/** The error of a refresh whose refresh token Tempo ID refuses. */
const refused = {
  code: 'invalid_grant',
  name: 'Accounts.RequestError',
  status: 400,
}

/** Signs `email` in through the dialog on `page`, and returns the session that the page shows. */
async function enter(page: Page, options: enter.Options) {
  await Playwright.start(page, { name: 'Sign in' })
  await Playwright.signIn(await Playwright.dialog(page), options)

  const session = await Playwright.outcome(page, { name: 'Sign in' })
  expect(session.state).toBe('fulfilled')
  await expect(page.locator('#status')).toHaveText('signedIn')
  return session.value
}

declare namespace enter {
  type Options = {
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
  }
}

/**
 * Returns the grant type of each request that `target` sends to Tempo ID's token endpoint from now
 * on, in order. The list grows as the requests leave.
 */
function grants(target: BrowserContext | Page) {
  const types: string[] = []
  target.on('request', (request) => {
    if (request.url() !== tokenUrl) return
    types.push(
      new URLSearchParams(request.postData() ?? '').get('grant_type') ?? '',
    )
  })
  return types
}

test.describe('session', () => {
  test('restores the session at a page load with no request for tokens', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)
    const before = await enter(page, { code, email })

    await test.step('shows the saved session after a reload', async () => {
      const requests = grants(page)
      await page.reload()

      await expect(page.locator('#history')).toHaveText('pending signedIn')
      expect((await Playwright.run(page, { name: 'Session' })).value).toEqual(
        before,
      )
      expect(requests).toEqual([])
      await capture('restored')
    })

    await test.step('sends OUSD with the access key that the store kept', async () => {
      await Chain.fund({ address: before.key.account })
      const transfer = await Playwright.send(page, {
        amount: '2',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(2_000_000n)
      await capture('sent')
    })
  })

  test('sets the session hint at a sign-in and a restore, and expires it at a sign-out and at a load without a session', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const hinted = async () =>
      Hint.has(await page.evaluate(() => document.cookie))

    await test.step('expires a hint at a load that restores no session', async () => {
      await page
        .context()
        .addCookies([{ name: Hint.cookie, url: Apps.web.url, value: '1' }])
      await page.goto(`${passive}&hint=1`)

      await expect(page.locator('#status')).toHaveText('signedOut')
      await expect.poll(hinted).toBe(false)
      await capture('no session')
    })

    await test.step('sets the hint at the sign-in', async () => {
      await enter(page, { code, email })

      expect(await hinted()).toBe(true)
      await capture('signed in')
    })

    await test.step('keeps the hint at a reload that restores the session', async () => {
      await page.reload()

      await expect(page.locator('#status')).toHaveText('signedIn')
      expect(await hinted()).toBe(true)
      await capture('restored')
    })

    await test.step('expires the hint at the sign-out', async () => {
      await Playwright.run(page, { name: 'Sign out' })

      await expect(page.locator('#status')).toHaveText('signedOut')
      expect(await hinted()).toBe(false)
      await capture('signed out')
    })
  })

  test('keeps the session hint at the expiry of the access key in an open page, so the next load renews the session', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const hinted = async () =>
      Hint.has(await page.evaluate(() => document.cookie))
    // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
    await page.goto(`${url}?expiry=15s&hint=1`)
    const before = await enter(page, { code, email })

    await test.step('keeps the hint at the expiry of the access key', async () => {
      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut',
        { timeout: 30_000 },
      )
      expect(await hinted()).toBe(true)
      await capture('expired')
    })

    await test.step('renews the session at the next load', async () => {
      await page.goto(`${url}?hint=1`)

      await expect(page.locator('#status')).toHaveText('signedIn')
      const after = (await Playwright.run(page, { name: 'Session' })).value
      expect(after.key.id).not.toBe(before.key.id)
      expect(await hinted()).toBe(true)
      await capture('renewed')
    })
  })

  test('expires the session hint at a sign-out after the access key expires in an open page', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const hinted = async () =>
      Hint.has(await page.evaluate(() => document.cookie))
    // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
    await page.goto(`${url}?expiry=15s&hint=1`)
    await enter(page, { code, email })

    await test.step('keeps the hint at the expiry of the access key', async () => {
      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut',
        { timeout: 30_000 },
      )
      expect(await hinted()).toBe(true)
      await capture('expired')
    })

    await test.step('expires the hint at the sign-out', async () => {
      await Playwright.run(page, { name: 'Sign out' })

      await expect.poll(hinted).toBe(false)
      await capture('signed out')
    })
  })

  test('refreshes the tokens, and keeps the access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)
    const before = await enter(page, { code, email })
    const requests = grants(page)

    const refresh =
      await test.step('rotates both tokens with one request', async () => {
        const refresh = await Playwright.run(page, { name: 'Refresh' })

        expect(refresh.state).toBe('fulfilled')
        expect(requests).toEqual(['refresh_token'])
        expect(refresh.value.accessToken).not.toBe(before.accessToken)
        expect(refresh.value.refreshToken).not.toBe(before.refreshToken)
        expect(refresh.value.key).toEqual(before.key)
        await capture('refreshed')
        return refresh
      })

    await test.step('stores the new tokens, which Tempo ID accepts', async () => {
      expect((await Playwright.run(page, { name: 'Session' })).value).toEqual(
        refresh.value,
      )
      expect((await Playwright.run(page, { name: 'User info' })).value).toEqual(
        {
          email,
          status: 200,
        },
      )
      await capture('user info')
    })
  })

  test('ends the session at a refresh whose refresh token Tempo ID revoked', async ({
    capture,
    code,
    email,
    errors,
    page,
  }) => {
    await page.goto(url)
    await enter(page, { code, email })

    await test.step('stays signed in after the revocation at Tempo ID', async () => {
      expect(
        (await Playwright.run(page, { name: 'Revoke the refresh token' }))
          .value,
      ).toBe(true)
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('revoked')
    })

    await test.step('signs out at the refresh that Tempo ID refuses', async () => {
      expect(await Playwright.run(page, { name: 'Refresh' })).toMatchObject({
        state: 'rejected',
        value: refused,
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      expect((await Playwright.run(page, { name: 'Session' })).value).toBeNull()
      // The browser logs the refused request.
      expect(errors.splice(0)).toEqual([expect.stringContaining('400')])
      await capture('signed out')
    })
  })

  test('ends the session at a refresh after the refresh token’s lifetime', async ({
    capture,
    code,
    email,
    errors,
    page,
  }) => {
    await page.goto(`${url}?clientId=${Apps.web.clientIdShortLived}`)
    await enter(page, { code, email })
    const expiry = Date.now() + Apps.web.refreshTokenLifetime * 1000

    await test.step('stays signed in past the lifetime of the refresh token', async () => {
      // No state of the page shows the refresh token's expiry, which only Tempo ID holds.
      await expect
        .poll(() => Date.now() > expiry + 1000, { timeout: 15_000 })
        .toBe(true)
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('past the lifetime')
    })

    await test.step('signs out at the refresh that Tempo ID refuses', async () => {
      expect(await Playwright.run(page, { name: 'Refresh' })).toMatchObject({
        state: 'rejected',
        value: refused,
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      expect(errors.splice(0)).toEqual([expect.stringContaining('400')])
      await capture('signed out')
    })
  })

  test('shows a sign-in and a sign-out of one tab in another', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    const tab = await context.newPage()
    await Promise.all([page.goto(passive), tab.goto(passive)])
    await expect(tab.locator('#status')).toHaveText('signedOut')

    await test.step('signs the second tab in at the first tab’s sign-in', async () => {
      const session = await enter(page, { code, email })

      await expect(tab.locator('#status')).toHaveText('signedIn')
      await expect(tab.locator('#email')).toHaveText(email)
      expect((await Playwright.run(tab, { name: 'Session' })).value).toEqual(
        session,
      )
      await capture('second tab signed in', tab)
    })

    await test.step('signs the first tab out at the second tab’s sign-out', async () => {
      expect((await Playwright.run(tab, { name: 'Sign out' })).state).toBe(
        'fulfilled',
      )

      await expect(page.locator('#status')).toHaveText('signedOut')
      expect((await Playwright.run(page, { name: 'Session' })).value).toBeNull()
      await capture('first tab signed out')
    })
  })

  test('shows a sign-in and a sign-out of one tab in another tab that only follows the status, with no `session.get`', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    const tab = await context.newPage()
    await Promise.all([
      page.goto(passive),
      tab.goto(`${Apps.web.url}/restore/?restore=0`),
    ])
    await expect(page.locator('#status')).toHaveText('signedOut')
    await expect(tab.locator('#status')).toHaveText('pending')

    await test.step('signs the second tab in at the first tab’s sign-in', async () => {
      await enter(page, { code, email })

      await expect(tab.locator('#status')).toHaveText('signedIn')
      await capture('second tab signed in', tab)
    })

    await test.step('signs the second tab out at the first tab’s sign-out', async () => {
      expect((await Playwright.run(page, { name: 'Sign out' })).state).toBe(
        'fulfilled',
      )

      await expect(tab.locator('#status')).toHaveText('signedOut')
      await capture('second tab signed out', tab)
    })
  })

  test('ends the browser’s Tempo ID session with `everywhere`, and the session of another app with it', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    // The page that signs out is the app whose refresh tokens are short-lived, so the lifetime of
    // the other app's refresh token never explains its refusal.
    await page.goto(`${url}?clientId=${Apps.web.clientIdShortLived}`)
    await enter(page, { code, email })
    const tab = await context.newPage()
    await tab.goto(url)
    await expect(tab.locator('#status')).toHaveText('signedIn')
    expect((await Playwright.run(tab, { name: 'Refresh' })).state).toBe(
      'fulfilled',
    )

    await test.step('signs out everywhere, which ends the Tempo ID session', async () => {
      expect(
        (await Playwright.run(page, { name: 'Sign out everywhere' })).state,
      ).toBe('fulfilled')
      await expect(page.locator('#status')).toHaveText('signedOut')

      await Playwright.start(page, { name: 'Sign in' })
      await expect(Playwright.form(await Playwright.dialog(page))).toBeVisible()
      await capture('signed out')
    })

    await test.step('refuses the refresh token of the other app', async () => {
      expect(await Playwright.run(tab, { name: 'Refresh' })).toMatchObject({
        state: 'rejected',
        value: refused,
      })
      await expect(tab.locator('#status')).toHaveText('signedOut')
      await capture('other app signed out', tab)
    })
  })

  test('signs out a tab whose store is local at another tab’s sign-out with `everywhere`, and requests no token', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    await page.goto(url)
    await enter(page, { code, email })
    // The second tab keeps its own copy of the session, which the first tab's sign-out cannot empty.
    // A local store authorizes nothing at a mount by default, so the tab asks for it.
    const tab = await context.newPage()
    const sent = grants(tab)
    await tab.goto(`${url}?store=memory&reauthorize=1`)
    await expect(tab.locator('#status')).toHaveText('signedIn')

    await test.step('signs the second tab out at the first tab’s logout', async () => {
      expect(
        (await Playwright.run(page, { name: 'Sign out everywhere' })).state,
      ).toBe('fulfilled')

      await expect(tab.locator('#status')).toHaveText('signedOut')
      await capture('second tab signed out', tab)
    })

    await test.step('refreshes nothing, since the second tab emptied its store', async () => {
      expect((await Playwright.run(tab, { name: 'Refresh' })).value).toBeNull()
      expect(sent).toEqual([])
      await capture('second tab refreshed nothing', tab)
    })
  })

  test('keeps the page signed out at a reload during the logout of a sign-out with `everywhere`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)
    await enter(page, { code, email })

    await test.step('signs out everywhere while the logout has no answer', async () => {
      // The logout stays without an answer, as on a slow network, so the Tempo ID session holds.
      await page.route(`${TempoId.url}/v1/auth/logout`, () => undefined)
      await Playwright.start(page, { name: 'Sign out everywhere' })

      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })

    await test.step('reloads the page, which authorizes nothing and stays signed out', async () => {
      // The route still holds the logout, so the reload aborts it before Tempo ID ends its session.
      await page.reload()

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      await capture('reloaded')
    })
  })

  test('reads the user from Tempo ID with the session’s access token', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)
    const session = await enter(page, { code, email })
    const requests = grants(page)

    await test.step('reads the user with the stored access token, and requests no token', async () => {
      expect((await Playwright.run(page, { name: 'User info' })).value).toEqual(
        {
          email,
          status: 200,
        },
      )
      expect((await Playwright.run(page, { name: 'Access token' })).value).toBe(
        session.accessToken,
      )
      expect(requests).toEqual([])
      await capture('user info')
    })
  })

  test('binds the tokens to the page’s DPoP key, which a reload keeps', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const proofs: Record<string, boolean[]> = { token: [], userinfo: [] }
    page.on('request', async (request) => {
      const name = new URL(request.url()).pathname.split('/').at(-1)!
      if (!request.url().startsWith(`${TempoId.url}/oauth2/`)) return
      const headers = await request.allHeaders()
      proofs[name]?.push('dpop' in headers)
    })
    await page.goto(`${url}?dpop=1`)
    await enter(page, { code, email })

    await test.step('refreshes after a reload, with a proof of the stored DPoP key', async () => {
      await page.reload()
      await expect(page.locator('#status')).toHaveText('signedIn')
      proofs.token = []

      expect((await Playwright.run(page, { name: 'Refresh' })).state).toBe(
        'fulfilled',
      )
      expect(proofs.token).toEqual([true])
      await capture('refreshed')
    })

    await test.step('sends a proof with the access token', async () => {
      expect((await Playwright.run(page, { name: 'User info' })).value).toEqual(
        {
          email,
          status: 200,
        },
      )
      expect(proofs.userinfo).toEqual([true])
      await capture('user info')
    })
  })

  test('refuses the dialog’s tokens for an app that requires DPoP to an instance with no DPoP key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const required = `${url}?clientId=${Apps.web.clientIdDpop}`
    const proofs: boolean[] = []
    page.on('request', async (request) => {
      if (request.url() !== tokenUrl) return
      proofs.push('dpop' in (await request.allHeaders()))
    })

    await test.step('rejects the sign-in of an instance with no DPoP key, with no request for tokens', async () => {
      await page.goto(required)
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), { code, email })
      const session = await Playwright.outcome(page, { name: 'Sign in' })

      expect(session).toMatchObject({
        state: 'rejected',
        value: { code: 'invalid_request', name: 'Accounts.RequestError' },
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      expect(proofs).toEqual([])
      await capture('refused')
    })

    await test.step('signs in with a DPoP key, and redeems the code with a proof', async () => {
      await page.goto(`${required}&dpop=1`)
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.approve(await Playwright.dialog(page))
      const session = await Playwright.outcome(page, { name: 'Sign in' })

      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { email, key: { account: expect.stringMatching(/^0x/) } },
      })
      await expect(page.locator('#status')).toHaveText('signedIn')
      expect(proofs).toEqual([true])
      await capture('signed in')
    })

    await test.step('refreshes with a proof', async () => {
      expect((await Playwright.run(page, { name: 'Refresh' })).state).toBe(
        'fulfilled',
      )
      expect(proofs).toEqual([true, true])
      await capture('refreshed')
    })
  })

  test('reads the Tempo Account of the access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)
    const session = await enter(page, { code, email })

    await test.step('returns the Tempo Account that the access key acts for', async () => {
      const account = await Playwright.run(page, { name: 'Account' })

      expect(account.state).toBe('fulfilled')
      expect(account.value.address).toBe(session.key.account)
      await capture('account')
    })
  })

  test('rotates the refresh token once for two tabs that refresh together', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    const tab = await context.newPage()
    await Promise.all([page.goto(passive), tab.goto(passive)])
    await enter(page, { code, email })
    await expect(tab.locator('#status')).toHaveText('signedIn')

    // The first tab's refresh waits for its answer until the second tab's refresh starts, so the
    // two overlap.
    const requests: string[] = []
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await context.route(tokenUrl, async (route) => {
      requests.push(
        new URLSearchParams(route.request().postData() ?? '').get(
          'grant_type',
        ) ?? '',
      )
      await held
      await route.continue()
    })

    await test.step('sends one request for the refreshes of both tabs', async () => {
      await Playwright.start(page, { name: 'Refresh' })
      await expect.poll(() => requests).toEqual(['refresh_token'])
      await Playwright.start(tab, { name: 'Refresh' })
      release()

      const [first, second] = await Promise.all([
        Playwright.outcome(page, { name: 'Refresh' }),
        Playwright.outcome(tab, { name: 'Refresh' }),
      ])
      expect(first.state).toBe('fulfilled')
      expect(second).toEqual(first)
      expect(requests).toEqual(['refresh_token'])
      await capture('first tab refreshed')
      await capture('second tab refreshed', tab)
    })
  })
})

test.describe('useSession', () => {
  test('shows `pending`, then each status of a sign-in and a sign-out', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await test.step('shows `pending`, then `signedOut`, at the page load', async () => {
      await page.goto(url)

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      await capture('signed out')
    })

    await test.step('shows `signedIn` after the sign-in', async () => {
      await enter(page, { code, email })

      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn',
      )
      await capture('signed in')
    })

    await test.step('shows `signedOut` after the sign-out', async () => {
      await Playwright.run(page, { name: 'Sign out' })

      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut',
      )
      await capture('history')
    })
  })

  test('shows `signedOut` at a mount whose check of the Tempo ID session receives no response', async ({
    capture,
    page,
  }) => {
    // Tempo ID accepts the check, and never answers it, as over a stalled connection.
    await page.route(`${TempoId.url}/v1/auth/session`, () => {})
    await page.clock.install()
    await page.goto(url)

    await test.step('shows `pending` while the check waits', async () => {
      await expect(page.locator('#history')).toHaveText('pending')
      await capture('pending')
    })

    await test.step('shows `signedOut` once the check times out', async () => {
      await page.clock.runFor(10_000)

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      await capture('signed out')
    })
  })

  test('stays signed out at a page load after a sign-out of the app alone', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await enter(page, { code, email })
      await Playwright.run(page, { name: 'Sign out' })

      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })

    await test.step('requests no token at the next page load', async () => {
      const requests = grants(page)
      await page.reload()

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      expect(requests).toEqual([])
      await capture('reloaded')
    })
  })

  test('stays signed out at a page load after a sign-out on `Store.memory`, and authorizes nothing', async ({
    capture,
    code,
    email,
    page,
  }) => {
    // A page load empties the store, and the signed-out mark with it, while the browser keeps its
    // Tempo ID session.
    await page.goto(`${url}?store=memory`)

    await test.step('signs in, then signs out of the app alone', async () => {
      await enter(page, { code, email })
      await Playwright.run(page, { name: 'Sign out' })

      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })

    await test.step('authorizes nothing at the next page load', async () => {
      const requests = record(page)
      await page.reload()

      await expect(page.locator('#history')).toHaveText('pending signedOut')
      expect(
        requests.filter((request) => request.startsWith('POST /v1/authorize')),
      ).toEqual([])
      await capture('reloaded')
    })
  })

  test('renews the session at a page load on `Store.memory` with `reauthorizeOnMount: true`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(`${url}?store=memory&reauthorize=1`)
    await enter(page, { code, email })

    await test.step('signs in at the next page load with the browser’s Tempo ID session', async () => {
      await page.reload()

      await expect(page.locator('#history')).toHaveText('pending signedIn')
      await expect(page.locator('#email')).toHaveText(email)
      await capture('renewed')
    })
  })

  test('keeps `signedOut` at a mount after another tab’s sign-out of the app alone, and requests no token', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    await page.goto(url)
    await enter(page, { code, email })
    const tab = await context.newPage()
    await tab.goto(url)
    await expect(tab.locator('#status')).toHaveText('signedIn')

    await test.step('signs the first tab out at the second tab’s sign-out', async () => {
      expect((await Playwright.run(tab, { name: 'Sign out' })).state).toBe(
        'fulfilled',
      )

      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('first tab signed out')
    })

    await test.step('keeps `signedOut` at a mount of `useSession` in the first tab', async () => {
      const requests = grants(page)
      const mount = await Playwright.run(page, {
        name: 'Mount a session reader',
      })

      expect(mount).toMatchObject({ state: 'fulfilled', value: null })
      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut',
      )
      expect(requests).toEqual([])
      await capture('reader mounted')
    })
  })

  test('signs in at a mount with the browser’s Tempo ID session, with no dialog', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    const first =
      await test.step('signs in to one app through the dialog', async () => {
        const first = await enter(page, { code, email })
        await capture('first app')
        return first
      })

    await test.step('signs in to another app at its first page load', async () => {
      // The store of each client ID is its own, so the page of another app holds no session.
      await page.goto(`${url}?clientId=${Apps.web.clientIdShortLived}`)

      await expect(page.locator('#history')).toHaveText('pending signedIn')
      await expect(page.locator('#email')).toHaveText(email)
      const second = (await Playwright.run(page, { name: 'Session' })).value
      expect(second.key.account).toBe(first.key.account)
      expect(second.key.id).not.toBe(first.key.id)
      await capture('second app')
    })
  })

  test('authorizes once for two tabs that restore the Tempo ID session together', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    await page.goto(url)
    await enter(page, { code, email })

    await test.step('restores both tabs with one authorization', async () => {
      // The app's store holds no session, as after a cleared site storage, so each tab authorizes
      // the browser's Tempo ID session at its mount.
      await page.evaluate(async () => {
        for (const database of await indexedDB.databases())
          if (database.name) indexedDB.deleteDatabase(database.name)
      })
      await page.goto('about:blank')
      const tab = await context.newPage()
      const requests = [record(page), record(tab)] as const
      await Promise.all([page.goto(url), tab.goto(url)])

      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(tab.locator('#status')).toHaveText('signedIn')
      const [first, second] = await Promise.all(
        [page, tab].map(
          async (target) =>
            (await Playwright.run(target, { name: 'Session' })).value,
        ),
      )
      expect(second.key.id).toBe(first.key.id)
      expect(
        [...requests[0], ...requests[1]].filter(
          (request) => request === 'POST /v1/authorize',
        ),
      ).toEqual(['POST /v1/authorize'])
      await capture('first tab restored')
      await capture('second tab restored', tab)
    })
  })

  for (const [variant, pageUrl] of [
    ['dialog()', `${url}?`],
    ['the default dialog', `${url}?default=1&`],
  ] as const)
    test(`renews a session whose access key expired at a load with no frame of a sign-in, with ${variant}`, async ({
      capture,
      code,
      email,
      page,
    }) => {
      // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
      await page.goto(`${pageUrl}expiry=15s`)
      const before = await enter(page, { code, email })

      await test.step('waits for the expiry of the access key', async () => {
        await expect
          .poll(() => Date.now() / 1000 > before.key.expiry, {
            timeout: 30_000,
          })
          .toBe(true)
        await capture('expired')
      })

      await test.step('renews the session at the next page load, with no frame', async () => {
        const requests = record(page)
        await page.goto(pageUrl)
        await expect(page.locator('#history')).toHaveText(
          'pending reauthorizing signedIn',
        )
        // The revocation of the expired session's refresh token runs beside the renewal, in no
        // order, and the page holds no request in flight once the preload's decision ran.
        await expect.poll(() => requests).toContain('POST /oauth2/revoke')
        await page.waitForLoadState('networkidle')
        expect(requests.toSorted()).toEqual([
          'POST /oauth2/revoke',
          'POST /v1/authorize',
        ])
        await capture('renewed')
      })
    })

  for (const [variant, pageUrl] of [
    ['dialog()', `${passive}&`],
    ['the default dialog', `${passive}&default=1&`],
  ] as const)
    test(`loads the frame of a sign-in for a session whose access key expired, with no authorization, with ${variant}`, async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(`${pageUrl}expiry=15s`)
      const before = await enter(page, { code, email })

      await test.step('waits for the expiry of the access key', async () => {
        await expect
          .poll(() => Date.now() / 1000 > before.key.expiry, {
            timeout: 30_000,
          })
          .toBe(true)
        await capture('expired')
      })

      await test.step('loads the frame at the next page load', async () => {
        // No authorization renews the session, so the next action shows a sign-in.
        const requests = record(page)
        await page.goto(pageUrl)
        await expect.poll(() => requests).toContain('GET /embed')
        await capture('preloaded')
      })
    })

  test('renews a held session whose access key expired, with no reload, and shows reauthorizing with no pending', async ({
    capture,
    code,
    email,
    page,
  }) => {
    // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
    await page.goto(`${url}?expiry=15s`)
    const before = await enter(page, { code, email })

    await test.step('shows signedOut at the expiry of the access key', async () => {
      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut',
        { timeout: 30_000 },
      )
      expect(Date.now() / 1000).toBeGreaterThan(before.key.expiry)
      await capture('expired')
    })

    await test.step('renews the held session with reauthorizing and no pending', async () => {
      const renewed = (
        await Playwright.run(page, { name: 'Mount a session reader' })
      ).value

      await expect(page.locator('#history')).toHaveText(
        'pending signedOut signedIn signedOut reauthorizing signedIn',
      )
      expect(renewed.email).toBe(email)
      expect(renewed.key.id).not.toBe(before.key.id)
      await capture('renewed')
    })
  })

  test('renews a session whose access key expired at a mount, and shows it meanwhile', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
    await page.goto(`${url}?expiry=15s`)
    const before = await enter(page, { code, email })

    await test.step('waits for the expiry of the access key', async () => {
      await expect
        .poll(() => Date.now() / 1000 > before.key.expiry, { timeout: 30_000 })
        .toBe(true)
      await capture('expired')
    })

    await test.step('authorizes a new access key at the next page load', async () => {
      // The page now requests an access key of a day, so the transfer below meets no expiry.
      await page.goto(url)

      await expect(page.locator('#history')).toHaveText(
        'pending reauthorizing signedIn',
      )
      const after = (await Playwright.run(page, { name: 'Session' })).value
      expect(after.email).toBe(email)
      expect(after.key.id).not.toBe(before.key.id)
      expect(after.key.expiry).toBeGreaterThan(before.key.expiry)
      await capture('renewed')
    })

    await test.step('sends OUSD with the new access key', async () => {
      await Chain.fund({ address: before.key.account })
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
  })
})
