/**
 * Measures popup / iframe latency of the Tempo Wallet postMessage adapter
 * against a deployed perf playground, using a CDP virtual passkey.
 *
 * Usage: node --import tsx scripts/bench.ts <url> [runs]
 *   CHROME_PATH=/path/to/chrome to override the browser binary.
 *   BENCH_NO_SANDBOX=1 disables Chrome's sandbox (only for containers that need it).
 *   Append `?mode=popup` or `?mode=iframe` to the URL to force a mount.
 */
import { type BrowserContext, chromium, type Page } from 'playwright-core'

const [url = 'http://127.0.0.1:5173/?mode=popup', runs = '3'] = process.argv.slice(2)

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { bypass: '127.0.0.1,localhost', server: process.env.HTTPS_PROXY } }
    : {}),
  // Keep Chrome's sandbox: the bench loads remote previews. Containers that can't
  // run it (e.g. as root) opt out with BENCH_NO_SANDBOX=1.
  ...(process.env.BENCH_NO_SANDBOX === '1' ? { args: ['--no-sandbox'] } : {}),
  headless: true,
})

type Perf = { action: string; error?: string; events: [string, number][] }

/** Adds a virtual passkey authenticator to every page, sharing credentials across popups. */
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
  session.on('WebAuthn.credentialAdded', ({ credential }) => credentials.push(credential))
}

/** Clicks an app button, approves in the wallet UI and times each phase. */
async function step(context: BrowserContext, page: Page, selector: string, approve: RegExp) {
  const count = await page.evaluate(() => (window as never as { __perf: Perf[] }).__perf.length)
  const popup = context.waitForEvent('page', { timeout: 2_000 }).catch(() => undefined)
  const start = Date.now()
  await page.click(selector)
  const wallet =
    (await popup) ?? page.frameLocator('iframe[data-testid="tempo-wallet-postmessage"]')
  const button = wallet.getByRole('button', { name: approve })
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  const interactive = Date.now() - start
  if (selector === '#connect')
    await wallet.getByPlaceholder(/Email address or label/).fill(`perf-${Date.now()}`)
  const approved = Date.now()
  await button.click()
  await page.waitForFunction(
    (count) => {
      const perf = (window as never as { __perf: Perf[] }).__perf
      return (
        perf.length > count && perf.at(-1)!.events.some(([name]) => name.startsWith('callback'))
      )
    },
    count,
    { timeout: 30_000 },
  )
  const callback = Date.now() - approved
  const perf = await page.evaluate(() => (window as never as { __perf: Perf[] }).__perf.at(-1)!)
  return {
    action: perf.action,
    approve_to_callback: callback,
    error: perf.error,
    mode: 'url' in wallet ? 'popup' : 'iframe',
    open_to_interactive: interactive,
  }
}

const results = []
for (let run = 0; run < Number(runs); run++) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const credentials: unknown[] = []
  context.on('page', (page) => void authenticate(context, page, credentials))
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForTimeout(1_500)
  results.push({ run, ...(await step(context, page, '#connect', /^Create account$/)) })
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(800)
    results.push({ run, ...(await step(context, page, '#sign', /^(Sign|Approve|Confirm)/)) })
  }
  await context.close()
}
await browser.close()

console.table(results)
