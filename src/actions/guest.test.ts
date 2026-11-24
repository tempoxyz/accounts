/**
 * Tests the guest account without a server: `Actions.guest.check`, which accepts only the requested
 * transfer from a transaction that Tempo ID's page posts, the guest session and its key pair in the
 * store, the signature of its account, and the guest session of an instance with `guest`.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import {
  Address,
  Base64,
  Bytes,
  Hash,
  Hex,
  P256,
  PublicKey,
  Signature,
} from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import {
  describe,
  expect,
  expectTypeOf,
  onTestFinished,
  test,
} from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as DefaultAccounts from '../internal/DefaultAccounts.js'
import * as DeviceStore from '../internal/DeviceStore.js'
import * as SignIn from '../internal/SignIn.js'
import { device, dialog, redirect } from '../plugins/index.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import * as Postgres from '../stores/Postgres.js'
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

  test.for([
    [
      'accepts a guest-paid fee in the quoted fee token',
      { feePayerSignature: undefined, feeToken: ousd },
      ousd,
      true,
    ],
    [
      'refuses a guest-paid fee in another fee token than the quoted one',
      {
        feePayerSignature: undefined,
        feeToken: '0x20c0000000000000000000000000000000000001',
      },
      ousd,
      false,
    ],
    [
      'refuses a guest-paid fee in a token that is no TIP-20 token, without a quoted fee token',
      {
        feePayerSignature: undefined,
        feeToken: '0x000000000000000000000000000000000000dEaD',
      },
      undefined,
      false,
    ],
    [
      'accepts a sponsored fee in any fee token, which the guest account never pays',
      { feeToken: '0x20c0000000000000000000000000000000000001' },
      ousd,
      true,
    ],
  ] as const)('%s', ([, fields, feeToken, accepted]) => {
    const check = () =>
      Guest.check(transaction(fields as never), { ...payment, feeToken })

    if (accepted) expect(check().calls).toHaveLength(1)
    else expect(check).toThrow('its fee token is not the quoted one.')
  })

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

  test('accepts a transfer of a TIP-20 token that no chain lists, by its address', () => {
    const token = '0x20c00000000000000000000000000000000004d2'
    const value = transaction({
      calls: [TokenActions.transfer.call({ amount: 1_500_000n, to, token })],
    })

    const envelope = Guest.check(value, { ...payment, amount: '1.5', token })

    expect(envelope.calls).toHaveLength(1)
  })

  test('refuses a token address that is no TIP-20 token', () => {
    const token = '0x000000000000000000000000000000000000dEaD'
    const value = transaction({
      calls: [TokenActions.transfer.call({ amount: 1_500_000n, to, token })],
    })

    expect(() =>
      Guest.check(value, { ...payment, amount: '1.5', token }),
    ).toThrow('its token is no TIP-20 token.')
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

describe('Actions.guest.session on each store preset', () => {
  /** Returns the platform capability of `expo-secure-store` on a device: strings at keys. */
  function secureStore() {
    const values = new Map<string, string>()
    return {
      deleteItemAsync(key: string) {
        values.delete(key)
        return Promise.resolve()
      },
      getItemAsync: (key: string) => Promise.resolve(values.get(key) ?? null),
      setItemAsync(key: string, value: string) {
        values.set(key, value)
        return Promise.resolve()
      },
    } satisfies DeviceStore.create.SecureStore
  }

  test.for([
    // A store that keeps values as they are keeps a non-extractable WebCrypto key pair, as the
    // default IndexedDB store of a page does.
    ['Store.memory', () => ({ store: Store.memory() }), 'webCrypto'],
    [
      'Store.file',
      () => {
        const path = Path.join(
          Os.tmpdir(),
          `accounts-${crypto.randomUUID()}`,
          'store.json',
        )
        return { store: Store.file(path) }
      },
      'p256',
    ],
    [
      "the `expo` preset's secure store",
      () => {
        const device = secureStore()
        // Another store on the same secure store reads the key pair back from its JSON.
        return {
          again: DeviceStore.create(device),
          store: DeviceStore.create(device),
        }
      },
      'p256',
    ],
  ] as const)(
    'creates a guest account that signs and persists on %s',
    async ([, create, type]) => {
      const { again, store } = create() as {
        again?: Store.Store
        store: Store.Store
      }

      const session = await Guest.session(config(store))
      const restored = await Guest.session(config(again ?? store))
      const signature = await Guest.account(config(again ?? store), {
        session,
      }).sign({ hash: `0x${'11'.repeat(32)}` })
      const stored = (await store.getItem(
        'tempo-id:guest:["http://127.0.0.1:9","cli:guest-example"]',
      )) as { privateKey?: unknown; type?: unknown } | undefined

      expect([
        restored.address === session.address,
        typeof signature,
        stored?.type === 'p256' ? 'p256' : 'webCrypto',
      ]).toEqual([true, 'string', type])
    },
  )

  test('refuses a shared store of JSON, such as `Store.postgres`, before any query', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const queries: string[] = []
    const store = Postgres.create({
      async query(text, values) {
        queries.push(text)
        return await database.query(text, [...values])
      },
    })

    const error = await Guest.session(config(store)).catch(
      (error: Error) => error.message,
    )

    expect([error, queries]).toMatchInlineSnapshot(`
      [
        "Invalid \`store\`: other parties read it, so it keeps no key pair of a guest account. Use IndexedDB in a browser, or \`Store.file\`.",
        [],
      ]
    `)
  })
})

describe('Actions.guest.request', () => {
  test('signs the checkout ID in the JSON and in the message, after `chain_id`, and keeps it across renewals', async () => {
    const auth = config()
    const options = {
      chainId,
      checkout: 'c8f2a1d4-3b6e-4f70-9a51-0d2e7c4b9f13',
      redirectUri: 'https://example.com/',
    }

    const first = await Guest.request(auth, options)
    const renewed = await Guest.request(auth, options)
    const json = JSON.parse(Base64.toString(first.value)) as {
      chain_id: number
      checkout: string
      client_id: string
      exp: number
      public_key: `0x${string}`
      redirect_uri: string
      signature: `0x${string}`
    }
    const message = [
      'tempo-id:guest',
      `chain_id=${json.chain_id}`,
      `checkout=${json.checkout}`,
      `client_id=${json.client_id}`,
      `exp=${json.exp}`,
      `redirect_uri=${json.redirect_uri}`,
    ].join('\n')
    const verified = P256.verify({
      payload: Hash.sha256(Bytes.fromString(message)),
      publicKey: PublicKey.fromHex(json.public_key),
      signature: Signature.from({
        r: Hex.toBigInt(Hex.slice(json.signature, 0, 32)),
        s: Hex.toBigInt(Hex.slice(json.signature, 32, 64)),
        yParity: 0,
      }),
    })
    const checkouts = [first, renewed].map(
      (entry) =>
        (JSON.parse(Base64.toString(entry.value)) as { checkout: string })
          .checkout,
    )

    expect({
      checkout: first.checkout,
      checkouts,
      keys: Object.keys(json),
      verified,
    }).toMatchInlineSnapshot(`
      {
        "checkout": "c8f2a1d4-3b6e-4f70-9a51-0d2e7c4b9f13",
        "checkouts": [
          "c8f2a1d4-3b6e-4f70-9a51-0d2e7c4b9f13",
          "c8f2a1d4-3b6e-4f70-9a51-0d2e7c4b9f13",
        ],
        "keys": [
          "chain_id",
          "checkout",
          "client_id",
          "exp",
          "public_key",
          "redirect_uri",
          "signature",
        ],
        "verified": true,
      }
    `)
  })

  test.for(['', 'a\nexp=0', 'a'.repeat(129)])(
    'refuses the checkout ID %j, before it signs',
    async (checkout) => {
      const store = Store.memory()

      const error = await Guest.request(config(store), {
        chainId,
        checkout,
        redirectUri: 'https://example.com/',
      }).catch((error: unknown) => error)

      expect([
        error instanceof TypeError,
        await Guest.get(config(store)),
      ]).toEqual([true, undefined])
    },
  )
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

  /**
   * Starts `program` in Node with an IPC channel, and returns the messages that it sends, a `send`
   * to it, and its output once it exits.
   */
  function start(program: string) {
    const child = ChildProcess.spawn(
      process.execPath,
      ['--input-type=module'],
      {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      },
    )
    const messages: string[] = []
    child.on('message', (message) => messages.push(String(message)))
    let stderr = ''
    let stdout = ''
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    const output = new Promise<string>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr))
      })
    })
    child.stdin!.end(program)
    return {
      messages,
      output,
      send: (message: string) => child.send(message),
    }
  }

  test('keeps one guest account for two processes that create it at once on `Store.file`', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    // Each process runs Node with its global `navigator`, whose Web Locks span only that process.
    // The parent steps both processes over IPC: each reports `ready` and waits for `go`, reports
    // `lock` when it asks for the file's lock, and reports `read` after its read of the guest
    // account's entry, then waits for `continue` before it creates the key pair.
    const program = await bundle([
      "import * as Accounts from '../Accounts.ts'",
      "import * as Store from '../Store.ts'",
      "import * as Guest from './guest.ts'",
      'const queue = []',
      'const waiters = []',
      "process.on('message', (message) => { const waiter = waiters.shift(); if (waiter) waiter(message); else queue.push(message) })",
      'const next = () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve)))',
      `const file = Store.file(${JSON.stringify(path)})`,
      'const store = Store.from({',
      '  ...file,',
      '  async getItem(key) {',
      '    const value = await file.getItem(key)',
      "    if (key.startsWith('tempo-id:guest:')) {",
      "      process.send('read')",
      '      await next()',
      '    }',
      '    return value',
      '  },',
      '  lock(name, fn) {',
      "    process.send('lock')",
      '    return file.lock(name, fn)',
      '  },',
      '})',
      "process.send('ready')",
      'await next()',
      "const session = await Guest.session(Accounts.from({ chain: 4217, clientId: 'cli:guest-example', store, url: 'http://127.0.0.1:9' }))",
      'console.log(session.address)',
      'process.disconnect()',
    ])
    const options = { timeout: 30_000 }

    const first = start(program)
    const second = start(program)
    await expect
      .poll(
        () =>
          first.messages.includes('ready') && second.messages.includes('ready'),
        options,
      )
      .toBe(true)
    // The first process reads the entry, which holds no key pair, under the file's lock.
    first.send('go')
    await expect.poll(() => first.messages.includes('read'), options).toBe(true)
    // The second process asks for the lock while the first holds it. Without the lock, it reads the
    // empty entry at once, so both create a key pair.
    second.send('go')
    await expect
      .poll(
        () =>
          second.messages.includes('lock') || second.messages.includes('read'),
        options,
      )
      .toBe(true)
    first.send('continue')
    await expect
      .poll(() => second.messages.includes('read'), options)
      .toBe(true)
    second.send('continue')
    const addresses = await Promise.all([first.output, second.output])
    const kept = await Guest.get(config(Store.file(path)))
    await Fs.rm(directory, { force: true, recursive: true })

    expect([addresses[0] === addresses[1], addresses[0] === kept])
      .toMatchInlineSnapshot(`
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

describe('Actions.guest.active', () => {
  const started = Session.from({
    address: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
    kind: 'guest',
    publicKey: '0x04',
    revision: 1,
  })

  test.for([
    ['the same guest session', started, true],
    ['no session, after a sign-out', undefined, false],
    [
      'another start of the same guest account, after a sign-out and a sign-in',
      { ...started, revision: 2 },
      false,
    ],
    [
      'another guest account',
      {
        ...started,
        address: '0x000000000000000000000000000000000000dEaD',
      },
      false,
    ],
  ] as const)('returns for %s', ([, current, expected]) => {
    expect(Guest.active({ current, started })).toBe(expected)
  })
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

  test('an instance without `guest` reads a stored guest session as signed out, and keeps it for an instance with `guest`', async () => {
    const store = Store.memory()
    const options = {
      chain: 4217,
      clientId: 'cli:guest-example',
      plugins: [device({ onCode: () => {} })],
      store,
      url: 'http://127.0.0.1:9',
    } as const
    const plain = Accounts.create(options)
    await plain.session.get()

    const session = await Accounts.create({
      ...options,
      guest: 'auto',
    }).device.signIn()
    // The instance on the same store hears the saved change, and reads the store again.
    const adopted = await plain.session.get()
    const hydrated = await Accounts.create(options).session.get()
    const restored = await Accounts.create({
      ...options,
      guest: 'auto',
    }).session.get()

    expect([
      adopted,
      plain.session.status.get().status,
      hydrated,
      restored?.address === session.address,
    ]).toMatchInlineSnapshot(`
      [
        undefined,
        "signedOut",
        undefined,
        true,
      ]
    `)
  })

  test('`pay` of `offer` without a session outside a page rejects with `SignedOutError`, and starts no guest session', async () => {
    const { accounts, requests } = create('offer')

    // Only a page shows the signed-out payment page, which offers Continue as guest.
    const error = await accounts.pay(payment).catch((error: unknown) => error)

    expect([error, await accounts.guest.get(), requests])
      .toMatchInlineSnapshot(`
        [
          [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
          undefined,
          [],
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

  test('`pay` of `offer` rejects after a sign-out during the read of the stored session, and starts no guest session', async () => {
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const reading = Promise.withResolvers<void>()
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'offer',
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
      await accounts.session.get(),
      await accounts.guest.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Accounts.SignedOutError",
        undefined,
        undefined,
      ]
    `)
  })

  test('Continue as guest of an offer whose change started before a sign-out rejects with `SupersededError`, and commits no guest session', async () => {
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:guest-example',
      guest: 'offer',
      plugins: [
        Plugin.from({
          actions: (context) => ({
            /** Starts a change, as `pay` of `offer` does before its read of the stored session. */
            start: () => context.session.change(),
          }),
          id: 'offer',
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const change = accounts.offer.start()
    await accounts.session.get()
    await accounts.signOut()

    // The selection of Continue as guest on the payment page starts the guest session.
    const error = await SignIn.guest(
      { config: accounts.config },
      { change },
    ).catch((error: unknown) => error)

    expect([
      error instanceof Error ? error.name : error,
      await accounts.session.get(),
    ]).toMatchInlineSnapshot(`
      [
        "Accounts.SupersededError",
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
