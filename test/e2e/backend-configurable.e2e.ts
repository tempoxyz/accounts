/**
 * Tests concurrent backend redirects with spending limits on a configurable account.
 * @module
 */
import { Account } from 'viem/tempo'
import * as Journeys from '../Journeys.js'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, signIn, test as base } from '../Playwright.js'
import { Chain, Harness, Realm, Schema, Sql, TempoApi } from '../TempoId.js'

/** Enables configurable accounts on the suite's local chain. */
const test = base.extend<object, { harness: Harness.Instance }>({
  harness: [
    async ({ database }, use) => {
      const url = new URL(TempoApi.url)
      url.username = 'tempo'
      url.password = 'sk:admin'
      const harness = Harness.create({
        secrets: {
          CONFIGURABLE_ACCOUNTS: 'local',
          DATABASE_URL: database.url,
          TEMPO_API_URLS: `local:${Chain.chain.id}=${url.href}`,
        },
      })
      await harness.listen()
      await use(harness)
      await harness.close()
    },
    { scope: 'worker' },
  ],
})

test('preserves the newest backend sign-in after an older approval returns a mismatched state', async ({
  code,
  context,
  database,
  email,
  errors,
  page,
  playgrounds,
}, info) => {
  test.setTimeout(120_000)
  await Realm.setSecp256k1(database.db, { enabled: true, realmId: 'default' })
  await Promise.all([
    playgrounds('api'),
    playgrounds('backend', Permissions.env(Permissions.matrix[3].permissions)),
  ])
  await signIn(page, { code, email })

  const latest = await context.newPage()
  latest.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  latest.on('pageerror', (error) => errors.push(error.message))
  type Request = { path: string; step: string }
  type Timing = { path: string; value: string }
  const requests: Request[] = []
  const timing: Timing[] = []
  let step = 'first approval'
  context.on('request', (request) => {
    requests.push({ path: new URL(request.url()).pathname, step })
  })
  context.on('response', (response) => {
    const value = response.headers()['server-timing']
    if (value) timing.push({ path: new URL(response.url()).pathname, value })
  })
  const started = Date.now()

  try {
    await page.goto(Playgrounds.url('backend'))
    await hydrated(page)
    await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
    await expect(page).toHaveURL(/\/authorize\?.*sig=/)
    await hydrated(page)
    await expect(page.getByText('Spend $10', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled()

    step = 'latest approval'
    await latest.goto(Playgrounds.url('backend'))
    await hydrated(latest)
    await latest.getByRole('link', { name: 'Sign in with Tempo' }).click()
    await expect(latest).toHaveURL(/\/authorize\?.*sig=/)
    await hydrated(latest)
    await expect(latest.getByText('Spend $10', { exact: true })).toBeVisible()
    await expect(latest.getByRole('button', { name: 'Approve' })).toBeEnabled()
    if (process.env.CURIOUS_DOG_CAPTURE_DIR)
      await latest.screenshot({
        mask: [latest.getByText(email, { exact: true })],
        path: `${process.env.CURIOUS_DOG_CAPTURE_DIR}/approval.png`,
      })

    const pending = (
      await context.cookies(Playgrounds.origin('backend'))
    ).filter((cookie) => /backend-(key|pending)$/.test(cookie.name))

    step = 'stale callback'
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText('Sign-in failed. Start again.')).toBeVisible()
    expect(errors.splice(0)).toEqual([expect.stringContaining('status of 400')])

    expect(
      (await context.cookies(Playgrounds.origin('backend'))).filter((cookie) =>
        /backend-(key|pending)$/.test(cookie.name),
      ),
    ).toEqual(pending)

    step = 'latest callback'
    const approved = Date.now()
    await latest.getByRole('button', { name: 'Approve' }).click()
    await expect(latest.locator('#email')).toHaveText(email)
    await expect(latest.locator('#api')).toContainText(
      Playgrounds.clientId('backend'),
    )
    const approvalMs = Date.now() - approved
    const account = await latest.locator('#account').textContent()
    // Version zero is derived from the owner, without an account_configs row.
    const [owner] = await database.db
      .select({ address: Schema.secp256k1Owners.address })
      .from(Schema.secp256k1Owners)
      .innerJoin(
        Schema.user,
        Sql.eq(Schema.user.id, Schema.secp256k1Owners.userId),
      )
      .where(Sql.eq(Schema.user.email, email))
    expect(account?.toLowerCase()).toBe(
      Account.fromConfig({
        owners: [owner!.address as `0x${string}`],
      }).address.toLowerCase(),
    )
    expect(account?.toLowerCase()).not.toBe(owner!.address.toLowerCase())

    expect(
      (await context.cookies(Playgrounds.origin('backend'))).filter((cookie) =>
        /backend-(key|pending)$/.test(cookie.name),
      ),
    ).toEqual([])

    step = 'fund and send'
    await hydrated(latest)
    await Journeys.send(latest)
    await info.attach('navigation', {
      body: JSON.stringify({ approvalMs, elapsedMs: Date.now() - started }),
      contentType: 'application/json',
    })
  } finally {
    await info.attach('traffic', {
      body: JSON.stringify({ requests, timing }),
      contentType: 'application/json',
    })
    if (process.env.CURIOUS_DOG_CAPTURE_DIR)
      await latest.screenshot({
        mask: [latest.locator('#email'), latest.locator('#api')],
        path: `${process.env.CURIOUS_DOG_CAPTURE_DIR}/callback.png`,
      })
    await latest.close()
    await Realm.setSecp256k1(database.db, {
      enabled: false,
      realmId: 'default',
    })
  }
})
