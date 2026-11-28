/**
 * Runs the `passkey` plugin without a server: what `passkey.signIn`, `passkey.prepare`, and
 * `passkey.register` throw for a request without a response, and for an invalid
 * `accessKey.publicKey` before any request.
 * @module
 */
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { P256, PublicKey, Secp256k1 } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { passkey } from './index.js'

describe('passkey', () => {
  // Nothing listens at the URL, so each request rejects with a network error.
  function create() {
    return Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
  }

  test('signIn throws RequestError with status 0, and keeps the user signed out, when the request receives no response', async () => {
    const accounts = create()

    const error = await accounts.passkey
      .signIn({ accessKey: false })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The sign-in received no response. Check the connection, and sign in again.]`,
    )
    expect({
      session: await accounts.session.get(),
      signedIn: (error as Accounts.RequestError).signedIn,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "signedIn": false,
        "status": 0,
      }
    `)
  })

  test('prepare returns a handle whose signIn throws RequestError with status 0 when the request receives no response', async () => {
    const accounts = create()

    const prepared = accounts.passkey.prepare({ accessKey: false })
    const available = await prepared.available
    const error = await prepared.signIn().catch((error: unknown) => error)

    expect(available).toMatchInlineSnapshot(`false`)
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The sign-in received no response. Check the connection, and sign in again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('available sends one GET /v1/realms for concurrent calls, such as the two effects of a React StrictMode mount, and a new one after it settles', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const concurrent = await Promise.all([
      accounts.passkey.available(),
      accounts.passkey.available(),
    ])
    const later = await accounts.passkey.available()

    expect({ concurrent, later }).toMatchInlineSnapshot(`
      {
        "concurrent": [
          false,
          false,
        ],
        "later": false,
      }
    `)
    expect(paths).toMatchInlineSnapshot(`
      [
        "/v1/realms",
        "/v1/realms",
      ]
    `)
  })

  test('available and prepare share one GET /v1/realms for concurrent calls, such as the button and the prepared sign-in of one sign-in form', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const prepared = accounts.passkey.prepare({ accessKey: false })
    const available = await Promise.all([
      accounts.passkey.available(),
      prepared.available,
    ])

    expect(available).toMatchInlineSnapshot(`
      [
        false,
        false,
      ]
    `)
    expect(paths).toMatchInlineSnapshot(`
      [
        "/v1/realms",
      ]
    `)
  })

  test('prepare with available sends no GET /v1/realms, and with true requests the options at once', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const known = accounts.passkey.prepare({
      accessKey: false,
      available: true,
    })
    const unknown = accounts.passkey.prepare({
      accessKey: false,
      available: false,
    })
    const available = await Promise.all([known.available, unknown.available])
    await expect.poll(() => paths.length).toBe(1)

    expect(available).toMatchInlineSnapshot(`
      [
        true,
        false,
      ]
    `)
    expect(paths).toMatchInlineSnapshot(`
      [
        "/v1/auth/passkey/options",
      ]
    `)
  })

  test('prepare returns a handle whose signIn calls during a request each send their own, so a stalled request holds no retry', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const prepared = accounts.passkey.prepare({
      accessKey: false,
      available: false,
    })
    const [first, second] = await Promise.allSettled([
      prepared.signIn(),
      prepared.signIn(),
    ])

    // Nothing answers, so no ceremony starts, and each call rejects with its own request's error.
    expect({
      paths,
      shared:
        first.status === 'rejected' &&
        second.status === 'rejected' &&
        first.reason === second.reason,
    }).toMatchInlineSnapshot(`
      {
        "paths": [
          "/v1/auth/passkey/options",
          "/v1/auth/passkey/options",
        ],
        "shared": false,
      }
    `)
  })

  test('prepare requests options that offer every passkey at the signIn of a handle that a signOut without everywhere followed', async () => {
    const allows: unknown[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.pathname === '/v1/auth/passkey/options')
          allows.push(
            (JSON.parse(String(init?.body)) as { allow?: unknown }).allow ??
              null,
          )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const prepared = accounts.passkey.prepare({
      accessKey: false,
      available: true,
    })
    await expect.poll(() => allows.length).toBe(1)
    // The sign-out keeps the browser's Tempo ID session, whose user alone the options would name.
    await accounts.signOut()
    await prepared.signIn().catch(() => undefined)

    // Nothing answers, so the signIn requests the options of the new request again.
    expect(allows).toMatchInlineSnapshot(`
      [
        null,
        {
          "type": "all",
        },
        {
          "type": "all",
        },
      ]
    `)
  })

  test('register and signIn throw expiry_passed, and send no request, for an access key whose expiry in Unix seconds has passed', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // 3600 is a Unix time in 1970, not a lifetime in seconds.
    const errors = [
      await accounts.passkey
        .register({ accessKey: { expiry: 3600 } })
        .catch((error: unknown) => error),
      await accounts.passkey
        .signIn({ accessKey: { expiry: 3600 } })
        .catch((error: unknown) => error),
    ]

    expect(
      errors.map((error) => ({
        message: (error as Accounts.RequestError).message,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "message": "Invalid \`expiry\`: Thu, 01 Jan 1970 01:00:00 GMT has passed. Use a future Unix time in seconds, or a duration, such as \`'1h'\`.",
          "reason": "expiry_passed",
          "status": 0,
        },
        {
          "message": "Invalid \`expiry\`: Thu, 01 Jan 1970 01:00:00 GMT has passed. Use a future Unix time in seconds, or a duration, such as \`'1h'\`.",
          "reason": "expiry_passed",
          "status": 0,
        },
      ]
    `)
    expect(paths).toMatchInlineSnapshot(`[]`)
  })

  test('register throws session_required, and sends no request, after the instance signs out, also in a new instance on the same store', async () => {
    const paths: string[] = []
    const store = Store.memory()
    const create = () =>
      Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [passkey()],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create()
    await accounts.signOut()

    // The sign-out keeps the browser's Tempo ID session, which would receive the passkey.
    const errors = [
      await accounts.passkey.register().catch((error: unknown) => error),
      await accounts.passkey
        .register({ accessKey: { expiry: '1h' } })
        .catch((error: unknown) => error),
      await create()
        .passkey.register()
        .catch((error: unknown) => error),
    ]

    expect(
      errors.map((error) => ({
        message: (error as Accounts.RequestError).message,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "message": "The user signed out of the app, so the passkey would join the account of the user who signed out. Sign in before the registration.",
          "reason": "session_required",
          "status": 0,
        },
        {
          "message": "The user signed out of the app, so the passkey would join the account of the user who signed out. Sign in before the registration.",
          "reason": "session_required",
          "status": 0,
        },
        {
          "message": "The user signed out of the app, so the passkey would join the account of the user who signed out. Sign in before the registration.",
          "reason": "session_required",
          "status": 0,
        },
      ]
    `)
    expect(paths).toMatchInlineSnapshot(`[]`)
  })

  test("register sends its request once another instance on the same store signs in after this instance's sign-out, and throws session_required while this instance's next sign-out ends that session", async () => {
    const paths: string[] = []
    const store = Store.memory()
    const signIns: string[] = []
    const create = (label: string) =>
      Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [
          passkey(),
          // Commits a session, as the sign-in of another instance, such as another tab, does.
          Plugin.from({
            hooks: {
              afterSignIn: () => {
                signIns.push(label)
              },
            },
            actions: (context) => ({
              // Reads the mark under the lock, as a plugin that holds it does.
              locked: () =>
                context.session.exclusive(() => context.session.signedOut()),
              commit: () =>
                context.session.change().commit(
                  Session.from({
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    user: { email: 'user@example.com', id: 'user_1' },
                  }),
                ),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create('accounts')
    const other = create('other')
    await accounts.signOut()
    await other.test.commit()

    // The sign-out ends the session of the other instance's sign-in, which the store holds.
    const signingOut = accounts.signOut()
    const [during, locked] = await Promise.all([
      accounts.passkey
        .register()
        .catch((error: unknown) => (error as Accounts.RequestError).reason),
      accounts.test.locked(),
    ])
    await signingOut
    await other.test.commit()
    // Two overlapping registrations adopt the stored session once.
    const [after] = await Promise.all(
      [accounts.passkey.register(), accounts.passkey.register()].map(
        (registration) =>
          registration.catch(
            (error: unknown) => (error as Accounts.RequestError).message,
          ),
      ),
    )

    await expect.poll(() => signIns.length).toBe(3)
    expect({ after, during, locked, paths, signIns }).toMatchInlineSnapshot(`
      {
        "after": "The registration received no response. Check the connection, and register the passkey again.",
        "during": "session_required",
        "locked": true,
        "paths": [
          "/v1/account/passkey/options",
          "/v1/account/passkey/options",
        ],
        "signIns": [
          "other",
          "other",
          "accounts",
        ],
      }
    `)
  })

  test("register throws session_required, and sends no request, when this instance signs out during its read of another instance's sign-in", async () => {
    const paths: string[] = []
    const store = Store.memory()
    const create = () =>
      Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [
          passkey(),
          // Commits a session, as the sign-in of another instance, such as another tab, does.
          Plugin.from({
            actions: (context) => ({
              commit: () =>
                context.session.change().commit(
                  Session.from({
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    user: { email: 'user@example.com', id: 'user_1' },
                  }),
                ),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create()
    const other = create()
    await accounts.signOut()
    await other.test.commit()

    // The sign-out starts after the registration's read of the store, and before the read settles.
    const registration = accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)
    await accounts.signOut()
    const during = await registration
    const after = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)

    expect({
      after,
      during,
      paths,
      session: (await accounts.session.get())?.user?.id,
    }).toMatchInlineSnapshot(`
      {
        "after": "session_required",
        "during": "session_required",
        "paths": [],
        "session": undefined,
      }
    `)
  })

  test("register throws session_required, and sends no request, while another instance's sign-out of its later sign-in runs", async () => {
    const paths: string[] = []
    const store = Store.memory()
    const create = (store: Store.Store) =>
      Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [
          passkey(),
          // Commits a session, as the sign-in of another instance, such as another tab, does.
          Plugin.from({
            actions: (context) => ({
              commit: () =>
                context.session.change().commit(
                  Session.from({
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    refreshToken: 'refresh-token',
                    user: { email: 'user@example.com', id: 'user_1' },
                  }),
                ),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create(store)
    // Another process on the same entries, whose messages never reach this one.
    const other = create(
      Store.from({
        getItem: (key) => store.getItem(key),
        removeItem: (key) => store.removeItem(key),
        setItem: (key, value, options) => store.setItem(key, value, options),
      }),
    )
    await accounts.signOut()
    await other.test.commit()

    // The other sign-out stores its mark at once, and empties the session after its revocation,
    // which receives no response.
    const signingOut = other.signOut().catch(() => undefined)
    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)
    await signingOut

    expect({
      error,
      paths,
      session: (await accounts.session.get())?.user?.id,
    }).toMatchInlineSnapshot(`
      {
        "error": "session_required",
        "paths": [
          "/oauth2/revoke",
        ],
        "session": undefined,
      }
    `)
  })

  test('register throws session_required, and sends no request, in an instance that holds the session once another process on the store signs out', async () => {
    const paths: string[] = []
    const store = Store.memory()
    const create = (store: Store.Store) =>
      Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [
          passkey(),
          // Commits a session, as a sign-in does.
          Plugin.from({
            actions: (context) => ({
              commit: () =>
                context.session.change().commit(
                  Session.from({
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    refreshToken: 'refresh-token',
                    user: { email: 'user@example.com', id: 'user_1' },
                  }),
                ),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create(store)
    // Another process on the same entries, such as a replica on one `Store.postgres` table, whose
    // messages never reach this one.
    const other = create(
      Store.from({
        getItem: (key) => store.getItem(key),
        removeItem: (key) => store.removeItem(key),
        setItem: (key, value, options) => store.setItem(key, value, options),
      }),
    )
    await other.test.commit()
    // This process reads the stored session, then the other process signs it out. Its revocation
    // receives no response, and the sign-out stores its mark.
    const held = (await accounts.session.get())?.user?.id
    await other.signOut().catch(() => undefined)
    paths.length = 0

    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)

    expect({ error, held, paths }).toMatchInlineSnapshot(`
      {
        "error": "session_required",
        "held": "user_1",
        "paths": [],
      }
    `)
  })

  test("register throws session_required, and sends no request, while another instance's sign-out with everywhere of its later sign-in runs", async () => {
    const paths: string[] = []
    const store = Store.memory()
    const create = (store: Store.Store) =>
      Accounts.create({
        chain: 42431,
        clientId: 'client_test',
        fetch: (input, init) => {
          paths.push(
            new URL(input instanceof Request ? input.url : input).pathname,
          )
          return fetch(input, init)
        },
        plugins: [
          passkey(),
          // Commits a session, as the sign-in of another instance, such as another tab, does.
          Plugin.from({
            actions: (context) => ({
              commit: () =>
                context.session.change().commit(
                  Session.from({
                    accessToken: 'access-token',
                    expiresAt: Date.now() + 60 * 60 * 1000,
                    refreshToken: 'refresh-token',
                    user: { email: 'user@example.com', id: 'user_1' },
                  }),
                ),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const accounts = create(store)
    // Another process on the same entries, whose messages never reach this one.
    const other = create(
      Store.from({
        getItem: (key) => store.getItem(key),
        removeItem: (key) => store.removeItem(key),
        setItem: (key, value, options) => store.setItem(key, value, options),
      }),
    )
    await accounts.signOut()
    await other.test.commit()

    // The other sign-out stores its logout's mark at once, and empties the session after its
    // logout, which receives no response.
    const signingOut = other
      .signOut({ everywhere: true })
      .catch(() => undefined)
    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)
    await signingOut

    expect({
      error,
      paths,
      session: (await accounts.session.get())?.user?.id,
    }).toMatchInlineSnapshot(`
      {
        "error": "session_required",
        "paths": [
          "/oauth2/revoke",
          "/v1/auth/logout",
        ],
        "session": undefined,
      }
    `)
  })

  test('register throws session_required, and sends no request, after a sign-out when the store refuses each read', async () => {
    const paths: string[] = []
    const path = Path.join(
      Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-')),
      'session.json',
    )
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.file(path),
      url: 'http://127.0.0.1:9',
    })
    await accounts.signOut()
    // Another process damages the file, so each read throws `Store.InvalidFileError`.
    Fs.writeFileSync(path, '{')

    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)

    expect({ error, paths }).toMatchInlineSnapshot(`
      {
        "error": "session_required",
        "paths": [],
      }
    `)
  })

  test('register throws session_required, and sends no request, after a signOut with everywhere whose logout fails', async () => {
    const paths: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_test',
      fetch: (input, init) => {
        paths.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        )
        return fetch(input, init)
      },
      plugins: [passkey()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // The logout receives no response, so the browser's Tempo ID session can still live.
    const signOut = await accounts
      .signOut({ everywhere: true })
      .catch((error: unknown) => (error as Accounts.RequestError).status)
    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => (error as Accounts.RequestError).reason)

    expect({ error, paths, signOut }).toMatchInlineSnapshot(`
      {
        "error": "session_required",
        "paths": [
          "/v1/auth/logout",
        ],
        "signOut": 0,
      }
    `)
  })

  test('register throws RequestError with status 0 when the request receives no response', async () => {
    const accounts = create()

    const error = await accounts.passkey
      .register()
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The registration received no response. Check the connection, and register the passkey again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('throws invalid_public_key, which quotes no part of the value, for a private key passed as `accessKey.publicKey` to `passkey.signIn` and `passkey.register`', async () => {
    const accounts = create()
    const privateKey = Secp256k1.randomPrivateKey()
    const accessKey = { expiry: 3600, publicKey: privateKey }

    const errors = await Promise.all([
      accounts.passkey.signIn({ accessKey }).then(
        () => undefined,
        (error: Accounts.RequestError) => error,
      ),
      accounts.passkey.register({ accessKey }).then(
        () => undefined,
        (error: Accounts.RequestError) => error,
      ),
    ])

    expect(
      errors.map((error) => ({
        cause: error?.cause,
        field: error?.field,
        leaks: `${error?.message} ${error?.stack}`.includes(
          privateKey.slice(2),
        ),
        message: error?.message,
        name: error?.name,
        reason: error?.reason,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "cause": undefined,
          "field": "accessKey.publicKey",
          "leaks": false,
          "message": "Invalid public key: \`accessKey.publicKey\` holds no uncompressed public key, such as a private key in its place. Pass the public key of the access key.",
          "name": "Accounts.RequestError",
          "reason": "invalid_public_key",
        },
        {
          "cause": undefined,
          "field": "accessKey.publicKey",
          "leaks": false,
          "message": "Invalid public key: \`accessKey.publicKey\` holds no uncompressed public key, such as a private key in its place. Pass the public key of the access key.",
          "name": "Accounts.RequestError",
          "reason": "invalid_public_key",
        },
      ]
    `)
  })

  test('throws invalid_public_key for an `accessKey.publicKey` of a public key length with an invalid prefix, compressed, or off the curve of its `type`', async () => {
    const accounts = create()
    const p256 = PublicKey.toHex(
      P256.getPublicKey({ privateKey: P256.randomPrivateKey() }),
    )
    const accessKeys = [
      { expiry: 3600, publicKey: `0x05${'ab'.repeat(64)}` as const },
      { expiry: 3600, publicKey: `0x04${'ab'.repeat(64)}` as const },
      { expiry: 3600, publicKey: p256 },
      // A private key behind a compressed prefix, whose value is a valid x coordinate.
      {
        expiry: 3600,
        publicKey:
          '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' as const,
      },
    ]

    const errors = await Promise.all(
      accessKeys.map((accessKey) =>
        accounts.passkey.signIn({ accessKey }).then(
          () => undefined,
          (error: Accounts.RequestError) => error,
        ),
      ),
    )

    expect(errors.map((error) => error?.reason)).toMatchInlineSnapshot(`
      [
        "invalid_public_key",
        "invalid_public_key",
        "invalid_public_key",
        "invalid_public_key",
      ]
    `)
  })
})
