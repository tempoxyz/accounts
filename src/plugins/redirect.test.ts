/**
 * Runs the `redirect` plugin with `open` and without a server: the URL and the redirect URI that `open`
 * receives.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { redirect } from './index.js'

describe('redirect', () => {
  test('refuses a sign-in without open outside a page before it writes the pending redirect to the store', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-cli',
      // Without `open`, the plugin leaves the page, and Node holds no page to leave.
      plugins: [redirect()],
      redirectUri: 'com.example.app:/callback',
      store: Store.file(path),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts.redirect
      .signIn({ accessKey: false })
      .catch((error: unknown) => error)

    expect(
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    ).toMatchInlineSnapshot(
      `"TypeError: Missing \`open\`: outside a page, a redirect has no page to leave. Pass \`open\` to the plugin, to show the sign-in URL, such as in a system browser."`,
    )
    // The store keeps no PKCE verifier of a redirect that never leaves.
    expect(Fs.readdirSync(directory)).toMatchInlineSnapshot(`[]`)
  })

  test('refuses a sign-in without open in React Native, whose window holds no page, before it writes the pending redirect to the store', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    // The program runs in a process of its own with the one global of React Native that Node lacks:
    // `window`, the global object, without `document` or `location`. Node defines neither, so
    // only this global tells a page check by `window` from one by `document`.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import * as Accounts from '../Accounts.ts'",
          "import * as Store from '../Store.ts'",
          "import { redirect } from './index.ts'",
          'globalThis.window = globalThis',
          'const accounts = Accounts.create({',
          '  chain: 42431,',
          "  clientId: 'example-mobile',",
          '  plugins: [redirect()],',
          "  redirectUri: 'com.example.app:/callback',",
          `  store: Store.file(${JSON.stringify(path)}),`,
          "  url: 'http://127.0.0.1:9',",
          '})',
          'const error = await accounts.redirect.signIn({ accessKey: false }).catch((error) => error)',
          'console.log(JSON.stringify(`${error.name}: ${error.message}`))',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })

    const result = ChildProcess.spawnSync(
      process.execPath,
      ['--input-type=module'],
      { encoding: 'utf8', input: output.outputFiles[0]!.text },
    )

    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(
      `"TypeError: Missing \`open\`: outside a page, a redirect has no page to leave. Pass \`open\` to the plugin, to show the sign-in URL, such as in a system browser."`,
    )
    // The store keeps no PKCE verifier of a redirect that never leaves.
    expect(Fs.readdirSync(directory)).toMatchInlineSnapshot(`[]`)
  }, 20_000)

  test('requests an access key of 5 OUSD for a day without `accessKey`, a day of expiry for one without `expiry`, and none for `accessKey: false` or a sign-in with a challenge', async () => {
    /** Returns the key authorization that a sign-in of an instance with `accessKey` requests. */
    async function requested(
      accessKey: Accounts.create.Options['accessKey'],
      challenge?: string,
    ) {
      const urls: string[] = []
      const accounts = Accounts.create({
        accessKey,
        chain: 42431,
        clientId: 'example-mobile',
        plugins: [
          redirect({
            open(url) {
              urls.push(url)
              return Promise.resolve(undefined)
            },
          }),
        ],
        redirectUri: 'com.example.app:/callback',
        store: Store.memory(),
        url: 'http://127.0.0.1:9',
      })
      const start = Math.floor(Date.now() / 1000)
      await accounts.redirect.signIn(challenge ? { challenge } : {})
      const encoded = new URL(urls[0]!).searchParams.get('key_authorization')
      if (!encoded) return null
      const { expiry, limits } = JSON.parse(
        Buffer.from(encoded, 'base64url').toString(),
      ) as { expiry: number; limits?: unknown }
      return { expiresIn: expiry - start, limits }
    }

    const results = {
      absent: await requested(undefined),
      challenge: await requested(undefined, 'Sign in to Example'),
      disabled: await requested(false),
      withoutExpiry: await requested({
        limits: [{ limit: '20', token: 'pathusd' }],
      }),
    }

    // A second can pass between the sign-in's start and its request.
    expect([86400, 86401]).toContain(results.absent?.expiresIn)
    expect([86400, 86401]).toContain(results.withoutExpiry?.expiresIn)
    expect({
      absent: results.absent?.limits,
      challenge: results.challenge,
      disabled: results.disabled,
      withoutExpiry: results.withoutExpiry?.limits,
    }).toMatchInlineSnapshot(`
      {
        "absent": [
          {
            "limit": "0x4c4b40",
            "token": "0x20c0000000000000000000006a37DA5C996874BE",
          },
        ],
        "challenge": null,
        "disabled": null,
        "withoutExpiry": [
          {
            "limit": "0x1312d00",
            "token": "0x20C0000000000000000000000000000000000000",
          },
        ],
      }
    `)
  })

  test("passes open the redirect URI of the sign-in URL, which an option of Accounts.create sets over a preset's", async () => {
    const opened: Opened[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        // A preset, such as `expo`, sets a redirect URI, which the option below overrides.
        Plugin.from({
          config: () => ({ redirectUri: 'com.example.app:/callback' }),
          id: 'preset',
        }),
        redirect({
          open(url, options) {
            opened.push({
              options,
              redirectUri: new URL(url).searchParams.get('redirect_uri'),
            })
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app.dev:/callback',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.redirect.signIn({ accessKey: false })

    expect(session).toMatchInlineSnapshot(`undefined`)
    expect(opened).toMatchInlineSnapshot(`
      [
        {
          "options": {
            "redirectUri": "com.example.app.dev:/callback",
          },
          "redirectUri": "com.example.app.dev:/callback",
        },
      ]
    `)
  })

  test("sends the sign-in's loginHint as login_hint, over the saved session's email", async () => {
    const hints: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            hints.push(new URL(url).searchParams.get('login_hint'))
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // A refused refresh ended the session, so only the app holds the user's email.
    await accounts.redirect.signIn({
      accessKey: false,
      loginHint: 'alice@example.com',
    })
    await accounts.redirect.signIn({ accessKey: false })

    expect(hints).toMatchInlineSnapshot(`
      [
        "alice@example.com",
        null,
      ]
    `)
  })

  test('reads the stored chain selection, the saved session, the login hint, and the sign-out flag in one store round before open', async () => {
    const memory = Store.memory()
    // Each read records the reads in flight when it starts, so sequential reads record 0.
    const reads: string[] = []
    let inFlight = 0
    const store = Store.from({
      async getItem(key) {
        reads.push(
          `${key.split(':')[1]}${key.endsWith(':chain') ? ':chain' : ''} ${inFlight}`,
        )
        inFlight++
        try {
          return await memory.getItem(key)
        } finally {
          inFlight--
        }
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value) => memory.setItem(key, value),
    })
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [redirect({ open: () => Promise.resolve(undefined) })],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })

    await accounts.redirect.signIn({ accessKey: false })

    expect(reads).toMatchInlineSnapshot(`
      [
        "session:chain 0",
        "session 1",
        "login-hint 2",
        "signed-out 3",
      ]
    `)
  })

  test('requests prompt=login for a sign-in that starts in the same tick as a sign-out, after a preset', async () => {
    const prompts: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        // A preset, such as `expo`, comes before `redirect`, so its sign-out hook runs later.
        Plugin.from({
          config: () => ({ redirectUri: 'com.example.app:/callback' }),
          id: 'preset',
        }),
        redirect({
          open(url) {
            prompts.push(new URL(url).searchParams.get('prompt'))
            return Promise.resolve(undefined)
          },
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const signedOut = accounts.signOut()
    await accounts.redirect.signIn({ accessKey: false })
    await signedOut

    expect(prompts).toMatchInlineSnapshot(`
      [
        "login",
      ]
    `)
  })
  test('requests prompt=login for a sign-in that starts in the same tick as a sign-out whose earlier hook is still pending', async () => {
    const prompts: (string | null)[] = []
    const hook = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        // The hook of an earlier plugin holds the hook of `redirect` until the sign-in opens.
        Plugin.from({
          hooks: { beforeSignOut: () => hook.promise },
          id: 'pending',
        }),
        redirect({
          open(url) {
            prompts.push(new URL(url).searchParams.get('prompt'))
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const signedOut = accounts.signOut()
    await accounts.redirect.signIn({ accessKey: false })
    hook.resolve()
    await signedOut

    expect(prompts).toMatchInlineSnapshot(`
      [
        "login",
      ]
    `)
  })
  test("sends no login_hint after a sign-out that ends the session before the plugin's sign-in hook runs", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","example-mobile",42431]'
    const store = Store.memory()
    const hints: (string | null)[] = []
    const held = Promise.withResolvers<void>()
    const hook = Promise.withResolvers<void>()
    const ran = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        // The hook of an earlier plugin holds the hook of `redirect` until after the sign-out.
        Plugin.from({
          hooks: {
            afterSignIn: () => {
              held.resolve()
              return hook.promise
            },
          },
          id: 'pending',
        }),
        redirect({
          open(url) {
            hints.push(new URL(url).searchParams.get('login_hint'))
            return Promise.resolve(undefined)
          },
        }),
        Plugin.from({
          actions: (context) => ({
            reload: () => context.session.reload({ hooks: true }),
          }),
          hooks: { afterSignIn: () => ran.resolve() },
          id: 'last',
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    // Another context signs the user in, and the instance adopts the session.
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.last.reload()
    await held.promise
    await accounts.signOut().catch(() => undefined)
    hook.resolve()
    await ran.promise

    await accounts.redirect.signIn({ accessKey: false })

    expect(hints).toMatchInlineSnapshot(`
      [
        null,
      ]
    `)
  })

  test('sends the stored email of the last signed-in user as login_hint without a session, and none after signOut', async () => {
    const store = Store.memory()
    await store.setItem(
      'tempo-id:login-hint:["http://127.0.0.1:9","example-mobile"]',
      'user@example.com',
    )
    const requests: { hint: string | null; prompt: string | null }[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            const { searchParams } = new URL(url)
            requests.push({
              hint: searchParams.get('login_hint'),
              prompt: searchParams.get('prompt'),
            })
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })

    await accounts.redirect.signIn({ accessKey: false })
    await accounts.signOut()
    await accounts.redirect.signIn({ accessKey: false })

    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "hint": "user@example.com",
          "prompt": null,
        },
        {
          "hint": null,
          "prompt": "login",
        },
      ]
    `)
  })

  test('removes the stored email in one store call for each sign-out', async () => {
    const memory = Store.memory()
    const removals: string[] = []
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      async removeItem(key) {
        removals.push(key.split(':')[1]!)
        await memory.removeItem(key)
      },
      setItem: (key, value) => memory.setItem(key, value),
    })
    await store.setItem(
      'tempo-id:login-hint:["http://127.0.0.1:9","example-mobile"]',
      'user@example.com',
    )
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [redirect({ open: () => Promise.resolve(undefined) })],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })

    await accounts.signOut()

    expect(removals.filter((key) => key === 'login-hint'))
      .toMatchInlineSnapshot(`
        [
          "login-hint",
        ]
      `)
  })

  test('opens the browser with prompt=login while a sign-out at the call still runs', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","example-mobile",42431]'
    const memory = Store.memory()
    // The sign-out's write of the stored session waits until the sign-in opens, as a slow
    // revocation or logout does.
    const write = Promise.withResolvers<void>()
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: (key) => memory.removeItem(key),
      async setItem(key, value) {
        if (key === name) await write.promise
        return memory.setItem(key, value)
      },
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const prompts: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            prompts.push(new URL(url).searchParams.get('prompt'))
            write.resolve()
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    const signedOut = accounts.signOut().catch(() => undefined)
    await accounts.redirect.signIn({ accessKey: false })
    await signedOut

    expect(prompts).toMatchInlineSnapshot(`
      [
        "login",
      ]
    `)
  })

  test('signIn throws Store.InvalidFileError before open, for a file that holds no valid JSON', async () => {
    const directory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), 'accounts-redirect-'),
    )
    const file = Path.join(directory, 'session.json')
    Fs.writeFileSync(file, '{"tempo-id:session', { mode: 0o600 })
    const opened: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            opened.push(url)
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store: Store.file(file),
      url: 'http://127.0.0.1:9',
    })

    try {
      const error = await accounts.redirect
        .signIn({ accessKey: false })
        .catch((error: unknown) => error)

      // The save of the session reads the same file, so a sign-in in the browser would fail after
      // the user signs in.
      expect({
        error: String(error).replace(directory, '<directory>'),
        opened: opened.length,
      }).toMatchInlineSnapshot(`
        {
          "error": "Store.InvalidFileError: Invalid file: <directory>/session.json holds no valid JSON. Remove the file, and sign in again.",
          "opened": 0,
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn throws the error of the store before open, when the read of the store fails', async () => {
    // A path that names a folder fails each read and each save with `EISDIR`.
    const directory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), 'accounts-redirect-'),
    )
    const opened: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            opened.push(url)
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store: Store.file(directory),
      url: 'http://127.0.0.1:9',
    })

    try {
      const error = await accounts.redirect
        .signIn({ accessKey: false })
        .catch((error: unknown) => error)

      expect({
        error: String(error).replace(directory, '<directory>'),
        opened: opened.length,
      }).toMatchInlineSnapshot(`
        {
          "error": "Error: EISDIR: illegal operation on a directory, read",
          "opened": 0,
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn keeps the configured chain and opens, when the stored chain selection of a store that parses each entry alone holds no valid JSON', async () => {
    const database = new PGlite()
    const store = Store.postgres({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('seed', true)
    await database.query(
      'insert into tempo_id_store (key, value) values ($1, $2)',
      [
        'tempo-id:session:["http://127.0.0.1:9","example-mobile",42431]:chain',
        '{"chain',
      ],
    )
    const opened: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            opened.push(url)
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.redirect.signIn({ accessKey: false })

    expect({ opened: opened.length, session }).toMatchInlineSnapshot(`
      {
        "opened": 1,
        "session": undefined,
      }
    `)
  })

  test('signIn opens on the configured chain, when the stored chain selection and the sign-out flag of a store that parses each entry alone hold no valid JSON', async () => {
    const database = new PGlite()
    const store = Store.postgres({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('seed', true)
    for (const key of [
      'tempo-id:session:["http://127.0.0.1:9","example-mobile",42431]:chain',
      'tempo-id:signed-out:["http://127.0.0.1:9","example-mobile"]',
    ])
      await database.query(
        'insert into tempo_id_store (key, value) values ($1, $2)',
        [key, '{"chain'],
      )
    const opened: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'example-mobile',
      plugins: [
        redirect({
          open(url) {
            opened.push(url)
            return Promise.resolve(undefined)
          },
        }),
      ],
      redirectUri: 'com.example.app:/callback',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.redirect.signIn({ accessKey: false })

    expect({ opened: opened.length, session }).toMatchInlineSnapshot(`
      {
        "opened": 1,
        "session": undefined,
      }
    `)
  })

  test('refuses a callback of open outside the redirect URI before it redeems its code', async () => {
    const refusals: Record<string, unknown> = {}
    for (const [name, callback] of Object.entries({
      // iOS returns any URL on the app's scheme, so a lookalike path reaches `open`.
      path: 'com.example.app:/callback-other',
      scheme: 'com.other.app:/callback',
      web: 'https://app.example/callback',
    })) {
      const accounts = Accounts.create({
        chain: 42431,
        clientId: 'example-mobile',
        plugins: [
          redirect({
            open(url) {
              const state = new URL(url).searchParams.get('state')
              return Promise.resolve(`${callback}?code=code&state=${state}`)
            },
          }),
        ],
        redirectUri: 'com.example.app:/callback',
        store: Store.memory(),
        // Nothing listens on the port, so a code exchange fails with `server_error`.
        url: 'http://127.0.0.1:9',
      })
      const error = await accounts.redirect
        .signIn({ accessKey: false })
        .catch((error: unknown) => error)
      refusals[name] =
        error instanceof Accounts.RequestError
          ? `${error.code} ${error.status} ${error.field}: ${error.message}`
          : error
    }

    expect(refusals).toMatchInlineSnapshot(`
      {
        "path": "invalid_request 400 url: Invalid callback URL: it returns outside the redirect URI \`com.example.app:/callback\`. Resolve the callback at the redirect URI that \`open\` receives.",
        "scheme": "invalid_request 400 url: Invalid callback URL: it returns outside the redirect URI \`com.example.app:/callback\`. Resolve the callback at the redirect URI that \`open\` receives.",
        "web": "invalid_request 400 url: Invalid callback URL: it returns outside the redirect URI \`com.example.app:/callback\`. Resolve the callback at the redirect URI that \`open\` receives.",
      }
    `)
  })
})

/** A call of `open`: its options, and the redirect URI that its URL names. */
type Opened = {
  /** The second parameter of `open`. */
  options: unknown
  /** The `redirect_uri` of the URL, or `null` without one. */
  redirectUri: string | null
}
