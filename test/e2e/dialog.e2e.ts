/**
 * Tests the dialog page of the web test app: Tempo ID's sign-in in a frame on the app's page, the
 * ways that a sign-in ends without a session, the frame's lifecycle, and the access key that each
 * sign-in requests, which the node registers at its first transfer.
 * @module
 */
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The URL of the dialog page. */
const url = `${Apps.web.url}${Apps.web.paths.dialog}`

/** The error of a sign-in that the user closed. */
const closed = {
  message: 'The user closed the sign-in.',
  name: 'AbortError',
}

test.describe('dialog', () => {
  test('signs in through the dialog, sends OUSD with the access key, and signs out', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    await test.step('signs in on the Tempo ID page in the dialog', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await capture('dialog')
      await Playwright.signIn(await Playwright.dialog(page), { code, email })

      const session = await Playwright.outcome(page, { name: 'Sign in' })
      expect(session.value).toMatchObject({ email })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#email')).toHaveText(email)
      await Playwright.uncovered(page)
      await capture('signed in')
    })

    await test.step('sends OUSD with the access key, which the node registers', async () => {
      const account = await page.locator('#account').innerText()
      await Chain.fund({ address: account as `0x${string}` })
      const transfer = await Playwright.send(page, {
        amount: '1.5',
        to: recipient,
      })

      expect(transfer.value.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(
        await Chain.balance({ address: recipient, token: Chain.ousd }),
      ).toBe(1_500_000n)
      await capture('sent')
    })

    await test.step('signs out', async () => {
      expect(await Playwright.run(page, { name: 'Sign out' })).toMatchObject({
        state: 'fulfilled',
      })

      await expect(page.locator('#status')).toHaveText('signedOut')
      await expect(page.locator('#email')).toHaveCount(0)
      expect((await Playwright.run(page, { name: 'Session' })).value).toBeNull()
      await capture('signed out')
    })
  })

  test('rejects a sign-in that the user closes with Escape, or with a click outside the dialog', async ({
    capture,
    page,
  }) => {
    await page.goto(url)

    await test.step('closes the dialog with Escape', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.dialog(page)
      await capture('dialog')
      await page.keyboard.press('Escape')

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'rejected',
          value: closed,
        },
      )
      await Playwright.uncovered(page)
      await capture('closed by Escape')
    })

    await test.step('closes the dialog with a click outside it', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.dialog(page)
      await page.mouse.click(8, 8)

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'rejected',
          value: closed,
        },
      )
      await Playwright.uncovered(page)
      await capture('closed')
    })

    await test.step('holds no session', async () => {
      await expect(page.locator('#status')).toHaveText('signedOut')
      expect((await Playwright.run(page, { name: 'Session' })).value).toBeNull()
      await capture('no session')
    })
  })

  test('rejects a sign-in whose signal aborts, with the reason of the signal', async ({
    capture,
    page,
  }) => {
    await page.goto(url)

    await test.step('opens the dialog of a sign-in with a signal', async () => {
      await Playwright.start(page, { name: 'Sign in with a signal' })
      await Playwright.dialog(page)
      await capture('dialog')
    })

    await test.step('closes the dialog and rejects, once the signal aborts', async () => {
      await Playwright.abort(page)

      expect(
        await Playwright.outcome(page, { name: 'Sign in with a signal' }),
      ).toMatchObject({
        state: 'rejected',
        value: { message: 'The page ended the sign-in.', name: 'Error' },
      })
      await Playwright.uncovered(page)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('aborted')
    })
  })

  test('revokes the refresh token of a code that redeems after the signal aborts the sign-in', async ({
    capture,
    code,
    email,
    page,
    request,
  }) => {
    // A pushed request redeems its code on the page, which then holds the token response.
    await page.goto(`${url}?par=1`)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const issued = new Promise<{ clientId: string; refreshToken: string }>(
      (resolve) => {
        void page.route(`${TempoId.url}/oauth2/token`, async (route) => {
          const form = new URLSearchParams(route.request().postData() ?? '')
          const response = await route.fetch()
          const body = (await response.json()) as { refresh_token: string }
          resolve({
            clientId: form.get('client_id')!,
            refreshToken: body.refresh_token,
          })
          await held
          await route.fulfill({ json: body, response })
        })
      },
    )

    await test.step('signs in in the popup, and holds the redemption of the code', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.start(page, { name: 'Sign in with a signal' }),
      })
      await Playwright.signIn(window, { code, email })
      await issued
      await capture('redeeming')
    })

    await test.step('rejects at once when the signal aborts during the redemption', async () => {
      await Playwright.abort(page)

      expect(
        await Playwright.outcome(page, { name: 'Sign in with a signal' }),
      ).toMatchObject({
        state: 'rejected',
        value: { message: 'The page ended the sign-in.', name: 'Error' },
      })
      await capture('aborted')
    })

    await test.step('revokes the refresh token of the redemption, and keeps no session', async () => {
      const tokens = await issued
      // The response, not the request, shows that Tempo ID revoked the refresh token.
      const revoked = page.waitForResponse(`${TempoId.url}/oauth2/revoke`)
      release()
      expect((await revoked).ok()).toBe(true)

      const refreshed = await request.post(`${TempoId.url}/oauth2/token`, {
        form: {
          client_id: tokens.clientId,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        },
      })
      expect(refreshed.status()).toBe(400)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('revoked')
    })
  })

  test('loads the frame before a sign-in, and signs in without it with `preload: false`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await test.step('holds a hidden frame of Tempo ID before the click', async () => {
      await page.goto(url)

      await expect(Playwright.frame(page)).toHaveAttribute(
        'src',
        new RegExp(`^${TempoId.url}/embed`),
      )
      await Playwright.uncovered(page)
      await capture('hidden frame')
    })

    await test.step('holds no frame with `preload: false`', async () => {
      await page.goto(`${url}?preload=0`)
      await expect(page.locator('#status')).toHaveText('signedOut')

      await expect(Playwright.frame(page)).toHaveCount(0)
      await capture('no frame')
    })

    await test.step('signs in with a frame that loads at the click', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await capture('signed in')
    })
  })

  test('signs a message in the frame for an instance with `resource`', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const message = 'Sign in to the web test app'
    const key = await Web.enter_dialog(page, {
      capture,
      code,
      email,
      fund: false,
    })
    await page.goto(
      Web.url({
        instanceResource: Apps.mcp.resource,
        message,
        path: Apps.web.paths.dialog,
      }),
    )
    await expect(page.locator('#status')).toHaveText('signedIn')

    await test.step('signs the message in the frame, since the signature keeps no token', async () => {
      await Playwright.start(page, { name: 'Sign a message' })
      await Playwright.approve(await Playwright.dialog(page))

      expect(
        await Playwright.outcome(page, { name: 'Sign a message' }),
      ).toMatchObject({
        state: 'fulfilled',
        value: { address: key.account, message },
      })
      await capture('signed')
    })
  })

  test('signs in twice in the one frame that the page loads', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const loads: string[] = []
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.url().startsWith(`${TempoId.url}/embed`)
      )
        loads.push(request.url())
    })
    await page.goto(url)
    // The page holds its frame before the sign-in, which shows it.
    await expect(Playwright.frame(page)).toHaveAttribute(
      'src',
      new RegExp(`^${TempoId.url}/embed`),
    )

    await test.step('signs in, and signs out', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), { code, email })
      const first = await Playwright.outcome(page, { name: 'Sign in' })
      expect(first.value).toMatchObject({ email })
      expect(await Playwright.run(page, { name: 'Sign out' })).toMatchObject({
        state: 'fulfilled',
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })

    await test.step('approves the next sign-in, with no code, for a new access key', async () => {
      const first = await Playwright.outcome(page, { name: 'Sign in' })
      await Playwright.start(page, { name: 'Sign in' })
      const target = await Playwright.dialog(page)
      await capture('approval')
      await Playwright.approve(target)

      await expect(page.locator('#status')).toHaveText('signedIn')
      const second = await Playwright.outcome(page, { name: 'Sign in' })
      expect(second).toMatchObject({ state: 'fulfilled', value: { email } })
      expect(second.value.key.id).not.toBe(first.value.key.id)
      await capture('signed in again')
    })

    expect(loads).toHaveLength(1)
  })

  test('loads one frame for a sign-in that starts while the page restores its session', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const loads: string[] = []
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.url().startsWith(`${TempoId.url}/embed`)
      )
        loads.push(request.url())
    })
    // The restore reads the browser's session at Tempo ID, which waits here until the sign-in shows.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`${TempoId.url}/v1/auth/session*`, async (route) => {
      await held
      await route.continue()
    })

    await test.step('signs in before the restore settles', async () => {
      await page.goto(url)
      await expect(page.locator('#status')).toHaveText('pending')
      await Playwright.start(page, { name: 'Sign in' })
      const target = await Playwright.dialog(page)
      release()
      await expect(page.locator('#status')).toHaveText('signedOut')
      await Playwright.signIn(target, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        { state: 'fulfilled', value: { email } },
      )
      await capture('signed in')
    })

    await test.step('keeps the sign-in’s frame for the next one', async () => {
      expect(await Playwright.run(page, { name: 'Sign out' })).toMatchObject({
        state: 'fulfilled',
      })
      await expect(page.locator('#status')).toHaveText('signedOut')
      await expect(Playwright.frame(page)).toHaveCount(1)
      await capture('signed out')
    })

    expect(loads).toHaveLength(1)
  })

  test('closes a pending sign-in when another tab signs out', async ({
    capture,
    code,
    context,
    email,
    page,
  }) => {
    await page.goto(url)

    await test.step('signs in on the Tempo ID page in the dialog', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.signIn(await Playwright.dialog(page), { code, email })

      expect(
        (await Playwright.outcome(page, { name: 'Sign in' })).value,
      ).toMatchObject({ email })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })

    const other = await context.newPage()
    await test.step('opens a second sign-in, and restores the session in another tab', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.dialog(page)
      await other.goto(url)

      await expect(other.locator('#status')).toHaveText('signedIn')
      await capture('sign-in pending')
    })

    await test.step('signs out in the other tab, which ends the pending sign-in', async () => {
      expect(await Playwright.run(other, { name: 'Sign out' })).toMatchObject({
        state: 'fulfilled',
      })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'rejected',
          value: {
            message:
              'Another sign-in or a sign-out completed while this sign-in was pending. Sign in again.',
            name: 'Accounts.SupersededError',
          },
        },
      )
      await Playwright.uncovered(page)
      await expect(page.locator('#status')).toHaveText('signedOut')
      await capture('signed out')
    })
  })

  test('shows the dialog as a bottom sheet on a narrow screen', async ({
    capture,
    code,
    email,
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 })
    await page.goto(url)

    const target =
      await test.step('shows the dialog along the bottom of the screen', async () => {
        await Playwright.start(page, { name: 'Sign in' })
        const target = await Playwright.dialog(page)
        const box = await Playwright.prompt(page).boundingBox()

        expect(box).toMatchObject({ width: 390, x: 0 })
        expect(box!.y + box!.height).toBe(844)
        await capture('bottom sheet')
        return target
      })

    await test.step('signs in in the sheet', async () => {
      await Playwright.signIn(target, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })
  })

  test('offers a popup when the frame fails to load, and signs in there', async ({
    capture,
    code,
    email,
    errors,
    page,
  }) => {
    await page.route(`${TempoId.url}/embed**`, (route) => route.abort())
    await page.goto(url)

    await test.step('offers a popup in place of the frame', async () => {
      await Playwright.start(page, { name: 'Sign in' })

      await expect(Playwright.prompt(page)).toContainText(
        'Sign in with Tempo in a new window.',
      )
      await capture('offer')
    })

    await test.step('signs in on the Tempo ID page in the popup', async () => {
      const window = await Playwright.popup(page, {
        open: () => Playwright.choose(page, { name: 'Continue' }),
      })
      await Playwright.signIn(window, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      await expect(page.locator('#status')).toHaveText('signedIn')
      await capture('signed in')
    })

    // The browser logs the load that the test aborted.
    errors.splice(0)
  })

  test('pushes the request of a sign-in with `par`, and signs in in a popup', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const pushed: string[] = []
    page.on('request', (request) => {
      if (request.url() === `${TempoId.url}/oauth2/par`)
        pushed.push(request.method())
    })
    await page.goto(`${url}?par=1`)

    await test.step('loads no frame before the sign-in', async () => {
      await expect(page.locator('#status')).toHaveText('signedOut')
      await expect(Playwright.frame(page)).toHaveCount(0)
      await capture('no frame')
    })

    const window =
      await test.step('opens a popup with the pushed request', async () => {
        const window = await Playwright.popup(page, {
          open: () => Playwright.start(page, { name: 'Sign in' }),
        })
        await window.waitForURL(/request_uri=/)
        await capture('popup', window)
        return window
      })

    await test.step('signs in in the popup, after one push', async () => {
      await Playwright.signIn(window, { code, email })

      expect(await Playwright.outcome(page, { name: 'Sign in' })).toMatchObject(
        {
          state: 'fulfilled',
          value: { email },
        },
      )
      expect(pushed).toEqual(['POST'])
      await capture('signed in')
    })
  })

  test('signs in without an access key, then adds one with a second sign-in', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    await test.step('holds a session without an access key', async () => {
      await Playwright.start(page, { name: 'Sign in without an access key' })
      await Playwright.signIn(await Playwright.dialog(page), { code, email })

      expect(
        await Playwright.outcome(page, {
          name: 'Sign in without an access key',
        }),
      ).toMatchObject({ state: 'fulfilled', value: { email, key: null } })
      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#account')).toHaveCount(0)
      await capture('without an access key')
    })

    await test.step('holds an access key after a sign-in that requests one', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.approve(await Playwright.dialog(page))

      await expect(page.locator('#account')).toBeVisible()
      const session = await Playwright.outcome(page, { name: 'Sign in' })
      expect(session.value.key.id).toMatch(/^0x[0-9a-f]{40}$/i)
      await capture('with an access key')
    })

    await test.step('sends OUSD with the access key', async () => {
      const account = await page.locator('#account').innerText()
      await Chain.fund({ address: account as `0x${string}` })
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

  test('requests the access key of the call in place of the instance’s', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    await page.goto(url)

    const key =
      await test.step('signs in with the limit of the call', async () => {
        await Playwright.start(page, { name: 'Sign in with a limit of 5' })
        await Playwright.signIn(await Playwright.dialog(page), { code, email })

        const session = await Playwright.outcome(page, {
          name: 'Sign in with a limit of 5',
        })
        expect(session.state).toBe('fulfilled')
        await capture('signed in')
        return session.value.key
      })

    await test.step('sends 1 OUSD, and the node holds the rest of the limit of 5', async () => {
      await Chain.fund({ address: key.account })
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      // The fee of the transfer spends the limit too, so less than 4 OUSD remains of the 5.
      const remaining = await Chain.remaining({
        accessKey: key.id,
        address: key.account,
        token: Chain.ousd,
      })
      expect(remaining).toBeLessThan(4_000_000n)
      expect(remaining).toBeGreaterThan(3_900_000n)
      await capture('sent')
    })
  })

  test('centers the dialog on a page whose CSS reset removes every margin', async ({
    capture,
    page,
  }) => {
    await page.goto(url)
    // A reset of this shape, such as Tailwind's preflight, overrides the browser's margin of a modal dialog.
    await page.addStyleTag({
      content: '@layer reset { *, ::backdrop { margin: 0; } }',
    })

    await test.step('opens the dialog in the middle of the viewport', async () => {
      await Playwright.start(page, { name: 'Sign in' })
      await Playwright.dialog(page)

      const box = await page
        .locator('dialog[data-tempo-id-dialog][open]:not([data-closing])')
        .boundingBox()
      const viewport = page.viewportSize()
      expect(box).not.toBeNull()
      expect(viewport).not.toBeNull()
      if (!box || !viewport) return
      expect(Math.round(box.x * 2 + box.width)).toBe(viewport.width)
      expect(Math.round(box.y * 2 + box.height)).toBe(viewport.height)
      await capture('centered')
    })
  })
})
