/**
 * Extends Playwright's `test` with a harness, an Admin API, and a database per worker, a new address
 * per test, and the playgrounds. A test fails if its page logs a console error or throws.
 * @module
 */
import {
  test as base,
  expect,
  type Frame,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import type { TestHarness } from 'wrangler'
import * as Admin from './Admin.js'
import * as Playgrounds from './Playgrounds.js'
import { Database, Harness } from './TempoId.js'

export { expect }

/** A playground that a worker runs, with the settings that it started with. */
type Running = {
  /** The settings, as JSON. */
  env: string
  /** The process. */
  process: Playgrounds.Process
}

/** The requests in flight of a page, in each of its frames. */
type Traffic = {
  /** When a request of the page last started or settled, in milliseconds since the epoch. */
  changed: number
  /** The requests that have not settled. */
  requests: Set<Request>
}

/** The traffic of each page that {@link track} follows. */
const inflight = new WeakMap<Page, Traffic>()

/** Playwright's `test`, served by one harness per Playwright worker. */
export const test = base.extend<
  {
    /** Returns the code that the inbox holds for `email`, once its message arrives. */
    code: (email: string) => Promise<string>
    /** A new address under `example.org`, unique to the test. */
    email: string
    /** The page's console errors and exceptions. A test removes the ones it expects. */
    errors: string[]
    /**
     * Registers a playground's app and starts it with `env` over its defaults, or reuses a running
     * one with the same settings.
     */
    playgrounds: (
      name: Playgrounds.Name,
      env?: Record<string, string | undefined>,
    ) => Promise<Playgrounds.Process>
    /** The harness that serves `apps/id`. */
    server: TestHarness
  },
  {
    /** The Admin API over the worker's database, which registers apps and realms. */
    admin: Admin.Instance
    /** The worker's own database, for the reads and writes that the Admin API does not cover. */
    database: ReturnType<typeof Database.connect>
    /** The harness that serves `apps/id`. */
    harness: Harness.Instance
    /** The worker's running playgrounds. A test that asks for the same settings reuses one. */
    running: Map<Playgrounds.Name, Running>
  }
>({
  admin: [
    async ({ database }, use) => {
      const admin = Admin.create({ databaseUrl: database.url })
      await admin.listen()
      await use(admin)
      await admin.close()
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ harness }, use) => {
    const { url } = await harness.listen()
    await use(url.href)
  },
  code: async ({ harness }, use) => {
    await use(async (email) => {
      let code: string | undefined
      await expect
        .poll(
          async () => {
            const messages = await Harness.messages(harness)
            // A security email to the same address can follow the code, and holds no code.
            code = messages
              .findLast(
                (entry) =>
                  entry.subject.endsWith('sign-in code') &&
                  entry.to.some((to) => to.email === email),
              )
              ?.text?.match(/\d{6}/)?.[0]
            return code
          },
          { timeout: 5_000 },
        )
        .toBeDefined()
      return code!
    })
  },
  database: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Each worker's harness, playgrounds, and seeds read a database of its own, so a test that
      // changes shared rows, such as the `default` realm's passkeys, changes them for its worker only.
      // The harness and `Database.connect` read the worker's database from the variable.
      const suite = process.env[Database.variable]
      const database = Database.isolated({
        prefix: `e2e_${process.env.TEST_RUN}`,
      })
      await database.create()
      process.env[Database.variable] = database.url
      await use({
        db: database.db,
        end: () => Promise.resolve(),
        url: database.url,
      })
      process.env[Database.variable] = suite
      // The harness's runtime can hold a connection a moment past its close, so global teardown drops
      // the database once every worker exits.
      await database.end()
    },
    { scope: 'worker' },
  ],
  // Playwright reads fixture dependencies from the destructured parameter, so this one stays empty.
  // oxlint-disable-next-line no-empty-pattern
  email: async ({}, use) => {
    await use(`tempo-id-test+${crypto.randomUUID()}@example.org`)
  },
  errors: [
    async ({ harness, page }, use, info) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      // `hydrated` names the requests that keep a page's network busy, in each page of the test.
      track(page)
      page.context().on('page', track)

      await use(errors)

      // Only the errors the test itself caused count, not those of requests the reset refuses.
      const logged = [...errors]
      // Each test signs in its own address and seeds rows of its own, so the next test reuses the
      // harness. A restart starts every Worker again, which takes seconds, so only a failed test,
      // whose state is unknown, restarts it.
      if (info.status !== info.expectedStatus) {
        harness.debug()
        await harness.restart()
      }
      expect(logged).toEqual([])
    },
    { auto: true },
  ],
  harness: [
    async ({ database }, use) => {
      const harness = Harness.create({
        secrets: { DATABASE_URL: database.url },
      })
      await harness.listen()
      await use(harness)
      await harness.close()
    },
    { scope: 'worker' },
  ],
  playgrounds: async ({ admin, baseURL, database, running }, use) => {
    await use(async (name, env = {}) => {
      if (name !== 'api') await Playgrounds.register(database, { admin, name })
      const settings = { TEMPO_ID_URL: new URL(baseURL!).origin, ...env }
      const current = running.get(name)
      if (
        current?.env === JSON.stringify(settings) &&
        current.process.running()
      )
        return current.process

      // The playground listens on its port, so one with other settings stops first.
      await current?.process.stop()
      const process = await Playgrounds.start(name, { env: settings })
      running.set(name, { env: JSON.stringify(settings), process })
      return process
    })
  },
  running: [
    // Playwright reads fixture dependencies from the destructured parameter, so this one stays empty.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const running = new Map<Playgrounds.Name, Running>()
      await use(running)
      await Promise.all(
        [...running.values()].map((entry) => entry.process.stop()),
      )
    },
    { scope: 'worker' },
  ],
  server: async ({ harness }, use) => {
    await use(harness)
  },
})

/**
 * Waits until `page` takes input. A Tempo ID page renders `data-hydrated` on its root, which turns
 * `true` once React hydrates it, and the wait lasts until React also reveals each streamed boundary.
 * A playground page has no marker, so the wait lasts until its network is idle for 500 milliseconds.
 * A network that stays busy for 20 seconds fails the wait with the requests in flight.
 */
export async function hydrated(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  if ((await page.locator('html[data-hydrated]').count()) === 0)
    return await idle(page)
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached' })
  // React streams a boundary's content into a hidden segment, and reveals it up to 300 milliseconds
  // after the first paint. Until then, the fallback takes no input, and a text locator matches both
  // copies.
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0)
}

/**
 * Signs `email` in through the API, with the cookies of `page`'s context, as the sign-in page does
 * without its page loads and its pause on the accepted code. The verification creates the user's
 * first account, as the page's does. For a test whose subject comes after the sign-in.
 */
export async function signIn(page: Page, options: signIn.Options) {
  const { code, email } = options
  const sent = await page.request.post('/v1/auth/code', { data: { email } })
  expect(sent.status()).toBe(200)
  const verified = await page.request.post('/v1/auth/code/verify', {
    data: { code: await code(email), email },
  })
  expect(verified.status()).toBe(200)
}

export declare namespace signIn {
  type Options = {
    /** Returns the code that the inbox holds for an address. */
    code: (email: string) => Promise<string>
    /** The address to sign in. */
    email: string
  }
}

/**
 * Pastes text into `locator` with a clipboard event, since `fill` stops at the `maxlength` of a
 * code slot.
 */
export async function paste(locator: Locator, options: paste.Options) {
  await locator.focus()
  await locator.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    )
  }, options.text)
}

export declare namespace paste {
  type Options = {
    /** The text that the clipboard holds. */
    text: string
  }
}

/**
 * Waits until no request of `page`, in any of its frames, is in flight for 500 milliseconds, as
 * {@link track} follows them. Playwright's `networkidle` can stay unfired: a child frame that already
 * fired it, then starts and settles a request between two of Playwright's checks, never fires it
 * again. The dialog's hidden frame does so when it loads a lazy chunk. A page that `track` does not
 * follow, such as one of another browser context, waits for `networkidle`.
 */
async function idle(page: Page) {
  const traffic = inflight.get(page)
  if (!traffic)
    return await page.waitForLoadState('networkidle', { timeout: 20_000 })

  await expect
    .poll(
      () => traffic.requests.size === 0 && Date.now() - traffic.changed >= 500,
      { intervals: [100], timeout: 20_000 },
    )
    .toBe(true)
    .catch((error: unknown) => {
      const pending = [...traffic.requests].map(
        (request) => `${request.method()} ${request.url()}`,
      )
      throw new Error(
        `The page's network stayed busy with ${pending.join(', ') || 'requests that never paused for 500 milliseconds'}.`,
        { cause: error },
      )
    })
}

/** Follows the requests in flight of `page`, which {@link hydrated} waits for and names. */
function track(page: Page) {
  const traffic = { changed: Date.now(), requests: new Set<Request>() }
  inflight.set(page, traffic)
  // The last navigation request of each frame, and the one whose document the frame shows.
  const documents = new WeakMap<Frame, Request>()
  const navigations = new WeakMap<Frame, Request>()

  const settle = (request: Request) => {
    traffic.changed = Date.now()
    traffic.requests.delete(request)
  }
  // Settles each request of `frame` but `kept`.
  const drop = (frame: Frame, kept?: Request) => {
    for (const request of traffic.requests)
      if (request.frame() === frame && request !== kept) settle(request)
  }

  page.on('request', (request) => {
    traffic.changed = Date.now()
    traffic.requests.add(request)
    if (request.isNavigationRequest()) navigations.set(request.frame(), request)
  })
  page.on('requestfailed', settle)
  page.on('requestfinished', settle)
  // The browser settles no request of a document that detaches, or that a frame leaves for a new
  // one, so those settle here, as in Playwright's own idle. A navigation within the document starts
  // no request, so the frame keeps the document's requests.
  page.on('framedetached', (frame) => drop(frame))
  page.on('framenavigated', (frame) => {
    const request = navigations.get(frame)
    if (!request || documents.get(frame) === request) return
    documents.set(frame, request)
    drop(frame, request)
  })
}
