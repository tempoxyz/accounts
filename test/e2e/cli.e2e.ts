/**
 * Tests the CLI playground's sign-in through the device grant, as a browser approves or denies its
 * code on `/device`. Approval creates the account and signs the key, which the CLI sends with.
 * @module
 */
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import type { Page } from '@playwright/test'
import * as Admin from '../Admin.js'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, signIn, test } from '../Playwright.js'

/** The device app of the CLI, in the `tempo-cash` realm. */
const clientId = 'tempo-cli-cash'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
  // Each worker's database holds the app once, so a later spec of the worker keeps it.
  await Admin.request(admin, { path: `/apps/${clientId}` }).catch(() =>
    Admin.createApp(admin, { clientId, device: true, name: 'Tempo Cash CLI' }),
  )
  await Admin.setAppRealms(admin, { clientId, realms: ['tempo-cash'] })
})

test.describe('CLI', () => {
  test.setTimeout(120_000)

  let controller: AbortController
  let env: Record<string, string>

  test.beforeEach(async ({ baseURL }) => {
    controller = new AbortController()
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'tempo-cli-'))
    env = {
      CLIENT_ID: clientId,
      TEMPO_ID_CREDENTIALS: Path.join(directory, 'credentials.json'),
      TEMPO_ID_URL: new URL(baseURL!).origin,
    }
  })

  test.afterEach(async () => {
    // A failed test can leave `login` polling, so its process stops here.
    controller.abort()
    await Fs.rm(Path.dirname(env.TEMPO_ID_CREDENTIALS!), {
      force: true,
      recursive: true,
    })
  })

  for (const entry of Permissions.matrix)
    test(`signs in with a device code and ${entry.name}, sends, and signs out`, async ({
      code,
      email,
      page,
    }) => {
      await test.step('treats credentials without a user or a key as signed out', async () => {
        await Fs.writeFile(
          env.TEMPO_ID_CREDENTIALS!,
          JSON.stringify({
            accessToken: 'old',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'old',
          }),
        )
        expect(await run(['whoami'])).toContain('Not signed in')
      })

      await test.step('signs in once the browser approves', async () => {
        const login = Playgrounds.cli({
          args: ['login'],
          env: { ...env, ...Permissions.env(entry.permissions) },
          signal: controller.signal,
        })
        await open(page, login, { code, email, limit: entry.limit })
        // The sign-in approves the code. Approval also creates the account and signs the key authorization.
        await expect(page.getByText('You can close this tab.')).toBeVisible({
          timeout: 30_000,
        })
        await login.exited
        expect(login.output()).toContain(email)
      })

      await test.step('shows the user and Tempo Account', async () => {
        const whoami = await run(['whoami'])
        expect(whoami).toContain(email)
        expect(whoami).toMatch(/0x[0-9a-fA-F]{40}/)
      })

      await test.step('sends no token to another deployment', async () => {
        const elsewhere = Playgrounds.cli({
          args: ['whoami'],
          env: { ...env, TEMPO_ID_URL: 'https://id.example.com' },
          signal: controller.signal,
        })
        await elsewhere.exited
        expect(elsewhere.output()).toContain('Not signed in')
      })

      await test.step('sends with its access key', async () => {
        expect(await run(['fund'])).toContain('funded: true')
        expect(
          await run([
            'send',
            '0x000000000000000000000000000000000000dEaD',
            '0.01',
          ]),
        ).toContain('success')
      })

      await test.step('signs out', async () => {
        await run(['logout'])
        expect(await run(['whoami'])).toContain('Not signed in')
      })
    })

  test('signs in with a device code, and pays MPP charges and a session with its access key', async ({
    code,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('api')
    const api = { API_URL: Playgrounds.origin('api') }

    await test.step('signs in once the browser approves', async () => {
      const login = Playgrounds.cli({
        args: ['login'],
        env,
        signal: controller.signal,
      })
      await open(page, login, { code, email, limit: 'Spend $1,000' })
      await expect(page.getByText('You can close this tab.')).toBeVisible({
        timeout: 30_000,
      })
      await login.exited
      expect(await run(['fund'])).toContain('funded: true')
    })

    await test.step('pays a charge in pull and push mode', async () => {
      const pull = await run(['pay', '--json'], { env: api })
      const push = await run(['pay', '--mode', 'push', '--json'], { env: api })

      expect(pull).toContain('Your code compiles on the first try.')
      expect(push).toContain('Your code compiles on the first try.')
    })

    await test.step('refuses a charge above --max before it signs', async () => {
      const output = await run(['pay', '--max', '0.001'], { env: api })

      expect(output).toContain('The charge of 0.01 exceeds')
    })

    await test.step('pays two requests of a session with vouchers, and closes it', async () => {
      const output = await run(['pay', '--requests', '2', '--json'], {
        env: api,
      })

      expect(output).toContain('Paid with a voucher.')
      // The second receipt counts both requests, and the close settles the channel.
      expect(output).toMatch(/"units":\s*2/)
      expect(output).toMatch(/"closed":\s*\{[^}]*"status":\s*"success"/)
    })
  })

  test('stays signed out when the device code is denied', async ({
    code,
    email,
    page,
  }) => {
    const login = Playgrounds.cli({
      args: ['login'],
      env,
      signal: controller.signal,
    })
    // The sign-in approves the code, so the user signs in first, and denies it on the device page.
    await signIn(page, { code, email })
    await expect
      .poll(() => login.output(), { timeout: 15_000 })
      .toContain('Open http')
    const link = new URL(/Open (\S+)/.exec(login.output())![1]!)
    await page.goto(link.pathname + link.search)
    await expect(page.getByText('Spend $1,000', { exact: true })).toBeVisible()
    await hydrated(page)
    await page.getByRole('button', { name: 'Deny' }).click()
    await expect(
      page.getByText('Denied. The device was not signed in.'),
    ).toBeVisible()

    await login.exited
    expect(login.output()).toContain('DENIED')
    expect(await run(['whoami'])).toContain('Not signed in')
  })

  test('refuses to sign in for a key on another chain than the one it sends on', async () => {
    const login = Playgrounds.cli({
      args: ['login'],
      env: { ...env, PERMISSIONS: '{"chainId":1}' },
      signal: controller.signal,
    })
    await login.exited

    expect(login.output()).toContain('CHAIN_MISMATCH')
    expect(await run(['whoami'])).toContain('Not signed in')
  })

  /**
   * Runs a CLI command to completion, with `options.env` over the test's environment, and returns its
   * output.
   */
  async function run(
    args: readonly string[],
    options: { env?: Record<string, string> } = {},
  ) {
    const command = Playgrounds.cli({
      args,
      env: { ...env, ...options.env },
      signal: controller.signal,
    })
    await command.exited
    return command.output()
  }
})

/**
 * Opens the link that `login` prints at the harness, waits for the sign-in page to show `limit`, and
 * signs in, which approves the code.
 */
async function open(
  page: Page,
  login: ReturnType<typeof Playgrounds.cli>,
  options: {
    code: (email: string) => Promise<string>
    email: string
    limit: string
  },
) {
  const { code, email, limit } = options
  // A cold Node process loads the CLI before it requests the device code.
  await expect
    .poll(() => login.output(), { timeout: 15_000 })
    .toContain('Open http')
  const link = new URL(/Open (\S+)/.exec(login.output())![1]!)
  await page.goto(link.pathname + link.search)
  await expect(page).toHaveURL(/\/login\?return_to=/)
  // The sign-in page shows the key authorization beside the device, and its sign-in approves it.
  await expect(page.getByText(limit, { exact: true })).toBeVisible()
  await hydrated(page)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page
    .getByRole('textbox', { exact: true, name: 'Code' })
    .fill(await code(email))
}
