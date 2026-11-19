/**
 * Runs `backend` with a store, without a server: a returning user's session whose access key
 * expired, as `backend.get` restores it, the refusal of a malformed funding hint before
 * `backend.start` leaves for Tempo ID, and `backend.start` without a redirect URI.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import { Address, Base64, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as Dpop from '../internal/Dpop.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { backend } from './backend.js'

/** The redirect URI of each sign-in that a test starts. */
const redirectUri = 'https://app.example.com/callback'

describe('backend', () => {
  test('returns undefined for a session whose access key expired, and deletes it', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const { id } = await accounts.backend.save({
      session: session({ expiry: -60 }),
    })

    const restored = await accounts.backend.get({ id })

    expect(restored).toMatchInlineSnapshot(`undefined`)
    expect(await store.getItem(`tempo-id:session:${id}`)).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('returns a session whose access key holds', async () => {
    const accounts = instance({ store: Store.memory() })
    const { id } = await accounts.backend.save({
      session: session({ expiry: 60 }),
    })

    const restored = await accounts.backend.get({ id })

    expect(
      restored?.method === 'tempo-id' && Session.expired(restored),
    ).toMatchInlineSnapshot(`false`)
  })

  test('returns the access keys of a session that an earlier release stored as `key` and `keys`', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const saved = session({ expiry: 60 })
    const { id } = await accounts.backend.save({
      session: {
        ...saved,
        accessKeys: [{ ...saved.accessKey!, chainId: 4217 }],
      },
    })
    const { accessKey, accessKeys, ...stored } = (await store.getItem(
      `tempo-id:session:${id}`,
    )) as Session.Any
    await store.setItem(`tempo-id:session:${id}`, {
      ...stored,
      key: accessKey,
      keys: accessKeys,
    })

    const restored = await accounts.backend.get({ id })

    expect({
      accessKey: restored?.method === 'tempo-id' && restored.accessKey?.chainId,
      accessKeys:
        restored?.method === 'tempo-id' &&
        restored.accessKeys?.map((entry) => entry.chainId),
      key: 'key' in (restored ?? {}),
      keys: 'keys' in (restored ?? {}),
    }).toMatchInlineSnapshot(`
      {
        "accessKey": 42431,
        "accessKeys": [
          4217,
        ],
        "key": false,
        "keys": false,
      }
    `)
  })

  test("stores the session until a day after its access key's expiry, so an abandoned session keeps no access key or refresh token", async () => {
    const memory = Store.memory()
    const writes: { expiresAt: number | undefined; value: unknown }[] = []
    const store = Store.from({
      ...memory,
      setItem: (key, value, options) => {
        if (key.startsWith('tempo-id:session:'))
          writes.push({ expiresAt: options?.expiresAt, value })
        return memory.setItem(key, value, options)
      },
    })
    const accounts = instance({ store })

    await accounts.backend.save({
      session: session({ expiry: 60, refreshToken: 'refresh-token' }),
    })
    const write = writes[0]!
    const { expiry } = KeyAuthorization.fromRpc(
      (write.value as Session.Any).accessKey!.keyAuthorization,
    )

    expect((write.expiresAt ?? 0) - expiry! * 1000).toMatchInlineSnapshot(
      `86400000`,
    )
  })

  test("returns the session's sid from save, which a logout token names as sessionId", async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_1' }),
      'signature',
    ].join('.')

    const saved = await accounts.backend.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    expect(saved).toMatchInlineSnapshot(
      { id: expect.any(String) },
      `
      {
        "id": Any<String>,
        "sid": "sid_1",
      }
    `,
    )
  })

  test("indexes each saved session by its sid until the longest one expires, so a logout token's sid finds both", async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_1' }),
      'signature',
    ].join('.')

    const first = await accounts.backend.save({
      session: { ...session({ expiry: 60 }), idToken },
    })
    const second = await accounts.backend.save({
      session: { ...session({ expiry: 120 }), idToken },
    })
    const index = (await store.getItem('tempo-id:sid:sid_1')) as {
      entries: { id: string }[]
    }

    expect(index.entries.map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  test('ends a session with sid only while the session names that sid, so a session that replaced it under its ID stays', async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await accounts.backend.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    await accounts.backend.end({ id, revoke: false, sid: 'sid_1' })
    const kept = await accounts.backend.get({ id })
    await accounts.backend.end({ id, revoke: false, sid: 'sid_2' })
    const ended = await accounts.backend.get({ id })

    expect({ ended, kept: kept?.id === id }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "kept": true,
      }
    `)
  })

  test("ends a session at concurrent ends with sid, when a later call names the session's sid and an earlier call another", async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await accounts.backend.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    await Promise.all([
      accounts.backend.end({ id, revoke: false, sid: 'sid_1' }),
      accounts.backend.end({ id, revoke: false, sid: 'sid_2' }),
    ])

    expect(await accounts.backend.get({ id })).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('sends the revocation of an end without sid that overlaps an end with another sid, and keeps the session when the revocation receives no answer', async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        idToken,
        refreshToken: 'refresh_2',
      },
    })

    const results = await Promise.allSettled([
      accounts.backend.end({ id }),
      accounts.backend.end({ id, revoke: false, sid: 'sid_1' }),
    ])
    const kept = (await accounts.backend.get({ id }))?.id === id

    expect({
      kept,
      results: results.map((result) => result.status),
    }).toMatchInlineSnapshot(`
      {
        "kept": true,
        "results": [
          "rejected",
          "fulfilled",
        ],
      }
    `)
  })

  test("sends no revocation for an end without sid that overlaps an end with the stored session's sid and revoke: false, and ends the session", async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        idToken,
        refreshToken: 'refresh_2',
      },
    })

    const results = await Promise.allSettled([
      accounts.backend.end({ id }),
      accounts.backend.end({ id, revoke: false, sid: 'sid_2' }),
    ])
    const ended = await accounts.backend.get({ id })

    expect({
      ended,
      results: results.map((result) => result.status),
    }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "results": [
          "fulfilled",
          "fulfilled",
        ],
      }
    `)
  })

  test('sends no revocation for an end of a sid that overlaps a logout token of the sid, and ends the session', async () => {
    const accounts = instance({ store: Store.memory() })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        idToken,
        refreshToken: 'refresh_2',
      },
    })

    // Nothing listens at the URL, so a revocation rejects.
    const results = await Promise.allSettled([
      accounts.backend.end({ id, sid: 'sid_2' }),
      accounts.backend.end({
        id,
        issuedAt: 1_800_000_000_000,
        revoke: false,
        sid: 'sid_2',
      }),
    ])
    const ended = await accounts.backend.get({ id })

    expect({
      ended,
      results: results.map((result) => result.status),
    }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "results": [
          "fulfilled",
          "fulfilled",
        ],
      }
    `)
  })

  test("sends the revocation of an end without sid for a session that a save replaced, also when a logout token of the replaced session's sid joins it", async () => {
    const sessions = BackendSessions.create(
      Accounts.from({
        clientId: 'https://app.example.com',
        url: 'http://127.0.0.1:9',
      }),
      { store: Store.memory() },
    )
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = (sid: string) =>
      [part({ alg: 'RS256' }), part({ sid }), 'signature'].join('.')
    const { id } = await sessions.save({
      session: {
        ...session({ expiry: 60 }),
        idToken: idToken('sid_1'),
        refreshToken: 'refresh_1',
      },
    })

    const results = await Promise.allSettled([
      sessions.save({
        id,
        session: {
          ...session({ expiry: 60 }),
          idToken: idToken('sid_2'),
          refreshToken: 'refresh_2',
        },
      }),
      sessions.end({ id }),
      sessions.end({ id, revoke: false, sid: 'sid_1' }),
    ])
    const kept = await sessions.get({ id })

    expect({
      kept: kept?.id === id,
      results: results.map((result) => result.status),
    }).toMatchInlineSnapshot(`
      {
        "kept": true,
        "results": [
          "fulfilled",
          "rejected",
          "fulfilled",
        ],
      }
    `)
  })

  test('link keeps the later expiry of a session ID that links twice, also when the earlier expiry arrives last, and no expiry for a session without one', async () => {
    const store = Store.memory()
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store },
    )
    const later = Date.now() + 120_000

    await sessions.link({ expiresAt: later, id: 'first', sid: 'sid_1' })
    await sessions.link({
      expiresAt: Date.now() + 60_000,
      id: 'first',
      sid: 'sid_1',
    })
    await sessions.link({ id: 'lasting', sid: 'sid_1' })
    const index = (await store.getItem('tempo-id:sid:sid_1')) as {
      entries: { expiresAt?: number; id: string }[]
    }

    expect(index.entries).toEqual([
      { expiresAt: later, id: 'first' },
      { expiresAt: undefined, id: 'lasting' },
    ])
  })

  test('get returns the session that an end with another sid keeps, when the end starts during the read', async () => {
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store: Store.memory() },
    )
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await sessions.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    const read = sessions.get({ id })
    await Promise.resolve()
    const ended = sessions.end({ id, revoke: false, sid: 'sid_1' })

    expect((await read)?.id === id).toBe(true)
    await ended
  })

  test('close keeps each session ID of a sid until unlink removes it, and a later link finds the index closed and stays in it until unlink', async () => {
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store: Store.memory() },
    )
    const expiresAt = Date.now() + 60_000

    await sessions.link({ expiresAt, id: 'first', sid: 'sid_1' })
    await sessions.link({ expiresAt, id: 'second', sid: 'sid_1' })
    const closed = await sessions.close({ sid: 'sid_1' })
    await sessions.unlink({ ids: ['second'], sid: 'sid_1' })
    const retry = await sessions.close({ sid: 'sid_1' })
    const late = await sessions.link({ expiresAt, id: 'third', sid: 'sid_1' })
    const after = await sessions.close({ sid: 'sid_1' })

    expect({
      after: after.map((entry) => entry.id),
      closed: closed.map((entry) => entry.id),
      late,
      retry: retry.map((entry) => entry.id),
    }).toMatchInlineSnapshot(`
      {
        "after": [
          "first",
          "third",
        ],
        "closed": [
          "first",
          "second",
        ],
        "late": {
          "closed": true,
        },
        "retry": [
          "first",
        ],
      }
    `)
  })

  test('end at a logout token keeps a session of its sid whose tokens Tempo ID issued after the token', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store },
    )
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const token = (claims: object) =>
      [part({ alg: 'RS256' }), part(claims), 'signature'].join('.')
    const issuedAt = 1_800_000_000_000
    const save = (iat: number) =>
      accounts.backend.save({
        session: {
          ...session({ expiry: 60 }),
          accessToken: token({ iat }),
          idToken: token({ sid: 'sid_1' }),
          refreshToken: 'refresh_1',
        },
      })
    const [earlier, later] = await Promise.all([
      save(issuedAt / 1000 - 1),
      save(issuedAt / 1000 + 1),
    ])

    await Promise.all(
      [earlier, later].map((saved) =>
        sessions.end({ id: saved.id, issuedAt, revoke: false, sid: 'sid_1' }),
      ),
    )

    expect({
      earlier: !!(await accounts.backend.get({ id: earlier.id })),
      later: !!(await accounts.backend.get({ id: later.id })),
    }).toMatchInlineSnapshot(`
      {
        "earlier": false,
        "later": true,
      }
    `)
  })

  test('end at a later logout token, during an end at an earlier one, ends a session issued between them', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store },
    )
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const token = (claims: object) =>
      [part({ alg: 'RS256' }), part(claims), 'signature'].join('.')
    const issuedAt = 1_800_000_000_000
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        accessToken: token({ iat: issuedAt / 1000 }),
        idToken: token({ sid: 'sid_1' }),
        refreshToken: 'refresh_1',
      },
    })

    await Promise.all([
      sessions.end({
        id,
        issuedAt: issuedAt - 60_000,
        revoke: false,
        sid: 'sid_1',
      }),
      sessions.end({
        id,
        issuedAt: issuedAt + 60_000,
        revoke: false,
        sid: 'sid_1',
      }),
    ])

    expect(!!(await accounts.backend.get({ id }))).toMatchInlineSnapshot(
      `false`,
    )
  })

  test('logout keeps the index entry of a session that a sign-in linked again under its ID after the token', async () => {
    const store = Store.memory()
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store },
    )
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = 1_800_000_000_000

    await sessions.link({
      expiresAt,
      id: 'id_1',
      issuedAt: issuedAt - 1_000,
      sid: 'sid_1',
    })
    await sessions.close({ issuedAt, sid: 'sid_1' })
    await sessions.link({
      expiresAt,
      id: 'id_1',
      issuedAt: issuedAt + 1_000,
      sid: 'sid_1',
    })
    await sessions.unlink({ ids: ['id_1'], issuedAt, sid: 'sid_1' })
    const retried = await sessions.close({
      issuedAt: issuedAt + 60_000,
      sid: 'sid_1',
    })

    expect(retried.map((entry) => entry.id)).toMatchInlineSnapshot(`
      [
        "id_1",
      ]
    `)
  })

  test('save ends a session at once whose sid a logout token already closed, without a revocation', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    await BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store },
    ).close({ sid: 'sid_1' })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_1' }),
      'signature',
    ].join('.')

    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        idToken,
        refreshToken: 'refresh_1',
      },
    })

    expect({
      index: await store.getItem('tempo-id:sid:sid_1'),
      logout: await store.getItem('tempo-id:logout:sid_1'),
      session: await accounts.backend.get({ id }),
    }).toMatchInlineSnapshot(
      { index: { closedUntil: expect.any(Number) } },
      `
      {
        "index": {
          "closed": true,
          "closedUntil": Any<Number>,
          "entries": [],
        },
        "logout": true,
        "session": undefined,
      }
    `,
    )
  })

  test('get during an end with another sid waits for it, and returns the session that the end keeps', async () => {
    const sessions = BackendSessions.create(
      Accounts.from({ clientId: 'https://app.example.com' }),
      { store: Store.memory() },
    )
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_2' }),
      'signature',
    ].join('.')
    const { id } = await sessions.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    const ended = sessions.end({ id, revoke: false, sid: 'sid_1' })
    const read = await sessions.get({ id })
    await ended

    expect(read?.id === id).toBe(true)
  })

  test('signs in through an adapter of sessions without link and unlink, and indexes nothing', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      plugins: [
        backend({
          sessions: () => {
            const {
              close: _,
              link: __,
              unlink: ___,
              ...sessions
            } = BackendSessions.create(
              Accounts.from({ clientId: 'https://app.example.com' }),
              { store },
            )
            return sessions
          },
        }),
      ],
      url: 'http://127.0.0.1:9',
    })
    const part = (value: unknown) =>
      Base64.fromString(JSON.stringify(value), { pad: false, url: true })
    const idToken = [
      part({ alg: 'RS256' }),
      part({ sid: 'sid_1' }),
      'signature',
    ].join('.')

    const { id, sid } = await accounts.backend.save({
      session: { ...session({ expiry: 60 }), idToken },
    })

    expect({
      index: await store.getItem('tempo-id:sid:sid_1'),
      session: (await accounts.backend.get({ id }))?.id === id,
      sid,
    }).toMatchInlineSnapshot(`
      {
        "index": undefined,
        "session": true,
        "sid": "sid_1",
      }
    `)
  })

  test('sends no refresh for a session whose access key expired, and returns undefined', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const { id } = await accounts.backend.save({
      session: session({
        expiresAt: 0,
        expiry: -60,
        refreshToken: 'refresh-token',
      }),
    })

    // Nothing listens at the URL, so a refresh rejects, and only the revocation runs, which fails.
    const restored = await accounts.backend
      .get({ id })
      .catch((error: unknown) => error)

    expect(restored).toMatchInlineSnapshot(`undefined`)
    expect(await store.getItem(`tempo-id:session:${id}`)).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('rejects with invalid_dpop_proof, and sends no request, for a session whose tokens another DPoP key binds', async () => {
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      dpop: await Dpop.create(),
      plugins: [backend({ store: Store.memory() })],
      url: 'http://127.0.0.1:9',
    })
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiry: 60 }),
        accessToken: boundToken(await Dpop.create()),
      },
    })

    // Nothing listens at the URL, so a request that the instance sends rejects with a network error.
    const error = await accounts.backend
      .fetch({ id, url: 'http://127.0.0.1:9/me' })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Accounts.RequestError)
    expect({
      code: (error as Accounts.RequestError).code,
      message: (error as Accounts.RequestError).message,
      reason: (error as Accounts.RequestError).reason,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "code": "invalid_dpop_proof",
        "message": "Invalid DPoP key: another DPoP key binds the access token. Set \`dpop\` to the key that bound it, or sign in again.",
        "reason": "invalid_dpop_proof",
        "status": 400,
      }
    `)
  })

  test('rejects a malformed URL in fetch with a TypeError that quotes none of the URL, and sends no request', async () => {
    const accounts = instance({ store: Store.memory() })
    const { id } = await accounts.backend.save({
      session: session({ expiry: 3600 }),
    })

    // A request that the instance sends rejects with a network error, not with this `TypeError`.
    const error = await accounts.backend
      .fetch({ id, url: 'https://api.example.com:99999/me?token=secret' })
      .then(
        () => undefined,
        (error: unknown) => error as TypeError,
      )

    expect(error).toBeInstanceOf(TypeError)
    expect({ ...error, message: error?.message }).toMatchInlineSnapshot(`
      {
        "message": "Invalid URL: the URL is malformed. Pass a valid absolute URL.",
      }
    `)
  })

  test('rejects with invalid_dpop_proof, sends no refresh, and keeps the session, when another DPoP key binds its tokens', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      dpop: await Dpop.create(),
      plugins: [backend({ store })],
      url: 'http://127.0.0.1:9',
    })
    const { id } = await accounts.backend.save({
      session: {
        ...session({ expiresAt: 0, expiry: 60, refreshToken: 'refresh-token' }),
        accessToken: boundToken(await Dpop.create()),
      },
    })

    // Nothing listens at the URL, so a refresh that the instance sends rejects with a network error,
    // which ends the session.
    const error = await accounts.backend
      .get({ id })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Accounts.RequestError)
    expect({
      code: (error as Accounts.RequestError).code,
      message: (error as Accounts.RequestError).message,
      reason: (error as Accounts.RequestError).reason,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "code": "invalid_dpop_proof",
        "message": "Invalid DPoP key: another DPoP key binds the access token. Set \`dpop\` to the key that bound it, or sign in again.",
        "reason": "invalid_dpop_proof",
        "status": 400,
      }
    `)
    expect(
      Boolean(await store.getItem(`tempo-id:session:${id}`)),
    ).toMatchInlineSnapshot(`true`)
  })

  test('get, fetch, and end return no session, and write and delete nothing, for the session name of an instance that shares the store', async () => {
    const memory = Store.memory()
    const calls: string[] = []
    const store = Store.from({
      getItem: (key) => {
        calls.push(`getItem ${key}`)
        return memory.getItem(key)
      },
      removeItem: (key) => {
        calls.push(`removeItem ${key}`)
        return memory.removeItem(key)
      },
      setItem: (key, value, options) => {
        calls.push(`setItem ${key}`)
        return memory.setItem(key, value, options)
      },
    })
    // The name of an instance's own session follows the prefix of a backend's session keys.
    const id = '["http://127.0.0.1:9","https://app.example.com",42431]'
    await memory.setItem(`tempo-id:session:${id}`, { state: {}, version: 0 })
    const accounts = instance({ store })

    const results = [
      await accounts.backend.get({ id }),
      await accounts.backend.fetch({ id, url: 'http://127.0.0.1:9/me' }),
      await accounts.backend.end({ id }),
    ]

    expect(results).toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        undefined,
      ]
    `)
    expect(calls).toMatchInlineSnapshot(`
      [
        "getItem tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]",
        "getItem tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]",
        "getItem tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]",
      ]
    `)
    expect(await memory.getItem(`tempo-id:session:${id}`))
      .toMatchInlineSnapshot(`
      {
        "state": {},
        "version": 0,
      }
    `)
  })

  test('get returns, and end revokes and deletes, a session that an earlier release stored under an ID of standard Base64', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const saved = await accounts.backend.save({
      session: session({ expiry: 60, refreshToken: 'refresh-token' }),
    })
    // An earlier release stored a session under any `id`.
    const id = 'a+b/c='
    await store.setItem(
      `tempo-id:session:${id}`,
      await store.getItem(`tempo-id:session:${saved.id}`),
    )

    const restored = await accounts.backend.get({ id })
    // Nothing listens at the URL, so the revocation fails, and the session stays.
    const revocation = await accounts.backend.end({ id }).then(
      () => 'ended',
      (error: unknown) =>
        error instanceof Accounts.RequestError ? error.code : error,
    )
    const kept = Boolean(await store.getItem(`tempo-id:session:${id}`))
    await accounts.backend.end({ id, revoke: false })

    expect({
      deleted: (await store.getItem(`tempo-id:session:${id}`)) === undefined,
      kept,
      restored: restored?.id,
      revocation,
    }).toMatchInlineSnapshot(`
      {
        "deleted": true,
        "kept": true,
        "restored": "a+b/c=",
        "revocation": "server_error",
      }
    `)
  })

  test('save and start store a session or a redirect only under an ID of 1 to 128 characters of URL-safe Base64', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const longest = `${'a'.repeat(63)}-_${'Z9'.repeat(31)}0`
    const ids = [longest, `${longest}0`, '', 'a:b', '["a"]']
    const refusal = (error: unknown) =>
      error instanceof Accounts.RequestError
        ? `${error.code} ${error.field}`
        : (error as Error).name

    const results = await Promise.all(
      ids.map((id) =>
        Promise.all([
          accounts.backend
            .save({ id, session: session({ expiry: 60 }) })
            .then(() => 'saved', refusal),
          accounts.backend
            .start({
              accessKey: false,
              id,
              redirectUri: 'https://app.example.com/callback',
            })
            .then(() => 'started', refusal),
        ]),
      ),
    )
    const stored = await Promise.all(
      ids.map(async (id) => [
        (await store.getItem(`tempo-id:session:${id}`)) !== undefined,
        (await store.getItem(`tempo-id:pending:${id}`)) !== undefined,
      ]),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        [
          "saved",
          "started",
        ],
        [
          "invalid_request id",
          "invalid_request id",
        ],
        [
          "invalid_request id",
          "invalid_request id",
        ],
        [
          "invalid_request id",
          "invalid_request id",
        ],
        [
          "invalid_request id",
          "invalid_request id",
        ],
      ]
    `)
    expect(stored).toMatchInlineSnapshot(`
      [
        [
          true,
          true,
        ],
        [
          false,
          false,
        ],
        [
          false,
          false,
        ],
        [
          false,
          false,
        ],
        [
          false,
          false,
        ],
      ]
    `)
  })

  test('complete redeems no callback of a redirect in progress under an ID that is no session ID', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const { id, url } = await accounts.backend.start({
      accessKey: false,
      redirectUri: 'https://app.example.com/callback',
    })
    const state = new URL(url).searchParams.get('state')
    // A redirect in progress under an ID that an earlier release accepted.
    await store.setItem(
      'tempo-id:pending:a:b',
      await store.getItem(`tempo-id:pending:${id}`),
    )

    const error = await accounts.backend
      .complete({
        id: 'a:b',
        url: `https://app.example.com/callback?code=1&state=${state}`,
      })
      .then(
        () => undefined,
        (error: Error) => error.name,
      )

    expect(error).toMatchInlineSnapshot(`"Accounts.PendingNotFoundError"`)
  })

  test('complete redeems the code of a redirect in progress once for concurrent callbacks of two processes that share a store', async () => {
    const database = new PGlite()
    // Each process holds its own client of the same table.
    const [first, second] = [0, 1].map(() =>
      instance({
        store: Store.postgres({
          query: (text, values) => database.query(text, [...values]),
        }),
      }),
    )
    const { id, url } = await first!.backend.start({
      accessKey: false,
      redirectUri,
    })
    const state = new URL(url).searchParams.get('state')
    const callback = `${redirectUri}?code=1&state=${state}`

    const errors = await Promise.all(
      [first!, second!].map((accounts) =>
        accounts.backend.complete({ id, url: callback }).then(
          () => undefined,
          (error: Error) => error.name,
        ),
      ),
    )

    // Nothing listens at the URL, so the one redemption rejects without a response.
    expect(errors.toSorted((a, b) => String(a).localeCompare(String(b))))
      .toMatchInlineSnapshot(`
      [
        "Accounts.PendingNotFoundError",
        "Accounts.RequestError",
      ]
    `)
  })

  test('refuses a relative callback URL as invalid_request, before any request, and quotes none of its code', async () => {
    const accounts = instance({ store: Store.memory() })
    const code = 'SplxlOBeZQQYbYS6WxSbIA'
    const { id, url } = await accounts.backend.start({
      accessKey: false,
      redirectUri: 'https://app.example.com/callback',
    })
    const state = new URL(url).searchParams.get('state')

    const error = (await accounts.backend
      .complete({ id, url: `/callback?code=${code}&state=${state}` })
      .then(
        () => undefined,
        (error: unknown) => error,
      )) as Error

    expect({
      code: error instanceof Accounts.RequestError ? error.code : undefined,
      field: error instanceof Accounts.RequestError ? error.field : undefined,
      name: error.name,
      quoted: [error.message, error.stack, ...Object.values(error)].some(
        (value) => String(value).includes(code),
      ),
    }).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": "url",
        "name": "Accounts.RequestError",
        "quoted": false,
      }
    `)
  })

  test.for([
    [{ amount: '-1' }, 'funding.amount'],
    [{ amount: '0' }, 'funding.amount'],
    [{ amount: 'ten' }, 'funding.amount'],
    [{ amount: '10', currency: 'usd' }, 'funding.currency'],
    [{ amount: '10', token: '' }, 'funding.token'],
    [{ amount: 10 as never }, 'funding.amount'],
    [{ amount: '10', token: null as never }, 'funding.token'],
  ] as const)(
    'refuses the funding hint %o before Tempo ID, as invalid_field with the field %s, and stores no pending sign-in',
    async ([funding, field]) => {
      const store = Store.memory()
      const accounts = instance({ store })

      const error = await accounts.backend
        .start({ accessKey: false, funding, id: 'session_1', redirectUri })
        .then(
          (started) => new URL(started.url).origin,
          (error: unknown) => error,
        )

      expect(error).toBeInstanceOf(Accounts.RequestError)
      expect({
        field: (error as Accounts.RequestError).field,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      }).toEqual({ field, reason: 'invalid_field', status: 0 })
      expect(
        await store.getItem('tempo-id:pending:session_1'),
      ).toMatchInlineSnapshot(`undefined`)
    },
  )

  test('sends a funding hint of 18 decimals, which Tempo ID takes', async () => {
    const accounts = instance({ store: Store.memory() })

    const { url } = await accounts.backend.start({
      accessKey: false,
      funding: { amount: '10.000000000000000001', currency: 'EUR' },
      redirectUri,
    })

    expect(
      [...new URL(url).searchParams].filter(([name]) =>
        name.startsWith('funding_'),
      ),
    ).toMatchInlineSnapshot(`
      [
        [
          "funding_currency",
          "EUR",
        ],
        [
          "funding_hint",
          "10.000000000000000001",
        ],
      ]
    `)
  })

  test('sends loginHint and prompt as login_hint and prompt of the authorization request', async () => {
    const accounts = instance({ store: Store.memory() })

    const { url } = await accounts.backend.start({
      accessKey: false,
      loginHint: 'user@example.com',
      par: false,
      prompt: 'login',
      redirectUri,
    })
    const search = new URL(url).searchParams

    expect(search.get('login_hint')).toMatchInlineSnapshot(`"user@example.com"`)
    expect(search.get('prompt')).toMatchInlineSnapshot(`"login"`)
  })

  test('throws RedirectUriRequiredError from start without a redirect URI outside a page, and stores no pending sign-in', async () => {
    const store = Store.memory()
    const accounts = instance({ store })

    const error = await accounts.backend
      .start({ accessKey: false, id: 'session_1' })
      .then(
        (started) => started.url,
        (error: unknown) => error,
      )

    expect(error).toBeInstanceOf(Accounts.RedirectUriRequiredError)
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RedirectUriRequiredError: Missing redirect URI: outside a browser, no page origin can serve as the redirect URI. Pass \`redirectUri\`, one of the app's registered redirect URIs.]`,
    )
    expect(
      await store.getItem('tempo-id:pending:session_1'),
    ).toMatchInlineSnapshot(`undefined`)
  })
})

describe('session.get', () => {
  test('reads an access token of the Authorization header only with accessToken, and only without a session cookie', async () => {
    const store = Store.memory()
    const [plain, verifying] = [false, true].map((accessToken) =>
      Accounts.create({
        clientId: 'https://app.example.com',
        plugins: [backend({ store, ...(accessToken ? { accessToken } : {}) })],
        url: 'http://127.0.0.1:9',
      }),
    )
    const { id } = await plain!.backend.save({
      session: session({ expiry: 60 }),
    })
    const request = (authorization: string, cookie?: string) =>
      new Request('https://app.example.com/v1/me', {
        headers: { authorization, ...(cookie ? { cookie } : {}) },
      })
    // A token that names a key of the issuer's key set, which the verifier fetches before it checks
    // the signature.
    const jwt = [
      { alg: 'RS256', kid: 'key_1', typ: 'at+jwt' },
      { sub: 'user_1' },
    ]
      .map((part) =>
        Base64.fromString(JSON.stringify(part), { pad: false, url: true }),
      )
      .concat('signature')
      .join('.')

    const results = await Promise.all([
      plain!.session.get(request(`Bearer ${jwt}`)),
      verifying!.session.get(request('Bearer sk-tempo-1')),
      verifying!.session
        .get(request(`Bearer ${jwt}`, `__Host-tempo-id.sid=${id}`))
        .then((session) => session?.method),
      // Nothing serves the issuer's key set, so a token that parses waits on an outage.
      verifying!.session
        .get(request(`DPoP ${jwt}`))
        .catch((error: Accounts.RequestError) => [error.name, error.status]),
    ])

    expect(results).toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        "tempo-id",
        [
          "Accounts.RequestError",
          0,
        ],
      ]
    `)
  })
})

/** Returns an unsigned access token whose `cnf.jkt` names `dpop`, as a DPoP token of Tempo ID's does. */
function boundToken(dpop: Dpop.Dpop) {
  const part = (value: unknown) =>
    Base64.fromString(JSON.stringify(value), { pad: false, url: true })
  return [
    part({ alg: 'ES256', typ: 'at+jwt' }),
    part({ cnf: { jkt: Dpop.thumbprint(dpop) } }),
    'signature',
  ].join('.')
}

/** Returns an instance of a backend whose sessions live in `store`, at a URL where nothing listens. */
function instance(options: { store: Store.Store }) {
  return Accounts.create({
    clientId: 'https://app.example.com',
    plugins: [backend({ store: options.store })],
    url: 'http://127.0.0.1:9',
  })
}

/**
 * Returns a session whose access key expires `expiry` seconds from now, with a signed key
 * authorization, and an access token that holds for an hour unless `expiresAt` says otherwise.
 */
function session(options: {
  expiresAt?: number | undefined
  expiry: number
  refreshToken?: string | undefined
}) {
  const owner = Secp256k1.randomPrivateKey()
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: 42431n,
    expiry: Math.floor(Date.now() / 1000) + options.expiry,
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: owner,
  })
  return Session.from({
    accessKey: {
      account: Address.fromPublicKey(
        Secp256k1.getPublicKey({ privateKey: owner }),
      ),
      chainId: 42431,
      keyAuthorization: KeyAuthorization.toRpc(
        KeyAuthorization.from(authorization, { signature }),
      ),
      privateKey,
    },
    accessToken: 'access-token',
    expiresAt: options.expiresAt ?? Date.now() + 60 * 60 * 1000,
    ...(options.refreshToken ? { refreshToken: options.refreshToken } : {}),
    user: { email: 'user@example.com', id: 'user_1' },
  })
}
