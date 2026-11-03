/**
 * Runs `Plugins.backend` with a store against `apps/id`: the redirect sign-in, the saved sign-in, the
 * shared refresh, the call with the access token, the sign-out, and the flow of a backend without a
 * client secret, whose client ID is its origin.
 * @module
 */
import { Actions, Id, Store } from 'accounts'
import * as Plugins from 'accounts/plugins'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import * as Admin from '../../test/Admin.js'
import {
  Database,
  Env,
  Harness,
  Realm,
  Schema,
  Sql,
} from '../../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()
const server = Harness.create()

/** The redirect URI of the app that each test registers. */
const redirectUri = 'https://app.example.com/callback'

beforeAll(async () => {
  await Promise.all([admin.listen(), server.listen()])
})

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    admin.debug()
    server.debug()
  }
  await Promise.all([admin.reset(), server.reset()])
})

afterAll(async () => {
  await Promise.all([admin.close(), database.end(), server.close()])
})

describe('complete', () => {
  test('stores the tokens without the ID token, and returns the user without the refresh token', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const auth = await instance({ endSession: false })
    const store = memory()
    const sessions = backend(auth, { store })

    const { id, url } = await sessions.start({ redirectUri })
    const session = await sessions.complete({
      id,
      url: await follow({ cookie: await signIn({ email }), url }),
    })
    const stored = store.values.get(`tempo-id:session:${id}`) as Record<
      string,
      unknown
    >

    expect(id).toMatch(/^[\w-]{43}$/)
    expect(session.user.email).toBe(email)
    expect(Object.keys(session).sort()).toMatchInlineSnapshot(`
      [
        "accessToken",
        "expiresAt",
        "user",
      ]
    `)
    expect(Object.keys(stored).sort()).toMatchInlineSnapshot(`
      [
        "accessToken",
        "expiresAt",
        "refreshToken",
        "user",
      ]
    `)
    expect(store.values.has(`tempo-id:pending:${id}`)).toBe(false)
  })

  test('keeps the sid of the Tempo ID session for an app with a back-channel logout URI, so a logout token finds the session', async () => {
    const auth = await instance({
      backchannelLogoutUri: 'https://app.example.com/logout',
    })
    const sessions = backend(auth, { store: memory() })
    const cookie = await signIn({
      email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
    })

    const { id, url } = await sessions.start({ redirectUri })
    const session = await sessions.complete({
      id,
      url: await follow({ cookie, url }),
    })
    const [row] = await database.db
      .select({ id: Schema.session.id })
      .from(Schema.session)
      .where(Sql.eq(Schema.session.userId, session.user.id))

    expect(session.sid).toBeTypeOf('string')
    expect(session.sid).toBe(row?.id)
  })

  test.for(['missing', 'mismatched', 'appended'] as const)(
    'keeps the pending sign-in after a callback with a %s state',
    async (state) => {
      const auth = await instance()
      const sessions = backend(auth, { store: memory() })
      const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
      const { id, url } = await sessions.start({ redirectUri })
      const callback = await follow({ cookie: await signIn({ email }), url })
      const invalid = new URL(callback)
      if (state === 'missing') invalid.searchParams.delete('state')
      else if (state === 'appended')
        invalid.searchParams.append('state', 'another-sign-in')
      else invalid.searchParams.set('state', 'another-sign-in')

      const error = await sessions
        .complete({ id, url: invalid.href })
        .catch((error: unknown) => error)

      expect(error).toBeInstanceOf(Id.RequestError)
      expect((error as Id.RequestError).field).toBe('state')
      expect(await sessions.get({ id })).toBeUndefined()

      const session = await sessions.complete({ id, url: callback })

      expect(session.user.email).toBe(email)
      await expect(
        sessions.complete({ id, url: callback }),
      ).rejects.toBeInstanceOf(Id.PendingNotFoundError)
    },
  )

  test.for(['denied', 'missing', 'invalid'] as const)(
    'consumes a matching callback with a %s code',
    async (code) => {
      const auth = await instance()
      const sessions = backend(auth, { store: memory() })
      const { id, url } = await sessions.start({ redirectUri })
      const callback = await follow({
        cookie: await signIn({
          email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
        }),
        url,
      })
      const invalid = new URL(callback)
      if (code === 'invalid') invalid.searchParams.set('code', 'invalid-code')
      else invalid.searchParams.delete('code')
      if (code === 'denied') invalid.searchParams.set('error', 'access_denied')

      await expect(
        sessions.complete({ id, url: invalid.href }),
      ).rejects.toBeInstanceOf(Id.RequestError)
      await expect(
        sessions.complete({ id, url: callback }),
      ).rejects.toBeInstanceOf(Id.PendingNotFoundError)
    },
  )

  test('completes a valid callback queued behind one with a mismatched state', async () => {
    const auth = await instance()
    const sessions = backend(auth, { store: memory() })
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const { id, url } = await sessions.start({ redirectUri })
    const callback = await follow({ cookie: await signIn({ email }), url })
    const invalid = new URL(callback)
    invalid.searchParams.set('state', 'another-sign-in')

    const [error, session] = await Promise.all([
      sessions
        .complete({ id, url: invalid.href })
        .catch((error: unknown) => error),
      sessions.complete({ id, url: callback }),
    ])

    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).field).toBe('state')
    expect(session.user.email).toBe(email)
    await expect(
      sessions.complete({ id, url: callback }),
    ).rejects.toBeInstanceOf(Id.PendingNotFoundError)
  })

  test('throws PendingNotFoundError for a second callback, since the pending state redeems one code', async () => {
    const auth = await instance()
    const sessions = backend(auth, { store: memory() })

    const { id, url } = await sessions.start({ redirectUri })
    const callback = await follow({
      cookie: await signIn({
        email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
      }),
      url,
    })
    await sessions.complete({ id, url: callback })
    const error = await sessions
      .complete({ id, url: callback })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.PendingNotFoundError)
  })
})

describe('start', () => {
  test('stores the pending state with an expiry 10 minutes later, so a store that expires entries deletes an abandoned sign-in', async () => {
    const store = memory()
    const sessions = backend(await instance(), { store })

    const before = Date.now()
    const { id } = await sessions.start({ redirectUri })
    const expiresAt = store.expiries.get(`tempo-id:pending:${id}`)!

    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000)
  })

  test('sends funding as the funding parameters of the authorization request', async () => {
    const sessions = backend(await instance(), { store: memory() })

    const { url } = await sessions.start({
      funding: { amount: '10', currency: 'EUR' },
      redirectUri,
    })
    const search = new URL(url).searchParams

    expect(search.get('funding_hint')).toMatchInlineSnapshot(`"10"`)
    expect(search.get('funding_currency')).toMatchInlineSnapshot(`"EUR"`)
    expect(search.has('funding_token')).toMatchInlineSnapshot(`false`)
  })
})

describe('complete (concurrent)', () => {
  test('redeems the code once for two concurrent callbacks, and throws PendingNotFoundError for the second', async () => {
    const auth = await instance()
    const sessions = backend(auth, { store: memory() })

    const { id, url } = await sessions.start({ redirectUri })
    const callback = await follow({
      cookie: await signIn({
        email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
      }),
      url,
    })
    const results = await Promise.all([
      sessions.complete({ id, url: callback }).catch((error: unknown) => error),
      sessions.complete({ id, url: callback }).catch((error: unknown) => error),
    ])

    expect(
      results.map((result) =>
        result instanceof Error ? result.name : 'session',
      ),
    ).toMatchInlineSnapshot(`
      [
        "session",
        "Id.PendingNotFoundError",
      ]
    `)
  })
  test('writes the callback after a save of the same ID that started before it, so the callback keeps its session', async () => {
    const auth = await instance()
    const store = memory()
    const gate = Promise.withResolvers<void>()
    const held = { key: '' }
    // The save's write of `held.key` waits for the gate, as a slow store's write does.
    const slow = {
      ...store,
      setItem: async (
        key: string,
        value: unknown,
        options?: { expiresAt?: number | undefined },
      ) => {
        if (key === held.key) {
          held.key = ''
          await gate.promise
        }
        return store.setItem(key, value, options)
      },
    }
    const sessions = backend(auth, { store: slow })
    const first = await signedIn({ sessions })
    const session = (await sessions.get({ id: first }))!

    const { id, url } = await sessions.start({ redirectUri })
    const callback = await follow({
      cookie: await signIn({
        email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
      }),
      url,
    })
    held.key = `tempo-id:session:${id}`
    const saved = sessions.save({ id, session })
    const completed = sessions.complete({ id, url: callback })
    gate.resolve()
    const [, result] = await Promise.all([saved, completed])

    expect(
      (store.values.get(`tempo-id:session:${id}`) as { accessToken: string })
        .accessToken,
    ).toBe(result.accessToken)
    expect(result.accessToken).not.toBe(session.accessToken)
  })
})

describe('get', () => {
  test('refreshes an expired access token once for concurrent requests, so the rotated refresh token stays valid', async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })
    const id = await signedIn({ sessions })
    const key = `tempo-id:session:${id}`
    const before = store.values.get(key) as { accessToken: string }
    // The store belongs to the test, so the test expires the access token in it.
    store.values.set(key, { ...before, expiresAt: 0 })

    const results = await Promise.all(
      Array.from({ length: 5 }, () => sessions.get({ id })),
    )
    const after = store.values.get(key) as { refreshToken: string }
    // A reused refresh token would revoke every refresh token of the app for the user.
    const next = await Actions.refresh(auth, {
      refreshToken: after.refreshToken,
    })

    expect(
      new Set(results.map((result) => result?.accessToken)).size,
    ).toMatchInlineSnapshot(`1`)
    expect(results[0]?.accessToken).not.toBe(before.accessToken)
    expect(results[0]!.expiresAt).toBeGreaterThan(Date.now())
    expect(next.accessToken).toMatch(/^ey/)
  })

  test('keeps a session without a refresh token until its access token expires', async () => {
    const auth = await instance({ scope: '' })
    const store = memory()
    const sessions = backend(auth, { store })
    const id = await signedIn({ sessions })
    const key = `tempo-id:session:${id}`
    const stored = store.values.get(key) as Record<string, unknown>

    // Within the refresh margin, but before the expiry.
    store.values.set(key, { ...stored, expiresAt: Date.now() + 10_000 })
    const valid = await sessions.get({ id })
    store.values.set(key, { ...stored, expiresAt: 0 })
    const expired = await sessions.get({ id })

    expect(stored.refreshToken).toBeUndefined()
    expect(valid?.accessToken).toBe(stored.accessToken)
    expect(expired).toBeUndefined()
    expect(store.values.has(key)).toBe(false)
  })

  test('ends the session when Tempo ID refuses its refresh token', async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })
    const id = await signedIn({ sessions })
    const key = `tempo-id:session:${id}`
    const stored = store.values.get(key) as {
      refreshToken: string
      user: { id: string }
    }
    store.values.set(key, { ...stored, expiresAt: 0 })
    // Another holder of the refresh token rotates it first, and the reuse interval ends, as the
    // cleanup cron clears the replay, so the session's copy is a reuse.
    await Actions.refresh(auth, { refreshToken: stored.refreshToken })
    await database.db
      .update(Schema.oauthRefreshToken)
      .set({ rotationReplayExpiresAt: null, rotationReplayResponse: null })
      .where(Sql.eq(Schema.oauthRefreshToken.userId, stored.user.id))

    const session = await sessions.get({ id })

    expect(session).toBeUndefined()
    expect(store.values.has(key)).toBe(false)
  })

  test('returns undefined for an unknown session ID', async () => {
    const sessions = backend(await instance(), { store: memory() })

    expect(await sessions.get({ id: 'unknown' })).toBeUndefined()
  })
})

describe('save', () => {
  test('stores the session of a sign-in on the backend, which get returns under the new session ID, and which a save under the same ID replaces', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const { app, clientSecret } = await Admin.createApp(admin, {
      backendSignIn: true,
      name: 'Backend',
      redirectUris: [redirectUri],
      secret: true,
    })
    const realmId = `cash-${crypto.randomUUID().replaceAll('-', '')}`
    await Admin.addRealm(admin, { id: realmId, name: 'Tempo Cash' })
    // The Admin API sets no secp256k1 owners.
    await Realm.setSecp256k1(database.db, { enabled: true, realmId })
    await Admin.setAppRealms(admin, {
      clientId: app.clientId,
      realms: [realmId],
    })
    const tempoId = Id.create({
      clientId: app.clientId,
      clientSecret: clientSecret!,
      fetch: harnessFetch,
      plugins: [Plugins.email(), Plugins.backend({ store: memory() })],
      url: Env.origin,
    })

    await tempoId.email.sendCode({ email, userIp: '203.0.113.7' })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      userIp: '203.0.113.7',
    })
    const { id } = await tempoId.backend.save({ session })
    const read = await tempoId.backend.get({ id })

    expect(id).toMatch(/^[\w-]{43}$/)
    expect(read?.user.email).toBe(email)
    expect(read?.accessToken).toBe(session.accessToken)
    expect(await tempoId.session.get()).toBeUndefined()

    // A second sign-in saved under the same ID replaces the session.
    await tempoId.email.sendCode({ email, userIp: '203.0.113.7' })
    const second = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      userIp: '203.0.113.7',
    })
    await tempoId.backend.save({ id, session: second })

    expect((await tempoId.backend.get({ id }))?.accessToken).toBe(
      second.accessToken,
    )

    // An end that starts beside a save waits for it, so it ends the saved session.
    await Promise.all([
      tempoId.backend.save({ id, session: second }),
      tempoId.backend.end({ id }),
    ])

    expect(await tempoId.backend.get({ id })).toBeUndefined()

    // Saves of one ID run in order, and an end that starts after them waits for the last.
    const saves = Promise.all([
      tempoId.backend.save({ id, session }),
      tempoId.backend.save({ id, session: second }),
    ])
    await tempoId.backend.end({ id })
    await saves

    expect(await tempoId.backend.get({ id })).toBeUndefined()
  })
})

describe('fetch', () => {
  test("sends the session's access token as a Bearer token, which userinfo accepts", async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const sessions = backend(await instance(), { store: memory() })
    const id = await signedIn({ email, sessions })

    const response = await sessions.fetch({
      id,
      url: new URL('/oauth2/userinfo', Env.origin),
    })
    const body = (await response!.json()) as { email: string }

    expect(response!.status).toMatchInlineSnapshot(`200`)
    expect(body.email).toBe(email)
  })

  test('returns undefined without a session, and sends no request', async () => {
    const sessions = backend(await instance(), { store: memory() })

    const response = await sessions.fetch({
      id: 'unknown',
      url: new URL('/oauth2/userinfo', Env.origin),
    })

    expect(response).toBeUndefined()
  })
})

describe('end', () => {
  test('awaits a callback in progress, and revokes the tokens that it stored', async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })

    const { id, url } = await sessions.start({ redirectUri })
    const callback = await follow({
      cookie: await signIn({
        email: `tempo-id-test+${crypto.randomUUID()}@example.org`,
      }),
      url,
    })
    const completed = sessions.complete({ id, url: callback })
    await sessions.end({ id })
    await completed
    const after = await sessions
      .complete({ id, url: callback })
      .catch((error: unknown) => error)

    expect(store.values.has(`tempo-id:session:${id}`)).toBe(false)
    expect(await sessions.get({ id })).toBeUndefined()
    expect(after).toBeInstanceOf(Id.PendingNotFoundError)
  })

  test('starts no refresh for a read that runs beside it, so the session stays signed out', async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })
    const id = await signedIn({ sessions })
    const key = `tempo-id:session:${id}`
    const stored = store.values.get(key) as { refreshToken: string }
    store.values.set(key, { ...stored, expiresAt: 0 })

    const [session] = await Promise.all([
      sessions.get({ id }),
      sessions.end({ id }),
    ])
    const error = await Actions.refresh(auth, {
      refreshToken: stored.refreshToken,
    }).catch((error: unknown) => error)

    expect(session).toBeUndefined()
    expect(store.values.has(key)).toBe(false)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_grant"`,
    )
  })

  test("shares one revocation among concurrent calls, so the user's other sessions of the app keep their refresh tokens", async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const ended = await signedIn({ email, sessions })
    const other = await signedIn({ email, sessions })
    const { refreshToken } = store.values.get(`tempo-id:session:${other}`) as {
      refreshToken: string
    }

    // A second revocation of one refresh token revokes every refresh token of the app for the user.
    await Promise.all([
      sessions.end({ id: ended }),
      sessions.end({ id: ended }),
    ])
    const refreshed = await Actions.refresh(auth, { refreshToken }).catch(
      (error: unknown) => error,
    )

    expect(refreshed).not.toBeInstanceOf(Error)
  })

  test("revokes nothing at a retry after a failed deletion, so the user's other sessions of the app keep their refresh tokens", async () => {
    const auth = await instance()
    const store = memory()
    const held = { failing: false }
    // While `failing`, the next deletion fails, as a store's transient error does.
    const failing = {
      ...store,
      removeItem: (key: string) => {
        if (!held.failing) return store.removeItem(key)
        held.failing = false
        return Promise.reject(new Error('The store is unavailable.'))
      },
    }
    const sessions = backend(auth, { store: failing })
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const ended = await signedIn({ email, sessions })
    const other = await signedIn({ email, sessions })
    const { refreshToken } = store.values.get(`tempo-id:session:${other}`) as {
      refreshToken: string
    }

    held.failing = true
    const failed = await sessions
      .end({ id: ended })
      .catch((error: unknown) => error)
    await sessions.end({ id: ended })
    const refreshed = await Actions.refresh(auth, { refreshToken }).catch(
      (error: unknown) => error,
    )

    expect((failed as Error).message).toMatchInlineSnapshot(
      `"The store is unavailable."`,
    )
    expect(store.values.has(`tempo-id:session:${ended}`)).toBe(false)
    expect(refreshed).not.toBeInstanceOf(Error)
  })

  test("refreshes with no revoked token after the store refuses the deletion and the write, so the user's other sessions of the app keep their refresh tokens", async () => {
    const auth = await instance()
    const store = memory()
    const held = { failing: false }
    // While `failing`, the store refuses each deletion and write, as during an outage.
    const failing = {
      ...store,
      removeItem: (key: string) =>
        held.failing
          ? Promise.reject(new Error('The store is unavailable.'))
          : store.removeItem(key),
      setItem: (...parameters: Parameters<typeof store.setItem>) =>
        held.failing
          ? Promise.reject(new Error('The store is unavailable.'))
          : store.setItem(...parameters),
    }
    const sessions = backend(auth, { store: failing })
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const ended = await signedIn({ email, sessions })
    const other = await signedIn({ email, sessions })
    const { refreshToken } = store.values.get(`tempo-id:session:${other}`) as {
      refreshToken: string
    }

    held.failing = true
    await sessions.end({ id: ended }).catch(() => undefined)
    held.failing = false
    // The kept session's access token expires, so the next read refreshes it.
    const key = `tempo-id:session:${ended}`
    store.values.set(key, {
      ...(store.values.get(key) as object),
      expiresAt: 0,
    })
    const read = await sessions.get({ id: ended })
    const refreshed = await Actions.refresh(auth, { refreshToken }).catch(
      (error: unknown) => error,
    )

    expect(read).toBeUndefined()
    expect(store.values.has(key)).toBe(false)
    expect(refreshed).not.toBeInstanceOf(Error)
  })

  test('returns no session after a deletion that takes effect and still rejects', async () => {
    const auth = await instance()
    const store = memory()
    const held = { failing: false }
    // While `failing`, a deletion takes effect and then rejects, as a store's lost reply does.
    const failing = {
      ...store,
      removeItem: async (key: string) => {
        await store.removeItem(key)
        if (held.failing) throw new Error('The store is unavailable.')
      },
    }
    const sessions = backend(auth, { store: failing })
    const id = await signedIn({ sessions })

    held.failing = true
    await sessions.end({ id }).catch(() => undefined)
    held.failing = false
    const key = `tempo-id:session:${id}`
    // The marker holds no token and no access key, and the store drops it on its own.
    const marker = store.values.get(key)
    const expiry = store.expiries.get(key)

    expect(marker).toMatchInlineSnapshot(`
      {
        "expiresAt": 0,
      }
    `)
    expect(expiry).toBeTypeOf('number')
    expect(await sessions.get({ id })).toBeUndefined()
    expect(store.values.has(`tempo-id:session:${id}`)).toBe(false)
  })

  test('revokes nothing at a retry after the store refuses both the deletion and the write', async () => {
    const auth = await instance()
    const store = memory()
    const held = { failing: false }
    // While `failing`, the store refuses each deletion and write, as during an outage.
    const failing = {
      ...store,
      removeItem: (key: string) =>
        held.failing
          ? Promise.reject(new Error('The store is unavailable.'))
          : store.removeItem(key),
      setItem: (...parameters: Parameters<typeof store.setItem>) =>
        held.failing
          ? Promise.reject(new Error('The store is unavailable.'))
          : store.setItem(...parameters),
    }
    const sessions = backend(auth, { store: failing })
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const ended = await signedIn({ email, sessions })
    const other = await signedIn({ email, sessions })
    const { refreshToken } = store.values.get(`tempo-id:session:${other}`) as {
      refreshToken: string
    }

    held.failing = true
    await sessions.end({ id: ended }).catch(() => undefined)
    held.failing = false
    await sessions.end({ id: ended })
    const refreshed = await Actions.refresh(auth, { refreshToken }).catch(
      (error: unknown) => error,
    )

    expect(store.values.has(`tempo-id:session:${ended}`)).toBe(false)
    expect(refreshed).not.toBeInstanceOf(Error)
  })

  test('revokes the refresh token at Tempo ID, and deletes the session', async () => {
    const auth = await instance()
    const store = memory()
    const sessions = backend(auth, { store })
    const id = await signedIn({ sessions })
    const key = `tempo-id:session:${id}`
    const stored = store.values.get(key) as { refreshToken: string }

    await sessions.end({ id })
    const error = await Actions.refresh(auth, {
      refreshToken: stored.refreshToken,
    }).catch((error: unknown) => error)

    expect(store.values.has(key)).toBe(false)
    expect(await sessions.get({ id })).toBeUndefined()
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_grant"`,
    )
  })
})

describe('origin client ID', () => {
  test('signs in, refreshes, and signs out a backend without a client secret, whose client ID is its origin, after the approval page', async () => {
    const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
    const clientId = `https://app-${crypto.randomUUID().slice(0, 8)}.example.com`
    const callback = `${clientId}/callback`
    await Harness.seedClientMetadata(server, {
      body: '<link rel="manifest" href="/manifest.json">',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      url: `${clientId}/`,
    })
    await Harness.seedClientMetadata(server, {
      body: { name: 'Example', redirect_uris: [callback] },
      url: `${clientId}/manifest.json`,
    })
    const store = memory()
    const tempoId = Id.create({
      clientId,
      fetch: harnessFetch,
      plugins: [Plugins.backend({ store })],
      url: Env.origin,
    })
    const key = (id: string) => `tempo-id:session:${id}`

    const { id, url } = await tempoId.backend.start({ redirectUri: callback })
    const callbackUrl = await approve({
      cookie: await signIn({ email }),
      email,
      url,
    })
    const session = await tempoId.backend.complete({ id, url: callbackUrl })
    const stored = store.values.get(key(id)) as { refreshToken: string }

    expect(new URL(callbackUrl).pathname).toMatchInlineSnapshot(`"/callback"`)
    expect(session.user.email).toBe(email)
    expect(stored.refreshToken).toBeTypeOf('string')

    // The backend sends no `Origin`, and no client authentication, for the refresh.
    store.values.set(key(id), { ...stored, expiresAt: 0 })
    const refreshed = await tempoId.backend.get({ id })
    const rotated = store.values.get(key(id)) as { refreshToken: string }

    expect(refreshed?.accessToken).not.toBe(session.accessToken)
    expect(rotated.refreshToken).not.toBe(stored.refreshToken)

    await tempoId.backend.end({ id })
    const error = await Actions.refresh(tempoId.config, {
      refreshToken: rotated.refreshToken,
    }).catch((error: unknown) => error)

    expect(store.values.has(key(id))).toBe(false)
    expect((error as Id.RequestError).code).toMatchInlineSnapshot(
      `"invalid_grant"`,
    )
  })
})

/**
 * Sends the sign-in URL of a third-party app with the session cookie, approves its approval page as
 * the user of `email`, and returns the callback URL.
 */
async function approve(options: {
  cookie: string
  email: string
  url: string
}) {
  const { cookie, email } = options
  const url = new URL(options.url)

  const response = await server.fetch(`${url.pathname}${url.search}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
  const page = new URL(
    response.headers.get('location') ??
      ((await response.json()) as { url: string }).url,
    Env.origin,
  )
  const [session] = await database.db
    .select({ id: Schema.session.id })
    .from(Schema.session)
    .innerJoin(Schema.user, Sql.eq(Schema.user.id, Schema.session.userId))
    .where(Sql.eq(Schema.user.email, email))

  const consent = await server.fetch('/v1/authorize/consent', {
    body: JSON.stringify({
      accept: true,
      oauth_query: page.search.slice(1),
      session_id: session?.id,
    }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  const body = (await consent.json()) as { redirect?: string }
  if (!body.redirect)
    throw new Error(`The approval failed with ${consent.status}.`)
  return body.redirect
}

/**
 * Follows the sign-in URL with the session cookie until it redirects off Tempo ID, and returns the
 * callback URL.
 */
async function follow(options: { cookie: string; url: string }) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    if (url.origin !== Env.origin) return url.href
    const response = await server.fetch(`${url.pathname}${url.search}`, {
      headers: { cookie: options.cookie },
      redirect: 'manual',
    })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    url = new URL(location, Env.origin)
  }
  throw new Error('The sign-in URL redirected too many times.')
}

/**
 * Registers a public app that skips consent, and returns an instance for it that calls the harness. With
 * `backchannelLogoutUri`, the app's ID tokens name the session as `sid`. `scope` replaces the default
 * `offline_access`, so an empty one issues no refresh token.
 */
async function instance(
  options: {
    backchannelLogoutUri?: string | undefined
    /**
     * Whether the app ends sessions at `GET /oauth2/end-session`, which puts `sid` in its ID tokens.
     * Defaults to `true`, as the Admin API registers every app. With `false`, the app's row is
     * written directly, since the Admin API has no setting for it.
     */
    endSession?: boolean | undefined
    scope?: string | undefined
  } = {},
) {
  if (options.endSession === false) {
    const clientId = crypto.randomUUID()
    await database.db.insert(Schema.oauthClient).values({
      clientId,
      grantTypes: ['authorization_code', 'refresh_token'],
      id: crypto.randomUUID(),
      redirectUris: [redirectUri],
      responseTypes: ['code'],
      skipConsent: true,
      tokenEndpointAuthMethod: 'none',
    })
    return Id.create({
      clientId,
      fetch: harnessFetch,
      scope: options.scope,
      url: Env.origin,
    }).config
  }

  const { app } = await Admin.createApp(admin, {
    ...(options.backchannelLogoutUri
      ? {
          backchannelLogoutSessionRequired: true,
          backchannelLogoutUri: options.backchannelLogoutUri,
        }
      : {}),
    name: 'Example',
    redirectUris: [redirectUri],
  })
  return Id.create({
    clientId: app.clientId,
    fetch: harnessFetch,
    scope: options.scope,
    url: Env.origin,
  }).config
}

/** Returns the backend namespace of an instance of the app of `config`, with its sessions in `store`. */
function backend(config: Id.Config, options: { store: Store.Store }) {
  return Id.create({
    clientAssertion: config.clientAssertion,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fetch: config.fetch,
    plugins: [Plugins.email(), Plugins.backend({ store: options.store })],
    scope: config.scope,
    url: config.url,
  }).backend
}

/** A store in the test's memory, whose values the test reads and changes. */
function memory() {
  const expiries = new Map<string, number | undefined>()
  const values = new Map<string, unknown>()
  return {
    ...Store.from({
      getItem: (key) => Promise.resolve(values.get(key)),
      removeItem: (key) => {
        values.delete(key)
        return Promise.resolve()
      },
      setItem: (key, value, options = {}) => {
        expiries.set(key, options.expiresAt)
        values.set(key, value)
        return Promise.resolve()
      },
    }),
    expiries,
    values,
  }
}

/** Signs a new address in through `sessions`, and returns the session ID. */
async function signedIn(options: {
  email?: string | undefined
  sessions: ReturnType<typeof backend>
}) {
  const {
    email = `tempo-id-test+${crypto.randomUUID()}@example.org`,
    sessions,
  } = options
  const { id, url } = await sessions.start({ redirectUri })
  await sessions.complete({
    id,
    url: await follow({ cookie: await signIn({ email }), url }),
  })
  return id
}

/** Signs `email` in to Tempo ID with an emailed code, and returns the session cookie. */
async function signIn(options: { email: string }) {
  const { email } = options
  const code = await Harness.sendCode(server, { email })

  const verify = await server.fetch('/v1/auth/code/verify', {
    body: JSON.stringify({ code, email }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  await verify.body?.cancel()
  const cookie = verify.headers
    .getSetCookie()
    .find((entry) => entry.includes('tempo-id-session'))
    ?.split(';')[0]
  if (!cookie) throw new Error(`The sign-in failed with ${verify.status}.`)
  return cookie
}

/**
 * Calls the harness as a backend does. The harness's fetch returns Miniflare's `Response`, which the
 * global `fetch` type does not name, though both have the same shape at runtime.
 */
const harnessFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input)
  return server.fetch(
    `${url.pathname}${url.search}`,
    init as Parameters<typeof server.fetch>[1],
  )
}) as unknown as typeof globalThis.fetch
