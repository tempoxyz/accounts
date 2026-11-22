/**
 * Tests the instance's session reads and its refresh without a server.
 * @module
 */
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import * as AccessKey from './AccessKey.js'

const owner = Account.fromSecp256k1(
  '0x0123456789012345678901234567890123456789012345678901234567890123',
)

describe('authorize', () => {
  test('sends the authorization with no check of the Tempo ID session, for an instance that holds a session', async () => {
    const memory = Store.memory()
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        const url = new URL(String(input))
        if (url.pathname.startsWith('/v1/'))
          requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
        return globalThis.fetch(input, init)
      },
      redirectUri: 'https://app.example/',
      store: memory,
      url: 'https://id.invalid',
    })
    await memory.setItem(
      'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
      {
        state: {
          session: await expired({
            accessToken: 'a',
            expiresIn: 3_600_000,
            valid: true,
          }),
        },
        version: 0,
      },
    )

    await accounts.authorize({ accessKey: false }).catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /v1/authorize",
      ]
    `)
  })
})

describe('getSession', () => {
  test('shows no authorization for a call with `reauthorize` after a sign-out without `everywhere`', async () => {
    const accounts = Accounts.create({
      clientId: 'tempo-example-web',
      store: Store.memory(),
      url: 'https://id.invalid',
    })
    await accounts.session.get()
    await accounts.signOut()
    const statuses: string[] = []
    accounts.session.status.subscribe((status) => statuses.push(status.status))

    const session = await accounts.session.get({ reauthorize: true })

    expect(session).toMatchInlineSnapshot(`undefined`)
    expect(statuses).toMatchInlineSnapshot(`[]`)
  })

  test('reads the sign-out mark from the store once for a call with `reauthorize` that authorizes', async () => {
    const store = Store.memory()
    const reads: string[] = []
    const accounts = Accounts.create({
      clientId: 'tempo-example-web',
      store: {
        ...store,
        getItem(key) {
          if (key.endsWith(':signed-out')) reads.push(key)
          return store.getItem(key)
        },
      },
      redirectUri: 'https://app.example/',
      url: 'https://id.invalid',
    })
    await accounts.session.get()

    await accounts.session.get({ reauthorize: true }).catch(() => undefined)

    expect(reads.length).toMatchInlineSnapshot(`1`)
  })

  test('sends one authorization for overlapping calls with `reauthorize`', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      redirectUri: 'https://app.example/',
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    await Promise.all([
      accounts.session.get({ reauthorize: true }).catch(() => undefined),
      accounts.session.get({ reauthorize: true }).catch(() => undefined),
    ])

    expect(requests).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
      ]
    `)
  })

  test('sends the renewal of an expired session with no check of the Tempo ID session', async () => {
    const memory = Store.memory()
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        const url = new URL(String(input))
        if (url.pathname.startsWith('/v1/'))
          requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
        return globalThis.fetch(input, init)
      },
      redirectUri: 'https://app.example/',
      store: memory,
      url: 'https://id.invalid',
    })
    await memory.setItem(
      'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
      {
        state: {
          session: await expired({ accessToken: 'a', expiresIn: -1000 }),
        },
        version: 0,
      },
    )

    await accounts.session.get({ reauthorize: true }).catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /v1/authorize",
      ]
    `)
  })

  test('sends no authorization, and returns the stored session, for an instance with `resource`', async () => {
    const memory = Store.memory()
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      resource: 'https://api.example/mcp',
      store: memory,
      url: 'https://id.invalid',
    })
    await memory.setItem(
      'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
      {
        state: {
          session: await expired({
            accessToken: 'a',
            expiresIn: 3_600_000,
            valid: true,
          }),
        },
        version: 0,
      },
    )

    const authorized = await accounts.authorize()

    expect({
      accessToken: authorized?.accessToken,
      requests,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "accessToken": "a",
        "requests": [],
        "status": "signedIn",
      }
    `)
  })

  test('refuses, sends no authorization, and settles the status, for an instance with `resource` and no stored session', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      resource: ['https://api.example/mcp'],
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    const error = await accounts.authorize().catch((error: unknown) => error)

    expect({
      code: (error as Accounts.RequestError).code,
      field: (error as Accounts.RequestError).field,
      requests,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "code": "interaction_required",
        "field": "resource",
        "requests": [],
        "status": "signedOut",
      }
    `)
  })

  test('returns no session, and sends no authorization, for `session.get` with `reauthorize` on an instance with `resource` and no stored session', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      resource: ['https://api.example/mcp'],
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    const session = await accounts.session.get({ reauthorize: true })

    expect({
      requests,
      session,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "requests": [],
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test.each([
    { challenge: 'nonce-b' },
    { accessKey: false as const },
    { account: '0x000000000000000000000000000000000000dEaD' as const },
    { passkey: true },
  ])(
    'refuses %o, sends no authorization, and keeps the stored session, for an instance with `resource`',
    async (parameters) => {
      const memory = Store.memory()
      const requests: string[] = []
      const accounts = Accounts.create({
        chain: 42431,
        clientId: 'tempo-example-web',
        fetch: (input, init) => {
          requests.push(
            `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
          )
          return globalThis.fetch(input, init)
        },
        resource: 'https://api.example/mcp',
        store: memory,
        url: 'https://id.invalid',
      })
      await memory.setItem(
        'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
        {
          state: {
            session: {
              ...(await expired({
                accessToken: 'a',
                expiresIn: 3_600_000,
                valid: true,
              })),
              challengeSignature: '0x01',
            },
          },
          version: 0,
        },
      )

      const error = await accounts
        .authorize(parameters)
        .catch((error: unknown) => error)
      const session = await accounts.session.get()

      expect({
        accessToken: session?.accessToken,
        challengeSignature: session?.challengeSignature,
        code: (error as Accounts.RequestError).code,
        message: (error as Accounts.RequestError).message,
        requests,
        status: accounts.session.status.get().status,
      }).toMatchInlineSnapshot(`
        {
          "accessToken": "a",
          "challengeSignature": "0x01",
          "code": "interaction_required",
          "message": "Authorization refused: an instance with \`resource\` authorizes only through a sign-in on a page. Sign in with a redirect or the dialog.",
          "requests": [],
          "status": "signedIn",
        }
      `)
    },
  )

  test("returns the stored session for an instance with `resource` and a call that names the session's own account", async () => {
    const memory = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      resource: 'https://api.example/mcp',
      store: memory,
      url: 'https://id.invalid',
    })
    await memory.setItem(
      'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
      {
        state: {
          session: await expired({
            accessToken: 'a',
            expiresIn: 3_600_000,
            valid: true,
          }),
        },
        version: 0,
      },
    )

    const authorized = await accounts.authorize({ account: owner.address })

    expect(authorized?.accessToken).toMatchInlineSnapshot(`"a"`)
  })

  test("sends the authorization for an instance with an empty `resource`, which names Tempo ID's origin", async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      resource: [],
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    await accounts.authorize().catch(() => undefined)

    expect(requests.length > 0).toMatchInlineSnapshot(`true`)
  })

  test("refuses the renewal of the app's own expired access key with no request, in place of a new access key", async () => {
    const memory = Store.memory()
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: memory,
      url: 'https://id.invalid',
    })
    // The sign-in named the app's own access key by its public key, so the session holds no material.
    const saved = await expired({ accessToken: 'a', expiresIn: -1000 })
    const { privateKey: _, ...accessKey } =
      saved.accessKey as AccessKey.AccessKey
    await memory.setItem(
      'tempo-id:session:["https://id.invalid","tempo-example-web",42431]',
      {
        state: {
          session: Session.from({
            ...saved,
            accessKey: { ...accessKey, lifetime: 3600 },
          }),
        },
        version: 0,
      },
    )

    const session = await accounts.session
      .get({ reauthorize: true })
      .catch((error: Error) => error.message)

    expect({ requests, session }).toMatchInlineSnapshot(`
      {
        "requests": [
          "POST /oauth2/revoke",
        ],
        "session": undefined,
      }
    `)
  })

  test('sends its own authorization for an overlapping call with `reauthorize` parameters', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      redirectUri: 'https://app.example/',
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    await Promise.all([
      accounts.session.get({ reauthorize: true }).catch(() => undefined),
      accounts.session.get({ reauthorize: {} }).catch(() => undefined),
    ])

    expect(requests).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
        "GET /v1/auth/session",
      ]
    `)
  })

  test('reads the stored session once for a call with `reauthorize` after a read emptied an expired session', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    let reads = 0
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store: Store.from({
        getItem(key) {
          if (key === name) reads++
          return memory.getItem(key)
        },
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      plugins: [lock()],
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: { session: await expired({ accessToken: 'a', expiresIn: -1000 }) },
      version: 0,
    })
    await accounts.session.get()
    // The revocation of the emptied session's refresh token runs in the background, under the lock.
    await settled(accounts)
    reads = 0

    await accounts.session.get({ reauthorize: true }).catch(() => undefined)

    expect(reads).toMatchInlineSnapshot(`1`)
  })

  test("renews another context's later expired session in two overlapping authorizations, which share one read of the store", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    let reads = 0
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store: Store.from({
        getItem(key) {
          if (key === name) reads++
          return memory.getItem(key)
        },
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      plugins: [lock()],
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: await expired({ accessToken: 'first', expiresIn: -2000 }),
      },
      version: 0,
    })
    await accounts.session.get()
    await settled(accounts)
    // Another context signs the same user in again, and that session expires too.
    await memory.setItem(name, {
      state: {
        session: await expired({ accessToken: 'second', expiresIn: -1000 }),
      },
      version: 0,
    })
    reads = 0

    const renewed = await Promise.all(
      [0, 1].map(() =>
        accounts.session_.authorize(async () => {
          await accounts.session_.load()
          return accounts.session_.renewing()?.accessToken
        }),
      ),
    )
    await settled(accounts)

    // One read for both authorizations, and one by the revocation of the replaced session's token.
    expect({ reads, renewed }).toMatchInlineSnapshot(`
      {
        "reads": 2,
        "renewed": [
          "second",
          "second",
        ],
      }
    `)
  })
  test('reads the stored session in the authorization of a call with `reauthorize` no more after its own load found the expired session', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    await memory.setItem(name, {
      state: { session: await expired({ accessToken: 'a', expiresIn: -1000 }) },
      version: 0,
    })
    const reads: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store: Store.from({
        getItem(key) {
          if (key === name)
            reads.push(
              new Error().stack?.includes('revokeExpired')
                ? 'revocation'
                : 'load',
            )
          return memory.getItem(key)
        },
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      plugins: [lock()],
      url: 'http://127.0.0.1:9',
    })

    await accounts.session.get({ reauthorize: true }).catch(() => undefined)
    await settled(accounts)

    // The load's first read and its read before the empty write, then the revocation's.
    expect(reads).toMatchInlineSnapshot(`
      [
        "load",
        "load",
        "revocation",
      ]
    `)
  })
  test("renews another context's later expired session in an authorization that starts after an earlier one read the store", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [lock()],
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: await expired({ accessToken: 'first', expiresIn: -2000 }),
      },
      version: 0,
    })
    await accounts.session.get()
    await settled(accounts)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const earlier = accounts.session_.authorize(async () => {
      await accounts.session_.load()
      await held
    })
    await accounts.session_.load()
    // Another context signs the same user in again after the earlier authorization read the store,
    // and that session expires too.
    await memory.setItem(name, {
      state: {
        session: await expired({ accessToken: 'second', expiresIn: -1000 }),
      },
      version: 0,
    })

    const renewed = await accounts.session_.authorize(async () => {
      await accounts.session_.load()
      return accounts.session_.renewing()?.accessToken
    })
    release()
    await earlier
    await settled(accounts)

    expect(renewed).toBe('second')
  })
  test("keeps another context's sign-in that the store saves during a restore whose empty result commits in an instance without a session", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [lock()],
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await settled(accounts)
    const restore = accounts.session_.change({ restore: true })
    // Another context, such as another tab, signs a user in after the instance read the store.
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'other',
          expiresIn: 60_000,
          valid: true,
        }),
      },
      version: 0,
    })

    await restore.commit(undefined)
    const stored = (await memory.getItem(name)) as {
      state: { session?: Session.Any | undefined }
    }

    expect(stored.state.session?.accessToken).toMatchInlineSnapshot(`"other"`)
  })
  test("keeps another context's sign-in that the store saves during a sign-in whose refusal marks the user signed in, in an instance without a session", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [lock()],
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await settled(accounts)
    const signIn = accounts.session_.change()
    // Another context, such as another tab, signs a user in after the instance read the store.
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'other',
          expiresIn: 60_000,
          valid: true,
        }),
      },
      version: 0,
    })

    await signIn
      .fail(
        new Accounts.RequestError({
          code: 'invalid_request',
          message: 'Refused.',
          signedIn: true,
          status: 400,
        }),
      )
      .catch(() => undefined)
    const stored = (await memory.getItem(name)) as {
      state: { session?: Session.Any | undefined }
    }

    expect(stored.state.session?.accessToken).toMatchInlineSnapshot(`"other"`)
  })
  test("overtakes a restore in progress when an authorization adopts another user's expired session", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [lock()],
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: { session: await expired({ accessToken: 'a', expiresIn: -2000 }) },
      version: 0,
    })
    await accounts.session.get()
    await settled(accounts)
    const restore = accounts.session_.change({ restore: true })
    // Another context signs another user in, and that session expires too.
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'b',
          expiresIn: -1000,
          user: { email: 'other@example.com', id: 'user_2' },
        }),
      },
      version: 0,
    })

    await accounts.session_.authorize(() => accounts.session_.load())
    await settled(accounts)

    expect(restore.overtaken()).toMatchInlineSnapshot(`true`)
  })
  test("runs the plugins' afterSignIn hooks for another context's valid session that a load adopts after an expired one", async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const signedIn: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        lock(),
        Plugin.from({
          hooks: {
            afterSignIn: (_, session) => {
              signedIn.push(session.accessToken!)
            },
          },
          id: 'hooks',
        }),
      ],
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: { session: await expired({ accessToken: 'a', expiresIn: -1000 }) },
      version: 0,
    })
    await accounts.session.get()
    await settled(accounts)
    // Another context signs another user in.
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'b',
          expiresIn: 3_600_000,
          user: { email: 'other@example.com', id: 'user_2' },
          valid: true,
        }),
      },
      version: 0,
    })

    await accounts.session.get()

    await expect.poll(() => signedIn).toEqual(['b'])
  })
})

describe('refresh', () => {
  test('keeps the ID token of the session across a refresh whose answer has none', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (() =>
        Promise.resolve(
          Response.json({
            access_token: 'new',
            expires_in: 300,
            refresh_token: 'refresh-new',
            token_type: 'Bearer',
          }),
        )) as typeof globalThis.fetch,
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: {
          ...(await expired({
            accessToken: 'old',
            expiresIn: 60_000,
            valid: true,
          })),
          idToken: 'id-token',
        },
      },
      version: 0,
    })
    await accounts.session.get()

    const refreshed = await accounts.session.refresh()

    expect({
      accessToken: refreshed?.accessToken,
      idToken: refreshed?.idToken,
    }).toMatchInlineSnapshot(`
      {
        "accessToken": "new",
        "idToken": "id-token",
      }
    `)
  })

  test('revokes the new refresh token, and never the rotated one, in a sign-out that empties the session while the refresh reads the store after its answer', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    // The reads of the session that the store holds, in the order of their calls. Each one returns
    // at its release.
    const reads: (() => void)[] = []
    let holds = false
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const { pathname } = new URL(request.url)
        const body = new URLSearchParams(await request.text())
        requests.push(
          `${request.method} ${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
        )
        if (pathname !== '/oauth2/token')
          return new Response(null, { status: 200 })
        await answered
        return Response.json({
          access_token: 'new',
          expires_in: 300,
          refresh_token: 'refresh-new',
          token_type: 'Bearer',
        })
      }) as typeof globalThis.fetch,
      store: Store.from({
        async getItem(key) {
          if (holds && key === name)
            await new Promise<void>((resolve) => reads.push(resolve))
          return memory.getItem(key)
        },
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'old',
          expiresIn: 60_000,
          valid: true,
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    const refresh = accounts.session.refresh()
    await expect.poll(() => requests.length).toBe(1)
    // The sign-out reads the store before it empties the session.
    holds = true
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(1)
    // The answer arrives during that read, so the refresh still holds the session, and reads the
    // store again.
    answer()
    await expect.poll(() => reads.length).toBe(2)
    // The sign-out's read returns first, so the session empties during the refresh's read.
    reads[0]!()
    await expect
      .poll(() => accounts.session.status.get().status)
      .toBe('signedOut')
    holds = false
    reads[1]!()
    const refreshed = await refresh
    await signOut

    // A refresh that set the session again here would end with no revocation of the new token.
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/token refresh-old",
        "POST /oauth2/revoke refresh-new",
      ]
    `)
    expect({
      refreshed,
      status: accounts.session.status.get().status,
      stored: await memory.getItem(name),
    }).toMatchInlineSnapshot(`
      {
        "refreshed": undefined,
        "status": "signedOut",
        "stored": {
          "state": {
            "session": undefined,
          },
          "version": 0,
        },
      }
    `)
  })

  // The refresh starts its change one microtask after its first read of the store returns. Each
  // row moves the sign-out by one microtask, so one row empties the session in between, also after
  // a change in the depth of either read.
  test.each([-2, -1, 0, 1, 2, 3])(
    'sets no session, and leaves no live refresh token, in a sign-out whose read of the store returns %i microtasks before the first read of the refresh',
    async (lead) => {
      const memory = Store.memory()
      const name =
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
      // The reads of the session that the store holds, in the order of their calls. Each one
      // returns the value at its call, at its release.
      const reads: (() => void)[] = []
      let holds = false
      const requests: string[] = []
      const accounts = Accounts.create({
        chain: 42431,
        clientId: 'https://app.example.com',
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          const { pathname } = new URL(request.url)
          const body = new URLSearchParams(await request.text())
          requests.push(
            `${request.method} ${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
          )
          if (pathname !== '/oauth2/token')
            return new Response(null, { status: 200 })
          return Response.json({
            access_token: 'new',
            expires_in: 300,
            refresh_token: 'refresh-new',
            token_type: 'Bearer',
          })
        }) as typeof globalThis.fetch,
        store: Store.from({
          async getItem(key) {
            const value = await memory.getItem(key)
            if (holds && key === name)
              await new Promise<void>((resolve) => reads.push(resolve))
            return value
          },
          removeItem: (key) => memory.removeItem(key),
          setItem: (key, value) => memory.setItem(key, value),
        }),
        url: 'http://127.0.0.1:9',
      })
      await memory.setItem(name, {
        state: {
          session: await expired({
            accessToken: 'old',
            expiresIn: 60_000,
            valid: true,
          }),
        },
        version: 0,
      })
      await accounts.session.get()

      // The refresh reads the store before it starts its change, and the sign-out reads it before
      // it empties the session.
      holds = true
      const refresh = accounts.session.refresh()
      await expect.poll(() => reads.length).toBe(1)
      const signOut = accounts.signOut()
      await expect.poll(() => reads.length).toBe(2)
      holds = false
      const [first, second] = lead < 0 ? [0, 1] : [1, 0]
      reads[first]!()
      for (let tick = 0; tick < Math.abs(lead); tick++) await Promise.resolve()
      reads[second]!()
      const refreshed = await refresh
      await signOut

      // A refresh that sent the token rotated it, so the token that Tempo ID still accepts is the
      // new one. A refresh that set the session again here would end with no revocation of it.
      const live = requests.includes('POST /oauth2/token refresh-old')
        ? 'refresh-new'
        : 'refresh-old'
      expect(requests.at(-1)).toBe(`POST /oauth2/revoke ${live}`)
      expect({
        refreshed,
        status: accounts.session.status.get().status,
        stored: await memory.getItem(name),
      }).toMatchInlineSnapshot(`
        {
          "refreshed": undefined,
          "status": "signedOut",
          "stored": {
            "state": {
              "session": undefined,
            },
            "version": 0,
          },
        }
      `)
    },
  )

  test('revokes the new refresh token, and never the rotated one, in a sign-out whose read of the store returns after a refresh committed during it', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    // The reads of the session that the store holds, in the order of their calls. Each one returns
    // the value at its call, at its release.
    const reads: (() => void)[] = []
    let holds = false
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const { pathname } = new URL(request.url)
        const body = new URLSearchParams(await request.text())
        requests.push(
          `${request.method} ${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
        )
        if (pathname !== '/oauth2/token')
          return new Response(null, { status: 200 })
        return Response.json({
          access_token: 'new',
          expires_in: 300,
          refresh_token: 'refresh-new',
          token_type: 'Bearer',
        })
      }) as typeof globalThis.fetch,
      store: Store.from({
        async getItem(key) {
          const value = await memory.getItem(key)
          if (holds && key === name)
            await new Promise<void>((resolve) => reads.push(resolve))
          return value
        },
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'old',
          expiresIn: 60_000,
          valid: true,
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // The sign-out reads the store before it empties the session.
    holds = true
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(1)
    holds = false
    // The refresh rotates the token, and saves the new session, during that read.
    const refreshed = await accounts.session.refresh()
    reads[0]!()
    await signOut

    // The sign-out empties the refreshed session, so it revokes that session's token. Tempo ID
    // counts a revocation of the rotated token as a reuse.
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/token refresh-old",
        "POST /oauth2/revoke refresh-new",
      ]
    `)
    expect({
      refreshed: refreshed?.refreshToken,
      status: accounts.session.status.get().status,
      stored: await memory.getItem(name),
    }).toMatchInlineSnapshot(`
      {
        "refreshed": "refresh-new",
        "status": "signedOut",
        "stored": {
          "state": {
            "session": undefined,
          },
          "version": 0,
        },
      }
    `)
  })

  test('keeps the new refresh token for the next sign-out, when its revocation receives no response in a refresh that a sign-out overtook', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    // Nothing listens at the URL, so a revocation that goes there receives no answer.
    let listens = false
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const { pathname } = new URL(request.url)
        const body = new URLSearchParams(await request.text())
        requests.push(
          `${request.method} ${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
        )
        if (pathname !== '/oauth2/token')
          return listens
            ? new Response(null, { status: 200 })
            : globalThis.fetch(input, init)
        await answered
        return Response.json({
          access_token: 'new',
          expires_in: 300,
          refresh_token: 'refresh-new',
          token_type: 'Bearer',
        })
      }) as typeof globalThis.fetch,
      store: memory,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: await expired({
          accessToken: 'old',
          expiresIn: 60_000,
          valid: true,
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    const refresh = accounts.session.refresh().then(
      () => undefined,
      (error: unknown) => error,
    )
    await expect.poll(() => requests.length).toBe(1)
    const signOut = accounts.signOut()
    await expect
      .poll(() => accounts.session.status.get().status)
      .toBe('signedOut')
    answer()
    const error = await refresh
    await signOut
    const unanswered = await memory.getItem(`${name}:unanswered`)
    listens = true
    await accounts.signOut()

    // Only the refresh holds the new token. Without the entry, no later sign-out sends its
    // revocation again, and Tempo ID accepts it until it expires.
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
    expect(unanswered).toMatchInlineSnapshot(`
      [
        "refresh-new",
      ]
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/token refresh-old",
        "POST /oauth2/revoke refresh-new",
        "POST /oauth2/revoke refresh-new",
        "POST /oauth2/revoke refresh-new",
      ]
    `)
    expect(await memory.getItem(`${name}:unanswered`)).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  // Two instances on one store stand for two tabs. The second one's sign-out empties the store
  // during the refresh, and waits for the lock with the token that the refresh sent.
  test.each(['before the answer', 'in the read after the answer'] as const)(
    "sends no revocation of the rotated refresh token in another instance's sign-out on the same store, after a sign-out of the refresh's instance %s",
    async (ordering) => {
      const memory = Store.memory()
      const name =
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
      // The reads of the session by the refresh's instance, in the order of their calls. Each one
      // returns the value at its call, at its release.
      const reads: (() => void)[] = []
      let holds = false
      let answer = () => {}
      const answered = new Promise<void>((resolve) => {
        answer = resolve
      })
      const requests: string[] = []
      const create = (tab: 'first' | 'second') =>
        Accounts.create({
          chain: 42431,
          clientId: 'https://app.example.com',
          fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init)
            const { pathname } = new URL(request.url)
            const body = new URLSearchParams(await request.text())
            requests.push(
              `${tab} ${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
            )
            if (pathname !== '/oauth2/token')
              return new Response(null, { status: 200 })
            await answered
            return Response.json({
              access_token: 'new',
              expires_in: 300,
              refresh_token: 'refresh-new',
              token_type: 'Bearer',
            })
          }) as typeof globalThis.fetch,
          store: Store.from({
            async getItem(key) {
              const value = await memory.getItem(key)
              if (tab === 'first' && holds && key === name)
                await new Promise<void>((resolve) => reads.push(resolve))
              return value
            },
            removeItem: (key) => memory.removeItem(key),
            setItem: (key, value) => memory.setItem(key, value),
          }),
          url: 'http://127.0.0.1:9',
        })
      await memory.setItem(name, {
        state: {
          session: await expired({
            accessToken: 'old',
            expiresIn: 60_000,
            valid: true,
          }),
        },
        version: 0,
      })
      const first = create('first')
      const second = create('second')
      await Promise.all([first.session.get(), second.session.get()])

      const refresh = first.session.refresh()
      await expect.poll(() => requests.length).toBe(1)
      const other = second.signOut()
      await expect
        .poll(() => memory.getItem(name))
        .toMatchObject({ state: { session: undefined } })
      if (ordering === 'before the answer') {
        const own = first.signOut()
        await expect
          .poll(() => first.session.status.get().status)
          .toBe('signedOut')
        answer()
        await own
      } else {
        // The sign-out reads the store before it empties the session. The answer arrives during
        // that read, and the refresh reads the store again. The sign-out's read returns first.
        holds = true
        const own = first.signOut()
        await expect.poll(() => reads.length).toBe(1)
        answer()
        await expect.poll(() => reads.length).toBe(2)
        reads[0]!()
        await expect
          .poll(() => first.session.status.get().status)
          .toBe('signedOut')
        holds = false
        reads[1]!()
        await own
      }
      await Promise.all([refresh, other])

      // Tempo ID counts a revocation of the rotated token as a reuse, which revokes the app's
      // tokens on the user's other devices.
      expect(requests).toMatchInlineSnapshot(`
        [
          "first /oauth2/token refresh-old",
          "first /oauth2/revoke refresh-new",
        ]
      `)
      expect({
        first: first.session.status.get().status,
        second: second.session.status.get().status,
      }).toMatchInlineSnapshot(`
        {
          "first": "signedOut",
          "second": "signedOut",
        }
      `)
    },
  )
})

describe('signIn', () => {
  test('holds no session, and revokes its refresh token, when the store refuses the save of a sign-in', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const revocations: (string | null)[] = []
    // A file holds values as JSON, so it refuses a non-extractable access key, as `Store.redis` does
    // in a browser.
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        if (new URL(String(input)).pathname === '/oauth2/revoke')
          revocations.push(new URLSearchParams(String(init?.body)).get('token'))
        return globalThis.fetch(input, init)
      },
      plugins: [lock()],
      store: Store.file(Path.join(directory, 'store.json')),
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const session = await expired({
      accessToken: 'access-token',
      expiresIn: 60_000,
      valid: true,
    })
    const keyPair = await WebCryptoP256.createKeyPair()
    // The access key of a browser's sign-in holds a key pair in place of a private key.
    const { privateKey: _, ...accessKey } = session.accessKey!

    const error = await accounts.session_
      .change()
      .commit({ ...session, accessKey: { ...accessKey, keyPair } })
      .catch((error: unknown) => error)
    // Nothing listens at the URL, so the revocation leaves and receives no answer.
    await settled(accounts)
    const status = accounts.session.status.get().status
    // The instance keeps the unanswered token, so the next sign-out sends it again.
    await accounts.signOut().catch(() => undefined)

    expect(error).toMatchInlineSnapshot(
      `[TypeError: Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.]`,
    )
    expect(status).toMatchInlineSnapshot(`"signedOut"`)
    expect(revocations).toMatchInlineSnapshot(`
      [
        "refresh-access-token",
        "refresh-access-token",
      ]
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('sends no revocation of the refused sign-in after a logout that started before the revocation', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(new URL(String(input)).pathname)
        return globalThis.fetch(input, init)
      },
      plugins: [lock()],
      store: Store.file(Path.join(directory, 'store.json')),
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const session = await expired({
      accessToken: 'access-token',
      expiresIn: 60_000,
      valid: true,
    })
    const keyPair = await WebCryptoP256.createKeyPair()
    const { privateKey: _, ...accessKey } = session.accessKey!
    // Another run holds the lock, so the revocation of the refused sign-in waits for it. The file's
    // lock is taken after a write of its lock file, so the run waits until it holds the lock.
    let release = () => {}
    let holding = () => {}
    const holds = new Promise<void>((resolve) => (holding = resolve))
    const held = accounts.lock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
          holding()
        }),
    )
    await holds

    await accounts.session_
      .change()
      .commit({ ...session, accessKey: { ...accessKey, keyPair } })
      .catch(() => undefined)
    // The logout of a sign-out with `everywhere` starts before the revocation takes the lock.
    const signOut = accounts
      .signOut({ everywhere: true })
      .catch(() => undefined)
    release()
    await Promise.all([held, signOut])
    await settled(accounts)

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/auth/logout",
      ]
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })
})

/**
 * Returns a plugin that exposes the session's lock, which a background revocation holds until it
 * ends, and the session that plugins see.
 */
function lock() {
  return Plugin.from({
    extend: (_, context) => ({
      lock: context.session.exclusive,
      session_: context.session,
    }),
    id: 'lock',
  })
}

/** Resolves once every run that holds the session's lock, such as a background revocation, ended. */
function settled(accounts: { lock: Plugin.Context['session']['exclusive'] }) {
  return accounts.lock(() => Promise.resolve())
}

async function expired(options: {
  accessToken: string
  chainId?: number | undefined
  expiresIn: number
  user?: { email: string; id: string } | undefined
  valid?: boolean | undefined
}) {
  const privateKey =
    '0x0123456789012345678901234567890123456789012345678901234567890124'
  const authorization = await owner.signKeyAuthorization(
    { address: Account.fromSecp256k1(privateKey).address, type: 'secp256k1' },
    {
      chainId: BigInt(options.chainId ?? 42431),
      expiry: options.valid ? Math.floor(Date.now() / 1000) + 3600 : 1,
    },
  )
  return Session.from({
    accessKey: AccessKey.from({
      account: owner.address,
      chainId: options.chainId ?? 42431,
      keyAuthorization: KeyAuthorization.toRpc(authorization),
      privateKey,
    }),
    accessToken: options.accessToken,
    expiresAt: Date.now() + options.expiresIn,
    refreshToken: `refresh-${options.accessToken}`,
    user: options.user ?? { email: 'user@example.com', id: 'user_1' },
  })
}
