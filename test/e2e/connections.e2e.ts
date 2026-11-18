/**
 * Tests connections on the connected page of the backend test app: a sign-in with `resource`, the
 * approval of what the API of a registered resource may do, the API's access key of the connection
 * from its access key endpoint and from an allowance, a transfer that the API sends for the user,
 * the API's revocations, and the app's own read and end of its connection. The node holds each
 * access key, each transfer, and each revocation.
 * @module
 */
import type { Page } from '@playwright/test'
import { getAddress, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Web from '../Web.js'

/** The connected page's URL, which is its own redirect URI. */
const connected = `${Apps.backend.url}${Apps.backend.paths.connected}`

/** More than the fee of one transaction of the suite, in the base units of a USD token: 0.02. */
const fee = 20_000n

/** What each API access key may send, as the policy of both resources holds it: 25 OUSD. */
const limit = parseUnits('25', 6)

/** The name of each API of the backend test app, as its sign-in action and its routes hold it. */
type Api = keyof typeof Apps.backend.resources

/** The connection of an API, as its routes return it. */
type Connection = {
  /** The Tempo Account that the API's access key acts for. */
  account: `0x${string}`
  /** The address of the API's access key. */
  key: `0x${string}`
}

/**
 * Approves the API on Tempo ID's approval page on `page`, and waits for the connected page with its
 * session.
 */
async function approve(page: Page) {
  await Playwright.approve(page)
  await returned(page)
}

/**
 * Signs `email` in for the API `api` on the connected page on `page`, approves the API, lets the
 * API open its connection, and funds the Tempo Account, as the first step of a test. Returns the
 * connection.
 */
function connect(page: Page, options: connect.Options): Promise<Connection> {
  const { api, code, email } = options
  return test.step(`signs in for the ${api} API, and funds the account`, async () => {
    await page.goto(connected)
    await leave(page, api)
    await Playwright.signIn(page, { code, email })
    await approve(page)
    const connection = await Playwright.run(page, { name: 'Connect' })
    expect(connection).toMatchObject({
      state: 'fulfilled',
      value: { status: 200 },
    })
    await Chain.fund({ address: connection.value.body.account })
    return connection.value.body
  })
}

declare namespace connect {
  type Options = {
    /** The API that the sign-in names. */
    api: Api
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
  }
}

/**
 * Starts the sign-in for the API `api` on the connected page on `page`, and waits for Tempo ID's
 * page.
 */
async function leave(page: Page, api: Api) {
  await Playwright.start(page, { name: `Sign in for the ${api} API` })
  await page.waitForURL(`${TempoId.url}/**`)
}

/** Returns what the node holds of the access key of `connection`. */
function metadata(connection: Connection) {
  return Chain.accessKey({
    accessKey: connection.key,
    address: connection.account,
  })
}

/** Waits until `page` shows the connected page with a session, after a return from Tempo ID. */
async function returned(page: Page) {
  await page.waitForURL((value) => value.href === connected)
  await expect(page.locator('#status')).toHaveText('signedIn')
}

/**
 * Sends 1 OUSD through the API of the session of the connected page on `page`, and expects the
 * transfer on the node, from the Tempo Account of `connection`. Returns the recipient.
 */
async function send(page: Page, connection: Connection) {
  const recipient = privateKeyToAddress(generatePrivateKey())
  const sent = await Playwright.send(page, { amount: '1', to: recipient })

  expect(sent).toMatchObject({ state: 'fulfilled', value: { status: 200 } })
  expect(
    await Chain.transfers({ hash: sent.value.body.transactionHash }),
  ).toContainEqual({
    amount: parseUnits('1', 6),
    from: getAddress(connection.account),
    to: recipient,
  })
  return recipient
}

test.describe('connections', () => {
  test.describe('connections.connect', () => {
    test('claims the access key that the API prepared at the approval, and sends for the user', async ({
      capture,
      code,
      email,
      page,
      request,
    }) => {
      await page.goto(connected)

      await test.step('shows what the API may do, on Tempo ID’s approval page', async () => {
        await leave(page, 'prepared')
        await Playwright.signIn(page, { code, email })

        const grant = Playwright.grant(page)
        await expect(grant).toContainText(
          'Prepared API of the backend test app will be able to, for this app:',
        )
        await expect(grant).toContainText('Spend $25')
        await expect(grant).toContainText('Expires in 1 day')
        await capture('approval page')
      })

      await test.step('returns with a session that holds no access key, and no connection yet', async () => {
        await approve(page)

        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: { email, key: null },
        })
        expect(await Playwright.run(page, { name: 'Stored' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        await capture('signed in')
      })

      const connection =
        await test.step('claims the access key of the approval with the app’s access token', async () => {
          const opened = await Playwright.run(page, { name: 'Connect' })

          expect(opened).toEqual({
            state: 'fulfilled',
            value: {
              body: {
                accessKeys: [expect.stringMatching(/^0x[0-9a-f]{40}$/)],
                account: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
                clientId: Apps.backend.clientIdPage,
                key: opened.value.body.accessKeys[0],
                resource: Apps.backend.resources.prepared,
                userId: expect.stringMatching(/^user_/),
              },
              status: 200,
            },
          })
          await capture('connected')
          return opened.value.body as Connection
        })

      await test.step('sends 1 OUSD with the API’s access key, within the limit of the policy', async () => {
        await Chain.fund({ address: connection.account })
        const recipient = await send(page, connection)

        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(parseUnits('1', 6))
        expect(await metadata(connection)).toMatchObject({
          isRevoked: false,
          spendPolicy: 'limited',
        })
        const left = await Chain.remaining({
          accessKey: connection.key,
          address: connection.account,
          token: Chain.ousd,
        })
        expect(left).toBeLessThan(limit - parseUnits('1', 6))
        expect(left).toBeGreaterThan(limit - parseUnits('1', 6) - fee)
        await capture('sent')
      })

      await test.step('refuses a second use of the access key request’s token, and a request without one', async () => {
        // The token lives 60 seconds, so the endpoint refuses this one for its repeated `jti`.
        expect(
          await Playwright.run(page, { name: 'Replay the access key request' }),
        ).toEqual({
          state: 'fulfilled',
          value: {
            body: { error: 'invalid_token', status: 401 },
            status: 200,
          },
        })
        const bare = await request.post(
          `${Apps.backend.url}/apis/prepared/access-keys`,
        )
        expect(bare.status()).toBe(401)
        expect(await bare.json()).toEqual({ error: 'invalid_token' })
        await capture('replay refused')
      })
    })

    test('redeems the allowance of the approval for an access key, once', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await page.goto(connected)

      await test.step('shows what the API may do, on Tempo ID’s approval page', async () => {
        await leave(page, 'deferred')
        await Playwright.signIn(page, { code, email })

        await expect(Playwright.grant(page)).toContainText(
          'Deferred API of the backend test app will be able to, for this app:',
        )
        await capture('approval page')
        await approve(page)
      })

      const connection =
        await test.step('redeems the allowance at the first call, and returns the stored connection after', async () => {
          expect(await Playwright.run(page, { name: 'Stored' })).toEqual({
            state: 'fulfilled',
            value: { body: null, status: 200 },
          })
          const first = await Playwright.run(page, { name: 'Connect' })
          const second = await Playwright.run(page, { name: 'Connect' })
          const stored = await Playwright.run(page, { name: 'Stored' })

          expect(first).toMatchObject({
            state: 'fulfilled',
            value: {
              body: {
                accessKeys: [expect.stringMatching(/^0x[0-9a-f]{40}$/)],
                clientId: Apps.backend.clientIdPage,
                resource: Apps.backend.resources.deferred,
              },
              status: 200,
            },
          })
          expect(first.value.body.key).toBe(first.value.body.accessKeys[0])
          expect(second).toEqual(first)
          expect(stored).toEqual(first)
          await capture('connected')
          return first.value.body as Connection
        })

      await test.step('sends 1 OUSD with the API’s access key', async () => {
        await Chain.fund({ address: connection.account })
        const recipient = await send(page, connection)

        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(parseUnits('1', 6))
        expect(await metadata(connection)).toMatchObject({
          isRevoked: false,
          spendPolicy: 'limited',
        })
        await capture('sent')
      })
    })
  })

  test.describe('connections.revokeAccessKey', () => {
    test('revokes one access key of the connection, which then needs a new approval', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const connection = await connect(page, { api: 'deferred', code, email })
      // The node holds an access key from its first transaction.
      await send(page, connection)

      await test.step('revokes the access key on the node, once', async () => {
        await page.getByLabel('Access key').fill(connection.key)
        const name = 'Revoke the access key'
        const revoked = await Playwright.run(page, { name })
        const repeated = await Playwright.run(page, { name })

        expect(revoked).toEqual({
          state: 'fulfilled',
          value: {
            body: { transactionHash: expect.stringMatching(/^0x/) },
            status: 200,
          },
        })
        expect(await metadata(connection)).toMatchObject({ isRevoked: true })
        // The connection holds the access key no longer, so the API sends no second revocation.
        expect(repeated).toEqual({
          state: 'fulfilled',
          value: { body: { transactionHash: null }, status: 200 },
        })
        await capture('revoked')
      })

      await test.step('holds no connection, and no allowance for a new access key', async () => {
        expect(await Playwright.run(page, { name: 'Stored' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        expect(await Playwright.run(page, { name: 'Connect' })).toMatchObject({
          state: 'fulfilled',
          value: { body: { error: 'unknown_allowance' }, status: 404 },
        })
        // The browser logs each response with a failure status.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[404]])
        await capture('no allowance')
      })

      await test.step('opens the connection again with a new access key, after a new approval', async () => {
        await leave(page, 'deferred')
        await expect(Playwright.grant(page)).toContainText(
          'Deferred API of the backend test app will be able to, for this app:',
        )
        await approve(page)
        const opened = await Playwright.run(page, { name: 'Connect' })

        expect(opened).toMatchObject({
          state: 'fulfilled',
          value: { body: { account: connection.account }, status: 200 },
        })
        expect(opened.value.body.key).not.toBe(connection.key)
        await send(page, opened.value.body)
        expect(await metadata(opened.value.body)).toMatchObject({
          isRevoked: false,
        })
        await capture('connected again')
      })
    })
  })

  test.describe('connections.revoke', () => {
    test('revokes each access key of the connection, and deletes the connection', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const connection = await connect(page, { api: 'prepared', code, email })
      await send(page, connection)

      await test.step('revokes the access key on the node, and returns the transaction', async () => {
        expect(
          await Playwright.run(page, { name: 'Revoke the connection' }),
        ).toEqual({
          state: 'fulfilled',
          value: {
            body: { transactionHashes: [expect.stringMatching(/^0x/)] },
            status: 200,
          },
        })
        expect(await metadata(connection)).toMatchObject({ isRevoked: true })
        await capture('revoked')
      })

      await test.step('holds no connection, and refuses the access token of the ended one', async () => {
        expect(await Playwright.run(page, { name: 'Stored' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 200 },
        })
        // The token names the access key request of its approval, whose access key the API deleted.
        expect(await Playwright.run(page, { name: 'Connect' })).toMatchObject({
          state: 'fulfilled',
          value: { body: { error: 'connection_mismatch' }, status: 400 },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        await capture('connection deleted')
      })
    })
  })

  test.describe('connection', () => {
    test('returns the connection with the access key that the API holds, and ends it', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const connection = await connect(page, { api: 'prepared', code, email })
      await send(page, connection)

      await test.step('rejects with the access token for the API, which Tempo ID’s own routes refuse', async () => {
        expect(await Playwright.run(page, { name: 'Connection' })).toEqual({
          state: 'rejected',
          value: {
            code: 'invalid_token',
            message:
              'Invalid access token: it names another audience. Request a token without `resource` for this route.',
            name: 'Accounts.RequestError',
            reason: 'invalid_token',
            status: 401,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
        await capture('API token refused')
      })

      await test.step('returns the app, and the access key with the API that holds it', async () => {
        // Tempo ID holds the user's session and consent, so the sign-in shows no page.
        await Promise.all([
          page.waitForRequest(
            (sent) =>
              sent.isNavigationRequest() &&
              sent.url().startsWith(`${TempoId.url}/`),
          ),
          Playwright.start(page, { name: 'Sign in' }),
        ])
        await returned(page)

        expect(await Playwright.run(page, { name: 'Connection' })).toEqual({
          state: 'fulfilled',
          value: {
            accessKeys: [
              {
                account: getAddress(connection.account),
                address: getAddress(connection.key),
                chainId: Chain.chain.id,
                createdAt: expect.any(Number),
                expiresAt: expect.any(Number),
                holder: {
                  identifier: Apps.backend.resources.prepared,
                  kind: 'api',
                  name: 'Prepared API of the backend test app',
                },
              },
            ],
            app: {
              clientId: Apps.backend.clientIdPage,
              logo: null,
              name: 'Backend test app pages',
            },
          },
        })
        await capture('connection')
      })

      await test.step('ends the connection, which revokes the API’s access key, and signs out', async () => {
        expect(await Playwright.run(page, { name: 'Disconnect' })).toEqual({
          state: 'fulfilled',
          value: {
            remaining: [],
            revoked: [
              {
                address: getAddress(connection.key),
                transaction: expect.stringMatching(/^0x/),
              },
            ],
          },
        })

        await expect(page.locator('#status')).toHaveText('signedOut')
        expect(await metadata(connection)).toMatchObject({ isRevoked: true })
        expect(await Playwright.run(page, { name: 'Session' })).toEqual({
          state: 'fulfilled',
          value: null,
        })
        await capture('disconnected')
      })
    })
  })
})
