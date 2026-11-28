/**
 * Tests the redirect page of the web test app: a sign-in that leaves the page for Tempo ID's sign-in
 * and returns to it, the renewal of its access key, the callbacks that the page refuses, and the
 * state that the return needs. Also tests the open page, whose `open` shows the sign-in in a window
 * in place of a system browser.
 * @module
 */
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'

/** The URL of the redirect page, which is its redirect URI. */
const url = `${Apps.web.url}${Apps.web.paths.redirect}`

/** The URL of the open page. */
const openUrl = `${Apps.web.url}${Apps.web.paths.open}`

test.describe('redirect', () => {
  test('signs in on Tempo ID’s page, returns, and sends OUSD with the access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    await test.step('leaves the page for Tempo ID’s sign-in', async () => {
      await Playwright.start(page, { name: 'Sign in' })

      await page.waitForURL(`${TempoId.url}/**`)
      await capture('Tempo ID')
    })

    await test.step('returns with a code, which the page redeems and removes', async () => {
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.url().startsWith(`${url}?`),
      )
      await Playwright.signIn(page, { code, email })
      expect(new URL((await returned).url()).searchParams.has('code')).toBe(
        true,
      )

      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#email')).toHaveText(email)
      expect(page.url()).toBe(url)
      await capture('signed in')
    })

    await test.step('sends OUSD with the access key, which the node registers', async () => {
      const account = await page.locator('#account').innerText()
      await Chain.fund({ address: account as `0x${string}` })
      const transfer = await Playwright.send(page, {
        amount: '3',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(3_000_000n)
      await capture('sent')
    })
  })

  test('renews an access key that only the sign-in named for the lifetime that the sign-in requested', async ({
    capture,
    code,
    email,
    page,
  }) => {
    // Tempo ID refuses an expiry that passed, so the expiry leaves time for a slow sign-in.
    await page.goto(`${url}?expiry=15s&signInKey=1`)

    const before =
      await test.step('signs in after a time on Tempo ID’s page', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        await page.waitForURL(`${TempoId.url}/**`)
        // The user reads Tempo ID's page before the sign-in, which the access key's lifetime excludes.
        const left = Date.now()
        await expect
          .poll(() => Date.now() - left, { timeout: 10_000 })
          .toBeGreaterThan(5_000)
        await Playwright.signIn(page, { code, email })

        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('signed in')
        return (await Playwright.run(page, { name: 'Session' })).value
      })

    await test.step('waits for the expiry of the access key', async () => {
      await expect
        .poll(() => Date.now() / 1000 > before.key.expiry, { timeout: 30_000 })
        .toBe(true)
      await capture('expired')
    })

    await test.step('renews the access key for 15 seconds at the next page load', async () => {
      const renewal = page.waitForRequest(
        (request) => request.url() === `${TempoId.url}/v1/authorize`,
      )
      await page.goto(`${url}?signInKey=1`)
      const request = await renewal
      await request.response()

      await expect(page.locator('#history')).toHaveText(
        'pending reauthorizing signedIn',
      )
      const { expiry } = request.postDataJSON().key_authorization
      // The page reads its clock in whole seconds before the request starts.
      const lifetime = expiry - Math.floor(request.timing().startTime / 1000)
      expect(lifetime).toBeGreaterThanOrEqual(14)
      expect(lifetime).toBeLessThanOrEqual(15)
      await capture('renewed')
    })
  })

  test('drops a code that the page did not request', async ({
    capture,
    page,
  }) => {
    const exchanges: string[] = []
    page.on('request', (request) => {
      if (request.url() === `${TempoId.url}/oauth2/token`)
        exchanges.push(request.method())
    })

    await test.step('removes the code from the URL, and redeems nothing', async () => {
      await page.goto(`${url}?code=forged&state=forged`)

      await expect(page.locator('#status')).toHaveText('signedOut')
      expect(page.url()).toBe(url)
      expect(exchanges).toEqual([])
      expect((await Playwright.run(page, { name: 'Session' })).value).toBeNull()
      await capture('signed out')
    })
  })

  test('drops a code with Tempo ID as its issuer that the page did not request, and keeps the session', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const exchanges: string[] = []
    page.on('request', (request) => {
      if (request.url() === `${TempoId.url}/oauth2/token`)
        exchanges.push(request.method())
    })
    await page.goto(url)

    await test.step('signs in', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })

    await test.step('removes the crafted code from the URL, redeems nothing, and keeps the session', async () => {
      exchanges.length = 0
      // A crafted link names Tempo ID as its issuer, but this tab started no redirect of its state.
      await page.goto(
        `${url}?code=crafted&state=crafted&iss=${encodeURIComponent(TempoId.url)}`,
      )

      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#email')).toHaveText(email)
      await expect(page.locator('#failure')).toHaveCount(0)
      expect(page.url()).toBe(url)
      expect(exchanges).toEqual([])
      await capture('session stays')
    })
  })

  test('refuses a store in memory before it leaves the page, since the page load at the return empties it', async ({
    capture,
    page,
  }) => {
    // The page reads its session from Tempo ID, but a sign-in starts at `/oauth2/`.
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith(`${TempoId.url}/oauth2/`))
        requests.push(request.url())
    })
    await page.goto(url)
    await page.evaluate(() =>
      sessionStorage.setItem('tempo-id-test:store', 'memory'),
    )
    await page.reload()

    await test.step('throws invalid_request at the sign-in, and stays on the page', async () => {
      expect(await Playwright.run(page, { name: 'Sign in' })).toMatchObject({
        state: 'rejected',
        value: {
          code: 'invalid_request',
          message:
            'Invalid store: it holds its values only in this page, and the redirect leaves the page. Keep the state in a store that persists across page loads, such as the default.',
          name: 'Accounts.RequestError',
          status: 0,
        },
      })
      expect(page.url()).toBe(url)
      expect(requests).toEqual([])
      await capture('refused')
    })
  })

  test('throws at the return of a redirect whose state a custom store lost at the page load, and redeems nothing', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const exchanges: string[] = []
    page.on('request', (request) => {
      if (request.url() === `${TempoId.url}/oauth2/token`)
        exchanges.push(request.method())
    })
    await page.goto(url)
    await page.evaluate(() =>
      sessionStorage.setItem('tempo-id-test:store', 'lossy'),
    )
    await page.reload()

    await test.step('leaves the page for Tempo ID’s sign-in', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await page.waitForURL(`${TempoId.url}/**`)
      await capture('Tempo ID')
    })

    await test.step('throws invalid_request at the return, and removes the code from the URL', async () => {
      await Playwright.signIn(page, { code, email })

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'invalid_request',
        message:
          'Missing sign-in: the store holds no state of this redirect, or it expired. Keep the state in a store that persists across page loads, and start sign-in again.',
        name: 'Accounts.RequestError',
        status: 400,
      })
      expect(page.url()).toBe(url)
      expect(exchanges).toEqual([])
      await capture('refused')
    })
  })

  test('redeems the code once when a duplicate of the tab returns from the same redirect at once, with Store.redis', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const exchanges: string[] = []
    page.context().on('request', (request) => {
      if (request.url() === `${TempoId.url}/oauth2/token`)
        exchanges.push(request.method())
    })
    await page.goto(`${url}?accessKey=false`)
    await page.evaluate(() =>
      sessionStorage.setItem('tempo-id-test:store', 'redis'),
    )
    await page.reload()

    await test.step('leaves the page for Tempo ID’s sign-in', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await page.waitForURL(`${TempoId.url}/**`)
      await capture('Tempo ID')
    })

    const duplicate =
      await test.step('holds the return, and duplicates the tab with its sessionStorage', async () => {
        // An empty document holds the return, so the tab keeps the callback URL and its own mark.
        await page.route(`${url}?*`, (route) =>
          route.fulfill({
            body: '<!doctype html><link href="data:," rel="icon">',
            contentType: 'text/html',
          }),
        )
        await Playwright.signIn(page, { code, email })
        await page.waitForURL(`${url}?*`)
        await page.unroute(`${url}?*`)
        const items = await page.evaluate(() => Object.entries(sessionStorage))
        const duplicate = await page.context().newPage()
        await duplicate.addInitScript((items) => {
          for (const [key, value] of items) sessionStorage.setItem(key, value)
        }, items)
        await capture('held')
        return duplicate
      })

    await test.step('loads the return in both tabs at once, and redeems the code in one', async () => {
      await Promise.all([page.reload(), duplicate.goto(page.url())])

      const outcome = async (tab: typeof page) => {
        if (await tab.locator('#failure').count())
          return (await Playwright.failure(tab)).code
        if (await tab.locator('#status').count())
          return tab.locator('#status').innerText()
        return undefined
      }
      await expect
        .poll(async () =>
          (await Promise.all([page, duplicate].map(outcome))).sort((a, b) =>
            String(a).localeCompare(String(b)),
          ),
        )
        .toEqual(['invalid_request', 'signedIn'])
      expect(exchanges).toEqual(['POST'])
      await capture('redeemed once')
    })
  })

  test('throws the denial at the return of a redirect whose state a custom store lost at the page load, and removes it from the URL', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
    })

    await page.evaluate(() =>
      sessionStorage.setItem('tempo-id-test:store', 'lossy'),
    )
    await page.reload()

    await test.step('throws access_denied at the return, removes the refusal from the URL, and authorizes no other way', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      const authorizations: string[] = []
      page.on('request', (request) => {
        if (request.url() === `${TempoId.url}/v1/authorize`)
          authorizations.push(request.method())
      })
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.url().startsWith(`${url}?`),
      )
      await Playwright.deny(page)
      await returned

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'access_denied',
        name: 'Accounts.RequestError',
        status: 0,
      })
      expect(page.url()).toBe(url)
      expect(authorizations).toEqual([])
      await capture('refused')
    })
  })

  test('throws the denial at the return of a redirect that a custom store lost only to the instance that started it, also beside an instance of the app on another chain', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
    })

    await page.evaluate(() => {
      sessionStorage.setItem('tempo-id-test:second', 'lossy')
      sessionStorage.setItem('tempo-id-test:store', 'lossy')
    })
    await page.reload()

    await test.step('denies the sign-in, which the second instance leaves to the first', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.url().startsWith(`${url}?`),
      )
      await Playwright.deny(page)
      await returned

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'access_denied',
        name: 'Accounts.RequestError',
        status: 0,
      })
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('tempo-id-test:second-outcome'),
        ),
      ).toBe('signedOut')
      await capture('refused')
    })
  })

  test('throws the denial at the return of a redirect that a custom store lost with the chain that `switchChain` selected', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
    })

    await page.evaluate(() =>
      sessionStorage.setItem('tempo-id-test:store', 'lossy'),
    )
    await page.reload()

    await test.step('selects the second chain, then denies the sign-in', async () => {
      await Playwright.run(page, { name: 'Switch to the second chain' })
      await Playwright.start(page, { name: 'Sign in' })
      const authorizations: string[] = []
      page.on('request', (request) => {
        if (request.url() === `${TempoId.url}/v1/authorize`)
          authorizations.push(request.method())
      })
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.url().startsWith(`${url}?`),
      )
      await Playwright.deny(page)
      await returned

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'access_denied',
        name: 'Accounts.RequestError',
        status: 0,
      })
      expect(page.url()).toBe(url)
      expect(authorizations).toEqual([])
      await capture('refused')
    })
  })

  test("throws the denial at the return of a redirect whose state a custom store lost, and keeps the redirect URI's own `error`", async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
    })

    await page.evaluate(() => {
      sessionStorage.setItem(
        'tempo-id-test:redirect-query',
        '?error=app_notice',
      )
      sessionStorage.setItem('tempo-id-test:store', 'lossy')
    })
    await page.reload()

    await test.step("throws access_denied at the return, and keeps the app's own `error` in the URL", async () => {
      await Playwright.start(page, { name: 'Sign in' })
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          request.url().startsWith(`${url}?error=app_notice&`),
      )
      await Playwright.deny(page)
      await returned

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'access_denied',
        name: 'Accounts.RequestError',
        status: 0,
      })
      expect(page.url()).toBe(`${url}?error=app_notice`)
      await capture('refused')
    })
  })

  test('throws the refusal of a sign-in that the user denies, once', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in, then signs out of the app alone', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out of the app')
    })

    let callback = ''
    await test.step('throws the refusal from `useSession` at the return', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      const returned = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.url().startsWith(`${url}?`),
      )
      await capture('approval')
      await Playwright.deny(page)
      callback = (await returned).url()

      expect(new URL(callback).searchParams.get('error')).toBe('access_denied')
      expect(await Playwright.failure(page)).toMatchObject({
        code: 'access_denied',
        name: 'Accounts.RequestError',
        status: 0,
      })
      expect(page.url()).toBe(url)
      await capture('refused')
    })

    await test.step('holds no state of the redirect after the refusal', async () => {
      await page.goto(callback)

      await expect(page.locator('#status')).toHaveText('signedOut')
      await expect(page.locator('#failure')).toHaveCount(0)
      await capture('signed out')
    })
  })

  test('prefetches the assets of Tempo ID’s sign-in page once', async ({
    capture,
    page,
  }) => {
    await page.goto(url)
    const links = page.locator('link[rel="prefetch"]')
    await expect(links).toHaveCount(0)

    const assets =
      await test.step('adds a prefetch link per asset of Tempo ID', async () => {
        const first = await Playwright.run(page, { name: 'Prefetch' })
        const assets = first.value as readonly string[]

        expect(assets.length).toBeGreaterThan(0)
        for (const asset of assets)
          expect(new URL(asset).origin).toBe(TempoId.url)
        await expect(links).toHaveCount(assets.length)
        await capture('prefetched')
        return assets
      })

    await test.step('adds no link at a second prefetch', async () => {
      expect((await Playwright.run(page, { name: 'Prefetch' })).value).toEqual(
        assets,
      )
      await expect(links).toHaveCount(assets.length)
      await capture('prefetched again')
    })
  })

  test('completes a return in a tab that did not start the sign-in', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    await page.goto(url)

    // The tab that starts the sign-in keeps the verifier in its `sessionStorage`, and the origin's
    // IndexedDB keeps the redirect's state.
    const authorize =
      await test.step('starts the sign-in in the first tab', async () => {
        const requested = page.waitForRequest((request) =>
          request.url().startsWith(`${TempoId.url}/oauth2/authorize?`),
        )
        await Playwright.start(page, { name: 'Sign in' })
        const authorize = (await requested).url()
        await page.waitForURL(`${TempoId.url}/**`)
        await capture('first tab')
        return authorize
      })

    await test.step('signs in and returns in a second tab', async () => {
      const tab = await context.newPage()
      await tab.goto(authorize)
      await Playwright.signIn(tab, { code, email })

      await expect(tab.locator('#status')).toHaveText('signedIn')
      await expect(tab.locator('#email')).toHaveText(email)
      expect(tab.url()).toBe(url)
      await capture('second tab', tab)
    })
  })

  test('refuses a return whose redirect another tab completed, and revokes the tokens of its code', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      const { origin, pathname } = new URL(request.url())
      if (origin === TempoId.url && pathname.startsWith('/oauth2/'))
        requests.push(`${request.method()} ${pathname}`)
    })
    await page.goto(url)

    const authorize =
      await test.step('starts the sign-in in the first tab', async () => {
        const requested = page.waitForRequest((request) =>
          request.url().startsWith(`${TempoId.url}/oauth2/authorize?`),
        )
        await Playwright.start(page, { name: 'Sign in' })
        const authorize = (await requested).url()
        await page.waitForURL(`${TempoId.url}/**`)
        await capture('first tab')
        return authorize
      })

    const tab =
      await test.step('signs in and returns in a second tab, which removes the state of the redirect', async () => {
        const tab = await context.newPage()
        await tab.goto(authorize)
        await Playwright.signIn(tab, { code, email })

        await expect(tab.locator('#status')).toHaveText('signedIn')
        await capture('second tab', tab)
        return tab
      })

    await test.step('throws a refusal at the return of the first tab, whose code its verifier redeemed', async () => {
      requests.length = 0
      // The browser holds a Tempo ID session, so the request of the first tab needs only an approval.
      await page.goto(authorize)
      await Playwright.approve(page)

      expect(await Playwright.failure(page)).toMatchObject({
        code: 'invalid_request',
        name: 'Accounts.RequestError',
        status: 400,
      })
      expect(page.url()).toBe(url)
      // The page revokes the refresh token of its code, then the one of the session that the
      // refusal ends.
      await expect
        .poll(() => requests.filter((request) => request.startsWith('POST')))
        .toEqual([
          'POST /oauth2/token',
          'POST /oauth2/revoke',
          'POST /oauth2/revoke',
        ])
      await capture('refused')
    })

    await test.step('ends the session of the second tab, as each refusal after a sign-in does', async () => {
      await expect(tab.locator('#status')).toHaveText('signedOut')
      await capture('second tab signed out', tab)
    })
  })

  test('keeps the session at a copy of a completed callback, whose code Tempo ID refuses', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    // A browser copies the `sessionStorage` of a tab to its duplicate, so the duplicate of a
    // callback's tab holds the verifier of the redirect. The origin's `localStorage` carries it here.
    await page.addInitScript(() => {
      const ticket = sessionStorage.getItem('tempo-id:redirect')
      if (ticket) localStorage.setItem('ticket', ticket)
    })
    await page.goto(url)

    const callback =
      await test.step('signs in and returns in the first tab, which redeems the code', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const returned = page.waitForRequest(
          (request) =>
            request.isNavigationRequest() &&
            request.url().startsWith(`${url}?`),
        )
        await Playwright.signIn(page, { code, email })
        const callback = (await returned).url()

        await expect(page.locator('#status')).toHaveText('signedIn')
        await capture('first tab')
        return callback
      })

    const tab =
      await test.step('redeems the code again in a copy of the callback, which Tempo ID refuses', async () => {
        const tab = await context.newPage()
        const responses: string[] = []
        tab.on('response', (response) => {
          const { origin, pathname } = new URL(response.url())
          if (origin === TempoId.url && pathname.startsWith('/oauth2/'))
            responses.push(
              `${response.request().method()} ${pathname} ${response.status()}`,
            )
        })
        await tab.addInitScript(() => {
          const ticket = localStorage.getItem('ticket')
          if (ticket && location.search.includes('code='))
            sessionStorage.setItem('tempo-id:redirect', ticket)
        })
        await tab.goto(callback)

        await expect.poll(() => responses).toEqual(['POST /oauth2/token 400'])
        expect(tab.url()).toBe(url)
        await capture('refused exchange', tab)
        return tab
      })

    await test.step('keeps the session of the first tab in both tabs, with no failure', async () => {
      await expect(tab.locator('#status')).toHaveText('signedIn')
      await expect(tab.locator('#email')).toHaveText(email)
      await expect(tab.locator('#failure')).toHaveCount(0)
      await capture('copy', tab)

      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('first tab signed in')
    })
  })

  test('approves a second sign-in with no code', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(url)

    const first = await test.step('signs in with a code', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })

      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
      return (await Playwright.run(page, { name: 'Session' })).value
    })

    await test.step('leaves for Tempo ID at the second sign-in', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await page.waitForURL(`${TempoId.url}/**`)
      await capture('approval')
    })

    await test.step('approves with no code, and returns with another access key', async () => {
      await Playwright.approve(page)

      await expect(page.locator('#status')).toHaveText('signedIn')
      const second = (await Playwright.run(page, { name: 'Session' })).value
      expect(second.email).toBe(email)
      expect(second.key.id).not.toBe(first.key.id)
      await capture('signed in again')
    })
  })

  test('revokes its own access key with no page and no `tempo-id:sign`, then signs out, and signs in with a new access key', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      const { origin, pathname } = new URL(request.url())
      if (origin === TempoId.url && pathname.includes('access-keys'))
        requests.push(`${request.method()} ${pathname}`)
    })
    await page.goto(url)

    const first = await test.step('signs in with a code', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(page, { code, email })

      await expect(page.locator('#status')).toHaveText('signedIn')
      const session = (await Playwright.run(page, { name: 'Session' })).value
      await Chain.fund({ address: session.key.account })
      await capture('signed in')
      return session
    })

    await test.step('revokes the access key with the session’s access token', async () => {
      const revocation = await Playwright.run(page, {
        name: 'Revoke the access key without a dialog',
      })

      expect(revocation).toMatchObject({
        state: 'fulfilled',
        value: { transactionHash: expect.stringMatching(/^0x/) },
      })
      expect(requests).toEqual(['POST /v1/access-keys/revoke'])
      expect(
        await Chain.accessKey({
          accessKey: first.key.id,
          address: first.key.account,
        }),
      ).toMatchObject({ isRevoked: true })
      await capture('revoked')
    })

    await test.step('signs out, and signs in again with a new access key', async () => {
      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await Playwright.start(page, { name: 'Sign in' })
      await page.waitForURL(`${TempoId.url}/**`)
      await Playwright.approve(page)

      await expect(page.locator('#status')).toHaveText('signedIn')
      const second = (await Playwright.run(page, { name: 'Session' })).value
      expect(second.key.id).not.toBe(first.key.id)
      await capture('signed in again')
    })
  })
})

test.describe('redirect with `open`', () => {
  test('signs in on the page that `open` shows, and returns the session', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.goto(openUrl)

    const window =
      await test.step('shows Tempo ID’s page in the window of `open`', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await window.waitForURL(`${TempoId.url}/**`)
        await capture('Tempo ID', window)
        return window
      })

    await test.step('returns the session to the page, which did not leave', async () => {
      await Playwright.signIn(window, { code, email })

      const session = await Playwright.outcome(page, { name: 'Sign in' })
      expect(session).toMatchObject({ state: 'fulfilled', value: { email } })
      expect(session.value.key.id).toMatch(/^0x[0-9a-fA-F]{40}$/)
      await expect(page.locator('#status')).toHaveText('signedIn')
      expect(page.url()).toBe(openUrl)
      await capture('signed in')
    })
  })

  test('returns no session when `open` resolves with no URL', async ({
    capture,
    page,
  }) => {
    await page.goto(openUrl)

    await test.step('opens the window of a sign-in, which the user closes', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await window.waitForURL(`${TempoId.url}/**`)
      await capture('Tempo ID', window)
      await window.close()
      await capture('window closed')
    })

    await test.step('resolves with no session, once `open` returns no URL', async () => {
      await Playwright.run(page, { name: 'Dismiss' })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
        state: 'fulfilled',
        value: null,
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })
  })

  test('asks the user to sign in again at the first sign-in after a sign-out', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    const prompts: (string | null)[] = []
    context.on('request', (request) => {
      if (request.url().startsWith(`${TempoId.url}/oauth2/authorize?`))
        prompts.push(new URL(request.url()).searchParams.get('prompt'))
    })
    await page.goto(openUrl)

    await test.step('signs in, then signs out of the app alone', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await Playwright.signIn(window, { code, email })
      await expect(page.locator('#status')).toHaveText('signedIn')

      await Playwright.run(page, { name: 'Sign out' })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out of the app')
    })

    await test.step('requests `prompt=login`, so Tempo ID’s session signs nobody in', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await expect(Playwright.form(window)).toBeVisible()
      await capture('sign-in form', window)
      await Playwright.signIn(window, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      expect(prompts).toEqual([null, 'login'])
      await capture('signed in again')
    })

    await test.step('requests no prompt at the sign-in after it', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in' }),
      })
      await expect.poll(() => Playwright.screen(window)).toBe('approval')
      await capture('approval', window)
      await Playwright.approve(window)

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      expect(prompts).toEqual([null, 'login', null])
      await capture('signed in with no prompt')
    })
  })
})
