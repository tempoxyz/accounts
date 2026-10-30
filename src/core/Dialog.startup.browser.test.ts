import { chromium, type Browser, type Page } from 'playwright-core'
import { createServer, type ViteDevServer } from 'vp'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vp/test'

let browser: Browser
let page: Page
let server: ViteDevServer
let origin: string
let errors: string[]

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    plugins: [
      {
        name: 'dialog-fixtures',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.startsWith('/fixture')) {
              response.setHeader('Content-Type', 'text/html')
              response.end('<script type="module" src="/test/dialog-startup.ts"></script>')
            } else if (request.url?.startsWith('/remote')) {
              response.setHeader('Content-Type', 'text/html')
              response.end(`<script>
        if (sessionStorage.getItem('ready'))
          parent.postMessage({ topic: 'ready', payload: { trustedHosts: ['localhost'] } }, '*')
        window.addEventListener('message', (event) => {
          if (event.data.topic !== 'rpc-requests') return
          for (const request of event.data.payload.requests)
            parent.postMessage({ topic: 'observed', id: request.request.id }, event.origin)
        })
      </script>`)
            } else next()
          })
        },
      },
    ],
    root: process.cwd(),
    server: { host: '0.0.0.0', port: 0 },
    optimizeDeps: { include: ['ox', 'viem', 'viem/tempo/chains'] },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  origin = `http://localhost:${address.port}`
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
})

beforeEach(async () => {
  page = await browser.newPage()
  page.setDefaultTimeout(8_000)
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/fixture`)
  await page.waitForFunction('Boolean(window.fixture)')
  await page.clock.install()
  await page.evaluate('fixture.setup()')
  await page.waitForFunction("document.querySelector('iframe') !== null")
  await page.frames()[1]!.waitForLoadState()
})

afterEach(async () => {
  await page.close()
  expect(errors).toMatchInlineSnapshot('[]')
})

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

async function ready() {
  await page.frames()[1]!.evaluate(() => {
    parent.postMessage({ topic: 'ready', payload: { trustedHosts: ['localhost'] } }, '*')
  })
  // Flush the real postMessage task before advancing the mocked timer.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      }),
  )
}

test('unreachable startup rejects through the coordinator, redacts URL, never dispatches late', async () => {
  await page.evaluate('fixture.begin()')
  await page.clock.fastForward(15_001)
  await page.waitForFunction('fixture.results.length === 1')
  const result = await page.evaluate<{
    code: number
    data: { origin: string; stage: string }
    message: string
  }>('fixture.results[0]')
  expect({
    ...result,
    data: { ...result.data, origin: new URL(result.data.origin).hostname },
  }).toMatchObject({ code: -32000, data: { origin: '127.0.0.1', stage: 'dialog_ready' } })
  expect(result.message.includes('never-show-this')).toMatchInlineSnapshot('false')
  expect(result.message.includes('/remote')).toMatchInlineSnapshot('false')
  await ready()
  await page.clock.fastForward(60_000)
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
  expect(
    await page.locator('dialog').evaluate((element) => (element as HTMLDialogElement).open),
  ).toMatchInlineSnapshot('false')
})

test('fresh request succeeds after timeout, without replay and without timing out approval', async () => {
  await page.evaluate('fixture.begin()')
  await page.clock.fastForward(15_001)
  await page.waitForFunction('fixture.results.length === 1')
  await ready()
  await page.evaluate('fixture.begin()')
  await page.waitForFunction('fixture.received.length === 1')
  await page.clock.fastForward(120_000)
  expect(await page.evaluate('fixture.results.length')).toMatchInlineSnapshot('1')
  const id = await page.evaluate('fixture.received[0]')
  await page.frames()[1]!.evaluate((id) => {
    parent.postMessage({ topic: 'rpc-response', payload: { id, result: 'approved' } }, '*')
  }, id)
  await page.waitForFunction('fixture.results.length === 2')
  expect(await page.evaluate('fixture.results[1]')).toMatchInlineSnapshot(`
    {
      "result": "approved",
    }
  `)
  expect(await page.evaluate('fixture.received.length')).toMatchInlineSnapshot('1')
})

test('ready success dispatches once and ignores a wrong-origin readiness event', async () => {
  await page.evaluate('fixture.begin()')
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { topic: 'ready', payload: {} },
        origin: 'https://wrong.example',
      }),
    ),
  )
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
  await ready()
  await page.waitForFunction('fixture.received.length === 1')
  expect(
    await page.locator('dialog').evaluate((element) => (element as HTMLDialogElement).open),
  ).toMatchInlineSnapshot('true')
})

test('cancellation before readiness cannot open or dispatch later', async () => {
  await page.evaluate('fixture.begin(); fixture.cancel()')
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].code')).toMatchInlineSnapshot('4001')
  await ready()
  await page.clock.fastForward(60_000)
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
  expect(
    await page.locator('dialog').evaluate((element) => (element as HTMLDialogElement).open),
  ).toMatchInlineSnapshot('false')
})

test('destroy rejects startup and disconnects the observer instead of resurrecting the iframe', async () => {
  await page.evaluate('fixture.begin(); fixture.destroy()')
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].data.stage')).toMatchInlineSnapshot(`"closed"`)
  await page.clock.fastForward(60_000)
  expect(await page.locator('dialog').count()).toMatchInlineSnapshot('0')
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
})

test('a fresh request reloads an unready document after its service recovers', async () => {
  await page.evaluate('fixture.begin()')
  await page.clock.fastForward(15_001)
  await page.waitForFunction('fixture.results.length === 1')
  await page.frames()[1]!.evaluate(() => sessionStorage.setItem('ready', 'true'))
  await page.evaluate('fixture.begin()')
  await page.waitForFunction('fixture.received.length === 1')
  expect(await page.evaluate('fixture.results.length')).toMatchInlineSnapshot('1')
  expect(await page.evaluate('fixture.received.length')).toMatchInlineSnapshot('1')
})

test('destroy also rejects a request already waiting on human approval', async () => {
  await ready()
  await page.evaluate('fixture.begin()')
  await page.waitForFunction('fixture.received.length === 1')
  await page.evaluate('fixture.destroy()')
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].data.stage')).toMatchInlineSnapshot(`"closed"`)
  expect(await page.locator('dialog').count()).toMatchInlineSnapshot('0')
})

test('blocked popups reject with safe actionable dispatch errors', async () => {
  await page.evaluate(() => {
    window.open = () => null
  })
  await page.evaluate("fixture.destroy(); fixture.setup('popup'); fixture.begin()")
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].data.stage')).toMatchInlineSnapshot(`"dispatch"`)
  expect(await page.evaluate('fixture.results[0].code')).toMatchInlineSnapshot('-32000')
})

test('Safari connect still falls back to a popup and bounds only its startup', async () => {
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Version/17.0 Safari/605.1.15',
    }),
  )
  await ready()
  const opened = page.context().waitForEvent('page')
  await page.evaluate("fixture.begin('wallet_connect')")
  const popup = await opened
  await popup.waitForLoadState()
  await page.clock.fastForward(15_001)
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].data.stage')).toMatchInlineSnapshot(
    `"dialog_ready"`,
  )
  expect(popup.isClosed()).toMatchInlineSnapshot('true')
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
})

test('real iframe timeout survives Provider, dialog adapter and viem signing wrappers', async () => {
  await page.evaluate('fixture.provider()')
  // Let account hydration and request validation reach the actual dialog wait.
  await page.clock.runFor(100)
  await page.clock.fastForward(15_001)
  await page.waitForFunction('fixture.results.length === 1')
  expect(await page.evaluate('fixture.results[0].code')).toMatchInlineSnapshot('-32000')
  expect(await page.evaluate('fixture.results[0].data.stage')).toMatchInlineSnapshot(
    `"dialog_ready"`,
  )
  expect(await page.evaluate('fixture.received')).toMatchInlineSnapshot('[]')
})
