/**
 * Tests the guest account without a server: `Actions.guest.check`, which accepts only the requested
 * transfer from a transaction that Tempo ID's page posts, the guest session and its key pair in the
 * store, the signature of its account, and the guest session of an instance with `guest`.
 * @module
 */
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address, PublicKey } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { describe, expect, expectTypeOf, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as DefaultAccounts from '../internal/DefaultAccounts.js'
import { device, dialog, redirect } from '../plugins/index.js'
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
