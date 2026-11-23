/**
 * Runs \`Accounts.create\` with a store, without a server: the access token that \`session.fetch\`
 * sends after another context on the store signs out, its abort with React Native's `AbortSignal`,
 * the refresh token of an expired session whose revocation receives no response, the one refresh of
 * two instances on one store without Web Locks, and the refusal of a
 * third-party app's `authorize` before any request, and the reasons of `RequestError`.
 * @module
 */
import { AbortController as NativeAbortController } from 'abort-controller'
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Util from 'node:util'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vite-plus/test'
import { Account } from 'viem/tempo'
import { Address, Bytes, Hash, Json, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import * as Accounts from './Accounts.js'
import * as DefaultAccounts from './internal/DefaultAccounts.js'
import * as StoreValue from './internal/StoreValue.js'
import * as Plugin from './Plugin.js'
import * as Session from './Session.js'
import * as Store from './Store.js'
import { local } from './plugins/local.js'
import { viem } from './plugins/viem.js'

describe('authorize', () => {
  test('rejects with `rejected`, and sends no request, for a third-party client ID', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'http://localhost:5190',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // Tempo ID grants an origin client ID no CORS for the browser's session, so a page's request
    // could only fail.
    const error = await accounts
      .authorize({
        accessKey: {
          expiry: '1d',
          limits: [{ limit: '500', token: 'ousd' }],
        },
      })
      .then(
        () => undefined,
        (error: Accounts.RequestError) => error,
      )

    expect({
      message: error?.message,
      name: error?.name,
      reason: error?.reason,
      status: error?.status,
    }).toMatchInlineSnapshot(`
      {
        "message": "Headless authorization refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with \`dialog.signIn\` or \`redirect.signIn\`.",
        "name": "Accounts.RequestError",
        "reason": "rejected",
        "status": 400,
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a CLI client ID with `rejected` that names `device.signIn`, and sends no request', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'cli:acme-deploy',
      fetch: (input, init) => {
        requests.push(String(input))
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts.authorize().then(
      () => undefined,
      (error: Accounts.RequestError) => error,
    )

    expect(error?.message).toMatchInlineSnapshot(
      `"Headless authorization refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with \`device.signIn\`."`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })
})

describe('connections.get', () => {
  test('returns the access keys of a connection that an earlier release stored as `keys`', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const store = Store.memory()
    await store.setItem(
      'tempo-id:api:["https://api.example.com","https://app.example.com","user_1"]',
      {
        keys: [
          {
            account: owner.address,
            chainId: 42431,
            keyAuthorization: KeyAuthorization.toRpc(
              await owner.signKeyAuthorization(
                { address: accessKey.address, type: 'secp256k1' },
                { chainId: 42431n },
              ),
            ),
          },
        ],
      },
    )
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://api.example.com',
      connections: { resource: 'https://api.example.com', store },
      url: 'http://127.0.0.1:9',
    })

    const connection = await accounts.connections.get({
      clientId: 'https://app.example.com',
      userId: 'user_1',
    })

    expect({
      accessKey: connection?.accessKey.chainId,
      accessKeys: connection?.accessKeys.map((entry) => entry.chainId),
    }).toMatchInlineSnapshot(`
      {
        "accessKey": 42431,
        "accessKeys": [
          42431,
        ],
      }
    `)
  })
})

describe('create', () => {
  const name = 'tempo-id:session:["http://127.0.0.1:9","cli:acme-deploy",42431]'
  const before = process.env.TEMPO_HOME
  let home: string

  beforeEach(() => {
    home = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    process.env.TEMPO_HOME = home
  })

  afterEach(() => {
    if (before === undefined) delete process.env.TEMPO_HOME
    else process.env.TEMPO_HOME = before
    Fs.rmSync(home, { force: true, recursive: true })
  })

  /** Returns an instance whose `test.commit` commits a session, as a sign-in does. */
  function create(
    options: Pick<Accounts.create.Options, 'clientId' | 'store'>,
  ) {
    return Accounts.create({
      chain: 42431,
      plugins: [
        Plugin.from({
          actions: (context) => ({
            commit: (session: Session.Any) =>
              context.session.change().commit(session),
          }),
          id: 'test',
        }),
      ],
      url: 'http://127.0.0.1:9',
      ...options,
    })
  }

  /** Returns the files and folders under `TEMPO_HOME`, with the mode of each. */
  function files() {
    return (Fs.readdirSync(home, { recursive: true }) as string[])
      .sort()
      .map(
        (path) =>
          `${path} ${(Fs.statSync(Path.join(home, path)).mode & 0o777).toString(8)}`,
      )
  }

  const session = () =>
    Session.from({
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshToken: 'refresh-token',
      user: { email: 'user@example.com', id: 'user_1' },
    })

  test('keeps the session of a `cli:` client ID without a store in the shared file of `TEMPO_HOME`, which a later instance restores', async () => {
    const first = create({ clientId: 'cli:acme-deploy' })
    await first.test.commit(session())

    // A later run of the CLI is a new instance, which holds nothing but the file.
    const restored = await create({ clientId: 'cli:acme-deploy' }).session.get()

    expect({
      files: files(),
      keys: Object.keys(
        JSON.parse(
          Fs.readFileSync(Path.join(home, 'id', 'store.json'), 'utf8'),
        ),
      ),
      refreshToken: restored?.refreshToken,
      user: restored?.user,
    }).toMatchInlineSnapshot(`
      {
        "files": [
          "id 700",
          "id/store.json 600",
        ],
        "keys": [
          "tempo-id:session:["http://127.0.0.1:9","cli:acme-deploy",42431]",
        ],
        "refreshToken": "refresh-token",
        "user": {
          "email": "user@example.com",
          "id": "user_1",
        },
      }
    `)
  })

  test('keeps the sessions of two CLIs in the one file, each under its own client ID', async () => {
    await create({ clientId: 'cli:acme-deploy' }).test.commit(session())
    await create({ clientId: 'cli:acme-status' }).test.commit(
      Session.from({
        ...session(),
        user: { email: 'other@example.com', id: 'user_2' },
      }),
    )

    const [deploy, status] = await Promise.all([
      create({ clientId: 'cli:acme-deploy' }).session.get(),
      create({ clientId: 'cli:acme-status' }).session.get(),
    ])

    expect({
      deploy: deploy?.user?.email,
      files: files(),
      status: status?.user?.email,
    }).toMatchInlineSnapshot(`
      {
        "deploy": "user@example.com",
        "files": [
          "id 700",
          "id/store.json 600",
        ],
        "status": "other@example.com",
      }
    `)
  })

  test('removes the session from the shared file at a sign-out of a later instance', async () => {
    await create({ clientId: 'cli:acme-deploy' }).test.commit(session())
    const before = await create({ clientId: 'cli:acme-deploy' }).session.get()

    // Nothing listens at the URL, so the revocation rejects with a network error.
    await create({ clientId: 'cli:acme-deploy' })
      .signOut()
      .catch(() => undefined)

    expect({
      after: await create({ clientId: 'cli:acme-deploy' }).session.get(),
      before: before?.user?.email,
    }).toMatchInlineSnapshot(`
      {
        "after": undefined,
        "before": "user@example.com",
      }
    `)
  })

  test('holds no session, and writes no file, for a registered client ID without a store, as a backend creates it', async () => {
    const accounts = create({ clientId: 'client_0123456789abcdef' })
    await accounts.test.commit(session())

    expect({
      files: files(),
      session: await accounts.session.get(),
      store: accounts.config.store,
    }).toMatchInlineSnapshot(`
      {
        "files": [],
        "session": undefined,
        "store": undefined,
      }
    `)
  })

  test('holds no session, and writes no file, for a `cli:` client ID with `store: false`, as a service of many users creates it', async () => {
    const accounts = create({ clientId: 'cli:acme-deploy', store: false })
    await accounts.test.commit(session())

    expect({
      files: files(),
      later: await create({ clientId: 'cli:acme-deploy' }).session.get(),
      session: await accounts.session.get(),
      store: accounts.config.store,
    }).toMatchInlineSnapshot(`
      {
        "files": [],
        "later": undefined,
        "session": undefined,
        "store": undefined,
      }
    `)
  })

  test('saves to the given store, and writes no file, for a `cli:` client ID with a store', async () => {
    const store = Store.memory()
    const accounts = create({ clientId: 'cli:acme-deploy', store })
    await accounts.test.commit(session())

    expect({
      files: files(),
      given: accounts.config.store === store,
      saved: (await store.getItem(name)) !== undefined,
    }).toMatchInlineSnapshot(`
      {
        "files": [],
        "given": true,
        "saved": true,
      }
    `)
  })

  test('adds no plugin, and the root entry adds the `dialog`, `funding`, and `mpp` plugins that `plugins` lacks', () => {
    const options = {
      chain: 42431,
      clientId: 'example',
      plugins: [Plugin.from({ actions: () => ({}), id: 'test' })],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    } satisfies Accounts.create.Options
    const names = ['dialog', 'fetch', 'funding', 'mpp', 'test']

    const lite = Accounts.create(options)
    const root = DefaultAccounts.create(options)

    expect({
      lite: names.filter((name) => name in lite),
      root: names.filter((name) => name in root),
    }).toMatchInlineSnapshot(`
      {
        "lite": [
          "test",
        ],
        "root": [
          "dialog",
          "fetch",
          "funding",
          "mpp",
          "test",
        ],
      }
    `)
  })

  test('holds `fetch` and `mpp` of the `mpp` plugin without one in `plugins`, which load the plugin at the first request', async () => {
    const accounts = DefaultAccounts.create({
      chain: 42431,
      clientId: 'example',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all([
      accounts.fetch('http://127.0.0.1:9/fortune').then(
        () => 'sent',
        (error: Error) => error.name,
      ),
      accounts
        .mpp({ maxAmount: '1' })
        .fetch('http://127.0.0.1:9/fortune')
        .then(
          () => 'sent',
          (error: Error) => error.name,
        ),
    ])

    // The loaded plugin reads the stored session before it sends a request.
    expect(errors).toMatchInlineSnapshot(`
      [
        "Accounts.SignedOutError",
        "Accounts.SignedOutError",
      ]
    `)
    expect(accounts.mpp.session().state).toMatchInlineSnapshot(`
      {
        "status": "idle",
      }
    `)
  })

  test('ends a session manager of the default `mpp` plugin at a change of user or of access key before its first request, so it never pays with another access key', async () => {
    const accounts = DefaultAccounts.create({
      chain: 42431,
      clientId: 'example',
      plugins: [
        Plugin.from({
          actions: (context) => ({
            commit: (session: Session.Any) =>
              context.session.change().commit(session),
          }),
          id: 'test',
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    /** Returns a session of `id` whose access key spends any token on Tempo testnet. */
    const signedIn = async (id: string) => {
      const owner = Account.fromSecp256k1(Secp256k1.randomPrivateKey())
      const privateKey = Secp256k1.randomPrivateKey()
      const accessKey = Account.fromSecp256k1(privateKey, { access: owner })
      return Session.from({
        accessKey: {
          account: owner.address,
          chainId: 42431,
          keyAuthorization: KeyAuthorization.toRpc(
            await owner.signKeyAuthorization(accessKey, {
              chainId: 42431n,
              expiry: Math.floor(Date.now() / 1000) + 86_400,
            }),
          ),
          privateKey,
        },
        accessToken: 'access-token',
        expiresAt: Date.now() + 3_600_000,
        user: { email: `${id}@example.com`, id },
      })
    }
    /** Returns the outcome of the first request of a manager created before a sign-in of `id`. */
    const refused = async (id: string) => {
      await accounts.test.commit(await signedIn('user_1'))
      const manager = accounts.mpp.session()

      await accounts.test.commit(await signedIn(id))
      return manager.fetch('http://127.0.0.1:9/stream').then(
        () => 'sent',
        (error: Error) => error.name,
      )
    }

    // Neither manager sends a request with the later access key.
    expect({
      otherKey: await refused('user_1'),
      otherUser: await refused('user_2'),
    }).toMatchInlineSnapshot(`
      {
        "otherKey": "Accounts.SignedOutError",
        "otherUser": "Accounts.SignedOutError",
      }
    `)
  })

  test('keeps the client secret out of a log or JSON of the instance and its `config`', () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_acme',
      clientSecret: 'cs_secret',
      url: 'http://127.0.0.1:9',
    })

    const logged = [
      Util.inspect(accounts, { depth: Number.POSITIVE_INFINITY }),
      Util.inspect(accounts.config),
      JSON.stringify(accounts),
      JSON.stringify(accounts.config),
    ]

    expect(
      logged.some((value) => value.includes('cs_secret')),
    ).toMatchInlineSnapshot(`false`)
    expect(JSON.stringify(accounts.config)).toMatchInlineSnapshot(
      `"{"clientId":"client_acme","clientSecret":"[redacted]","chainId":42431,"scope":"openid email offline_access","url":"http://127.0.0.1:9"}"`,
    )
    expect(accounts.config.clientSecret).toMatchInlineSnapshot(`"cs_secret"`)
  })

  test('keeps a client secret set after creation, or on a descriptor copy, out of a log or JSON of `config`', () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_acme',
      url: 'http://127.0.0.1:9',
    })
    accounts.config.clientSecret = 'cs_later'
    const copy = Object.defineProperties(
      {} as Accounts.Config,
      Object.getOwnPropertyDescriptors(accounts.config),
    )
    copy.clientSecret = 'cs_copy'

    const logged = [
      Util.inspect(accounts.config),
      JSON.stringify(accounts.config),
      Util.inspect(copy),
      JSON.stringify(copy),
    ]

    expect(
      logged.some(
        (value) => value.includes('cs_later') || value.includes('cs_copy'),
      ),
    ).toMatchInlineSnapshot(`false`)
    expect(
      Util.inspect({ config: { nested: accounts.config } }, { depth: 1 }),
    ).toMatchInlineSnapshot(`"{ config: { nested: [Object] } }"`)
  })

  test('keeps circular detection in a log or JSON of a `config` that reaches itself', () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_acme',
      clientSecret: 'cs_secret',
      url: 'http://127.0.0.1:9',
    })
    const config = Object.assign(accounts.config, { self: accounts.config })

    const json = (() => {
      try {
        return JSON.stringify(config)
      } catch (error) {
        return (error as Error).name
      }
    })()

    expect(json).toMatchInlineSnapshot(`"TypeError"`)
    expect(
      Util.inspect(config).includes('[Circular *1]'),
    ).toMatchInlineSnapshot(`true`)
  })

  test('lets a plugin replace the `toJSON` of `config`', () => {
    const plugin = Plugin.from({
      actions: (context) => {
        Object.assign(context.config, {
          toJSON: () => ({ clientId: context.config.clientId }),
        })
        return {}
      },
      id: 'json',
    })

    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_acme',
      clientSecret: 'cs_secret',
      plugins: [plugin],
      url: 'http://127.0.0.1:9',
    })

    expect(JSON.stringify(accounts.config)).toMatchInlineSnapshot(
      `"{"clientId":"client_acme"}"`,
    )
  })

  test('gives plugins `config.account` of `account: false`, no default access key for `account: false` or `accessKey: false`, and the default access key without either', () => {
    const resolve = (options: Accounts.create.Options) => {
      let seen: unknown[] = []
      Accounts.create({
        ...options,
        clientId: 'client_acme',
        plugins: [
          Plugin.from({
            actions: (context) => {
              seen = [context.config.account, context.defaultAccessKey()]
              return {}
            },
            id: 'probe',
          }),
        ],
        store: false,
      })
      return seen
    }

    expect([
      resolve({}),
      resolve({ accessKey: false }),
      resolve({ account: false }),
    ]).toMatchInlineSnapshot(`
      [
        [
          undefined,
          {
            "expiry": "1d",
            "limits": [
              {
                "limit": "5",
                "token": "ousd",
              },
            ],
          },
        ],
        [
          undefined,
          undefined,
        ],
        [
          false,
          undefined,
        ],
      ]
    `)
  })

  test('throws a TypeError for `accessKey` beside `account: false`, which the type refuses too', () => {
    const typed = () =>
      Accounts.create({
        accessKey: { limits: [] },
        // @ts-expect-error An access key acts for a Tempo Account.
        account: false,
        clientId: 'client_acme',
        store: false,
      })
    const create = (accessKey: object | false) => () =>
      Accounts.create({
        ...({
          accessKey,
          account: false,
        } as unknown as Accounts.create.Options),
        clientId: 'client_acme',
        store: false,
      })

    expect(typed).toThrow(TypeError)
    expect(create(() => undefined)).toThrow(TypeError)
    expect(create(false)).toThrow(TypeError)
  })

  test('throws ChainNameInvalidError for a `chain` that names no chain, such as an environment variable', () => {
    const errors = ['localnet', '1337', 'Testnet'].map((chain) => {
      try {
        return Accounts.from({ chain: chain as never, clientId: 'client_acme' })
          .chainId
      } catch (error) {
        return String(error)
      }
    })

    expect(errors).toMatchInlineSnapshot(`
      [
        "Accounts.ChainNameInvalidError: Invalid chain: "localnet" names no chain. Pass \`mainnet\`, \`testnet\`, or the chain's ID as a number.",
        "Accounts.ChainNameInvalidError: Invalid chain: "1337" names no chain. Pass \`mainnet\`, \`testnet\`, or the chain's ID as a number.",
        "Accounts.ChainNameInvalidError: Invalid chain: "Testnet" names no chain. Pass \`mainnet\`, \`testnet\`, or the chain's ID as a number.",
      ]
    `)
    expect(
      Accounts.from({ chain: 'testnet', clientId: 'client_acme' }).chainId,
    ).toMatchInlineSnapshot(`42431`)
    expect(
      Accounts.from({ chain: null as never, clientId: 'client_acme' }).chainId,
    ).toMatchInlineSnapshot(`4217`)
  })

  test('keeps an own `__proto__` member as a member of a log or JSON of `config`', () => {
    const config = Accounts.from({
      clientId: 'client_acme',
      clientSecret: 'cs_secret',
      ...JSON.parse('{"__proto__":{"scope":"readonly"}}'),
    })

    const json = JSON.stringify(config)

    expect(json).toMatchInlineSnapshot(
      `"{"clientId":"client_acme","clientSecret":"[redacted]","__proto__":{"scope":"readonly"},"chainId":4217,"scope":"openid email offline_access","url":"https://id.tempo.xyz"}"`,
    )
    expect(Util.inspect(config).includes('cs_secret')).toMatchInlineSnapshot(
      `false`,
    )
  })

  test('keeps the client secret and the private scalar of a DPoP key out of a log or JSON of `Accounts.from`', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const config = Accounts.from({
      clientId: 'client_acme',
      clientSecret: 'cs_secret',
      dpop: {
        jwk: {
          crv: jwk.crv!,
          d: jwk.d!,
          kty: jwk.kty!,
          x: jwk.x!,
          y: jwk.y!,
        } as never,
        privateKey: pair.privateKey,
      },
    })

    const logged = [
      Util.inspect(config, { depth: Number.POSITIVE_INFINITY }),
      JSON.stringify(config),
    ]

    expect(
      logged.some(
        (value) => value.includes('cs_secret') || value.includes(jwk.d!),
      ),
    ).toMatchInlineSnapshot(`false`)
    expect(Object.keys(JSON.parse(JSON.stringify(config)).dpop.jwk))
      .toMatchInlineSnapshot(`
      [
        "crv",
        "kty",
        "x",
        "y",
      ]
    `)
    expect(config.clientSecret).toMatchInlineSnapshot(`"cs_secret"`)
  })
})

describe('pay', () => {
  test("rejects a payment within the access key's limit outside a page, on an instance without a plugin that sends it, with a PageRequiredError that names the missing plugin rather than a sign-in", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const privateKey = Secp256k1.randomPrivateKey()
    const authorization = KeyAuthorization.from({
      address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
      chainId: 4217n,
      expiry: Math.floor(Date.now() / 1000) + 86_400,
      limits: [
        {
          limit: 100_000_000n,
          token: '0x20c0000000000000000000000000000000000000',
        },
      ],
      type: 'secp256k1',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_1",4217]',
      {
        state: {
          session: Session.from({
            accessKey: {
              account: Address.fromPublicKey(
                Secp256k1.getPublicKey({ privateKey: owner }),
              ),
              chainId: 4217,
              keyAuthorization: KeyAuthorization.toRpc(
                KeyAuthorization.from(authorization, { signature }),
              ),
              privateKey,
            },
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    // A native app's instance, with a session and its access key but no `viem` plugin.
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'client_1',
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    const error = await accounts
      .pay({
        amount: '1',
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect({ message: error?.message, name: error?.name })
      .toMatchInlineSnapshot(`
        {
          "message": "No browser window, and no plugin sends payments: the payment page opens only from a page. Outside a page, add a plugin that sends a payment with the session's access key.",
          "name": "Actions.account.PageRequiredError",
        }
      `)
  })
  test('rejects an amount of 100,000 digits and a letter, or a long fraction, in linear time', async () => {
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const start = performance.now()

    const reasons: (string | undefined)[] = []
    for (const amount of [
      `${'1'.repeat(100_000)}x`,
      `1.${'0'.repeat(100_000)}1`,
    ]) {
      const error = await accounts
        .pay({
          account: '0x7a3f0000000000000000000000000000000000aa',
          amount,
          to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
          token: 'ousd',
        })
        .then(
          () => undefined,
          (error: Accounts.RequestError) => error,
        )
      reasons.push(error?.reason)
    }

    expect(reasons).toMatchInlineSnapshot(`
      [
        "invalid_field",
        "invalid_field",
      ]
    `)
    expect(performance.now() - start < 100).toMatchInlineSnapshot(`true`)
  })

  test('rejects an amount that is no positive decimal of 6 places with `invalid_field`, before it opens a page', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const refusals: Record<string, unknown> = {}
    for (const amount of [
      '-5',
      '0',
      '0.0000001',
      '1e3',
      ' 5',
      '',
      '.5',
      '5.',
      '1.50000000',
      5_000_000n as never,
      5 as never,
    ]) {
      const error = await accounts
        .pay({
          account: '0x7a3f0000000000000000000000000000000000aa',
          amount,
          to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
          token: 'ousd',
        })
        .then(
          () => undefined,
          (error: Accounts.RequestError) => error,
        )
      refusals[amount] =
        `${error?.name} ${error?.code} ${error?.reason} ${error?.field}`
    }

    expect(refusals).toMatchInlineSnapshot(`
      {
        "": "Accounts.RequestError invalid_request invalid_field amount",
        " 5": "Accounts.RequestError invalid_request invalid_field amount",
        "-5": "Accounts.RequestError invalid_request invalid_field amount",
        ".5": "Actions.account.PageRequiredError undefined undefined undefined",
        "0": "Accounts.RequestError invalid_request invalid_field amount",
        "0.0000001": "Accounts.RequestError invalid_request invalid_field amount",
        "1.50000000": "Actions.account.PageRequiredError undefined undefined undefined",
        "1e3": "Accounts.RequestError invalid_request invalid_field amount",
        "5": "Accounts.RequestError invalid_request invalid_field amount",
        "5.": "Actions.account.PageRequiredError undefined undefined undefined",
        "5000000": "Accounts.RequestError invalid_request invalid_field amount",
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a memo over 32 bytes with `invalid_request`, before it reads the account', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts
      .pay({
        account: '0x7a3f0000000000000000000000000000000000aa',
        amount: '5',
        memo: 'an order number that is longer than 32 bytes',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'ousd',
      })
      .then(
        () => undefined,
        (error: Accounts.RequestError) => error,
      )

    expect({
      code: error?.code,
      field: error?.field,
      message: error?.message,
      name: error?.name,
    }).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": "memo",
        "message": "Invalid \`memo\`: it holds no byte, or more than 32 bytes. Pass text or hex of 1 to 32 bytes.",
        "name": "Accounts.RequestError",
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a `to` that is no address with `invalid_field`, before it opens a page', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const refusals: Record<string, unknown> = {}
    for (const to of [
      '0x123',
      '0x1f9090aae28b8a3dceadf281b0f12828e676c32',
      '0x1F9090aaE28b8a3dCeaDf281B0F12828e676c326',
      'alice.eth',
      '0x1f9090aae28b8a3dceadf281b0f12828e676c326',
    ]) {
      const error = await accounts
        .pay({
          account: '0x7a3f0000000000000000000000000000000000aa',
          amount: '5',
          to: to as `0x${string}`,
          token: 'ousd',
        })
        .then(
          () => undefined,
          (error: Accounts.RequestError) => error,
        )
      refusals[to] =
        `${error?.name} ${error?.code} ${error?.reason} ${error?.field}`
    }

    expect(refusals).toMatchInlineSnapshot(`
      {
        "0x123": "Accounts.RequestError invalid_request invalid_field to",
        "0x1F9090aaE28b8a3dCeaDf281B0F12828e676c326": "Accounts.RequestError invalid_request invalid_field to",
        "0x1f9090aae28b8a3dceadf281b0f12828e676c32": "Accounts.RequestError invalid_request invalid_field to",
        "0x1f9090aae28b8a3dceadf281b0f12828e676c326": "Actions.account.PageRequiredError undefined undefined undefined",
        "alice.eth": "Accounts.RequestError invalid_request invalid_field to",
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('rejects outside a browser page with Actions.account.PageRequiredError', async () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_1',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts
      .pay({
        account: '0x7a3f0000000000000000000000000000000000aa',
        amount: '5',
        memo: '0x696e762d31303432',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'ousd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(
      `"Actions.account.PageRequiredError"`,
    )
  })

  test("rejects a payment above the access key's limit outside a page with a PageRequiredError whose message names the fix, and sends no request", async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const privateKey =
      '0x0123456789012345678901234567890123456789012345678901234567890124'
    const accessKey = Account.fromSecp256k1(privateKey, { access: owner })
    const requests: string[] = []
    // A native app's instance, such as an Expo app's, whose access key sends up to 1 pathUSD.
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      plugins: [viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const session = Session.from({
      accessKey: {
        account: owner.address,
        chainId: 1337,
        keyAuthorization: KeyAuthorization.toRpc(
          await owner.signKeyAuthorization(accessKey, {
            chainId: 1337n,
            expiry: Math.floor(Date.now() / 1000) + 86_400,
            limits: [
              {
                limit: 1_000_000n,
                token: '0x20c0000000000000000000000000000000000000',
              },
            ],
          }),
        ),
        privateKey,
      },
      accessToken: 'access-token',
      expiresAt: Date.now() + 3_600_000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const error = await accounts
      .pay({
        amount: '5',
        session,
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect({ message: error?.message, name: error?.name })
      .toMatchInlineSnapshot(`
      {
        "message": "No browser window: the payment page opens only from a page. Outside a page, only the session's access key sends a payment, within its limits and before its expiry, so a payment above them needs a sign-in for an access key that holds it.",
        "name": "Actions.account.PageRequiredError",
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('throws SignedOutError without a session outside a page, and sends no request', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts
      .pay({
        amount: '5',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(`"Accounts.SignedOutError"`)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test("pays from the stored session's account of an instance that has not read its session, and sends no request", async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
      { access: owner },
    )
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_1",1337]',
      {
        state: {
          session: Session.from({
            accessKey: {
              account: owner.address,
              chainId: 1337,
              keyAuthorization: KeyAuthorization.toRpc(
                await owner.signKeyAuthorization(accessKey, {
                  chainId: 1337n,
                  expiry: Math.floor(Date.now() / 1000) + 86_400,
                }),
              ),
            },
            accessToken: 'access-token',
            expiresAt: Date.now() + 3_600_000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    // A new instance on a stored session, as a server creates one for each request.
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })

    // No plugin sends the payment, so it reaches the payment page, which needs a page.
    const error = await accounts
      .pay({
        amount: '5',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(
      `"Actions.account.PageRequiredError"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('opens the payment page without a read of the account for a third-party client ID whose session holds no account', async () => {
    const store = Store.memory()
    // A sign-in without an access key, such as another demo's on the same origin, holds no account.
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","http://localhost:5190",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 3_600_000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'http://localhost:5190',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })

    // Tempo ID grants an origin client ID no CORS for the read, so a page's read could only fail.
    const error = await accounts
      .pay({
        amount: '1',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'ousd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(
      `"Actions.account.PageRequiredError"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('pays on the stored chain selection from its stored account, and sends no request, for an instance that has not read its session', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
      { access: owner },
    )
    const signed = async (chainId: number) => ({
      account: owner.address,
      chainId,
      keyAuthorization: KeyAuthorization.toRpc(
        await owner.signKeyAuthorization(accessKey, {
          chainId: BigInt(chainId),
          expiry: Math.floor(Date.now() / 1000) + 86_400,
        }),
      ),
    })
    const store = Store.memory()
    const name = 'tempo-id:session:["http://127.0.0.1:9","client_1",1337]'
    // Another context switched the session to Tempo testnet.
    await store.setItem(`${name}:chain`, 42431)
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessKey: await signed(42431),
          accessKeys: [await signed(1337)],
          accessToken: 'access-token',
          expiresAt: Date.now() + 3_600_000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts
      .pay({
        amount: '5',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(
      `"Actions.account.PageRequiredError"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test("reads the account on the payment's chain for a stored session whose only access key is on another chain", async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
      { access: owner },
    )
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_1",1337]',
      {
        state: {
          session: Session.from({
            accessKey: {
              account: owner.address,
              chainId: 42431,
              keyAuthorization: KeyAuthorization.toRpc(
                await owner.signKeyAuthorization(accessKey, {
                  chainId: 42431n,
                  expiry: Math.floor(Date.now() / 1000) + 86_400,
                }),
              ),
            },
            accessToken: 'access-token',
            expiresAt: Date.now() + 3_600_000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })

    await accounts
      .pay({
        amount: '5',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "GET /v1/account",
      ]
    `)
  })

  test('throws AccessKeyRequiredError for a fixed session without an access key on the chain, with or without `account`, and sends no request', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
      { access: owner },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    // The session's only access key is on another chain.
    const session = Session.from({
      accessKey: {
        account: owner.address,
        chainId: 42431,
        keyAuthorization: KeyAuthorization.toRpc(
          await owner.signKeyAuthorization(accessKey, {
            chainId: 42431n,
            expiry: Math.floor(Date.now() / 1000) + 86_400,
          }),
        ),
      },
      accessToken: 'access-token',
      expiresAt: Date.now() + 3_600_000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const messages: (string | undefined)[] = []
    const names: (string | undefined)[] = []
    for (const account of [undefined, owner.address]) {
      const error = await accounts
        .pay({
          account,
          amount: '5',
          session,
          to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
          token: 'pathusd',
        })
        .then(
          () => undefined,
          (error: Error) => error,
        )
      messages.push(error?.message)
      names.push(error?.name)
    }

    expect(names).toMatchInlineSnapshot(`
      [
        "Accounts.AccessKeyRequiredError",
        "Accounts.AccessKeyRequiredError",
      ]
    `)
    expect(messages).toMatchInlineSnapshot(`
      [
        "The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.",
        "The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.",
      ]
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('throws SignedOutError for a fixed session whose only access key expired, as its viem client and mpp payer do, and sends no request', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const privateKey =
      '0x0123456789012345678901234567890123456789012345678901234567890124'
    const accessKey = Account.fromSecp256k1(privateKey, { access: owner })
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      plugins: [viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    // A backend's session whose access key expired a minute ago, such as one past its `1d` expiry.
    const session = Session.from({
      accessKey: {
        account: owner.address,
        chainId: 1337,
        keyAuthorization: KeyAuthorization.toRpc(
          await owner.signKeyAuthorization(accessKey, {
            chainId: 1337n,
            expiry: Math.floor(Date.now() / 1000) - 60,
          }),
        ),
        privateKey,
      },
      accessToken: 'access-token',
      expiresAt: Date.now() + 3_600_000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const error = await accounts
      .pay({
        amount: '5',
        session,
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(error?.name).toMatchInlineSnapshot(`"Accounts.SignedOutError"`)
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test("rejects an `account` other than the account of a fixed session's access key with `invalid_field`, and sends no request", async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
      { access: owner },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const session = Session.from({
      accessKey: {
        account: owner.address,
        chainId: 1337,
        keyAuthorization: KeyAuthorization.toRpc(
          await owner.signKeyAuthorization(accessKey, {
            chainId: 1337n,
            expiry: Math.floor(Date.now() / 1000) + 86_400,
          }),
        ),
      },
      accessToken: 'access-token',
      expiresAt: Date.now() + 3_600_000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const error = await accounts
      .pay({
        account: '0x7a3f0000000000000000000000000000000000aa',
        amount: '5',
        session,
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'pathusd',
      })
      .then(
        () => undefined,
        (error: Accounts.RequestError) => error,
      )

    expect(
      `${error?.name} ${error?.code} ${error?.reason} ${error?.field}`,
    ).toMatchInlineSnapshot(
      `"Accounts.RequestError invalid_request invalid_field account"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('opens the payment page for a challenge without an account or a session, and reads no account', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts
      .pay({
        amount: '5',
        challenge: 'app.example.com wants you to sign in',
        to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
        token: 'ousd',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    // Outside a page, the payment page cannot open. A call without a challenge throws
    // `SignedOutError` without a session.
    expect(error?.name).toMatchInlineSnapshot(
      `"Actions.account.PageRequiredError"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })
})

describe('RequestError', () => {
  test('names each reason of Tempo ID as `Reason`', () => {
    // Each `reason` of Tempo ID's OpenAPI document, `GET /openapi.json`.
    const reasons = [
      'access_key_changing',
      'access_key_endpoint_failed',
      'access_key_pending',
      'access_key_taken',
      'allowance_redeemed',
      'already_decided',
      'app_exists',
      'authorization_expired',
      'backend_sign_in_not_permitted',
      'body_too_large',
      'challenge_not_permitted',
      'config_conflict',
      'configurable_accounts_disabled',
      'connection_mismatch',
      'consent_required',
      'cross_site_request',
      'duplicate_limit',
      'duplicate_scope',
      'embed_not_permitted',
      'employee_required',
      'empty_limits',
      'empty_scopes',
      'expiry_exceeds_maximum',
      'expiry_passed',
      'foreign_account',
      'funding_unavailable',
      'google_unavailable',
      'insufficient_balance',
      'invalid_access_key_endpoint',
      'invalid_app',
      'invalid_chain',
      'invalid_client',
      'invalid_client_attestation',
      'invalid_client_metadata',
      'invalid_code',
      'invalid_dpop_proof',
      'invalid_expiry',
      'invalid_field',
      'invalid_id_token_hint',
      'invalid_origin',
      'invalid_period',
      'invalid_public_key',
      'invalid_realm',
      'invalid_recipients',
      'invalid_redirect_uri',
      'invalid_resource',
      'invalid_scope',
      'invalid_target',
      'invalid_token',
      'limit_exceeds_maximum',
      'localhost_not_permitted',
      'logout_not_permitted',
      'malformed_body',
      'missing_key',
      'missing_permissions',
      'not_configurable',
      'origin_required',
      'owner_app_taken',
      'owner_exists',
      'owner_unavailable',
      'passkey_limit',
      'passkey_link_expired',
      'passkey_not_permitted',
      'passkey_register_not_permitted',
      'payment_declined',
      'payment_pending',
      'payment_reverted',
      'post_logout_redirect_not_permitted',
      'public_app',
      'pushed_authorization_required',
      'quote_changed',
      'rate_limited',
      'realm_exists',
      'realm_in_use',
      'recipient_not_permitted',
      'registrar_required',
      'rejected',
      'relying_party_taken',
      'resource_exists',
      'scope_without_limit',
      'session_changed',
      'session_required',
      'sign_not_permitted',
      'sign_out_link_expired',
      'signing_key_in_use',
      'too_many_signing_keys',
      'unexpected',
      'unknown_allowance',
      'unknown_app',
      'unknown_code',
      'unknown_endpoint',
      'unknown_key',
      'unknown_order',
      'unknown_realm',
      'unknown_resource',
      'unknown_screening',
      'unknown_session',
      'unknown_signing_key',
      'unknown_user',
      'unsupported_call',
      'unsupported_token',
      'upgrade_required',
      'upstream_unavailable',
      'webauthn_rejected',
      'webauthn_required',
    ] as const

    expectTypeOf<
      (typeof reasons)[number]
    >().toEqualTypeOf<Accounts.RequestError.Reason>()
  })
})

describe('session.fetch', () => {
  test('throws SignedOutError, and sends no request, when another context signs out while the access token expires', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() - 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()
    // Another context on the store, such as another tab or process, signs out.
    await store.removeItem(name)

    // Nothing listens at the URL, so a request rejects with a network error.
    const error = await accounts.session
      .fetch({ url: 'http://127.0.0.1:9/me' })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('throws SignedOutError, and sends no request, when another context signs in another user while the access token expires', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() - 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()
    // Another context on the store, such as another process, signs in another user.
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'other-access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'other-refresh-token',
          user: { email: 'other@example.com', id: 'user_2' },
        }),
      },
      version: 0,
    })

    // Nothing listens at the URL, so a request rejects with a network error.
    const error = await accounts.session
      .fetch({ url: 'http://127.0.0.1:9/me' })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test("rejects with an AbortError for React Native's AbortSignal, which has no `throwIfAborted` or `reason`", async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    // React Native installs this polyfill as its global `AbortController`.
    const signal = () =>
      new NativeAbortController() as unknown as globalThis.AbortController
    const [live, before, during] = [signal(), signal(), signal()]
    before.abort()

    const results = [
      await accounts.session
        .fetch({ init: { signal: live.signal }, url: 'http://127.0.0.1:9/me' })
        .catch((error: Error) => `${error.name}: ${error.message}`),
      await accounts.session
        .fetch({
          init: { signal: before.signal },
          url: 'http://127.0.0.1:9/me',
        })
        .catch((error: Error) => `${error.name}: ${error.message}`),
    ]
    // The access token expired, so the call waits for a refresh, which nothing answers.
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() - 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const waiting = accounts.session
      .fetch({ init: { signal: during.signal }, url: 'http://127.0.0.1:9/me' })
      .catch((error: Error | undefined) => `${error?.name}: ${error?.message}`)
    during.abort()
    results.push(await waiting)

    expect(results).toMatchInlineSnapshot(`
      [
        "Accounts.SignedOutError: The client's account is signed out. Sign in before sending.",
        "AbortError: The operation was aborted.",
        "AbortError: The operation was aborted.",
      ]
    `)
  })

  test('throws SignedOutError, and sends no request, for an access token that expired without a refresh token', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    // A sign-in without `offline_access` holds no refresh token, and its access key outlives its access token.
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessKey: {
              account: owner.address,
              chainId: 42431,
              keyAuthorization: KeyAuthorization.toRpc(
                await owner.signKeyAuthorization(
                  { address: accessKey.address, type: 'secp256k1' },
                  { chainId: 42431n },
                ),
              ),
            },
            accessToken: 'access-token',
            expiresAt: Date.now() - 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    await accounts.session.get()

    // Nothing listens at the URL, so a request rejects with a network error.
    const errors = await Promise.all([
      accounts.session.accessToken().catch((error: unknown) => error),
      accounts.session
        .fetch({ url: 'http://127.0.0.1:9/me' })
        .catch((error: unknown) => error),
    ])

    expect(errors.map(String)).toMatchInlineSnapshot(`
      [
        "Accounts.SignedOutError: The client's account is signed out. Sign in before sending.",
        "Accounts.SignedOutError: The client's account is signed out. Sign in before sending.",
      ]
    `)
  })

  test('throws SignedOutError, and sends no request, for an access token that expires within 5 seconds without a refresh token', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    // A sign-in without `offline_access` holds no refresh token, so no refresh renews the access token.
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 2_000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    await accounts.session.get()

    // Nothing listens at the URL, so a request rejects with a network error.
    const results = await Promise.all([
      accounts.session.accessToken().catch((error: unknown) => error),
      accounts.session
        .fetch({ url: 'http://127.0.0.1:9/me' })
        .catch((error: unknown) => error),
    ])

    expect(results.map(String)).toMatchInlineSnapshot(`
      [
        "Accounts.SignedOutError: The client's account is signed out. Sign in before sending.",
        "Accounts.SignedOutError: The client's account is signed out. Sign in before sending.",
      ]
    `)
  })
})

describe('session.get', () => {
  test('returns no session, and sends no request, with `reauthorize` for a third-party client ID', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'http://localhost:5190',
      fetch: (input, init) => {
        requests.push(String(input))
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // A third-party app signs in only on an approval page, so the page shows its sign-in.
    const session = await accounts.session.get({ reauthorize: true })

    expect(session).toMatchInlineSnapshot(`undefined`)
    expect(accounts.session.status.get().status).toMatchInlineSnapshot(
      `"signedOut"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('authorizes once for two instances on one store that restore together, and the later one returns the earlier one’s session', async () => {
    const name = 'tempo-id:session:["http://127.0.0.1:9","cli:mercator",4217]'
    const store = Store.memory()
    const create = () =>
      Accounts.create({
        chain: 4217,
        clientId: 'cli:mercator',
        plugins: [local()],
        store,
        url: 'http://127.0.0.1:9',
      })
    // The store holds the owner key and no session, as after a cleared session in another tab.
    await create().local.create()
    await store.removeItem(name)
    const first = create()
    const second = create()
    const authorizations: string[] = []

    const [a, b] = await Promise.all(
      [first, second].map((accounts, index) =>
        accounts.session.get({
          reauthorize: async () => {
            authorizations.push(index === 0 ? 'first' : 'second')
            return await accounts.local.signIn()
          },
        }),
      ),
    )

    expect(authorizations).toMatchInlineSnapshot(`
      [
        "first",
      ]
    `)
    expect(a?.accessKey?.keyAuthorization).toEqual(
      b?.accessKey?.keyAuthorization,
    )
    expect([
      first.session.status.get().status,
      second.session.status.get().status,
    ]).toMatchInlineSnapshot(`
      [
        "signedIn",
        "signedIn",
      ]
    `)
  })

  test('reads the stored session once when a plugin reloads it as the instance is created', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const memory = Store.memory()
    const calls: string[] = []
    const store = Store.from({
      async getItem(key) {
        calls.push(`getItem ${key.slice(name.length) || 'session'}`)
        return memory.getItem(key)
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value) => memory.setItem(key, value),
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    // A page's dialog plugin reloads the session as the instance is created, to decide its preload.
    const reloads: Promise<unknown>[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload())
            return {}
          },
          id: 'preload',
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })

    const [session] = await Promise.all([accounts.session.get(), ...reloads])

    expect(session?.user?.id).toMatchInlineSnapshot(`"user_1"`)
    expect(accounts.session.status.get().status).toMatchInlineSnapshot(
      `"signedIn"`,
    )
    expect(calls).toMatchInlineSnapshot(`
      [
        "getItem session",
        "getItem :chain",
      ]
    `)
  })

  test('reads the stored session beside the stored chain selection, so a restore waits for one store round trip', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const memory = Store.memory()
    // Each read records the reads in flight when it starts, so sequential reads record 0.
    const reads: string[] = []
    let inFlight = 0
    const store = Store.from({
      async getItem(key) {
        reads.push(`${key.slice(name.length) || 'session'} ${inFlight}`)
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
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.session.get()

    expect(session?.user?.id).toMatchInlineSnapshot(`"user_1"`)
    expect(reads).toMatchInlineSnapshot(`
      [
        ":chain 0",
        "session 1",
      ]
    `)
  })

  test('reads the store again at the next call after a failed read and a restore hook that throws', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const memory = Store.memory()
    const held = { failing: true, throwing: true }
    // The session's first read fails, as an aborted IndexedDB transaction does.
    const store = Store.from({
      async getItem(key) {
        if (key !== name || !held.failing) return memory.getItem(key)
        held.failing = false
        throw new Error('The store is unavailable.')
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value) => memory.setItem(key, value),
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    // The first restore fails, as a redirect's callback with an error does.
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          hooks: {
            restore() {
              if (!held.throwing) return Promise.resolve()
              held.throwing = false
              return Promise.reject(new Error('The callback failed.'))
            },
          },
          id: 'callback',
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })

    const first = await accounts.session
      .get()
      .catch((error: Error) => error.message)
    const second = await accounts.session.get()

    expect(first).toMatchInlineSnapshot(`"The callback failed."`)
    expect(second?.user?.id).toMatchInlineSnapshot(`"user_1"`)
  })

  test("rejects with the store's error, and keeps the status `pending`, when the read of the saved session fails", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const store = Store.file(path)
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const saved = Fs.readFileSync(path, 'utf8')
    // A partial write leaves the file without valid JSON, as a device's secure store can fail.
    Fs.writeFileSync(path, saved.slice(0, 20))
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })

    const first = await accounts.session.get().then(
      (session) => ({ session: session?.user?.id }),
      (error: Error) => ({ error: error.name }),
    )
    const status = accounts.session.status.get().status
    Fs.writeFileSync(path, saved)
    const second = await accounts.session.get()

    expect({ first, status }).toMatchInlineSnapshot(`
      {
        "first": {
          "error": "Store.InvalidFileError",
        },
        "status": "pending",
      }
    `)
    expect(second?.user?.id).toMatchInlineSnapshot(`"user_1"`)
    expect(accounts.session.status.get().status).toMatchInlineSnapshot(
      `"signedIn"`,
    )
  })

  test('returns no session, and sets the status `signedOut`, for a saved record that holds no valid session', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const store = Store.memory()
    // An account without `keys`, as no release saves, decodes to no session.
    await store.setItem(name, {
      state: {
        session: {
          ...Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
          account: { address: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326' },
        },
      },
      version: 0,
    })
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.session.get()

    expect({
      session,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test('returns no session, and sets the status `signedOut`, for a stored entry without valid JSON, which the next save replaces', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    // A store of text, as a device's secure store holds each value.
    const texts = Store.memory()
    const store = Store.from({
      async getItem(key) {
        const text = (await texts.getItem(key)) as string | undefined
        return text === undefined ? undefined : StoreValue.parse(text)
      },
      removeItem: (key) => texts.removeItem(key),
      setItem: (key, value) => texts.setItem(key, Json.stringify(value)),
    })
    // A partial write leaves the entry without valid JSON.
    await texts.setItem(name, '{"state":{"sess')
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.session.get()

    expect({
      session,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test('keeps the refresh token of an expired session whose revocation receives no response, for the next signOut', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const store = Store.file(Path.join(directory, 'session.json'))
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    // The access key expired a minute ago, as when a device opens the app after its expiry.
    const keyAuthorization = await owner.signKeyAuthorization(
      { address: accessKey.address, type: 'secp256k1' },
      { chainId: 42431n, expiry: Math.floor(Date.now() / 1000) - 60 },
    )
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessKey: {
            account: owner.address,
            chainId: 42431,
            keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
          },
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })

    // Nothing listens at the URL, as on a device that is offline, so the revocation receives no response.
    const session = await accounts.session.get()

    expect(session).toMatchInlineSnapshot(`undefined`)
    await expect
      .poll(() => store.getItem(`${name}:unanswered`))
      .toEqual(['refresh-token'])
  })

  test('calls no `session.subscribe` listener for a saved session whose access key expired, at its restore', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const store = Store.file(Path.join(directory, 'session.json'))
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    // The access key expired a minute ago, as when a returning user opens the app after its expiry.
    const keyAuthorization = await owner.signKeyAuthorization(
      { address: accessKey.address, type: 'secp256k1' },
      { chainId: 42431n, expiry: Math.floor(Date.now() / 1000) - 60 },
    )
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessKey: {
              account: owner.address,
              chainId: 42431,
              keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
            },
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const changes: (string | undefined)[][] = []
    accounts.session.subscribe((session, previous) =>
      changes.push([previous?.user?.id, session?.user?.id]),
    )

    const session = await accounts.session.get()

    expect({
      changes,
      session,
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "changes": [],
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test('reads the store for the kept expired session once before the request of a function `reauthorize` that calls `authorize`, as with `true`', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const name =
      'tempo-id:session:["http://127.0.0.1:9","tempo-example-web",42431]'
    const memory = Store.memory()
    const calls: string[] = []
    const store = Store.from({
      async getItem(key) {
        calls.push(`getItem ${key.slice(name.length) || 'session'}`)
        return memory.getItem(key)
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value) => memory.setItem(key, value),
    })
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        calls.push(`fetch ${new URL(String(input)).pathname}`)
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    // The access key expired a minute ago, as when a returning user opens the app after its expiry.
    // The session holds no refresh token, so no revocation reads the store beside the renewal.
    const keyAuthorization = await owner.signKeyAuthorization(
      { address: accessKey.address, type: 'secp256k1' },
      { chainId: 42431n, expiry: Math.floor(Date.now() / 1000) - 60 },
    )
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessKey: {
            account: owner.address,
            chainId: 42431,
            keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
          },
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })

    // The function authorizes as the `react` plugin's default does at a mount. Nothing listens at the
    // URL, so the authorization fails after its first request.
    await accounts.session.get({
      async reauthorize() {
        calls.push('reauthorize')
        return await accounts.authorize().catch(() => undefined)
      },
    })

    expect(calls.slice(calls.indexOf('reauthorize'))).toMatchInlineSnapshot(`
      [
        "reauthorize",
        "fetch /v1/authorize",
      ]
    `)
  })

  test('returns undefined, and sends no request, for a call with `reauthorize` outside a browser without `redirectUri`', async () => {
    const requests: string[] = []
    const accounts = Accounts.create({
      clientId: 'tempo-example-web',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store: Store.memory(),
      url: 'https://id.invalid',
    })

    // A CLI or a server has no page origin for the headless authorization's redirect URI, so Tempo
    // ID can only refuse it.
    const session = await accounts.session.get({ reauthorize: true })

    expect(session).toMatchInlineSnapshot(`undefined`)
    expect(accounts.session.status.get().status).toMatchInlineSnapshot(
      `"signedOut"`,
    )
    expect(requests).toMatchInlineSnapshot(`[]`)
  })

  test('rejects with server_error and status 0 when the authorization of a call with `reauthorize` receives no response', async () => {
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

    // Nothing answers at the URL, as on a device that is offline.
    const error = await accounts.session.get({ reauthorize: true }).then(
      () => undefined,
      (error: Accounts.RequestError) => error,
    )

    expect({
      code: error?.code,
      message: error?.message,
      name: error?.name,
      status: error?.status,
    }).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "message": "The authorization received no response. Check the connection, then authorize again.",
        "name": "Accounts.RequestError",
        "status": 0,
      }
    `)
    expect(accounts.session.status.get().status).toMatchInlineSnapshot(
      `"signedOut"`,
    )
    expect(requests).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
      ]
    `)
  })

  test('reads the access keys of a session that an earlier release saved as `key` and `keys`', async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const accessKey = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890124',
    )
    const earlier = async (chainId: number) => ({
      account: owner.address,
      chainId,
      keyAuthorization: KeyAuthorization.toRpc(
        await owner.signKeyAuthorization(
          { address: accessKey.address, type: 'secp256k1' },
          { chainId: BigInt(chainId) },
        ),
      ),
    })
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: {
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            key: await earlier(42431),
            keys: [await earlier(4217)],
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          },
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })

    const session = await accounts.session.get()

    expect({
      accessKey: session?.accessKey?.chainId,
      accessKeys: session?.accessKeys?.map((entry) => entry.chainId),
      names: Object.keys(session ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "accessKey": 42431,
        "accessKeys": [
          4217,
        ],
        "names": [
          "accessKey",
          "accessKeys",
          "accessToken",
          "expiresAt",
          "refreshToken",
          "user",
        ],
      }
    `)
  })
  test("returns another context's later tokens from a reload that waits for a save, after a sign-in that commits during the wait", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const memory = Store.memory()
    // The reads and the writes of the session in the store, in the order of their calls. A read
    // returns the value at its release, and a write changes the store at its release.
    const reads: (() => void)[] = []
    const writes: (() => void)[] = []
    let holds = false
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
      plugins: [
        Plugin.from({
          actions: (context) => ({
            commit: (session: Session.Any) =>
              context.session.change().commit(session),
            reload: () => context.session.reload(),
            update: (session: Session.Any) =>
              context.session.change({ update: true }).commit(session),
          }),
          id: 'test',
        }),
      ],
      store: Store.from({
        async getItem(key) {
          if (holds && key === name)
            await new Promise<void>((resolve) => reads.push(resolve))
          return memory.getItem(key)
        },
        removeItem: (key) => memory.removeItem(key),
        async setItem(key, value) {
          if (holds && key === name)
            await new Promise<void>((resolve) => writes.push(resolve))
          await memory.setItem(key, value)
        },
      }),
      url: 'http://127.0.0.1:9',
    })
    const signedIn = Session.from({
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshToken: 'refresh-token',
      user: { email: 'user@example.com', id: 'user_1' },
    })
    const other = Session.from({
      ...signedIn,
      refreshToken: 'other-refresh-token',
      user: { email: 'other@example.com', id: 'user_2' },
    })
    await memory.setItem(name, { state: { session: signedIn }, version: 0 })
    await accounts.session.get()

    // A save starts, such as one that keeps the session's account, and the reload waits for it.
    holds = true
    const update = accounts.test.update({ ...signedIn, accessToken: 'later' })
    await expect.poll(() => writes.length).toBe(1)
    const reload = accounts.test.reload()
    // The sign-in of another user commits during that wait. Its save follows the first one.
    const signIn = accounts.test.commit(other)
    writes[0]!()
    await expect.poll(() => writes.length).toBe(2)
    writes[1]!()
    // Another context's refresh saves that session's later tokens before the reload's read completes.
    await expect.poll(() => reads.length).toBeGreaterThan(0)
    holds = false
    await memory.setItem(name, {
      state: {
        session: Session.from({
          ...other,
          expiresAt: other.expiresAt + 1,
          refreshToken: 'later-refresh-token',
        }),
      },
      version: 0,
    })
    for (const read of reads) read()
    const reloaded = await reload
    await Promise.all([update, signIn])

    expect({
      held: (await accounts.session.get())?.refreshToken,
      reloaded: reloaded?.refreshToken,
    }).toMatchInlineSnapshot(`
      {
        "held": "later-refresh-token",
        "reloaded": "later-refresh-token",
      }
    `)
  })
})

describe('session.status', () => {
  test("changes to `signedOut` at the access key's expiry while the instance stays open, and sends no request and no write", async () => {
    const owner = Account.fromSecp256k1(
      '0x0123456789012345678901234567890123456789012345678901234567890123',
    )
    const privateKey =
      '0x0123456789012345678901234567890123456789012345678901234567890124'
    const accessKey = Account.fromSecp256k1(privateKey, { access: owner })
    // The access key expires in 2 seconds, on the next whole second.
    const expiry = Math.floor(Date.now() / 1000) + 2
    const store = Store.memory()
    const key = 'tempo-id:session:["http://127.0.0.1:9","client_1",1337]'
    await store.setItem(key, {
      state: {
        session: Session.from({
          accessKey: {
            account: owner.address,
            chainId: 1337,
            keyAuthorization: KeyAuthorization.toRpc(
              await owner.signKeyAuthorization(accessKey, {
                chainId: 1337n,
                expiry,
              }),
            ),
            privateKey,
          },
          accessToken: 'access-token',
          expiresAt: Date.now() + 3_600_000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'client_1',
      fetch: (input, init) => {
        requests.push(
          `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
        )
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const before = accounts.session.status.get().status
    // Each status, and whether the access key had expired at it.
    const statuses: string[] = []
    accounts.session.status.subscribe((status) =>
      statuses.push(`${status.status} ${Date.now() >= expiry * 1000}`),
    )

    // `useSession` renders from the status, so a page that stays open shows the expiry with no
    // read of its own.
    await expect
      .poll(() => accounts.session.status.get().status, { timeout: 5_000 })
      .toBe('signedOut')

    expect({
      before,
      session: accounts.session.status.get().session,
      statuses,
    }).toMatchInlineSnapshot(`
      {
        "before": "signedIn",
        "session": undefined,
        "statuses": [
          "signedOut true",
        ],
      }
    `)
    expect(requests).toMatchInlineSnapshot(`[]`)
    // The store keeps the expired session, so the next load renews it, as before the change.
    expect(await store.getItem(key)).toMatchObject({
      state: { session: { accessToken: 'access-token' } },
    })
  })
  test("follows another instance's sign-in on the same store before a read of its own, such as another tab's, as it follows that instance's sign-out", async () => {
    const store = Store.memory()
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'client_1',
        plugins: [
          Plugin.from({
            actions: (context) => ({
              commit: (session: Session.Any) =>
                context.session.change().commit(session),
            }),
            id: 'test',
          }),
        ],
        store,
        url: 'http://127.0.0.1:9',
      })
    const tab = create()
    // The instance only follows the status, as a router guard does, and calls no `session.get`.
    const other = create()
    const statuses: string[] = []
    other.session.status.subscribe((status, previous) =>
      statuses.push(
        `${previous.status} > ${status.status} ${status.session?.user.email}`,
      ),
    )

    await tab.test.commit(
      Session.from({
        accessToken: 'access-token',
        expiresAt: Date.now() + 3_600_000,
        user: { email: 'user@example.com', id: 'user_1' },
      }),
    )
    await expect
      .poll(() => other.session.status.get().status, { timeout: 2_000 })
      .toBe('signedIn')
    await tab.signOut()
    await expect
      .poll(() => other.session.status.get().status, { timeout: 2_000 })
      .toBe('signedOut')

    expect(statuses).toMatchInlineSnapshot(`
      [
        "pending > signedIn user@example.com",
        "signedIn > signedOut undefined",
      ]
    `)
  })
})

describe('session.refresh', () => {
  test('throws RequestError with status 0 when no attempt receives a response', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    await accounts.session.get()

    // Nothing listens at the URL, so each attempt rejects with a network error.
    const error = await accounts.session
      .refresh()
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The refresh received no response. Check the connection, and refresh again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  }, 20_000)

  test('refreshes under the Web Lock alone when the lock of a shared store rejects before the run', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 3_600_000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const requests: string[] = []
    // A shared store whose server refuses writes, such as a Redis replica, rejects each `lock`.
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      fetch(input, init) {
        const token = new URLSearchParams(String(init?.body)).get(
          'refresh_token',
        )
        requests.push(`${new URL(String(input)).pathname} ${token}`)
        return Promise.resolve(
          Response.json({
            access_token: 'access-token-1',
            expires_in: 3600,
            refresh_token: 'refresh-token-1',
            token_type: 'Bearer',
          }),
        )
      },
      store: Store.from({
        getItem: (key) => memory.getItem(key),
        lock: () => Promise.reject(new Error('SET failed with READONLY.')),
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => memory.setItem(key, value),
      }),
      url: 'http://127.0.0.1:9',
    })

    await accounts.session.get()
    const session = await accounts.session.refresh()

    expect({ refreshToken: session?.refreshToken, requests })
      .toMatchInlineSnapshot(`
        {
          "refreshToken": "refresh-token-1",
          "requests": [
            "/oauth2/token refresh-token",
          ],
        }
      `)
  })

  test('sends one refresh for two instances on `Store.memory` in a runtime without Web Locks, such as React Native', async () => {
    // The program runs in Node without `navigator`, so no Web Lock serializes the refreshes, as in
    // React Native. `fetch` records each request, and answers the refresh with new tokens.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import * as Accounts from './Accounts.ts'",
          "import * as Session from './Session.ts'",
          "import * as Store from './Store.ts'",
          'const requests = []',
          'const store = Store.memory()',
          'const create = () => Accounts.create({',
          '  chain: 1337,',
          "  clientId: 'https://app.example.com',",
          '  async fetch(input, init) {',
          "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
          '    requests.push(new URL(String(input)).pathname + " " + token)',
          "    return Response.json({ access_token: 'access-token-1', expires_in: 3600, refresh_token: 'refresh-token-1', token_type: 'Bearer' })",
          '  },',
          '  store,',
          "  url: 'http://127.0.0.1:9',",
          '})',
          'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
          "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
          '  version: 0,',
          '})',
          'const instances = [create(), create()]',
          'await Promise.all(instances.map((accounts) => accounts.session.get()))',
          'const sessions = await Promise.all(instances.map((accounts) => accounts.session.refresh()))',
          'console.log(JSON.stringify({ refreshTokens: sessions.map((session) => session?.refreshToken), requests }))',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })

    const result = ChildProcess.spawnSync(
      process.execPath,
      ['--input-type=module', '--no-experimental-global-navigator'],
      { encoding: 'utf8', input: output.outputFiles[0]!.text },
    )

    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "refreshTokens": [
          "refresh-token-1",
          "refresh-token-1",
        ],
        "requests": [
          "/oauth2/token refresh-token",
        ],
      }
    `)
  }, 20_000)

  test('revokes the session of a sign-out on `Store.file` in a runtime without Web Locks, whose folder refuses the lock file', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    // The program runs in Node without `navigator`, as Bun or Deno without Web Locks. The folder
    // holds the session, then refuses new files, such as a read-only mount.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import * as Fs from 'node:fs/promises'",
          "import * as Accounts from './Accounts.ts'",
          "import * as Session from './Session.ts'",
          "import * as Store from './Store.ts'",
          'const requests = []',
          `const path = ${JSON.stringify(path)}`,
          'await Store.file(path).setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
          "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
          '  version: 0,',
          '})',
          `await Fs.chmod(${JSON.stringify(directory)}, 0o500)`,
          'const accounts = Accounts.create({',
          '  chain: 1337,',
          "  clientId: 'https://app.example.com',",
          '  async fetch(input) {',
          '    requests.push(new URL(String(input)).pathname)',
          '    return new Response(null, { status: 200 })',
          '  },',
          '  store: Store.file(path),',
          "  url: 'http://127.0.0.1:9',",
          '})',
          'await accounts.session.get()',
          'await accounts.signOut().catch(() => undefined)',
          'console.log(JSON.stringify({ requests }))',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })

    const result = ChildProcess.spawnSync(
      process.execPath,
      ['--input-type=module', '--no-experimental-global-navigator'],
      { encoding: 'utf8', input: output.outputFiles[0]!.text },
    )
    Fs.chmodSync(directory, 0o700)
    Fs.rmSync(directory, { force: true, recursive: true })

    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "requests": [
          "/oauth2/revoke",
        ],
      }
    `)
  }, 20_000)

  test("revokes the new tokens of a refresh that another instance's sign-out overtook, and never the rotated token", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const store = Store.memory()
    /** The value that the store holds under the session's key. */
    type Saved = { state: { session?: Session.Any | undefined } }
    /** Returns the session that the store holds. */
    const stored = async () =>
      ((await store.getItem(name)) as Saved | undefined)?.state.session
    const requests: string[] = []
    /** Returns an instance on a local Tempo node, whose token endpoint answers after the store empties. */
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        async fetch(input, init) {
          const body = new URLSearchParams(String(init?.body))
          const { pathname } = new URL(String(input))
          requests.push(
            `${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
          )
          if (pathname !== '/oauth2/token')
            return new Response(null, { status: 200 })
          // The other instance's sign-out empties the store while the refresh waits for its answer.
          await expect.poll(stored).toBeUndefined()
          return Response.json({
            access_token: 'access-token-1',
            expires_in: 3600,
            refresh_token: 'refresh-token-1',
            token_type: 'Bearer',
          })
        },
        store,
        url: 'http://127.0.0.1:9',
      })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const refreshing = create()
    const signingOut = create()
    await Promise.all([refreshing.session.get(), signingOut.session.get()])

    const [refreshed] = await Promise.all([
      refreshing.session.refresh(),
      signingOut.signOut(),
    ])

    expect(refreshed).toMatchInlineSnapshot(`undefined`)
    expect(requests).toMatchInlineSnapshot(`
      [
        "/oauth2/token refresh-token",
        "/oauth2/revoke refresh-token-1",
      ]
    `)
    expect(await stored()).toMatchInlineSnapshot(`undefined`)
  })

  test("revokes no new token that another process received through the same rotation and revoked, after another instance's sign-out", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const store = Store.memory()
    /** The value that the store holds under the session's key. */
    type Saved = { state: { session?: Session.Any | undefined } }
    /** Returns the session that the store holds. */
    const stored = async () =>
      ((await store.getItem(name)) as Saved | undefined)?.state.session
    const requests: string[] = []
    /** Returns an instance on a local Tempo node, whose token endpoint answers after the store empties. */
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        async fetch(input, init) {
          const body = new URLSearchParams(String(init?.body))
          const { pathname } = new URL(String(input))
          requests.push(
            `${pathname} ${body.get('refresh_token') ?? body.get('token')}`,
          )
          if (pathname !== '/oauth2/token')
            return new Response(null, { status: 200 })
          // The other instance's sign-out empties the store while the refresh waits for its answer.
          await expect.poll(stored).toBeUndefined()
          // Another process on the store received the same new token through the rotation grace
          // period, and revoked it, so a second revocation would count as a reuse.
          await store.setItem(`${name}:revoked`, [
            Hash.sha256(Bytes.fromString('refresh-token-1'), { as: 'Hex' }),
          ])
          return Response.json({
            access_token: 'access-token-1',
            expires_in: 3600,
            refresh_token: 'refresh-token-1',
            token_type: 'Bearer',
          })
        },
        store,
        url: 'http://127.0.0.1:9',
      })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const refreshing = create()
    const signingOut = create()
    await Promise.all([refreshing.session.get(), signingOut.session.get()])

    const [refreshed] = await Promise.all([
      refreshing.session.refresh(),
      signingOut.signOut(),
    ])

    expect(refreshed).toMatchInlineSnapshot(`undefined`)
    expect(requests).toMatchInlineSnapshot(`
      [
        "/oauth2/token refresh-token",
      ]
    `)
    expect(await stored()).toMatchInlineSnapshot(`undefined`)
  })
})

describe('signOut', () => {
  test('revokes the refresh token of a sign-out whose store is unreachable, such as a Redis that is down', async () => {
    const memory = Store.memory()
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 3_600_000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const held = { down: false }
    const requests: string[] = []
    // A shared store whose server goes down after the session loads, such as Redis, rejects each call.
    const reject = () =>
      Promise.reject(new Error('GET failed with ECONNREFUSED.'))
    const accounts = Accounts.create({
      chain: 1337,
      clientId: 'https://app.example.com',
      fetch(input, init) {
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${new URL(String(input)).pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      store: Store.from({
        getItem: (key) => (held.down ? reject() : memory.getItem(key)),
        lock: (_key, fn) => (held.down ? reject() : fn()),
        removeItem: (key) => (held.down ? reject() : memory.removeItem(key)),
        setItem: (key, value) =>
          held.down ? reject() : memory.setItem(key, value),
      }),
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    held.down = true
    const error = await accounts
      .signOut()
      .catch((error: Error) => error.message)

    expect({ error, requests }).toMatchInlineSnapshot(`
      {
        "error": "GET failed with ECONNREFUSED.",
        "requests": [
          "/oauth2/revoke refresh-token",
        ],
      }
    `)
  })

  const name =
    'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'

  /** Returns an instance whose `test.commit` commits a session after `before` resolves. */
  function create(store: Store.Store) {
    return Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          actions: (context) => ({
            async commit(
              session: Session.Any,
              before: Promise<void> = Promise.resolve(),
            ) {
              const change = context.session.change()
              await before
              await change.commit(session)
            },
          }),
          id: 'test',
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
  }

  const session = () =>
    Session.from({
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

  test("reads the saved session once before the revocation, in a sign-out of a new instance, as a CLI's logout runs", async () => {
    const memory = Store.memory()
    await create(memory).test.commit(
      Session.from({ ...session(), refreshToken: 'refresh-token' }),
    )
    // Each call names its entry by the suffix after the session's key, such as `get revoked`.
    const calls: string[] = []
    const entry = (key: string) =>
      key === name ? 'session' : key.slice(name.length + 1)
    const store = Store.from({
      getItem: (key) => {
        calls.push(`get ${entry(key)}`)
        return memory.getItem(key)
      },
      removeItem: (key) => {
        calls.push(`remove ${entry(key)}`)
        return memory.removeItem(key)
      },
      setItem: (key, value, options) => {
        calls.push(`set ${entry(key)}`)
        return memory.setItem(key, value, options)
      },
    })

    // Nothing listens at the URL, so the revocation rejects with a network error.
    await create(store)
      .signOut()
      .catch(() => undefined)

    // The new instance's first read holds the store's latest copy, so the sign-out reads the
    // session again only after it empties it, under the lock.
    expect(calls).toMatchInlineSnapshot(`
      [
        "set signed-out",
        "get session",
        "get chain",
        "get unanswered",
        "get revoked",
        "set session",
        "get session",
        "set unanswered",
      ]
    `)
  })

  test('keeps the signed-out mark of a sign-out that starts while a sign-in saves its session', async () => {
    const memory = Store.memory()
    // The sign-in's save waits until the sign-out starts. Later saves run at once.
    const held: (() => void)[] = []
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: (key) => memory.removeItem(key),
      setItem: async (key, value, options) => {
        if (key === name && held.length === 0)
          await new Promise<void>((resolve) => held.push(resolve))
        return memory.setItem(key, value, options)
      },
    })
    const accounts = create(store)
    await accounts.session.get()

    const committed = accounts.test.commit(session())
    await expect.poll(() => held.length).toBe(1)
    // Nothing listens at the URL, so the logout rejects with a network error.
    const signedOut = accounts.signOut().catch(() => undefined)
    held[0]!()
    await Promise.all([committed, signedOut])

    expect(await memory.getItem(`${name}:signed-out`)).toMatchInlineSnapshot(
      `true`,
    )
  })

  test('empties the session of another instance on the store at once, without a page to post to it, as in React Native', async () => {
    const store = Store.memory()
    const accounts = create(store)
    const other = create(store)
    await accounts.test.commit(session())
    await other.session.get()

    await accounts.signOut()

    await expect.poll(() => other.session.status.get().status).toBe('signedOut')
    expect(await other.session.get()).toMatchInlineSnapshot(`undefined`)
  })

  test('keeps the signed-out mark of a sign-out that starts during a sign-in and ends the session after its commit', async () => {
    const memory = Store.memory()
    // The sign-out's read of the session waits until the sign-in commits. Later reads run at once.
    const held: (() => void)[] = []
    let holding = false
    const store = Store.from({
      getItem: async (key) => {
        if (key === name && holding && held.length === 0)
          await new Promise<void>((resolve) => held.push(resolve))
        return memory.getItem(key)
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value, options) => memory.setItem(key, value, options),
    })
    const accounts = create(store)
    await accounts.session.get()
    holding = true

    const before = Promise.withResolvers<void>()
    const committed = accounts.test.commit(session(), before.promise)
    // Nothing listens at the URL, so the logout rejects with a network error.
    const signedOut = accounts.signOut().catch(() => undefined)
    await expect.poll(() => held.length).toBe(1)
    before.resolve()
    await committed
    held[0]!()
    await signedOut

    expect(await memory.getItem(`${name}:signed-out`)).toMatchInlineSnapshot(
      `true`,
    )
  })

  test('resolves `context.session.ended` once the sign-out that runs settles, and at once without one', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          actions: (context) => ({ ended: context.session.ended }),
          id: 'test',
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    const idle = await accounts.test.ended()
    // Nothing listens at the URL, so the revocation receives no answer, and the sign-out saves its
    // refresh token for the next sign-out before it settles.
    const signedOut = accounts.signOut().catch(() => undefined)
    const ended = await accounts.test.ended()
    const unanswered = await store.getItem(`${name}:unanswered`)
    await signedOut

    expect(idle).toMatchInlineSnapshot(`false`)
    expect(ended).toMatchInlineSnapshot(`true`)
    expect(unanswered).toMatchInlineSnapshot(`
      [
        "refresh-token",
      ]
    `)
  })

  test('keeps the refresh token of a session that a plugin discards for the next sign-out, when the revocation receives no response', async () => {
    const store = Store.memory()
    const contexts: Plugin.Context[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          extend(_, context) {
            contexts.push(context)
            return {}
          },
          id: 'discard',
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // A renewal that no change saved. Nothing listens at the URL, so its revocation receives no answer.
    contexts[0]!.session.discard(
      Session.from({
        accessToken: 'renewed-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: 'renewed-refresh-token',
        user: { email: 'user@example.com', id: 'user_1' },
      }),
    )
    await expect
      .poll(() => store.getItem(name + ':unanswered'), { timeout: 10_000 })
      .toEqual(['renewed-refresh-token'])
  })

  test('throws RequestError with status 0, and keeps the refresh token for the next sign-out, when the revocation receives no response', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // Nothing listens at the URL, so the revocation receives no answer.
    const error = await accounts.signOut().catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
    expect(await accounts.session.get()).toMatchInlineSnapshot(`undefined`)
    expect(await store.getItem(`${name}:unanswered`)).toMatchInlineSnapshot(`
      [
        "refresh-token",
      ]
    `)
  })

  test('sends the revocation of a saved session again at the next sign-out, when the store refuses the unanswered entry', async () => {
    const memory = Store.memory()
    // The store refuses only the unanswered entry, such as at a full quota.
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value, options) =>
        key === `${name}:unanswered`
          ? Promise.reject(new Error('The store is full.'))
          : memory.setItem(key, value, options),
    })
    const revocations: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        if (new URL(String(input)).pathname === '/oauth2/revoke')
          revocations.push(new URLSearchParams(String(init?.body)).get('token'))
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // Nothing listens at the URL, so each revocation receives no answer.
    await accounts.signOut().catch(() => undefined)
    const first = [...revocations]
    const error = await accounts.signOut().catch((error: unknown) => error)

    expect(await memory.getItem(`${name}:unanswered`)).toMatchInlineSnapshot(
      `undefined`,
    )
    expect(first).toMatchInlineSnapshot(`
      [
        "refresh-token",
      ]
    `)
    expect(revocations).toMatchInlineSnapshot(`
      [
        "refresh-token",
        "refresh-token",
      ]
    `)
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
  })

  test('retains no token of a session that the store still holds, when the store refuses the erase and the unanswered entry', async () => {
    const memory = Store.memory()
    // The store refuses each write, such as at a full quota, so it keeps the session.
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: () => Promise.reject(new Error('The store is full.')),
      setItem: () => Promise.reject(new Error('The store is full.')),
    })
    const revocations: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        if (new URL(String(input)).pathname === '/oauth2/revoke')
          revocations.push(new URLSearchParams(String(init?.body)).get('token'))
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    const stored = Session.from({
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshToken: 'refresh-token',
      user: { email: 'user@example.com', id: 'user_1' },
    })
    await memory.setItem(name, { state: { session: stored }, version: 0 })
    await accounts.session.get()

    // Nothing listens at the URL, so each revocation receives no answer.
    const first = await accounts.signOut().catch((error: unknown) => error)
    // Another context refreshes the session that the store still holds.
    await memory.setItem(name, {
      state: { session: { ...stored, refreshToken: 'rotated-refresh-token' } },
      version: 0,
    })
    await accounts.signOut().catch(() => undefined)

    expect(first).toMatchInlineSnapshot(`[Error: The store is full.]`)
    expect(revocations).toMatchInlineSnapshot(`
      [
        "refresh-token",
        "rotated-refresh-token",
      ]
    `)
  })

  test('sends the revocation of a saved session again at the next sign-out, when the store refuses the first erase and the unanswered entry', async () => {
    const memory = Store.memory()
    let refused = false
    // The store refuses the first write of the session, and each write of the unanswered entry. The
    // sign-out's second erase then succeeds, so the store holds the session no more.
    const write = (key: string) => {
      if (key === `${name}:unanswered`) return false
      if (key !== name || refused) return true
      refused = true
      return false
    }
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: (key) =>
        write(key)
          ? memory.removeItem(key)
          : Promise.reject(new Error('The store is full.')),
      setItem: (key, value, options) =>
        write(key)
          ? memory.setItem(key, value, options)
          : Promise.reject(new Error('The store is full.')),
    })
    const revocations: (string | null)[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        if (new URL(String(input)).pathname === '/oauth2/revoke')
          revocations.push(new URLSearchParams(String(init?.body)).get('token'))
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // Nothing listens at the URL, so each revocation receives no answer.
    const first = await accounts.signOut().catch((error: unknown) => error)
    const erased = await memory.getItem(name)
    const error = await accounts.signOut().catch((error: unknown) => error)

    expect(first).toMatchInlineSnapshot(`[Error: The store is full.]`)
    expect(erased).toMatchInlineSnapshot(`
      {
        "state": {
          "session": undefined,
        },
        "version": 0,
      }
    `)
    expect(revocations).toMatchInlineSnapshot(`
      [
        "refresh-token",
        "refresh-token",
      ]
    `)
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
  })

  // Each restore commits after a sign-out with `everywhere` overtook it: after the logout received
  // no answer, or during the logout. Such a logout can have revoked the restore's token.
  const restores = [
    [
      'sends no revocation after the logout of `everywhere` received no answer',
      'after',
    ],
    [
      'sends no revocation once the logout of `everywhere` in progress receives no answer',
      'during',
    ],
  ] as const

  for (const [name, commit] of restores)
    test(`${name}, for a restore that the sign-out overtook`, async () => {
      const requests: string[] = []
      const answer = Promise.withResolvers<void>()
      const requested = Promise.withResolvers<void>()
      const committing = Promise.withResolvers<void>()
      // A first-party client ID, so the sign-out logs out, and a restore skips a revoked token.
      const accounts = Accounts.create({
        chain: 42431,
        clientId: 'client_test',
        // The logout leaves once `answer` resolves. Nothing listens at the URL, so it then receives
        // no answer.
        fetch: async (input, init) => {
          const { pathname } = new URL(String(input))
          if (pathname === '/oauth2/revoke') {
            const token = new URLSearchParams(String(init?.body)).get('token')
            requests.push(`${init?.method} ${pathname} ${token}`)
            return globalThis.fetch(input, init)
          }
          requests.push(`${init?.method} ${pathname}`)
          requested.resolve()
          await answer.promise
          return globalThis.fetch(input, init)
        },
        plugins: [
          Plugin.from({
            actions: (context) => ({
              async restore(session: Session.Any) {
                const change = context.session.change({ restore: true })
                await committing.promise
                await change.commit(session)
              },
            }),
            id: 'test',
          }),
        ],
        store: Store.memory(),
        url: 'http://127.0.0.1:9',
      })

      const restore = accounts.test
        .restore(
          Session.from({
            ...session(),
            refreshToken: 'restore-refresh-token',
          }),
        )
        .then(
          () => 'resolved',
          () => 'rejected',
        )
      const signOut = accounts.signOut({ everywhere: true }).then(
        () => 'resolved',
        () => 'rejected',
      )
      await requested.promise
      if (commit === 'after') {
        answer.resolve()
        await signOut
      }
      committing.resolve()
      answer.resolve()
      const result = { restore: await restore, signOut: await signOut }

      expect(requests).toMatchInlineSnapshot(`
        [
          "POST /v1/auth/logout",
        ]
      `)
      expect(result).toMatchInlineSnapshot(`
        {
          "restore": "rejected",
          "signOut": "rejected",
        }
      `)
    })

  test('keeps the refresh token of a restore that the sign-out overtook for the next sign-out, when its revocation receives no response', async () => {
    const memory = Store.memory()
    // Nothing listens at the URL, so a revocation that goes there receives no answer.
    let listens = false
    const requests: string[] = []
    const committing = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: async (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        if (listens) return new Response(null, { status: 200 })
        return globalThis.fetch(input, init)
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            async restore(session: Session.Any) {
              const change = context.session.change({ restore: true })
              await committing.promise
              await change.commit(session)
            },
          }),
          id: 'test',
        }),
      ],
      store: memory,
      url: 'http://127.0.0.1:9',
    })

    const restore = accounts.test
      .restore(
        Session.from({
          ...session(),
          refreshToken: 'restore-refresh-token',
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    await accounts.signOut()
    committing.resolve()
    const error = await restore
    const unanswered = await memory.getItem(`${name}:unanswered`)
    listens = true
    await accounts.signOut()

    // Only the restore holds its token. Without the entry, no later sign-out sends its revocation
    // again, and Tempo ID accepts it until it expires.
    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
    expect(unanswered).toMatchInlineSnapshot(`
      [
        "restore-refresh-token",
      ]
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke restore-refresh-token",
        "POST /oauth2/revoke restore-refresh-token",
      ]
    `)
    expect(await memory.getItem(`${name}:unanswered`)).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('keeps the stored session out of a reload that waits for a save, after a sign-out whose read of the store started before the save', async () => {
    const memory = Store.memory()
    // The reads and the writes of the session in the store that wait, in the order of their calls.
    // A read returns the value at its call, and a write changes the store, at its release.
    const reads: (() => void)[] = []
    const writes: (() => void)[] = []
    let holds: 'all' | 'none' | 'writes' = 'none'
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            reload: () => context.session.reload(),
            update: (session: Session.Any) =>
              context.session.change({ update: true }).commit(session),
          }),
          id: 'test',
        }),
      ],
      store: Store.from({
        async getItem(key) {
          const value = await memory.getItem(key)
          if (holds === 'all' && key === name)
            await new Promise<void>((resolve) => reads.push(resolve))
          return value
        },
        removeItem: (key) => memory.removeItem(key),
        async setItem(key, value) {
          if (holds !== 'none' && key === name)
            await new Promise<void>((resolve) => writes.push(resolve))
          await memory.setItem(key, value)
        },
      }),
      url: 'http://127.0.0.1:9',
    })
    const signedIn = Session.from({
      ...session(),
      refreshToken: 'refresh-token',
    })
    await memory.setItem(name, { state: { session: signedIn }, version: 0 })
    await accounts.session.get()

    // The sign-out reads the store before it empties the session.
    holds = 'all'
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(1)
    holds = 'writes'
    // A save of the same tokens starts, such as one that keeps the session's account, and the
    // reload waits for it.
    const update = accounts.test.update({ ...signedIn, accessToken: 'later' })
    await expect.poll(() => writes.length).toBe(1)
    const reload = accounts.test.reload()
    // The sign-out's read completes, then the save. The sign-out empties the session, and its
    // empty write follows the save. A reload that read the store between the two writes, and
    // counted the sign-out as no change since, would set the stored session again.
    reads[0]!()
    writes[0]!()
    await expect.poll(() => writes.length).toBe(2)
    writes[1]!()
    await Promise.all([reload, signOut, update])

    expect({
      status: accounts.session.status.get().status,
      stored: await memory.getItem(name),
    }).toMatchInlineSnapshot(`
      {
        "status": "signedOut",
        "stored": {
          "state": {
            "session": undefined,
          },
          "version": 0,
        },
      }
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke refresh-token",
      ]
    `)
  })

  test("keeps another context's later tokens out of a reload that waits for the empty write of a sign-out, and revokes them", async () => {
    const memory = Store.memory()
    // The writes of the session in the store that wait, in the order of their calls.
    const writes: (() => void)[] = []
    let holds = false
    // The session that another context saves right after the next write of the session.
    let saves: Session.Any | undefined
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            reload: () => context.session.reload(),
          }),
          id: 'test',
        }),
      ],
      store: Store.from({
        getItem: (key) => memory.getItem(key),
        removeItem: (key) => memory.removeItem(key),
        async setItem(key, value) {
          if (holds && key === name)
            await new Promise<void>((resolve) => writes.push(resolve))
          await memory.setItem(key, value)
          if (!saves || key !== name) return
          await memory.setItem(name, { state: { session: saves }, version: 0 })
          saves = undefined
        },
      }),
      url: 'http://127.0.0.1:9',
    })
    const signedIn = Session.from({
      ...session(),
      refreshToken: 'refresh-token',
    })
    await memory.setItem(name, { state: { session: signedIn }, version: 0 })
    await accounts.session.get()

    // The sign-out empties the session, and the reload waits for its empty write.
    holds = true
    const signOut = accounts.signOut()
    await expect.poll(() => writes.length).toBe(1)
    holds = false
    const reload = accounts.test.reload()
    // Another tab's refresh saves the session's later tokens after the empty write, before the
    // reload and the sign-out read the store.
    saves = Session.from({
      ...signedIn,
      expiresAt: signedIn.expiresAt + 1,
      refreshToken: 'later-refresh-token',
    })
    writes[0]!()
    const reloaded = await reload
    await signOut

    expect({
      reloaded,
      status: accounts.session.status.get().status,
      stored: await memory.getItem(name),
    }).toMatchInlineSnapshot(`
      {
        "reloaded": undefined,
        "status": "signedOut",
        "stored": {
          "state": {
            "session": undefined,
          },
          "version": 0,
        },
      }
    `)
    // The first token is rotated, so the sign-out revokes its successor.
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke later-refresh-token",
      ]
    `)
  })

  test('revokes the refresh token of a sign-in of another user that commits during the read of the store, in the sign-out that empties its session', async () => {
    const memory = Store.memory()
    // The reads of the session that the store holds, in the order of their calls. Each one returns
    // the value at its call, at its release.
    const reads: (() => void)[] = []
    let holds = false
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            commit: (session: Session.Any) =>
              context.session.change().commit(session),
          }),
          id: 'test',
        }),
      ],
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
    // After a change in the instance, such as this sign-in, a sign-out reads the store again.
    await accounts.test.commit(
      Session.from({ ...session(), refreshToken: 'refresh-token' }),
    )
    await accounts.session.get()

    // The sign-out reads the store before it empties the session.
    holds = true
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(1)
    holds = false
    // The sign-in of another user saves its session during that read, and revokes the token of the
    // session that it replaced.
    await accounts.test.commit(
      Session.from({
        ...session(),
        refreshToken: 'other-refresh-token',
        user: { email: 'other@example.com', id: 'user_2' },
      }),
    )
    reads[0]!()
    await signOut

    // The sign-out empties the session of the sign-in, so it revokes that session's token, which
    // nothing else holds.
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke refresh-token",
        "POST /oauth2/revoke other-refresh-token",
      ]
    `)
    expect({
      status: accounts.session.status.get().status,
      stored: await memory.getItem(name),
    }).toMatchInlineSnapshot(`
      {
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

  test('revokes the later refresh token that the store holds, after a reload that sets an earlier one during the read of the store', async () => {
    const memory = Store.memory()
    // The reads of the session that the store holds, in the order of their calls. Each one returns
    // the value at its call, at its release.
    const reads: (() => void)[] = []
    let holds = false
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            reload: () => context.session.reload(),
          }),
          id: 'test',
        }),
      ],
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
    const signedIn = session()
    await memory.setItem(name, { state: { session: signedIn }, version: 0 })
    await accounts.session.get()

    // Another tab's refresh saves the session's second tokens, which the reload reads.
    holds = true
    await memory.setItem(name, {
      state: {
        session: Session.from({
          ...signedIn,
          expiresAt: signedIn.expiresAt + 1,
          refreshToken: 'second-refresh-token',
        }),
      },
      version: 0,
    })
    const reload = accounts.test.reload()
    await expect.poll(() => reads.length).toBe(1)
    // Its next refresh rotates that token, and saves the third tokens, which the sign-out reads.
    await memory.setItem(name, {
      state: {
        session: Session.from({
          ...signedIn,
          expiresAt: signedIn.expiresAt + 2,
          refreshToken: 'third-refresh-token',
        }),
      },
      version: 0,
    })
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(2)
    holds = false
    // The reload sets the second tokens during the sign-out's read.
    reads[0]!()
    await reload
    reads[1]!()
    await signOut

    // The second token is rotated, so its revocation counts as a reuse. The sign-out empties the
    // store, so nothing else revokes the third.
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke third-refresh-token",
      ]
    `)
    expect(await memory.getItem(name)).toMatchInlineSnapshot(`
      {
        "state": {
          "session": undefined,
        },
        "version": 0,
      }
    `)
  })

  test('revokes the refresh token of the stored session too, after a sign-in of another user whose save fails after the read of the store', async () => {
    const memory = Store.memory()
    // The reads and the writes of the session in the store, in the order of their calls. A read
    // returns the value at its call, at its release. A write fails at its release.
    const reads: (() => void)[] = []
    const writes: (() => void)[] = []
    let holds = false
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (input, init) => {
        const { pathname } = new URL(String(input))
        const token = new URLSearchParams(String(init?.body)).get('token')
        requests.push(`${init?.method} ${pathname} ${token}`)
        return Promise.resolve(new Response(null, { status: 200 }))
      },
      plugins: [
        Plugin.from({
          actions: (context) => ({
            commit: (session: Session.Any) =>
              context.session.change().commit(session),
          }),
          id: 'test',
        }),
      ],
      store: Store.from({
        async getItem(key) {
          const value = await memory.getItem(key)
          if (holds && key === name)
            await new Promise<void>((resolve) => reads.push(resolve))
          return value
        },
        removeItem: (key) => memory.removeItem(key),
        async setItem(key, value) {
          if (holds && key === name) {
            await new Promise<void>((resolve) => writes.push(resolve))
            throw new Error('The store refused the write.')
          }
          await memory.setItem(key, value)
        },
      }),
      url: 'http://127.0.0.1:9',
    })
    await accounts.test.commit(
      Session.from({ ...session(), refreshToken: 'refresh-token' }),
    )
    await accounts.session.get()

    // The sign-out reads the store before it empties the session.
    holds = true
    const signOut = accounts.signOut()
    await expect.poll(() => reads.length).toBe(1)
    // The sign-in of another user sets its session during that read. Its save is in progress when
    // the read completes, and fails after it.
    const signIn = accounts.test
      .commit(
        Session.from({
          ...session(),
          refreshToken: 'other-refresh-token',
          user: { email: 'other@example.com', id: 'user_2' },
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    await expect.poll(() => writes.length).toBe(1)
    reads[0]!()
    holds = false
    writes[0]!()
    const [error] = await Promise.all([signIn, signOut])

    // No store holds the failed sign-in's session, so its refresh token ends beside its rejection.
    // The sign-in revokes no session that it replaced, and the sign-out revokes the stored one.
    expect(error).toMatchInlineSnapshot(`[Error: The store refused the write.]`)
    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke other-refresh-token",
        "POST /oauth2/revoke refresh-token",
      ]
    `)
    expect(await memory.getItem(name)).toMatchInlineSnapshot(`
      {
        "state": {
          "session": undefined,
        },
        "version": 0,
      }
    `)
  })

  test('throws RequestError with status 0 when the logout of `everywhere` receives no response', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_test',
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_test",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    await accounts.session.get()

    // Nothing listens at the URL, so the revocation and the logout receive no answer.
    const error = await accounts
      .signOut({ everywhere: true })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The logout received no response. Check the connection, and sign out again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('sends one revocation and one logout for two calls of `everywhere` at once, as two clicks of a sign-out button', async () => {
    const store = Store.memory()
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'client_test',
      fetch: (input, init) => {
        requests.push(`${init?.method} ${new URL(String(input)).pathname}`)
        return globalThis.fetch(input, init)
      },
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_test",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    await accounts.session.get()

    // Nothing listens at the URL, so both calls reject with the one logout's error.
    const results = await Promise.allSettled([
      accounts.signOut({ everywhere: true }),
      accounts.signOut({ everywhere: true }),
    ])

    expect(requests).toMatchInlineSnapshot(`
      [
        "POST /oauth2/revoke",
        "POST /v1/auth/logout",
      ]
    `)
    expect(results.map((result) => result.status)).toMatchInlineSnapshot(`
      [
        "rejected",
        "rejected",
      ]
    `)
  })

  test('reads the revoked digests and the unanswered entry once, beside the session, and writes each once after the revocations', async () => {
    const memory = Store.memory()
    const calls: string[] = []
    const entry = (key: string) => key.slice(name.length) || 'session'
    const store = Store.from({
      async getItem(key) {
        calls.push(`getItem ${entry(key)}`)
        return memory.getItem(key)
      },
      async removeItem(key) {
        calls.push(`removeItem ${entry(key)}`)
        return memory.removeItem(key)
      },
      async setItem(key, value) {
        calls.push(`setItem ${entry(key)}`)
        return memory.setItem(key, value)
      },
    })
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      store,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    // An earlier sign-out's revocation that received no answer.
    await memory.setItem(`${name}:unanswered`, ['earlier-refresh-token'])
    await accounts.session.get()
    calls.length = 0

    // Nothing listens at the URL, so the revocations and the logout receive no answer.
    const error = await accounts.signOut().catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The revocation received no response. Check the connection, and sign out again.]`,
    )
    expect(calls).toMatchInlineSnapshot(`
      [
        "setItem :signed-out",
        "getItem session",
        "getItem :unanswered",
        "getItem :revoked",
        "setItem session",
        "getItem session",
        "setItem :unanswered",
      ]
    `)
    expect(await memory.getItem(`${name}:unanswered`)).toMatchInlineSnapshot(`
      [
        "earlier-refresh-token",
        "refresh-token",
      ]
    `)
  })
})

describe('switchChain', () => {
  const owner = Account.fromSecp256k1(
    '0x0123456789012345678901234567890123456789012345678901234567890123',
  )
  const accessKey = Account.fromSecp256k1(
    '0x0123456789012345678901234567890123456789012345678901234567890124',
  )
  const name =
    'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
  const options = {
    chain: 4217,
    clientId: 'https://app.example.com',
    url: 'http://127.0.0.1:9',
  }

  /** Returns an access key of `owner` on `chainId`. */
  async function createAccessKey(chainId: number) {
    return {
      account: owner.address,
      chainId,
      keyAuthorization: KeyAuthorization.toRpc(
        await owner.signKeyAuthorization(
          { address: accessKey.address, type: 'secp256k1' },
          { chainId: BigInt(chainId) },
        ),
      ),
    }
  }

  /** Saves a session with `fields` to `store`. */
  async function save(
    store: Store.Store,
    fields: Pick<Session.Any, 'accessKey' | 'accessKeys' | 'account'>,
  ) {
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
          ...fields,
        }),
      },
      version: 0,
    })
  }

  /** Returns the chains of the access keys of `session`. */
  function chains(session: Session.Any | undefined) {
    return {
      accessKey: session?.accessKey?.chainId,
      accessKeys: session?.accessKeys?.map((entry) => entry.chainId),
    }
  }

  test("sets the session's access key on the chain, saves the selection, and a new instance restores both", async () => {
    const store = Store.memory()
    const accounts = Accounts.create({ ...options, store })
    await save(store, {
      accessKey: await createAccessKey(4217),
      accessKeys: [await createAccessKey(42431)],
    })
    const changes: number[] = []
    accounts.chain.subscribe((chainId) => changes.push(chainId))

    await accounts.switchChain({ chainId: 42431 })
    const session = await accounts.session.get()
    const restored = Accounts.create({ ...options, store })
    const restoredSession = await restored.session.get()

    expect(accounts.config.chainId).toMatchInlineSnapshot(`42431`)
    expect(changes).toMatchInlineSnapshot(`
      [
        42431,
      ]
    `)
    expect(chains(session)).toMatchInlineSnapshot(`
      {
        "accessKey": 42431,
        "accessKeys": [
          4217,
        ],
      }
    `)
    expect(restored.config.chainId).toMatchInlineSnapshot(`42431`)
    expect(chains(restoredSession)).toMatchInlineSnapshot(`
      {
        "accessKey": 42431,
        "accessKeys": [
          4217,
        ],
      }
    `)
  })

  test("keeps the session's access key on the selected chain after another context on the earlier chain saves a refresh", async () => {
    const store = Store.memory()
    const local = { ...options, chain: 1337 }
    const localName =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...local,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })
    const signedIn = async (
      fields: Pick<Session.TempoIdSession, 'expiresAt'>,
    ) =>
      Session.from({
        accessKey: await createAccessKey(1337),
        accessKeys: [await createAccessKey(42431)],
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { email: 'user@example.com', id: 'user_1' },
        ...fields,
      })
    const expiresAt = Date.now() + 60 * 60 * 1000
    await store.setItem(localName, {
      state: { session: await signedIn({ expiresAt }) },
      version: 0,
    })

    await accounts.switchChain({ chainId: 42431 })
    // Another tab, still on chain 1337, saves the tokens of its refresh with its own copy.
    await store.setItem(localName, {
      state: { session: await signedIn({ expiresAt: expiresAt + 60_000 }) },
      version: 0,
    })
    await Promise.all(reloads.map((reload) => reload()))
    const status = accounts.session.status.get()
    const restored = Accounts.create({ ...local, store })
    const restoredSession = await restored.session.get()

    expect({ chainId: accounts.chain.get(), ...chains(status.session) })
      .toMatchInlineSnapshot(`
        {
          "accessKey": 42431,
          "accessKeys": [
            1337,
          ],
          "chainId": 42431,
        }
      `)
    expect({ chainId: restored.chain.get(), ...chains(restoredSession) })
      .toMatchInlineSnapshot(`
        {
          "accessKey": 42431,
          "accessKeys": [
            1337,
          ],
          "chainId": 42431,
        }
      `)
  })

  test("restores the access key of the stored selection at a first read that loads no chain, such as a plugin's reload outside a browser", async () => {
    const store = Store.memory()
    const localName =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    await store.setItem(`${localName}:chain`, 42431)
    await store.setItem(localName, {
      state: {
        session: Session.from({
          accessKey: await createAccessKey(42431),
          accessKeys: [await createAccessKey(1337)],
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...options,
      chain: 1337,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })

    await Promise.all(reloads.map((reload) => reload()))
    const session = await accounts.session.get()

    expect({ chainId: accounts.chain.get(), ...chains(session) })
      .toMatchInlineSnapshot(`
        {
          "accessKey": 42431,
          "accessKeys": [
            1337,
          ],
          "chainId": 42431,
        }
      `)
  })

  test("selects the access key of the instance's chain from a stored session without an `accessKey`, such as after another context switched to a chain without one", async () => {
    const store = Store.memory()
    const localName =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...options,
      chain: 1337,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })
    const signedIn = (
      fields: Pick<
        Session.TempoIdSession,
        'accessKey' | 'accessKeys' | 'expiresAt'
      >,
    ) =>
      Session.from({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { email: 'user@example.com', id: 'user_1' },
        ...fields,
      })
    const expiresAt = Date.now() + 60 * 60 * 1000
    await store.setItem(localName, {
      state: {
        session: signedIn({
          accessKey: await createAccessKey(1337),
          expiresAt,
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // Another tab switches to chain 42431, where the session holds no access key, and saves a refresh.
    await store.setItem(localName, {
      state: {
        session: signedIn({
          accessKeys: [await createAccessKey(1337)],
          expiresAt: expiresAt + 60_000,
        }),
      },
      version: 0,
    })
    await Promise.all(reloads.map((reload) => reload()))
    const session = await accounts.session.get()

    expect({ chainId: accounts.chain.get(), ...chains(session) })
      .toMatchInlineSnapshot(`
        {
          "accessKey": 1337,
          "accessKeys": undefined,
          "chainId": 1337,
        }
      `)
  })

  test('keeps the stored access key when the first read of the chain selection fails, and selects nothing until the selection loads', async () => {
    const memory = Store.memory()
    const localName =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    // The first read of the selection fails, as a transient store error does.
    let failures = 1
    const store = Store.from({
      async getItem(key) {
        if (key === `${localName}:chain` && failures-- > 0)
          throw new Error('The store is unavailable.')
        return memory.getItem(key)
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value) => memory.setItem(key, value),
    })
    await memory.setItem(`${localName}:chain`, 42431)
    await memory.setItem(localName, {
      state: {
        session: Session.from({
          accessKey: await createAccessKey(42431),
          accessKeys: [await createAccessKey(1337)],
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...options,
      chain: 1337,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })

    await Promise.all(reloads.map((reload) => reload()))
    const session = await accounts.session.get()

    expect({ chainId: accounts.chain.get(), ...chains(session) })
      .toMatchInlineSnapshot(`
        {
          "accessKey": 42431,
          "accessKeys": [
            1337,
          ],
          "chainId": 42431,
        }
      `)
  })

  test("keeps the instance's own access key layout when another context on another chain saves a refresh of the same access keys", async () => {
    const store = Store.memory()
    const localName =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...options,
      chain: 1337,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })
    const signedIn = (
      fields: Pick<
        Session.TempoIdSession,
        'accessKey' | 'accessKeys' | 'expiresAt'
      >,
    ) =>
      Session.from({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { email: 'user@example.com', id: 'user_1' },
        ...fields,
      })
    const expiresAt = Date.now() + 60 * 60 * 1000
    // This instance switched to chain 42431, where the session holds no access key.
    await store.setItem(`${localName}:chain`, 42431)
    await store.setItem(localName, {
      state: {
        session: signedIn({
          accessKeys: [await createAccessKey(1337)],
          expiresAt,
        }),
      },
      version: 0,
    })
    await accounts.session.get()

    // Another tab, still on chain 1337, saves a refresh with the access key as its `accessKey`.
    await store.setItem(localName, {
      state: {
        session: signedIn({
          accessKey: { ...(await createAccessKey(1337)), lifetime: 3600 },
          expiresAt: expiresAt + 60_000,
        }),
      },
      version: 0,
    })
    await Promise.all(reloads.map((reload) => reload()))
    const session = await accounts.session.get()

    expect({
      chainId: accounts.chain.get(),
      expiresAt: session!.expiresAt! - expiresAt,
      lifetime: session!.accessKeys?.[0]?.lifetime,
      ...chains(session),
    }).toMatchInlineSnapshot(`
      {
        "accessKey": undefined,
        "accessKeys": [
          1337,
        ],
        "chainId": 42431,
        "expiresAt": 60000,
        "lifetime": 3600,
      }
    `)
  })

  test("takes the account of another context's sign-in of the same user without access keys", async () => {
    const store = Store.memory()
    const reloads: (() => Promise<unknown>)[] = []
    const accounts = Accounts.create({
      ...options,
      plugins: [
        Plugin.from({
          extend(_, context) {
            reloads.push(context.session.reload)
            return {}
          },
          id: 'tab',
        }),
      ],
      store,
    })
    const signedIn = (address: `0x${string}`, expiresAt: number) => ({
      state: {
        session: {
          accessToken: 'access-token',
          account: {
            address,
            keys: [],
            owner: 'secp256k1',
            realm: { id: 'default', name: 'Tempo' },
          },
          expiresAt,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        },
      },
      version: 0,
    })
    const expiresAt = Date.now() + 60 * 60 * 1000
    await store.setItem(name, signedIn(owner.address, expiresAt))
    await accounts.session.get()

    // Another tab signs the same user in again, with another account and no access key.
    await store.setItem(name, signedIn(accessKey.address, expiresAt + 60_000))
    await Promise.all(reloads.map((reload) => reload()))
    const session = await accounts.session.get()

    expect(
      session?.account?.address === accessKey.address,
    ).toMatchInlineSnapshot(`true`)
  })

  test('selects `chainId` with `from` only from that chain, after the earlier switches', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({ ...options, store })

    await Promise.all([
      accounts.switchChain({ chainId: 42431 }),
      accounts.switchChain({ chainId: 4217, from: 4217 }),
    ])
    const kept = accounts.chain.get()
    await accounts.switchChain({ chainId: 4217, from: 42431 })

    expect({
      kept,
      selected: accounts.chain.get(),
    }).toMatchInlineSnapshot(`
      {
        "kept": 42431,
        "selected": 4217,
      }
    `)
  })

  test('selects the last call when two switches overlap', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({ ...options, store })
    await save(store, {
      accessKey: await createAccessKey(4217),
      accessKeys: [await createAccessKey(42431)],
    })

    await Promise.all([
      accounts.switchChain({ chainId: 42431 }),
      accounts.switchChain({ chainId: 4217 }),
    ])
    const session = await accounts.session.get()

    expect(accounts.chain.get()).toMatchInlineSnapshot(`4217`)
    expect(chains(session)).toMatchInlineSnapshot(`
      {
        "accessKey": 4217,
        "accessKeys": [
          42431,
        ],
      }
    `)
  })

  test('keeps the account of a session without access keys at a switch to its own chain, and rejects a switch whose account read fails', async () => {
    const store = Store.memory()
    // A registered client ID, since a third-party client ID, such as an origin, sends no read.
    const accounts = Accounts.create({
      ...options,
      clientId: 'client_0123456789abcdef',
      store,
    })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","client_0123456789abcdef",4217]',
      {
        state: {
          session: {
            accessToken: 'access-token',
            account: {
              address: owner.address,
              keys: [],
              owner: 'secp256k1',
              realm: { id: 'default', name: 'Tempo' },
            },
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          },
        },
        version: 0,
      },
    )

    await accounts.switchChain({ chainId: 4217 })
    const same = await accounts.session.get()
    // Tempo ID is unreachable, so the account read on the other chain fails.
    const error = await accounts
      .switchChain({ chainId: 42431 })
      .catch((error: Error) => error.name)
    const other = await accounts.session.get()

    expect(same?.account?.address).toBe(owner.address)
    expect(error).toMatchInlineSnapshot(`"TypeError"`)
    expect(accounts.chain.get()).toMatchInlineSnapshot(`4217`)
    expect(other?.account?.address).toBe(owner.address)
  })

  test("runs the restore hooks, such as a redirect's callback, on the stored selection", async () => {
    const store = Store.memory()
    await store.setItem(`${name}:chain`, 42431)
    const seen: number[] = []
    const accounts = Accounts.create({
      ...options,
      plugins: [
        Plugin.from({
          hooks: {
            restore(context) {
              seen.push(context.config.chainId)
              return Promise.resolve()
            },
          },
          id: 'test',
        }),
      ],
      store,
    })

    await accounts.session.get()

    expect(seen).toMatchInlineSnapshot(`
      [
        42431,
      ]
    `)
  })

  test('parks the access key of a sign-in that a switch overtook, and keeps one that names another chain on purpose', async () => {
    const store = Store.memory()
    const accounts = Accounts.create({
      ...options,
      plugins: [
        Plugin.from({
          actions: (context) => ({
            start: () => context.session.change(),
          }),
          id: 'test',
        }),
      ],
      store,
    })
    const signedIn = async () =>
      Session.from({
        accessKey: await createAccessKey(4217),
        accessToken: 'access-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: 'refresh-token',
        user: { email: 'user@example.com', id: 'user_1' },
      })

    const overtaken = accounts.test.start()
    await accounts.switchChain({ chainId: 42431 })
    await overtaken.commit(await signedIn())
    const parked = await accounts.session.get()
    await accounts.test.start().commit(await signedIn())
    const named = await accounts.session.get()

    expect(chains(parked)).toMatchInlineSnapshot(`
      {
        "accessKey": undefined,
        "accessKeys": [
          4217,
        ],
      }
    `)
    expect(chains(named)).toMatchInlineSnapshot(`
      {
        "accessKey": 4217,
        "accessKeys": undefined,
      }
    `)
  })

  test('rejects, and selects nothing, when the save of the selection fails', async () => {
    const memory = Store.memory()
    const store = Store.from({
      ...memory,
      async setItem(key, value) {
        if (key.endsWith(':chain')) throw new Error('Write failed.')
        return memory.setItem(key, value)
      },
    })
    const accounts = Accounts.create({ ...options, store })
    await save(store, {
      accessKey: await createAccessKey(4217),
      accessKeys: [await createAccessKey(42431)],
    })

    const error = await accounts
      .switchChain({ chainId: 42431 })
      .catch((error: Error) => error)
    const session = await accounts.session.get()

    expect(error).toMatchInlineSnapshot(`[Error: Write failed.]`)
    expect(accounts.chain.get()).toMatchInlineSnapshot(`4217`)
    expect(chains(session)).toMatchInlineSnapshot(`
      {
        "accessKey": 4217,
        "accessKeys": [
          42431,
        ],
      }
    `)
  })

  test('restores the earlier selection when the save of the moved session fails', async () => {
    const memory = Store.memory()
    const store = Store.from({
      ...memory,
      async setItem(key, value) {
        if (key === name) throw new Error('Write failed.')
        return memory.setItem(key, value)
      },
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessKey: await createAccessKey(4217),
          accessKeys: [await createAccessKey(42431)],
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const accounts = Accounts.create({ ...options, store })

    const error = await accounts
      .switchChain({ chainId: 42431 })
      .catch((error: Error) => error.message)
    const stored = await memory.getItem(`${name}:chain`)
    const held = await accounts.session.get()

    expect(error).toMatchInlineSnapshot(`"Write failed."`)
    expect(accounts.chain.get()).toMatchInlineSnapshot(`4217`)
    expect(stored).toMatchInlineSnapshot(`4217`)
    expect(chains(held)).toMatchInlineSnapshot(`
      {
        "accessKey": 4217,
        "accessKeys": [
          42431,
        ],
      }
    `)
  })

  test('keeps a sign-in that commits during a failed save of the moved session, and the selection', async () => {
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const writes = { session: 0 }
    const store = Store.from({
      ...memory,
      async setItem(key, value) {
        // The switch's save of the moved session waits, then fails. Later saves succeed.
        if (key === name && ++writes.session === 1) {
          await gate.promise
          throw new Error('Write failed.')
        }
        return memory.setItem(key, value)
      },
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessKey: await createAccessKey(4217),
          accessKeys: [await createAccessKey(42431)],
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const accounts = Accounts.create({
      ...options,
      plugins: [
        Plugin.from({
          actions: (context) => ({
            start: () => context.session.change(),
          }),
          id: 'test',
        }),
      ],
      store,
    })

    const switching = accounts
      .switchChain({ chainId: 42431 })
      .catch((error: Error) => error.message)
    await expect.poll(() => writes.session).toBe(1)
    const signingIn = accounts.test
      .start()
      .commit(
        Session.from({
          accessKey: await createAccessKey(42431),
          accessToken: 'access-token-2',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token-2',
          user: { email: 'other@example.com', id: 'user_2' },
        }),
      )
      .catch(() => undefined)
    await expect
      .poll(async () => (await accounts.session.get())?.user?.id)
      .toBe('user_2')
    gate.resolve()
    const [error] = await Promise.all([switching, signingIn])
    const held = await accounts.session.get()

    expect(error).toBeUndefined()
    expect(accounts.chain.get()).toMatchInlineSnapshot(`42431`)
    expect(await memory.getItem(`${name}:chain`)).toMatchInlineSnapshot(`42431`)
    expect(held?.user?.id).toMatchInlineSnapshot(`"user_2"`)
  })

  test('throws ChainInvalidError for a chain outside `chains`, and restores no stored selection outside them', async () => {
    const store = Store.memory()
    await store.setItem(`${name}:chain`, 31318)
    const accounts = Accounts.create({
      ...options,
      chains: [4217, 42431],
      store,
    })

    await accounts.session.get()
    const error = await accounts
      .switchChain({ chainId: 31318 })
      .catch((error: Error) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.ChainInvalidError: Invalid chain ID: 31318 is not a chain that the instance serves. Pass the ID of a chain in \`chains\`, such as \`tempo.id\`, or add it to \`chains\`.]`,
    )
    expect(accounts.chain.get()).toMatchInlineSnapshot(`4217`)
  })

  test('throws for a plugin whose ID is `switchChain`, a member of every instance', () => {
    const error = (() => {
      try {
        Accounts.create({
          ...options,
          plugins: [Plugin.from({ id: 'switchChain' })],
        })
      } catch (error) {
        return error
      }
    })()

    expect(error).toMatchInlineSnapshot(
      `[Error: Invalid plugin ID: switchChain is a member of every instance. Give the plugin another \`id\`.]`,
    )
  })
})

describe('Plugin.Context.session.reload', () => {
  test('adopts no session that a refusal ended, while its end waits for the lock, and runs no hook', async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const store = Store.memory()
    const signIns: string[] = []
    const contexts: Plugin.Context[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          hooks: {
            afterSignIn: (_context, session) => {
              signIns.push(session.user!.id)
            },
          },
          id: 'record',
          setup(context) {
            contexts.push(context)
          },
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await store.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()
    const [context] = contexts

    // The lock holds the refusal's end, so the store keeps the ended session during the reload.
    const reloaded = await context!.session.exclusive(async () => {
      await context!.session
        .change()
        .fail(
          new Accounts.RequestError({
            code: 'access_denied',
            message: 'Refused.',
            signedIn: true,
            status: 400,
          }),
        )
        .catch(() => undefined)
      return context!.session.reload({ hooks: true })
    })
    await expect
      .poll(async () => (await store.getItem(name)) as unknown)
      .toMatchObject({ state: { session: undefined } })

    expect({
      reloaded: reloaded?.user?.id,
      signIns,
    }).toMatchInlineSnapshot(`
      {
        "reloaded": undefined,
        "signIns": [],
      }
    `)
  })

  test("adopts another context's sign-out, and reads none of the revocation entries", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'
    const memory = Store.memory()
    const calls: string[] = []
    const store = Store.from({
      ...memory,
      getItem: (key) => {
        calls.push(`getItem ${key.slice(name.length)}`)
        return memory.getItem(key)
      },
      lock: (key, fn) => {
        calls.push(`lock ${key.slice(name.length)}`)
        return memory.lock!(key, fn)
      },
    })
    const contexts: Plugin.Context[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [
        Plugin.from({
          id: 'record',
          setup(context) {
            contexts.push(context)
          },
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await memory.setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    await accounts.session.get()
    const [context] = contexts

    // Another process's sign-out empties the store, and revoked the stored refresh token.
    await memory.setItem(name, { state: {}, version: 0 })
    calls.length = 0
    const reloaded = await context!.session.reload()
    // A later hold of the lock runs after any hold that the reload queued.
    await context!.session.exclusive(() => Promise.resolve())

    expect({ calls, reloaded }).toMatchInlineSnapshot(`
      {
        "calls": [
          "getItem ",
        ],
        "reloaded": undefined,
      }
    `)
  })
})
