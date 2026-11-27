/**
 * Extends Playwright's `test` with a new address per test, the inbox's sign-in codes, and screenshots
 * for the report. A test fails if its page logs a console error or throws. `approve`, `deny`,
 * `deposit`, `device`, `form`, `frame`, `funding`, `grant`, `guest`, `payment`, `prompt`, and `revoke` hold the
 * suite's only selectors of the package's dialog and of Tempo ID's own pages, beside `dialog` and
 * `signIn`, which `accounts/test/playwright` exports. `abort`, `call`, `calls`,
 * `issue`, `outcome`, `run`, `send`, `signIn_custom`, `start`, and `submit` drive the controls of a
 * test app's page, each of which runs one action and shows what it returned or threw.
 * `authenticator` adds a virtual authenticator to a page, which holds the passkeys of a test. The
 * `tempoApi` fixture starts the Tempo API for the tests that take it.
 * @module
 */
import {
  test as base,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from '@playwright/test'
import * as TestPlaywright from 'accounts/test/playwright'
import { Json } from 'ox'
import * as TempoApi from './TempoApi.js'
import * as TempoId from './TempoId.js'

export { expect }
export { dialog, signIn } from 'accounts/test/playwright'

/** One call of a transaction: the contract, and the selector with its arguments. */
export type Call = {
  /** The call's data. */
  data: `0x${string}`
  /** The contract that receives the call. */
  to: `0x${string}`
}

/** Returns the sign-in code that the inbox holds for an address, once its message arrives. */
export type Code = (email: string) => Promise<string>

/** What an action of a test app's page returned or threw, as the page shows it. */
export type Outcome = {
  /** Whether the action returned or threw. */
  state: 'fulfilled' | 'rejected'
  /** The result, or the fields of the error: `name`, `message`, `reason`, `code`, and `status`. */
  // The value is the page's JSON, whose shape each action defines.
  // oxlint-disable-next-line no-explicit-any
  value: any
}

/** Playwright's `test`, with the suite's fixtures. */
export const test = base.extend<
  {
    /**
     * Adds a screenshot to the report under `name`, as proof of a step: of the test's page, or of
     * `target`, such as a second tab.
     */
    capture: (name: string, target?: Page) => Promise<void>
    /** Returns the sign-in code that the inbox holds for `email`, once its message arrives. */
    code: Code
    /** A new address under `example.org`, unique to the test, so each test has its own user. */
    email: string
    /** The page's console errors and exceptions. A test removes the ones it expects. */
    errors: string[]
  },
  {
    /**
     * Starts the suite's Tempo API for the worker of the tests that take the fixture, and stops it
     * after them. Each such test carries `TempoApi.tag`, and their `describe` runs in one worker, since
     * the API serves on one port.
     */
    tempoApi: void
  }
>({
  capture: async ({ page }, use, info) => {
    await use(async (name, target = page) => {
      await info.attach(name, {
        body: await target.screenshot(),
        contentType: 'image/png',
      })
    })
  },
  // Playwright reads fixture dependencies from the destructured parameter, so this one stays empty.
  // oxlint-disable-next-line no-empty-pattern
  code: async ({}, use) => {
    // The inbox holds the latest code of an address, so a second sign-in of one address waits for a
    // code other than the ones that its earlier sign-ins used.
    const used = new Map<string, readonly string[]>()
    await use(async (email) => {
      const codes = used.get(email) ?? []
      const value = await TestPlaywright.code({
        email,
        url: TempoId.url,
        used: codes,
      })
      used.set(email, [...codes, value])
      return value
    })
  },
  // oxlint-disable-next-line no-empty-pattern
  email: async ({}, use) => {
    await use(`accounts-test+${crypto.randomUUID()}@example.org`)
  },
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        // The `id-dev` image at times responds 502 to a static asset, which its next load serves.
        if (
          message.location().url.startsWith(`${TempoId.url}/assets/`) &&
          message.text().includes('status of 502')
        )
          return
        errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await use(errors)

      expect(errors).toEqual([])
    },
    { auto: true },
  ],
  tempoApi: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const api = await TempoApi.start()
      await use()
      await api.stop()
    },
    // A fresh machine pulls the image first, and the API seeds the chain before it listens.
    { scope: 'worker', timeout: 6 * 60_000 },
  ],
})

/**
 * Aborts the signal of the sign-in that runs on the test app on `page`, as the app's own cancel
 * does. The dialog covers the page while a sign-in runs, so the page aborts at an event of its
 * window, in place of a control.
 */
export async function abort(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-app-web:abort')),
  )
}

/**
 * Approves the request on Tempo ID's approval page in `target`: a page, or the frame of a dialog.
 * Tempo ID shows the page to a signed-in user for a request with an access key.
 */
export async function approve(
  target: FrameLocator | Page,
  options: approve.Options = {},
) {
  await hydrated(target)
  const button = target.getByRole('button', { name: 'Approve' })
  if (options.held) {
    await expect(button).toBeEnabled()
    await shown(target)
  }
  await button.click()
}

export declare namespace approve {
  type Options = {
    /**
     * Whether Tempo ID holds each action until its content shows, as the frame of an app without
     * `tempo-id:iframe` does. Defaults to `false`.
     */
    held?: boolean | undefined
  }
}

/**
 * Adds a virtual authenticator to `page`, which holds each passkey that the page creates, and
 * answers each ceremony with no prompt. Returns the reads and the settings of the authenticator.
 */
export async function authenticator(
  page: Page,
): Promise<authenticator.ReturnType> {
  const session = await page.context().newCDPSession(page)
  await session.send('WebAuthn.enable')
  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        automaticPresenceSimulation: true,
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        protocol: 'ctap2',
        transport: 'internal',
      },
    },
  )
  return {
    async credentials() {
      const { credentials } = await session.send('WebAuthn.getCredentials', {
        authenticatorId,
      })
      return credentials.map((credential) => ({
        id: credential.credentialId,
        signCount: credential.signCount,
      }))
    },
    async verifies(isUserVerified) {
      await session.send('WebAuthn.setUserVerified', {
        authenticatorId,
        isUserVerified,
      })
    },
  }
}

export declare namespace authenticator {
  /** A passkey that the authenticator holds. */
  type Credential = {
    /** The credential ID, as base64. */
    id: string
    /** The number of assertions that the passkey signed. */
    signCount: number
  }

  type ReturnType = {
    /** Returns each passkey that the authenticator holds. */
    credentials: () => Promise<readonly Credential[]>
    /**
     * Sets whether the authenticator verifies the user. An authenticator that does not rejects each
     * ceremony with `NotAllowedError`, as a user who dismisses the prompt does.
     */
    verifies: (isUserVerified: boolean) => Promise<void>
  }
}

/**
 * Starts an action of the test app on `page` with no user gesture, as a script of the page does. The
 * browser's popup blocker refuses a window that such a call opens.
 */
export async function call(page: Page, options: call.Options) {
  await uncovered(page)
  // Each of Playwright's own reads of the page holds a gesture.
  await idle(page)
  await script(
    page,
    `[...document.querySelectorAll('button')].find((button) => button.textContent === ${JSON.stringify(options.name)}).click()`,
  )
}

export declare namespace call {
  type Options = {
    /** The label of the action's control. */
    name: string
  }
}

/**
 * Sends `options.calls` as one transaction from the session of the test app on `page`, with the
 * "Send calls" form of the page. Returns what the transaction returned, its `transactionHash`, or
 * threw. A call that reverts rejects the whole transaction.
 */
export async function calls(page: Page, options: calls.Options) {
  await uncovered(page)
  // A call of a `viem/tempo` action also holds its ABI and its arguments, which the form does not
  // take.
  const calls = options.calls.map((call) => ({ data: call.data, to: call.to }))
  await page.getByLabel('Calls').fill(JSON.stringify(calls))
  await page.getByLabel('Fee token').fill(options.feeToken ?? '')
  await page
    .getByLabel('Fields')
    .fill(options.fields ? Json.stringify(options.fields) : '')
  return run(page, { name: 'Send calls' })
}

export declare namespace calls {
  type Options = {
    /** The calls, as the `.call` of a `viem/tempo` action returns each one. */
    calls: readonly Call[]
    /** The address of the token that pays the fee. Absent, the node selects the token. */
    feeToken?: `0x${string}` | undefined
    /**
     * The transaction's other fields, such as its gas and fees, so that Viem fills and estimates
     * nothing. Absent, Viem fills the transaction.
     */
    fields?:
      | {
          gas?: bigint | undefined
          maxFeePerGas?: bigint | undefined
          maxPriorityFeePerGas?: bigint | undefined
          nonceKey?: 'expiring' | undefined
        }
      | undefined
  }
}

/**
 * Clicks a button of the prompt on `page`, which the package shows in place of Tempo ID's frame.
 */
export async function choose(page: Page, options: choose.Options) {
  await prompt(page).getByRole('button', { name: options.name }).click()
}

export declare namespace choose {
  type Options = {
    /** The button's label. `Continue` opens the popup of the sign-in, and `Cancel` rejects the sign-in. */
    name: 'Cancel' | 'Continue'
  }
}

/**
 * Denies the request on Tempo ID's approval page in `target`: a page, or the frame of a dialog.
 */
export async function deny(target: FrameLocator | Page) {
  await hydrated(target)
  await target.getByRole('button', { name: 'Deny' }).click()
}

/**
 * Returns Tempo ID's deposit page in `target`, once it shows: a page, or the frame of a dialog.
 */
export async function deposit(
  target: FrameLocator | Page,
): Promise<deposit.ReturnType> {
  await hydrated(target)
  await expect(target.getByRole('heading', { name: 'Deposit' })).toBeVisible()
  return {
    close: target.getByRole('button', { exact: true, name: 'Close' }),
    continue: target.getByRole('link', { name: /^Continue to/ }),
    faucet: target.getByRole('button', { name: /^Faucet/ }),
    hint: target.getByText(/recommends you have at least/),
    refusal: target.getByText(/does not hold this wallet/),
    skip: target.getByRole('link', { name: 'Skip for now' }),
  }
}

export declare namespace deposit {
  type ReturnType = {
    /** The button of a frame's bar, which ends the page without a deposit. */
    close: Locator
    /** The link of a page that a redirect opened, which returns to the app with the result. */
    continue: Locator
    /** The button that funds the Tempo Account from the node's faucet, and ends a frame or a popup. */
    faucet: Locator
    /** The text that states the amount that the app needs in the Tempo Account. */
    hint: Locator
    /** The text that refuses a deposit to a Tempo Account that the user does not hold. */
    refusal: Locator
    /** The link beside the hint, which returns to the app without a deposit. */
    skip: Locator
  }
}

/**
 * Returns Tempo ID's device page on `page`, once it shows the request of a device grant to a
 * signed-in user: the code that the program printed, and what the request asks for. `approve` and
 * `deny` settle the request.
 */
export async function device(page: Page): Promise<device.ReturnType> {
  await hydrated(page)
  const approve = page.getByRole('button', { name: 'Approve' })
  await expect(approve).toBeVisible()
  return {
    approve,
    approved: page.getByText('Authorization successful'),
    async code() {
      const characters = await page
        .getByRole('textbox')
        .evaluateAll((boxes) =>
          boxes.map((box) => (box as HTMLInputElement).value),
        )
      return `${characters.slice(0, 4).join('')}-${characters.slice(4).join('')}`
    },
    denied: page.getByText('The device was not signed in'),
    message: page.getByRole('note').locator('pre'),
    note: page.getByRole('note').filter({ has: page.locator('pre') }),
    unverified: page.getByText('an unverified app'),
  }
}

export declare namespace device {
  type ReturnType = {
    /** The button that approves the request. */
    approve: Locator
    /** The text that confirms an approved request. */
    approved: Locator
    /** Returns the code that the page shows, in the form that the program prints, such as `ABCD-EFGH`. */
    code: () => Promise<string>
    /** The text that confirms a denied request. */
    denied: Locator
    /** The message that the request signs. */
    message: Locator
    /** The note of a request that signs a message: who signs it, and the message. */
    note: Locator
    /** The flag of the description for an app without a registration. */
    unverified: Locator
  }
}

/**
 * Returns the failure that the test app on `page` shows in place of its controls: the fields of the
 * error that `useSession` threw, such as a refused redirect's.
 */
export async function failure(page: Page) {
  return JSON.parse(await page.locator('#failure').innerText()) as Record<
    string,
    unknown
  >
}

/**
 * Returns the email field of Tempo ID's sign-in form in `target`: a page, or the frame of a dialog.
 * Tempo ID shows the form to a browser that holds no Tempo ID session.
 */
export function form(target: FrameLocator | Page) {
  return target.getByLabel('Email')
}

/**
 * Returns the frame of Tempo ID that `page` holds for a sign-in, also while its dialog is hidden.
 */
export function frame(page: Page) {
  return page.locator('dialog[data-tempo-id-dialog] iframe')
}

/**
 * Returns Tempo ID's funding page on `page`, once it shows. The page follows the approval of a
 * device grant whose request needs an amount in the Tempo Account.
 */
export async function funding(page: Page): Promise<funding.ReturnType> {
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Add funds' })).toBeVisible()
  return {
    add: page.getByRole('button', { name: 'Add funds' }),
    funded: page.getByText('Your wallet is funded'),
    hint: page.getByText(/recommends you have at least/),
    skip: page.getByRole('button', { name: 'Not now' }),
  }
}

export declare namespace funding {
  type ReturnType = {
    /** The button that funds the Tempo Account from the node's faucet. */
    add: Locator
    /** The text that confirms that the Tempo Account holds the amount. */
    funded: Locator
    /** The text that states the amount that the app needs in the Tempo Account, and the balance. */
    hint: Locator
    /** The button that ends the page without a deposit. */
    skip: Locator
  }
}

/**
 * Returns the notes and the cards of a request on Tempo ID's sign-in form or approval page in
 * `target`: the message that the user signs, and what the app receives. Until React reveals a
 * streamed boundary, the page also holds a hidden copy of each, which the locator skips.
 */
export function grant(target: FrameLocator | Page) {
  return target.locator('[data-grant]').filter({ visible: true })
}

/**
 * Selects Continue as guest on Tempo ID's sign-in page in `target`: a page, or the frame of a
 * dialog. Tempo ID offers it for a request with `guest=offer`.
 */
export async function guest(target: FrameLocator | Page) {
  await hydrated(target)
  await target.getByRole('button', { name: 'Continue as guest' }).click()
}

/**
 * Waits until the Tempo ID page in `target` takes input. The page renders `data-hydrated` on its
 * root, which turns `true` once React hydrates it. Before that, React discards the input of a form.
 */
async function hydrated(target: FrameLocator | Page) {
  await target
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached' })
  // React reveals a streamed boundary after the first paint. Until then, its fallback takes no input.
  await expect(target.locator('[hidden][id^="S:"]')).toHaveCount(0)
}

/**
 * Waits until `page` holds no user gesture. A click's gesture lasts a few seconds, which a user
 * spends in a popup, so the page's next call opens no window by itself.
 */
export async function idle(page: Page) {
  await expect
    .poll(() => script(page, 'navigator.userActivation.isActive'), {
      timeout: 10_000,
    })
    .toBe(false)
}

/**
 * Settles the message that the test app on `page` waits for, as the answer of the app's backend
 * does: with the message of the page's query, or with a refusal. The dialog covers the page while a
 * request runs, so the page settles at an event of its window, in place of a control.
 */
export async function issue(page: Page, options: issue.Options = {}) {
  const type = `test-app-web:${options.refuse ? 'refusal' : 'message'}`
  await page.evaluate((type) => window.dispatchEvent(new Event(type)), type)
}

export declare namespace issue {
  type Options = {
    /** Whether the page rejects in place of a message. Defaults to `false`. */
    refuse?: boolean | undefined
  }
}

/**
 * Returns what an action of the test app on `page` returned or threw, once it settles.
 */
export async function outcome(
  page: Page,
  options: outcome.Options,
): Promise<Outcome> {
  const { name, timeout } = options
  const output = page.locator(`output[data-action="${name}"]`)
  await expect(output).toHaveAttribute(
    'data-state',
    /^(fulfilled|rejected)$/,
    timeout === undefined ? {} : { timeout },
  )
  const [state, text] = await Promise.all([
    output.getAttribute('data-state'),
    // The output of a secret, such as a token, is hidden, and a hidden element has no inner text.
    output.textContent(),
  ])
  return { state: state as Outcome['state'], value: JSON.parse(text ?? '') }
}

export declare namespace outcome {
  type Options = {
    /** The label of the action's control. */
    name: string
    /**
     * The time to wait for the action, in milliseconds, such as for one that waits for several
     * blocks. Defaults to the timeout of an assertion.
     */
    timeout?: number | undefined
  }
}

/**
 * Returns Tempo ID's payment page in `target`, once it shows: a page, or the frame of a dialog.
 * Tempo ID shows the page for a payment that the owner of the Tempo Account signs.
 */
export async function payment(
  target: FrameLocator | Page,
): Promise<payment.ReturnType> {
  await hydrated(target)
  const main = target.getByRole('main', { name: 'Payment request' })
  await expect(
    main.getByRole('heading', { name: 'Payment request' }),
  ).toBeVisible()
  return {
    close: target.getByRole('button', { exact: true, name: 'Close' }),
    pay: main.getByRole('button', { name: /^Pay / }),
    reject: main.getByRole('button', { name: 'Reject' }),
  }
}

export declare namespace payment {
  type ReturnType = {
    /** The button of a frame's bar, which ends the page and sends nothing. */
    close: Locator
    /** The button that sends the payment, which names its amount, such as "Pay $5.00". */
    pay: Locator
    /** The button that returns to the app with `access_denied`, and sends nothing. */
    reject: Locator
  }
}

/**
 * Returns the popup window that `options.open` opens on `page`.
 */
export async function popup(page: Page, options: popup.Options) {
  const [window] = await Promise.all([
    page.waitForEvent('popup'),
    options.open(),
  ])
  return window
}

export declare namespace popup {
  type Options = {
    /** Opens the window, such as with a click. */
    open: () => Promise<unknown>
  }
}

/**
 * Returns the prompt of the dialog on `page`, which the package shows in place of Tempo ID's frame:
 * its text, and its buttons.
 */
export function prompt(page: Page) {
  // A dialog that closes stays open for its exit, beside the one that follows it.
  return page.locator('dialog[data-tempo-id-dialog][open]:not([data-closing])')
}

/**
 * Revokes the access key on Tempo ID's revocation page in `target`: a page, or the frame of a dialog.
 */
export async function revoke(target: FrameLocator | Page) {
  await hydrated(target)
  await target.getByRole('button', { exact: true, name: 'Revoke' }).click()
}

/** Runs an action of the test app on `page`, and returns what it returned or threw. */
export async function run(page: Page, options: run.Options) {
  await start(page, options)
  return outcome(page, options)
}

export declare namespace run {
  type Options = outcome.Options
}

/**
 * Evaluates `expression` on `page` with no user gesture, and returns its value. Playwright's own
 * `evaluate` and `dispatchEvent` run with a gesture, within which the popup blocker accepts a window.
 */
async function script(page: Page, expression: string): Promise<unknown> {
  const session = await page.context().newCDPSession(page)
  const { result } = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  })
  await session.detach()
  return result.value
}

/** Returns the color scheme that Tempo ID's page in `frame` prefers: `dark` or `light`. */
export async function scheme(frame: FrameLocator) {
  const dark = await frame
    .locator('html')
    .evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? 'dark' : 'light'
}

/**
 * Returns the screen of a sign-in that Tempo ID shows in `target` after the email's code, with no
 * wait: the approval, the deposit page, or `undefined` for any other screen.
 */
export async function screen(target: FrameLocator | Page) {
  const shows = (locator: Locator) => locator.isVisible().catch(() => false)
  if (await shows(target.getByRole('heading', { name: 'Deposit' })))
    return 'deposit'
  if (await shows(target.getByRole('button', { name: 'Approve' })))
    return 'approval'
  return undefined
}

/**
 * Sends OUSD from the session of the test app on `page`, with the form of the page. Returns what the
 * transfer returned, its `transactionHash`, or threw.
 */
export async function send(page: Page, options: send.Options) {
  await submit(page, options)
  return outcome(page, { name: 'Send OUSD', timeout: options.timeout })
}

export declare namespace send {
  type Options = {
    /** The OUSD to send, as a decimal string. */
    amount: string
    /**
     * The time to wait for the transfer, in milliseconds, such as for one that a remote sponsor
     * signs. Defaults to the timeout of an assertion.
     */
    timeout?: number | undefined
    /** The recipient's address. */
    to: `0x${string}`
  }
}

/**
 * Waits until Tempo ID's page in `target` reports its content as shown: in view, and covered by
 * nothing for a moment. The frame of an app without `tempo-id:iframe` runs an action only then, so
 * no page that covers the frame can pass a click to it.
 */
async function shown(target: FrameLocator | Page) {
  // The browser reports the visibility with a frame's paint, so two paints pass first.
  await target
    .locator('main')
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
  await expect(target.locator('main[data-visible]')).toHaveCount(1)
}

/**
 * Signs `email` in on the custom page of the test app on `page`, with the app's own form, which
 * shows no page of Tempo ID. The form sends a code to the address, then runs the sign-in action of
 * `options.name` with the code that the inbox holds. Returns what the action returned or threw.
 */
export async function signIn_custom(
  page: Page,
  options: signIn_custom.Options,
) {
  const { code, email, name = 'Sign in' } = options
  await page.getByLabel('Email').fill(email)
  const sent = await run(page, { name: 'Send code' })
  expect(sent.state).toBe('fulfilled')
  await page.getByLabel('Code', { exact: true }).fill(await code(email))
  return run(page, { name })
}

export declare namespace signIn_custom {
  type Options = {
    /** Returns the code that the inbox holds for an address. */
    code: Code
    /** The address to sign in. */
    email: string
    /** The label of the sign-in action's control. Defaults to `Sign in`. */
    name?: string | undefined
  }
}

/** Starts an action of the test app on `page` with a click on its control. */
export async function start(page: Page, options: start.Options) {
  await uncovered(page)
  await page.getByRole('button', { exact: true, name: options.name }).click()
}

export declare namespace start {
  type Options = {
    /** The label of the action's control. */
    name: string
  }
}

/**
 * Starts a transfer of OUSD from the session of the test app on `page`, with the form of the page,
 * and waits for no outcome, such as before a screen that the transfer opens. `outcome` of
 * `Send OUSD` then returns what the transfer returned or threw.
 */
export async function submit(page: Page, options: send.Options) {
  await uncovered(page)
  await page.getByLabel('Recipient').fill(options.to)
  await page.getByLabel('Amount').fill(options.amount)
  await start(page, { name: 'Send OUSD' })
}

/**
 * Waits until no dialog covers `page`. A sign-in resolves before the exit of its dialog ends, and the
 * page under an open dialog takes no input.
 */
export async function uncovered(page: Page) {
  await expect(page.locator('dialog[data-tempo-id-dialog][open]')).toHaveCount(
    0,
  )
}
