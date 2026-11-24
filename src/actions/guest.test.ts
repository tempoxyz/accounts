/**
 * Tests the guest account without a server: `Actions.guest.check`, which accepts only the requested
 * transfer from a transaction that Tempo ID's page posts, the guest session and its key pair in the
 * store, the signature of its account, and the guest session of an instance with `guest`.
 * @module
 */
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address, PublicKey } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { describe, expect, expectTypeOf, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as DefaultAccounts from '../internal/DefaultAccounts.js'
import * as SignIn from '../internal/SignIn.js'
import { device, dialog, redirect } from '../plugins/index.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import * as Guest from './guest.js'

/** Tempo mainnet's chain ID. */
const chainId = 4217

/** OUSD, at its mainnet address. */
const ousd = '0x20c0000000000000000000006a37da5c996874be'

/** The recipient of the requested payment. */
const to = '0x1f9090aae28b8a3dceadf281b0f12828e676c326'

/** The requested payment: 12.5 OUSD to `to`. */
const payment = { amount: '12.5', chainId, to, token: 'ousd' } as const

/** The requested transfer's call. */
const transfer = TokenActions.transfer.call({
  amount: 12_500_000n,
  to,
  token: ousd,
})

/** Returns a serialized transaction with the transfer and the sponsor's marker, with `fields`. */
function transaction(fields: Partial<TxEnvelopeTempo.TxEnvelopeTempo> = {}) {
  return TxEnvelopeTempo.serialize(
    TxEnvelopeTempo.from({
      calls: [transfer],
      chainId,
      feePayerSignature: null,
      gas: 100_000n,
      maxFeePerGas: 1n,
      nonce: 0n,
      ...fields,
    }),
  )
}

describe('Actions.guest.check', () => {
  test.for([
    ['with the sponsor marker', transaction()],
    [
      'without the sponsor marker, whose fee the guest account pays',
      transaction({ feePayerSignature: undefined }),
    ],
  ] as const)('accepts the requested transfer %s', ([, value]) => {
    const envelope = Guest.check(value, payment)

    expect(envelope.calls).toHaveLength(1)
  })

  const refused = [
    ['a value that is no Tempo transaction', '0x02f8'],
    ['a transaction on another chain', transaction({ chainId: 4218 })],
    [
      'another amount',
      transaction({
        calls: [
          TokenActions.transfer.call({ amount: 12_500_001n, to, token: ousd }),
        ],
      }),
    ],
    [
      'another recipient',
      transaction({
        calls: [
          TokenActions.transfer.call({
            amount: 12_500_000n,
            to: '0x000000000000000000000000000000000000dEaD',
            token: ousd,
          }),
        ],
      }),
    ],
    ['a second call', transaction({ calls: [transfer, transfer] })],
    [
      "a fee payer's signature",
      transaction({ feePayerSignature: { r: 1n, s: 1n, yParity: 0 } }),
    ],
  ] as const

  test("names the fee payer's signature that it refuses", () => {
    const value = transaction({
      feePayerSignature: { r: 1n, s: 1n, yParity: 0 },
    })

    expect(() => Guest.check(value, payment)).toThrow(
      'it holds a fee payer signature.',
    )
  })

  for (const [name, value] of refused)
    test(`refuses ${name}`, () => {
      expect(() => Guest.check(value, payment)).toThrow(
        'Invalid prepared transaction',
      )
    })
})

/** Returns the configuration of an app whose Tempo ID never answers, with `store`. */
function config(store: Store.Store = Store.memory()) {
  return Accounts.from({
    chain: 4217,
    clientId: 'cli:guest-example',
    store,
    url: 'http://127.0.0.1:9',
  })
}

describe('Actions.guest.session', () => {
  test('keeps the key pair in the store, and the session holds only its address and public key', async () => {
    const store = Store.memory()
    const auth = config(store)

    const session = await Guest.session(auth)
    const again = await Guest.session(auth)
    const address = await Guest.get(auth)

    expect(Object.keys(session).sort()).toMatchInlineSnapshot(`
      [
        "address",
        "kind",
        "publicKey",
        "revision",
      ]
    `)
    expect([
      Session.guest(session),
      Session.expired(session),
      again.address === session.address,
      address === session.address,
      Address.isEqual(
        Address.fromPublicKey(PublicKey.fromHex(session.publicKey)),
        session.address,
      ),
    ]).toMatchInlineSnapshot(`
      [
        true,
        false,
        true,
        true,
        true,
      ]
    `)
  })

  test('keeps a P256 private key, and no `CryptoKey`, in a private store of JSON', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'guest-'))
    const file = Path.join(directory, 'accounts.json')
    try {
      const auth = config(Store.file(file))

      const session = await Guest.session(auth)
      const text = await Fs.readFile(file, 'utf8')
      const address = await Guest.get(config(Store.file(file)))

      expect([text.includes('"type":"p256"'), address === session.address])
        .toMatchInlineSnapshot(`
        [
          true,
          true,
        ]
      `)
    } finally {
      await Fs.rm(directory, { force: true, recursive: true })
    }
  })

  test('refuses a store that other parties read', async () => {
    const store = Store.from({ ...Store.memory(), json: true })

    const error = await Guest.session(config(store)).catch(
      (error: unknown) => error,
    )

    expect(error).toMatchInlineSnapshot(
      `[TypeError: Invalid \`store\`: other parties read it, so it keeps no key pair of a guest account. Use IndexedDB in a browser, or \`Store.file\`.]`,
    )
  })
})

describe('Actions.guest.session in other processes', () => {
  /** Bundles `lines`, a program that imports this folder's modules, for Node to run. */
  async function bundle(lines: readonly string[]) {
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: lines.join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    return output.outputFiles[0]!.text
  }

  /** Runs `program` in Node with `args`, and resolves with its output. */
  function run(program: string, args: readonly string[] = []) {
    return new Promise<string>((resolve, reject) => {
      const child = ChildProcess.spawn(process.execPath, [
        '--input-type=module',
        ...args,
      ])
      let stderr = ''
      let stdout = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr))
      })
      child.stdin.end(program)
    })
  }

  test('keeps one guest account for two processes that create it at once on `Store.file`', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    // Each process runs Node with its global `navigator`, whose Web Locks span only that process.
    // The read of the guest account's entry takes 200 milliseconds, so both reads overlap without
    // the file's lock. Both processes start once both are ready. The wait ends after 10 seconds.
    const program = await bundle([
      "import * as Fs from 'node:fs/promises'",
      "import * as Path from 'node:path'",
      "import * as Accounts from '../Accounts.ts'",
      "import * as Store from '../Store.ts'",
      "import * as Guest from './guest.ts'",
      `const path = ${JSON.stringify(path)}`,
      'const file = Store.file(path)',
      'const store = Store.from({',
      '  ...file,',
      '  async getItem(key) {',
      '    const value = await file.getItem(key)',
      "    if (key.startsWith('tempo-id:guest:')) await new Promise((resolve) => setTimeout(resolve, 200))",
      '    return value',
      '  },',
      '})',
      "await Fs.writeFile(Path.join(Path.dirname(path), 'ready-' + crypto.randomUUID()), '')",
      'for (let attempt = 0; ; attempt++) {',
      "  const ready = (await Fs.readdir(Path.dirname(path))).filter((name) => name.startsWith('ready-'))",
      '  if (ready.length === 2) break',
      "  if (attempt > 1_000) throw new Error('The other process never started.')",
      '  await new Promise((resolve) => setTimeout(resolve, 10))',
      '}',
      "const session = await Guest.session(Accounts.from({ chain: 4217, clientId: 'cli:guest-example', store, url: 'http://127.0.0.1:9' }))",
      'console.log(session.address)',
    ])

    const addresses = await Promise.all([run(program), run(program)])
    const kept = await Guest.get(config(Store.file(path)))
    await Fs.rm(directory, { force: true, recursive: true })

    expect([
      addresses[0]!.trim() === addresses[1]!.trim(),
      addresses[0]!.trim() === kept,
    ]).toMatchInlineSnapshot(`
      [
        true,
        true,
      ]
    `)
  }, 60_000)

  test('refuses to create a guest account in a runtime without Web Locks, on a store without `lock`', async () => {
    // The program runs in Node without `navigator`, as a runtime without Web Locks. The store has
    // no `lock`, so nothing serializes two creations of the guest account.
    const program = await bundle([
      "import * as Accounts from '../Accounts.ts'",
      "import * as Store from '../Store.ts'",
      "import * as Guest from './guest.ts'",
      'const memory = Store.memory()',
      'const store = Store.from({ getItem: memory.getItem, json: true, private: true, removeItem: memory.removeItem, setItem: memory.setItem })',
      "const config = Accounts.from({ chain: 4217, clientId: 'cli:guest-example', store, url: 'http://127.0.0.1:9' })",
      'const error = await Guest.session(config).catch((error) => error)',
      'console.log(JSON.stringify({ address: (await Guest.get(config)) ?? null, error: error.message, locks: typeof navigator }))',
    ])

    const output = await run(program, ['--no-experimental-global-navigator'])

    expect(JSON.parse(output)).toMatchInlineSnapshot(`
      {
        "address": null,
        "error": "Invalid \`store\`: the runtime has no Web Locks, and the store has no \`lock\`, so two callers could create two guest accounts. Use a store with \`lock\`.",
        "locks": "undefined",
      }
    `)
  }, 60_000)
})

describe('Actions.guest.account', () => {
  test("signs a transaction as the root account, with a prehashed P256 envelope of the store's key pair", async () => {
    const auth = config()
    const session = await Guest.session(auth)
    const envelope = Guest.check(transaction(), payment)

    const signed = TxEnvelopeTempo.deserialize(
      (await Guest.sign(envelope, {
        account: Guest.account(auth, { session }),
      })) as TxEnvelopeTempo.Serialized,
    )

    expect([
      signed.signature?.type,
      signed.signature?.type === 'p256' && signed.signature.prehash,
      SignatureEnvelope.verify(signed.signature!, {
        address: session.address,
        payload: TxEnvelopeTempo.getSignPayload(envelope),
      }),
    ]).toMatchInlineSnapshot(`
      [
        "p256",
        true,
        true,
      ]
    `)
  })

  test('throws `SignedOutError` once `disconnect` forgets the key pair', async () => {
    const auth = config()
    const session = await Guest.session(auth)
    const account = Guest.account(auth, { session })
    await Guest.disconnect(auth)

    const error = await account
      .sign({ hash: `0x${'00'.repeat(32)}` })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Accounts.SignedOutError)
    expect(await Guest.get(auth)).toMatchInlineSnapshot(`undefined`)
  })
})

describe('Accounts.create with guest', () => {
  /** Returns an instance with the `device` plugin whose Tempo ID never answers, and its requests. */
  function create(guest: Accounts.Config['guest']) {
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      fetch: (input, init) => {
        requests.push(
          `${new URL(String(input)).pathname} ${String(init?.body)}`,
        )
        return globalThis.fetch(input, init)
      },
      guest,
      plugins: [device({ onCode: () => {} })],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    return { accounts, requests }
  }

  test('`auto` starts the guest session at a sign-in without a session, with no request, and `signOut` keeps the guest account', async () => {
    const { accounts, requests } = create('auto')

    const session = await accounts.device.signIn()
    const status = accounts.session.status.get().status
    await accounts.signOut()
    const kept = await accounts.guest.get()
    const again = await accounts.device.signIn()

    expect([
      Session.guest(session),
      status,
      kept === session.address,
      again.address === session.address,
      requests,
    ]).toMatchInlineSnapshot(`
      [
        true,
        "signedIn",
        true,
        true,
        [],
      ]
    `)
  })

  test('`guest.disconnect` forgets the guest account, and signs out its session', async () => {
    const { accounts } = create('auto')
    const session = await accounts.device.signIn()

    await accounts.guest.disconnect()
    const status = accounts.session.status.get().status
    const address = await accounts.guest.get()
    const next = await accounts.device.signIn()

    expect([status, address, next.address === session.address])
      .toMatchInlineSnapshot(`
      [
        "signedOut",
        undefined,
        false,
      ]
    `)
  })

  test('`offer` adds `guest=offer` to the code request', async () => {
    const { accounts, requests } = create('offer')

    await accounts.device.signIn().catch(() => undefined)

    expect(requests.map((entry) => entry.includes('guest=offer')))
      .toMatchInlineSnapshot(`
      [
        true,
      ]
    `)
  })

  test('types a guest session of a sign-in only for an instance with `guest`', () => {
    const options = {
      clientId: 'cli:guest-example',
      plugins: [device({ onCode: () => {} }), dialog(), redirect()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    } as const
    const plain = Accounts.create(options)
    const guest = Accounts.create({ ...options, guest: 'offer' })

    expectTypeOf<
      Awaited<ReturnType<typeof plain.device.signIn>>
    >().toEqualTypeOf<Session.Session>()
    expectTypeOf<
      Awaited<ReturnType<typeof plain.redirect.signIn>>
    >().toEqualTypeOf<Session.Session | undefined>()
    // The calls are never made, so their types alone are read.
    const plainSignIn = () => plain.dialog.signIn()
    const guestSignIn = () => guest.dialog.signIn()
    expectTypeOf<
      Awaited<ReturnType<typeof plainSignIn>>
    >().not.toExtend<Session.GuestSession>()
    expectTypeOf<
      Awaited<ReturnType<typeof guest.device.signIn>>
    >().toEqualTypeOf<Session.GuestSession | Session.Session>()
    expectTypeOf<Awaited<ReturnType<typeof guestSignIn>>>().toExtend<
      Session.GuestSession | Session.Session
    >()
    expectTypeOf<Session.GuestSession>().toExtend<
      Awaited<ReturnType<typeof guestSignIn>>
    >()
  })

  test('`auto` honors an aborted signal, and starts no guest session', async () => {
    const { accounts, requests } = create('auto')
    const reason = new Error('Cancelled.')

    const error = await accounts.device
      .signIn({ signal: AbortSignal.abort(reason) })
      .catch((error: unknown) => error)

    expect([
      error === reason,
      await accounts.session.get(),
      await accounts.guest.get(),
      requests,
    ]).toMatchInlineSnapshot(`
      [
        true,
        undefined,
        undefined,
        [],
      ]
    `)
  })

  test("`pay` of a new instance reads the stored session first, so a signed-in user's payment takes no guest path", async () => {
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","cli:guest-example",4217]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'auto',
      store,
      url: 'http://127.0.0.1:9',
    })

    // Node holds no page, so the payment of the signed-in user rejects. A guest payment would start
    // the guest session, and create its key pair, first.
    await accounts.pay(payment).catch(() => undefined)

    expect([
      (await accounts.session.get())?.user?.id,
      await accounts.guest.get(),
    ]).toMatchInlineSnapshot(`
      [
        "user_1",
        undefined,
      ]
    `)
  })

  test('`pay` of `auto` with an aborted signal rejects with its reason, and starts no guest session', async () => {
    const { accounts, requests } = create('auto')
    const reason = new Error('Cancelled.')

    const error = await accounts
      .pay({ ...payment, signal: AbortSignal.abort(reason) })
      .catch((error: unknown) => error)

    expect([
      error === reason,
      await accounts.session.get(),
      await accounts.guest.get(),
      requests,
    ]).toMatchInlineSnapshot(`
      [
        true,
        undefined,
        undefined,
        [],
      ]
    `)
  })

  test("`pay` of `auto` starts no guest session when a plugin's challenge signs the user in with the payment", async () => {
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'auto',
      // A challenge hook, as the `siwe` plugin's in a page, whose message the app's routes issue.
      plugins: [
        Plugin.from({
          hooks: {
            challenge: () => ({
              message: () => Promise.resolve('Sign in to Example.'),
              settle: () => Promise.resolve({}),
            }),
          },
          id: 'challenge',
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // Node holds no page, so the payment with the challenge rejects before it opens.
    const error = await accounts.pay(payment).catch((error: unknown) => error)

    expect([
      error instanceof Error && error.name,
      await accounts.session.get(),
      await accounts.guest.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Actions.account.PageRequiredError",
        undefined,
        undefined,
      ]
    `)
  })

  test('`pay` of `auto` starts no guest session after a sign-out during the read of the stored session', async () => {
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const reading = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'auto',
      // The first read of the stored session waits for the gate.
      store: Store.from({
        ...memory,
        getItem: async (key) => {
          if (!key.startsWith('tempo-id:guest:')) {
            reading.resolve()
            await gate.promise
          }
          return await memory.getItem(key)
        },
      }),
      url: 'http://127.0.0.1:9',
    })

    const pending = accounts.pay(payment).catch((error: unknown) => error)
    await reading.promise
    const signedOut = accounts.signOut()
    gate.resolve()
    await signedOut
    const error = await pending

    expect([
      error instanceof Error ? error.name : error,
      accounts.session.status.get().status,
      await accounts.session.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Accounts.SupersededError",
        "signedOut",
        undefined,
      ]
    `)
  })

  test('`auto` starts no guest session for a sign-in with a challenge, which signs in through Tempo ID', async () => {
    const { accounts, requests } = create('auto')
    const shown = DefaultAccounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'auto',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    // Nothing listens at Tempo ID's URL, so the device sign-in rejects after its request. Node holds
    // no page, so the dialog's sign-in rejects before it opens.
    const device = await accounts.device
      .signIn({ challenge: 'Sign in to Example.' })
      .catch((error: unknown) => error)
    const dialog = await shown.dialog
      .signIn({ challenge: 'Sign in to Example.' })
      .catch((error: unknown) => error)

    expect([
      device instanceof Error && device.name,
      requests.map((entry) => entry.split(' ')[0]),
      dialog instanceof Error && dialog.name,
      await accounts.session.get(),
      await shown.session.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Accounts.RequestError",
        [
          "/device/code",
        ],
        "Actions.dialog.PageRequiredError",
        undefined,
        undefined,
      ]
    `)
  })

  test('`auto` starts no guest session after a sign-out during the read of the stored session', async () => {
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const reading = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'auto',
      plugins: [device({ onCode: () => {} })],
      // The first read of the stored session waits for the gate.
      store: Store.from({
        ...memory,
        getItem: async (key) => {
          if (!key.startsWith('tempo-id:guest:')) {
            reading.resolve()
            await gate.promise
          }
          return await memory.getItem(key)
        },
      }),
      url: 'http://127.0.0.1:9',
    })

    const pending = accounts.device.signIn().catch((error: unknown) => error)
    await reading.promise
    const signedOut = accounts.signOut()
    gate.resolve()
    await signedOut
    const error = await pending

    expect([
      error instanceof Error ? error.name : error,
      accounts.session.status.get().status,
      await accounts.session.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Accounts.SupersededError",
        "signedOut",
        undefined,
      ]
    `)
  })

  test('a guest session aborted during the creation of its key pair rejects with the reason, and commits nothing', async () => {
    const memory = Store.memory()
    const controller = new AbortController()
    const reason = new Error('Cancelled.')
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'offer',
      plugins: [device({ onCode: () => {} })],
      // The read of the guest account's entry aborts the sign-in.
      store: Store.from({
        ...memory,
        getItem: async (key) => {
          if (key.startsWith('tempo-id:guest:')) controller.abort(reason)
          return await memory.getItem(key)
        },
      }),
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    const error = await SignIn.guest(
      { config: accounts.config },
      {
        change: {
          commit: () => Promise.reject(new Error('Committed.')),
          fail: (error) => Promise.reject(error),
        },
        signal: controller.signal,
      },
    ).catch((error: unknown) => error)

    expect(error === reason).toMatchInlineSnapshot(`true`)
  })

  test.for([
    ['the default dialog', []],
    ['dialog()', [dialog()]],
  ] as const)(
    '`dialog.session` of %s returns no guest session',
    async ([, plugins]) => {
      const accounts = DefaultAccounts.create({
        chain: 4217,
        clientId: 'cli:guest-example',
        guest: 'auto',
        plugins,
        store: Store.memory(),
        url: 'http://127.0.0.1:9',
      })
      const session = await accounts.dialog.signIn()

      const shown = await accounts.dialog.session()

      expect([Session.guest(session), shown]).toMatchInlineSnapshot(`
        [
          true,
          null,
        ]
      `)
    },
  )
})
