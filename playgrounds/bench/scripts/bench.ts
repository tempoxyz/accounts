/**
 * UX benchmark for the Tempo Wallet (popup and iframe) and WebAuthn adapters.
 *
 * Drives the bench playground in headless Chrome with a CDP virtual WebAuthn
 * authenticator, and times register, login and send transaction per renderer.
 *
 * Usage: pnpm --filter bench-playground bench [options]
 *   --url <url>              Bench playground URL. @default http://localhost:5180
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

/**
 * Pause before each user action, as a person takes between clicks. Without it, a
 * popup request sent right after the previous popup closes can reach the closed
 * window, since the transport polls for a closed window every 250 ms.
 */
const pause = 1_000

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    json: { type: 'string' },
    markdown: { type: 'string' },
    renderers: { default: Report.renderers.join(','), type: 'string' },
    runs: { default: '3', type: 'string' },
    url: { default: 'http://localhost:5180', type: 'string' },
  },
})

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
 * `credentials`, so a popup opened later can sign with a passkey registered earlier.
 */
async function authenticate(context: BrowserContext, page: Page, credentials: unknown[]) {
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
  for (const credential of credentials)
    await session.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: credential as never,
    })
  session.on('WebAuthn.credentialAdded', (event) => credentials.push(event.credential))
}

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
  await page.waitForTimeout(pause)
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

  await page.waitForTimeout(pause)
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

const samples: Sample[] = []
for (const renderer of selected)
  for (let run = 0; run < Number(values.runs); run++) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const credentials: unknown[] = []
    // A short-lived popup (e.g. one that only relays a disconnect) can close
    // before the authenticator attaches. It needs no passkey, so ignore it.
    context.on('page', (page) => void authenticate(context, page, credentials).catch(() => {}))

    const page = await context.newPage()
    const url = new URL(values.url)
    const [adapter, mode] = renderer.split('/')
    url.searchParams.set('adapter', adapter!)
    if (mode) url.searchParams.set('mode', mode)
    if (values.host) url.searchParams.set('host', values.host)
    await page.goto(url.toString())
    await page.waitForFunction(() => '__bench' in window)

    try {
      for (const name of Report.cases) {
        if (name === 'login') await setup(page, 'disconnect')
        if (name === 'send') await setup(page, 'fund')
        const sample = await step(context, page, { case: name, renderer, run })
        samples.push(sample)
        console.log(JSON.stringify(sample))
        if (sample.error) break
      }
    } catch (error) {
      console.error(`${renderer} run ${run} failed:`, (error as Error).message)
    }
    await context.close()
  }
const version = browser.version()
await browser.close()

if (values.json) await fs.writeFile(values.json, JSON.stringify(samples, null, 2))

const summary = Report.summarize(samples, { renderers: selected, runs: Number(values.runs) })
console.table(Report.table(summary))

if (values.markdown)
  await fs.writeFile(
    values.markdown,
    Report.markdown(summary, {
      browser: `Chrome ${version}`,
      commit: process.env.BENCH_COMMIT,
      runUrl: process.env.BENCH_RUN_URL,
      walletHost: values.host ?? 'https://wallet.tempo.xyz',
    }),
  )
