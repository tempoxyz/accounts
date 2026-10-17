/**
 * Accounts Bench: UX benchmark for the Tempo Wallet (popup and iframe) and WebAuthn adapters.
 *
 * Drives the bench app in headless Chrome with a CDP virtual WebAuthn
 * authenticator, and times register, login and send transaction per renderer.
 *
 * Usage: pnpm --filter bench bench [options]
 *   --url <url>              Bench app URL. @default http://localhost:5180
 *   --baseline <url>         Bench app built against main's SDK. Each run measures
 *                            both apps, alternating which goes first, and the
 *                            report compares them.
 *   --runs <n>               Runs per renderer. @default 3
 *   --renderers <list>       Comma-separated renderers. @default all
 *                            (tempoWallet/popup, tempoWallet/iframe, webAuthn)
 *   --host <url>             Wallet page override for the Tempo Wallet renderers.
 *   --json <path>            Also writes every sample as JSON.
 *   --markdown <path>        Also writes a scored Markdown report.
 *
 * Environment:
 *   CHROME_PATH=<path>       Browser binary. Defaults to the installed Chrome channel.
 *   BENCH_NO_SANDBOX=1       Disables Chrome's sandbox (only for containers that need it).
 *   BENCH_SCREENSHOTS=<dir>  Writes a screenshot of the wallet when a step fails.
 *   BENCH_COMMIT=<sha>       Commit named in the Markdown report.
 *   BENCH_BASE_COMMIT=<sha>  Baseline commit named in the Markdown report.
 *   BENCH_RUN_URL=<url>      Workflow run linked from the Markdown report.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import {
  type BrowserContext,
  chromium,
  type FrameLocator,
  type Locator,
  type Page,
} from 'playwright-core'

import * as Report from './report.js'

type Case = Report.Case
type Renderer = Report.Renderer
type Sample = Report.Sample

/** Wallet button that approves each case. */
const approvals = {
  login: /^(Continue|Sign in) with passkey$/,
  register: /^Create account$/,
  send: /^(Confirm|Approve|Send|Pay)\b/,
} as const satisfies Record<Case, RegExp>

const timeout = 60_000

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    host: { type: 'string' },
    json: { type: 'string' },
    markdown: { type: 'string' },
    renderers: { default: Report.renderers.join(','), type: 'string' },
    runs: { default: '3', type: 'string' },
    url: { default: 'http://localhost:5180', type: 'string' },
  },
})

const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1)
  throw new Error(`Invalid --runs: ${values.runs}. Use a positive integer.`)

const selected = values.renderers.split(',').map((renderer) => {
  if (!Report.renderers.includes(renderer as Renderer))
    throw new Error(`Unknown renderer: ${renderer}`)
  return renderer as Renderer
})

/** Page timeline entry written by `src/main.ts`. */
type Entry = { action: string; error?: string; events: [string, number][] }

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { bypass: '127.0.0.1,localhost', server: process.env.HTTPS_PROXY } }
    : {}),
  // Playwright disables Chrome's sandbox unless asked. Keep it on, since the bench
  // can load remote previews. Containers that can't run it opt out explicitly.
  chromiumSandbox: process.env.BENCH_NO_SANDBOX !== '1',
  headless: true,
})

/**
 * Adds a virtual passkey authenticator to a page. Credentials are shared through
 * `credentials`, keyed by credential ID, so a popup opened later can sign with a
 * passkey registered earlier, at its latest signature counter.
 */
async function authenticate(
  context: BrowserContext,
  page: Page,
  credentials: Map<string, { credentialId: string }>,
) {
  const session = await context.newCDPSession(page)
  await session.send('WebAuthn.enable')
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: 'ctap2',
      transport: 'internal',
    },
  })
  for (const credential of credentials.values())
    await session.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: credential as never,
    })
  // An assertion increments the credential's signature counter. Keep the latest
  // copy, so a later popup does not present a counter lower than the last one.
  session.on('WebAuthn.credentialAdded', (event) =>
    credentials.set(event.credential.credentialId, event.credential),
  )
  session.on('WebAuthn.credentialAsserted', (event) =>
    credentials.set(event.credential.credentialId, event.credential),
  )
}

/** Resolves once the virtual authenticator is attached to a page of the current run. */
let attached: (page: Page) => Promise<void> = async () => {}

/**
 * Clicks an app button. Returns the click time and a function that resolves with
 * the page's timeline entry for the action.
 */
async function click(page: Page, action: string) {
  const count = await page.evaluate(() => (window as never as { __bench: Entry[] }).__bench.length)
  const start = Date.now()
  await page.click(`#${action}`)
  const done = async () => {
    await page.waitForFunction(
      (count) => {
        const entry = (window as never as { __bench: Entry[] }).__bench[count]
        return entry?.events.some(([name]) => name.startsWith('callback'))
      },
      count,
      { timeout },
    )
    const entry = await page.evaluate(
      (count) => (window as never as { __bench: Entry[] }).__bench[count]!,
      count,
    )
    const callback = entry.events.find(([name]) => name.startsWith('callback'))!
    return { callback: callback[1], entry, time: Date.now() }
  }
  return { done, start }
}

/** Runs one untimed setup action and fails when it rejects. */
async function setup(page: Page, action: 'disconnect' | 'fund') {
  const { done } = await click(page, action)
  const { entry } = await done()
  if (entry.error) throw new Error(`${action} failed: ${entry.error}`)
}

/** Times one case. Tempo Wallet cases are approved in the wallet UI. */
async function step(
  context: BrowserContext,
  page: Page,
  options: { case: Case; renderer: Renderer; run: number },
): Promise<Sample> {
  const { renderer, run } = options
  const popup = renderer === 'tempoWallet/popup' ? context.waitForEvent('page', { timeout }) : null
  popup?.catch(() => {})

  const { done, start } = await click(page, options.case)

  if (renderer === 'webAuthn') {
    const { callback, entry } = await done()
    return { case: options.case, error: entry.error, renderer, run, total: callback }
  }

  const wallet: Page | FrameLocator = popup
    ? await popup
    : page.frameLocator('iframe[data-testid="tempo-wallet-postmessage"]')
  const button: Locator = wallet.getByRole('button', { name: approvals[options.case] })
  try {
    await button.waitFor({ state: 'visible', timeout })
  } catch (error) {
    await screenshot(popup ? (wallet as Page) : page, `${renderer}-${options.case}-${run}`)
    throw error
  }
  const ready = Date.now() - start
  // The passkey prompt follows the approval click, so the popup's authenticator
  // must be attached by then. Awaited after `ready` to keep setup out of the timing.
  if (popup) await attached(wallet as Page)

  if (options.case === 'register')
    await wallet.getByPlaceholder(/Email address or label/).fill(`bench-${Date.now()}`)
  const approved = Date.now()
  await button.click()

  const { callback, entry, time } = await done()
  return {
    case: options.case,
    confirm: time - approved,
    error: entry.error,
    ready,
    renderer,
    run,
    total: callback,
  }
}

async function screenshot(page: Page, name: string) {
  const dir = process.env.BENCH_SCREENSHOTS
  if (!dir) return
  await fs.mkdir(dir, { recursive: true })
  await page
    .screenshot({ path: path.join(dir, `${name.replace('/', '-')}.png`) })
    .catch((error) => console.error(`Screenshot ${name} failed:`, error.message))
}

/** Runs every case once for one renderer against one bench app, in a fresh context. */
async function measure(options: { renderer: Renderer; run: number; url: string }) {
  const { renderer, run } = options
  const results: Sample[] = []
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const credentials = new Map<string, { credentialId: string }>()
  // Each page's authenticator setup, awaited before the page is used.
  const authenticators = new WeakMap<Page, Promise<void>>()
  context.on('page', (page) => {
    const setup = authenticate(context, page, credentials)
    // A short-lived popup (e.g. one that only relays a disconnect) can close
    // before setup ends. Its rejection surfaces where the page is awaited.
    setup.catch(() => {})
    authenticators.set(page, setup)
  })
  attached = (page) => authenticators.get(page) ?? Promise.resolve()

  const page = await context.newPage()
  const url = new URL(options.url)
  const [adapter, mode] = renderer.split('/')
  url.searchParams.set('adapter', adapter!)
  if (mode) url.searchParams.set('mode', mode)
  if (values.host) url.searchParams.set('host', values.host)

  // The case in progress, so a thrown failure is recorded against it.
  let current: Case = Report.cases[0]
  try {
    await attached(page)
    await page.goto(url.toString())
    await page.waitForFunction(() => '__bench' in window)
    for (const name of Report.cases) {
      current = name
      if (name === 'login') await setup(page, 'disconnect')
      if (name === 'send') await setup(page, 'fund')
      const sample = await step(context, page, { case: name, renderer, run })
      results.push(sample)
      if (sample.error) break
    }
  } catch (error) {
    const message = (error as Error).message
    console.error(`${renderer} run ${run} failed:`, message)
    // `total` is unused for a failed sample, since the summary skips failures.
    results.push({ case: current, error: message, renderer, run, total: 0 })
  } finally {
    await context.close()
  }
  return results
}

const samples: Sample[] = []
const samples_base: Sample[] = []
for (const renderer of selected)
  for (let run = 0; run < runs; run++) {
    const targets = [{ samples, url: values.url }]
    // Alternate the order, so neither app always runs first in a pair.
    if (values.baseline)
      targets[run % 2 ? 'push' : 'unshift']({ samples: samples_base, url: values.baseline })
    for (const target of targets) {
      const results = await measure({ renderer, run, url: target.url })
      target.samples.push(...results)
      for (const result of results)
        console.log(JSON.stringify({ ...result, app: target.url === values.url ? 'head' : 'base' }))
    }
  }
const version = browser.version()
await browser.close()

if (values.json)
  await fs.writeFile(
    values.json,
    JSON.stringify(values.baseline ? { base: samples_base, head: samples } : samples, null, 2),
  )

const summary = Report.summarize(samples, { renderers: selected, runs })
const summary_base = values.baseline
  ? Report.summarize(samples_base, { renderers: selected, runs })
  : undefined
console.table(Report.table(summary))

if (values.markdown)
  await fs.writeFile(
    values.markdown,
    Report.markdown(summary, {
      baseCommit: process.env.BENCH_BASE_COMMIT,
      baseline: summary_base,
      browser: `Chrome ${version}`,
      commit: process.env.BENCH_COMMIT,
      repository: process.env.GITHUB_REPOSITORY ?? 'tempoxyz/accounts',
      runUrl: process.env.BENCH_RUN_URL,
      walletHost: values.host ?? 'https://wallet.tempo.xyz',
    }),
  )

// Individual failures are part of the report, but a run with no passing sample
// measured nothing (e.g. the app never loaded), so it must not pass.
if (!samples.some((sample) => !sample.error)) {
  console.error('No sample passed.')
  process.exitCode = 1
}
