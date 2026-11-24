/**
 * The Playwright helpers of an end-to-end test that signs in through Tempo ID's dialog, at an
 * `id-dev` instance of Tempo ID, whose inbox returns each sign-in code. `dialog` returns the frame
 * of the open dialog, `signIn` completes Tempo ID's sign-in form, and `code` reads the inbox. The
 * selectors of the dialog live beside the code that renders it. `@playwright/test` is an optional
 * peer, which only this entry imports.
 *
 * @example
 * ```ts
 * import { expect, test } from '@playwright/test'
 * import { code, dialog, signIn } from 'accounts/test/playwright'
 *
 * test('signs in', async ({ page }) => {
 *   const email = `test+${crypto.randomUUID()}@example.org`
 *   await page.goto('/')
 *   await page.getByRole('button', { name: 'Sign in' }).click()
 *
 *   await signIn(await dialog(page), {
 *     code: (email) => code({ email, url: 'http://localhost:8787' }),
 *     email,
 *   })
 *
 *   await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
 * })
 * ```
 * @module
 */
import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from '@playwright/test'

/** The open dialog. A dialog that closes stays open for its exit, beside the one that follows it. */
const selector = 'dialog[data-tempo-id-dialog][open]:not([data-closing])'

/**
 * Returns the latest sign-in code that the inbox of the `id-dev` instance at `url` holds for
 * `email`, once its message arrives. Tempo ID sends the code after its response, so the call polls
 * the inbox. The inbox holds only the latest code of an address, so a second sign-in of an address
 * passes the codes of earlier sign-ins as `used`, and the call waits for another one.
 *
 * @throws {Error} When the inbox responds with a status other than 200 or 404, such as from a
 *   Tempo ID that is not an `id-dev` instance, or when no new code arrives within `timeout`.
 *
 * @example
 * ```ts
 * import { code } from 'accounts/test/playwright'
 *
 * const first = await code({ email, url: 'http://localhost:8787' })
 * const second = await code({ email, url: 'http://localhost:8787', used: [first] })
 * ```
 */
export async function code(options: code.Options) {
  const { email, timeout, url, used = [] } = options

  let value: string | undefined
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${new URL(url).origin}/__id-dev/code?${new URLSearchParams({ email })}`,
        )
        if (response.status === 404) {
          await response.body?.cancel()
          return (value = undefined)
        }
        if (!response.ok)
          throw new Error(
            `Reading the sign-in code responded with ${response.status}. Pass the URL of an \`id-dev\` instance as \`url\`.`,
          )
        const body = (await response.json()) as { code: string }
        return (value = used.includes(body.code) ? undefined : body.code)
      },
      timeout === undefined ? {} : { timeout },
    )
    .toBeDefined()
  return value!
}

export declare namespace code {
  type Options = {
    /** The address that receives the code. */
    email: string
    /** The milliseconds to wait for the code. Defaults to the timeout of an assertion. */
    timeout?: number | undefined
    /** The origin of the `id-dev` instance, such as `http://localhost:8787`. */
    url: string
    /** The codes that earlier sign-ins of the address submitted, which the call skips. */
    used?: readonly string[] | undefined
  }
}

/**
 * Returns the frame of Tempo ID's page in the open dialog on `page`, once the page hydrates and the
 * dialog holds still. The entrance scales and moves the dialog, and Playwright checks that an
 * element is stable only in its frame's own viewport, so a click during the entrance can miss.
 *
 * @example
 * ```ts
 * import { dialog } from 'accounts/test/playwright'
 *
 * const frame = await dialog(page)
 * await frame.getByRole('button', { name: 'Approve' }).click()
 * ```
 */
export async function dialog(page: Page) {
  const element = page.locator(selector)
  const frame = element.locator('iframe').contentFrame()
  await frame
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached' })
  // The dialog takes its size from the page's render after hydration, so its box changes once more.
  await expect
    .poll(() =>
      element.evaluate(async (dialog) => {
        const before = JSON.stringify(dialog.getBoundingClientRect())
        await new Promise((resolve) => requestAnimationFrame(resolve))
        await new Promise((resolve) => requestAnimationFrame(resolve))
        return (
          JSON.stringify(dialog.getBoundingClientRect()) === before &&
          dialog
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState === 'finished')
        )
      }),
    )
    .toBe(true)
  return frame
}

/**
 * Signs `email` in on Tempo ID's sign-in form in `target`: the frame that `dialog` returns, or the
 * page of a popup or a redirect. The form submits the address, then the code that `options.code`
 * returns. Tempo ID shows the form to a browser that holds no Tempo ID session.
 *
 * @example
 * ```ts
 * import { code, dialog, signIn } from 'accounts/test/playwright'
 *
 * await signIn(await dialog(page), {
 *   code: (email) => code({ email, url: 'http://localhost:8787' }),
 *   email: 'ada@example.org',
 * })
 * ```
 */
export async function signIn(
  target: FrameLocator | Page,
  options: signIn.Options,
) {
  const { email, filled } = options

  await hydrated(target)
  const held = options.held ?? (await observed(target))
  if (held) await shown(target)
  await target.getByLabel('Email').fill(email)
  const submit = target.getByRole('button', { name: 'Continue with email' })
  await filled?.(submit)
  await submit.click()

  const field = target.getByRole('textbox', { exact: true, name: 'Code' })
  if (held) {
    await expect(field).toBeVisible()
    await shown(target)
  }
  await field.fill(await options.code(email))
}

export declare namespace signIn {
  type Options = {
    /** Returns the sign-in code that Tempo ID sent to the address, such as with `code`. */
    code: (email: string) => Promise<string>
    /** The address to sign in. */
    email: string
    /**
     * Runs once the email fills, with the Continue with email button, before its click, such as
     * while the frame waits for a deferred request's challenge. The click waits until the button
     * enables. Defaults to none.
     */
    filled?: ((submit: Locator) => Promise<void>) | undefined
    /**
     * Whether Tempo ID holds each action until its content shows, as the frame of an app without
     * `tempo-id:iframe` does. Defaults to whether the page reports its visibility, which only such
     * a frame does.
     */
    held?: boolean | undefined
  }
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
 * Returns whether Tempo ID's page in `target` reports its visibility, as the frame of an app without
 * `tempo-id:iframe` does. The frame reports it with its first paints, so two paints pass first. A
 * trusted frame, a popup, and a redirect report none.
 */
async function observed(target: FrameLocator | Page) {
  await paints(target)
  return (await target.locator('main[data-in-view]').count()) > 0
}

/** Waits until Tempo ID's page in `target` paints twice. */
async function paints(target: FrameLocator | Page) {
  await target
    .locator('html')
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
}

/**
 * Waits until Tempo ID's page in `target` reports its content as shown: in view, and covered by
 * nothing for a moment. The frame of an app without `tempo-id:iframe` runs an action only then.
 */
async function shown(target: FrameLocator | Page) {
  // The browser reports the visibility with a frame's paint, so two paints pass first.
  await paints(target)
  await expect(target.locator('main[data-visible]')).toHaveCount(1)
}
