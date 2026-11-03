/**
 * Tests the web playground's headless sign-in of a returning user, who holds a Tempo ID session
 * already, on a chain whose accounts are configurable (TIP-1107), and its call to the API playground.
 * @module
 */
import { Account } from 'viem/tempo'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, signIn, test as base } from '../Playwright.js'
import { Chain, Harness, Realm, Schema, Sql, TempoApi } from '../TempoId.js'

/** The suite's `test`, whose harness makes the accounts of the local chain configurable. */
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

test.describe('web app (headless) with configurable accounts', () => {
  // The `default` realm's secp256k1 owners stand in for cloud wallets during each test.
  test.beforeEach(async ({ database }) => {
    await Realm.setSecp256k1(database.db, { enabled: true, realmId: 'default' })
  })
  test.afterEach(async ({ database, page }) => {
    await page.context().unrouteAll({ behavior: 'ignoreErrors' })
    await Realm.setSecp256k1(database.db, {
      enabled: false,
      realmId: 'default',
    })
  })

  test('authorizes a returning user with one request after the session check, and reads the account from its response', async ({
    baseURL,
    code,
    database,
    email,
    page,
    playgrounds,
  }, info) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('web', Permissions.env(Permissions.matrix[3].permissions)),
    ])
    await signIn(page, { code, email })
    const requests: string[] = []
    page.context().on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.origin === new URL(baseURL!).origin &&
        url.pathname.startsWith('/v1/')
      )
        requests.push(`${request.method()} ${url.pathname}`)
    })
    const authorized = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/v1/authorize',
    )

    const started = Date.now()
    await page.goto(Playgrounds.url('web'))

    await expect(page.locator('#who')).toHaveText(email, { timeout: 30_000 })
    await expect(page.locator('#account')).toHaveText(/^0x[0-9a-fA-F]{40}$/)
    const accountMs = Date.now() - started
    const account = await page.locator('#account').textContent()
    // The account is the configurable account of the cloud wallet, not the wallet's own address.
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
    await page.getByRole('button', { name: 'Call the API' }).click()
    await expect(page.locator('#api')).toContainText(
      Playgrounds.clientId('web'),
    )

    // The authorization returns the account, so the page reads no `GET /v1/account`.
    expect(requests).toEqual(['GET /v1/auth/session', 'POST /v1/authorize'])
    const body = (await (await authorized).json()) as {
      account: string
      tempo?: readonly { address: string; realm: { id: string } }[]
    }
    expect(body.tempo?.[0]?.address).toBe(body.account)
    expect(body.account).toBe(account)

    await info.attach('navigation', {
      body: JSON.stringify({ accountMs }),
      contentType: 'application/json',
    })
  })
})
