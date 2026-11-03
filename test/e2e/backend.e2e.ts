/**
 * Tests the backend playground, a confidential client that redeems the code on its server with its
 * secret, and holds each session through `BackendSession`. In the `tempo-cash` realm, it sends with
 * the key of each case of `Permissions.matrix`.
 * @module
 */
import type { Page } from '@playwright/test'
import * as Admin from '../Admin.js'
import * as Journeys from '../Journeys.js'
import * as Permissions from '../Permissions.js'
import * as Playgrounds from '../Playgrounds.js'
import { expect, hydrated, test } from '../Playwright.js'
import { Schema, Sql } from '../TempoId.js'

test.beforeAll(async ({ admin, database }) => {
  await Playgrounds.realms(database, { admin })
})

test.describe('backend app', () => {
  test('signs in without a key on the Tempo ID page and calls the API from its server, then signs out of the app and revokes its refresh token', async ({
    code,
    context,
    database,
    email,
    page,
    playgrounds,
  }) => {
    await Promise.all([
      playgrounds('api'),
      playgrounds('backend', { KEY: 'false' }),
    ])

    await test.step('signs in on the Tempo ID page', async () => {
      await page.goto(Playgrounds.url('backend'))
      await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
      await expect(page).toHaveURL(/\/login\?/)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page.locator('#email')).toHaveText(email)
    })

    await test.step('calls the API from its server', async () => {
      await expect(page.locator('#api')).toContainText(
        Playgrounds.clientId('backend'),
      )
    })

    await test.step('holds only the session ID in the cookie', async () => {
      const cookies = await context.cookies(Playgrounds.origin('backend'))
      expect(
        cookies
          .filter((cookie) => cookie.name.endsWith('backend-sid'))
          .map((cookie) => ({
            httpOnly: cookie.httpOnly,
            value: cookie.value.replace(/^[\w-]{43}$/, '<session ID>'),
          })),
      ).toEqual([{ httpOnly: true, value: '<session ID>' }])
    })

    await test.step('signs out of the app but not Tempo ID', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(
        page.getByRole('link', { name: 'Sign in with Tempo' }),
      ).toBeVisible()
    })

    await test.step('revokes the refresh token at sign-out', async () => {
      const [user] = await database.db
        .select({ id: Schema.user.id })
        .from(Schema.user)
        .where(Sql.eq(Schema.user.email, email))
      const unrevoked = await database.db
        .select({ id: Schema.oauthRefreshToken.id })
        .from(Schema.oauthRefreshToken)
        .where(
          Sql.and(
            Sql.eq(
              Schema.oauthRefreshToken.clientId,
              Playgrounds.clientId('backend'),
            ),
            Sql.eq(Schema.oauthRefreshToken.userId, user!.id),
            Sql.isNull(Schema.oauthRefreshToken.revoked),
          ),
        )
      expect(unrevoked).toEqual([])
    })
  })

  test('revokes a session of the app that the browser switched from at the next sign-in', async ({
    admin,
    code,
    database,
    email,
    page,
    playgrounds,
  }) => {
    const other = `tempo-example-backend-other-${process.env.TEST_PARALLEL_INDEX ?? 0}`
    await Playgrounds.register(database, {
      admin,
      clientId: other,
      name: 'backend',
    })
    await Promise.all([
      playgrounds('api'),
      playgrounds('backend', {
        CLIENT_ID: `${Playgrounds.clientId('backend')},${other}`,
        KEY: 'false',
      }),
    ])

    await test.step('signs in to the first app', async () => {
      await page.goto(Playgrounds.url('backend'))
      await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      await expect(page.locator('#email')).toHaveText(email)
    })

    await test.step('switches to the second app, and signs in again with the session of Tempo ID', async () => {
      await page.goto(
        `${Playgrounds.origin('backend')}/?${new URLSearchParams({ client_id: other })}`,
      )
      await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
      await expect(page.locator('#email')).toHaveText(email)
    })

    await test.step("revokes the first app's refresh token", async () => {
      const live = await database.db
        .select({ clientId: Schema.oauthRefreshToken.clientId })
        .from(Schema.oauthRefreshToken)
        .innerJoin(
          Schema.user,
          Sql.eq(Schema.user.id, Schema.oauthRefreshToken.userId),
        )
        .where(
          Sql.and(
            Sql.eq(Schema.user.email, email),
            Sql.isNull(Schema.oauthRefreshToken.revoked),
          ),
        )

      expect(live).toEqual([{ clientId: other }])
    })
  })

  test('stays signed out once the user denies the key that the sign-in requests', async ({
    code,
    context,
    email,
    page,
    playgrounds,
  }) => {
    await playgrounds('backend')

    await test.step('requests a key, which the approval page can only deny', async () => {
      await page.goto(Playgrounds.url('backend'))
      await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
      await expect(page).toHaveURL(/\/login\?/)
      await hydrated(page)
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page
        .getByRole('textbox', { exact: true, name: 'Code' })
        .fill(await code(email))
      // The default realm creates no account here, so Approve stays off, as for a passkey owner.
      await expect(page).toHaveURL(/\/authorize\?.*sig=/)
      await hydrated(page)
      await page.getByRole('button', { name: 'Deny' }).click()
    })

    await test.step('returns to the app signed out, with the refusal', async () => {
      await expect(page).toHaveURL(
        `${Playgrounds.origin('backend')}/?refused=true`,
      )
      await expect(
        page.getByText('Tempo ID refused the sign-in. Sign in again.'),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Sign in with Tempo' }),
      ).toBeVisible()
      expect(
        (await context.cookies(Playgrounds.origin('backend'))).find((cookie) =>
          cookie.name.endsWith('backend-sid'),
        ),
      ).toBeUndefined()
    })
  })

  test('fails a callback that carries an error without the sign-in in progress, and starts no sign-in without a key', async ({
    errors,
    page,
    playgrounds,
  }) => {
    await playgrounds('backend')

    // The session ID's cookie is set, as when a forged link opens during a sign-in.
    await page.goto(Playgrounds.url('backend'))
    await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
    await expect(page).toHaveURL(/\/login\?/)
    await page.goto(
      `${Playgrounds.origin('backend')}/auth/callback?error=access_denied`,
    )

    await expect(page.getByText('Sign-in failed. Start again.')).toBeVisible()
    // The browser logs the callback's 400, which is the failure this test expects.
    expect(errors.splice(0)).toEqual([expect.stringContaining('status of 400')])
  })

  test('fails sign-in before the sign-in page when the client secret is wrong', async ({
    errors,
    page,
    playgrounds,
  }) => {
    await playgrounds('backend', {
      CLIENT_SECRET: 'a-wrong-client-secret-of-32-characters',
      KEY: 'false',
    })

    // The backend pushes the request with its secret, which `/oauth2/par` refuses.
    await page.goto(Playgrounds.url('backend'))
    await page.getByRole('link', { name: 'Sign in with Tempo' }).click()

    await expect(page.getByText('Sign-in failed. Start again.')).toBeVisible()
    // The browser logs the start's 400, which is the failure this test expects.
    expect(errors.splice(0)).toEqual([expect.stringContaining('status of 400')])
  })

  for (const entry of Permissions.matrix)
    test(`signs in with ${entry.name} and sends, then asks for approval on the next sign-in`, async ({
      admin,
      code,
      context,
      database,
      email,
      page,
      playgrounds,
    }) => {
      // Funding and sending add a few blocks.
      test.setTimeout(120_000)
      await Promise.all([
        playgrounds('api'),
        playgrounds('backend', Permissions.env(entry.permissions)),
      ])
      // The `tempo-cash` realm creates the account at sign-in. The other tests serve the backend
      // in the default realm, so the test restores its realms.
      await Playgrounds.register(database, {
        admin,
        name: 'backend',
        realms: ['tempo-cash'],
      })

      try {
        await test.step('signs in on the Tempo ID page, which shows the key that the sign-in grants', async () => {
          await page.goto(Playgrounds.url('backend'))
          await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
          await expect(page).toHaveURL(/\/login\?/)
          await expect(
            page.getByText(entry.limit, { exact: true }),
          ).toBeVisible()
          await hydrated(page)
          await page.getByLabel('Email').fill(email)
          await page
            .getByRole('button', { name: 'Continue with email' })
            .click()
          await page
            .getByRole('textbox', { exact: true, name: 'Code' })
            .fill(await code(email))
          await expect(page.locator('#email')).toHaveText(email, {
            timeout: 30_000,
          })
        })

        await test.step('calls the API from its server', async () => {
          await expect(page.locator('#api')).toContainText(
            Playgrounds.clientId('backend'),
          )
        })

        await test.step('sends with its access key', () => Journeys.send(page))

        const account = (await page.locator('#account').textContent())!

        await test.step('signs out of the app but not Tempo ID', async () => {
          await page.getByRole('button', { name: 'Sign out' }).click()
          await expect(
            page.getByRole('link', { name: 'Sign in with Tempo' }),
          ).toBeVisible()
        })

        // Tempo ID still holds a session, so the next sign-in shows the approval page at once.
        await test.step('denies the key on the approval page, and stays signed out', async () => {
          await page.getByRole('link', { name: 'Sign in with Tempo' }).click()
          await expect(page).toHaveURL(/\/authorize\?.*sig=/)
          await hydrated(page)
          await expect(
            page.getByText(entry.limit, { exact: true }),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Deny' }).click()
          await expect(
            page.getByText('Tempo ID refused the sign-in. Sign in again.'),
          ).toBeVisible()
          await expect(
            page.getByRole('link', { name: 'Sign in with Tempo' }),
          ).toBeVisible()
        })

        let withoutKey: string | undefined
        await test.step('signs in without a key, with no page', async () => {
          await page.goto(
            `${Playgrounds.origin('backend')}/auth/start?key=false`,
          )
          await expect(page.locator('#email')).toHaveText(email)
          await expect(
            page.getByText('Signed in without an access key.'),
          ).toBeVisible()
          withoutKey = (
            await context.cookies(Playgrounds.origin('backend'))
          ).find((cookie) => cookie.name.endsWith('backend-sid'))?.value
          expect(withoutKey).toMatch(/^[\w-]{43}$/)
        })

        await test.step('approves the key through a second redirect, for the same account', async () => {
          await page
            .getByRole('link', { name: 'Authorize an access key' })
            .click()
          await approve(page, { limit: entry.limit })
          await expect(page.locator('#account')).toHaveText(account, {
            timeout: 30_000,
          })
        })

        await test.step('replaces the session without a key, and revokes its refresh token', async () => {
          const sessions = (
            await context.cookies(Playgrounds.origin('backend'))
          )
            .filter((cookie) => cookie.name.endsWith('backend-sid'))
            .map((cookie) => cookie.value)
          const live = await database.db
            .select({ id: Schema.oauthRefreshToken.id })
            .from(Schema.oauthRefreshToken)
            .innerJoin(
              Schema.user,
              Sql.eq(Schema.user.id, Schema.oauthRefreshToken.userId),
            )
            .where(
              Sql.and(
                Sql.eq(
                  Schema.oauthRefreshToken.clientId,
                  Playgrounds.clientId('backend'),
                ),
                Sql.eq(Schema.user.email, email),
                Sql.isNull(Schema.oauthRefreshToken.revoked),
              ),
            )

          expect(sessions).toHaveLength(1)
          expect(sessions).not.toContain(withoutKey)
          // The session with the key holds the one live refresh token.
          expect(live).toHaveLength(1)
        })
      } finally {
        await Admin.setAppRealms(admin, {
          clientId: Playgrounds.clientId('backend'),
          realms: [],
        })
      }
    })
})

/** Approves the key on the approval page, once the page shows `limit`. */
async function approve(page: Page, options: { limit: string }) {
  await expect(page).toHaveURL(/\/authorize\?.*sig=/)
  await hydrated(page)
  await expect(page.getByText(options.limit, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
}
