/**
 * Tests guest payments without a server: the refusals before any request, the guest account that
 * the store keeps, the check of each transaction that Tempo ID prepares, and the purchase machine,
 * whose effects each test records.
 * @module
 */
import { Secp256k1 } from 'ox'
import { KeyAuthorization, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { Actions } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'
import * as AccountActions from './account.js'
import * as Guest from './guest.js'
import { machines } from './guest.js'

/** MACH on Tempo mainnet. */
const mach = '0x20c000000000000000000000f37de3740adec032'

/** The recipient of each payment. */
const to = '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326'

/** The URL of a Tempo ID that no test reaches, since each call ends before a request. */
const url = 'http://127.0.0.1:1'

describe('Actions.guest.pay', () => {
  test('refuses another token, another chain, and invalid fields before any request', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: Store.memory(),
      url,
    })
    const options = { amount: '1', to, token: 'mach' } as const

    const errors = await Promise.all(
      [
        { ...options, token: 'ousd' },
        { ...options, token: '0x20c0000000000000000000000000000000000000' },
        { ...options, chainId: 42431 },
        { ...options, amount: '0' },
        { ...options, to: '0x123' as const },
      ].map((entry) =>
        Guest.pay(auth, entry).then(
          () => undefined,
          (error: Accounts.RequestError) => ({
            field: error.field,
            reason: error.reason,
          }),
        ),
      ),
    )

    expect(errors).toMatchInlineSnapshot(`
      [
        {
          "field": "token",
          "reason": "unsupported_token",
        },
        {
          "field": "token",
          "reason": "unsupported_token",
        },
        {
          "field": "chainId",
          "reason": "invalid_chain",
        },
        {
          "field": "amount",
          "reason": "invalid_field",
        },
        {
          "field": "to",
          "reason": "invalid_field",
        },
      ]
    `)
    expect(await Guest.get(auth)).toBeUndefined()
  })

  test('creates the guest account, which holds no MACH, and opens the purchase page only from a page', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: Store.memory(),
      url,
    })

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AccountActions.PageRequiredError)
    expect((error as Error).message).toMatchInlineSnapshot(
      `"No browser window: the purchase page of a guest payment opens only from a page. Pay as a guest from a page, or with a balance that holds the payment."`,
    )
    expect(await Guest.get(auth)).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('keeps one guest account for each payment, until `disconnect` forgets it', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: Store.memory(),
      url,
    })
    const options = { amount: '1', to, token: 'MACH' } as const

    await Guest.pay(auth, options).catch(() => undefined)
    const first = await Guest.get(auth)
    await Guest.disconnect(auth)
    const forgotten = await Guest.get(auth)
    await Guest.pay(auth, options).catch(() => undefined)
    const created = await Guest.get(auth)

    expect(first).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(forgotten).toBeUndefined()
    expect(created).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(created).not.toBe(first)
  })

  test('refuses a store that keeps each value as JSON', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: { ...Store.memory(), json: true },
      url,
    })

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(TypeError)
  })
})

describe('Actions.guest.check', () => {
  /** The private key of the signature of a transaction that arrives signed. */
  const privateKey =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

  /** Returns the call of a MACH transfer, with the requested fields unless `options` names others. */
  const transfer = (options: transfer.Options = {}) =>
    Actions.token.transfer.call({
      amount: options.amount ?? 1_000_000n,
      memo: options.memo,
      to: options.to ?? to,
      token: options.token ?? mach,
    })

  /** The transaction that Tempo ID prepares for the requested transfer. */
  const envelope = TxEnvelopeTempo.from({
    calls: [transfer()],
    chainId: 4217,
    feePayerSignature: null,
    gas: 100_000n,
    maxFeePerGas: 1n,
    nonceKey: 1n,
  })

  /** The memo of the transfers with a memo, as hex. */
  const memo = '0x6f726465722d313233'

  const rows = [
    {
      expected: 'signs',
      name: 'signs the requested transfer',
      transaction: TxEnvelopeTempo.serialize(envelope),
    },
    {
      expected: 'signs',
      memo,
      name: 'signs the requested transfer with a memo',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer({ memo })],
      }),
    },
    {
      expected: 'it is no Tempo transaction.',
      name: 'refuses a value that is no Tempo transaction',
      transaction: '0x1234',
    },
    {
      expected: 'its call is not the requested transfer.',
      name: 'refuses a transfer of another token',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [
          transfer({ token: '0x20c0000000000000000000000000000000000000' }),
        ],
      }),
    },
    {
      expected: 'its call is not the requested transfer.',
      name: 'refuses a transfer of another amount',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer({ amount: 2_000_000n })],
      }),
    },
    {
      expected: 'its call is not the requested transfer.',
      name: 'refuses a transfer to another recipient',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer({ to: mach })],
      }),
    },
    {
      expected: 'its call is not the requested transfer.',
      memo,
      name: 'refuses a transfer without the requested memo',
      transaction: TxEnvelopeTempo.serialize(envelope),
    },
    {
      expected: 'its call is not the requested transfer.',
      name: 'refuses a transfer that sends value',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [{ ...transfer(), value: 1n }],
      }),
    },
    {
      expected: 'it makes more than one call.',
      name: 'refuses an extra call',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer(), transfer()],
      }),
    },
    {
      expected: 'it changes the account.',
      name: 'refuses a key authorization',
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        keyAuthorization: KeyAuthorization.from({
          address: '0xbe95c3f554e9fc85ec51be69a3d807a0d55bcf2c',
          chainId: 4217n,
          expiry: 1234567890,
          limits: [{ limit: 10_000_000n, token: mach }],
          signature: SignatureEnvelope.from(
            Secp256k1.sign({ payload: '0x01', privateKey }),
          ),
          type: 'secp256k1',
        }),
      }),
    },
    {
      expected: 'it holds a signature.',
      name: 'refuses a transaction that is already signed',
      transaction: TxEnvelopeTempo.serialize(envelope, {
        signature: SignatureEnvelope.from(
          Secp256k1.sign({
            payload: TxEnvelopeTempo.getSignPayload(envelope),
            privateKey,
          }),
        ),
      }),
    },
    {
      expected: 'no sponsor pays its fee.',
      name: "refuses a transaction without the sponsor's marker",
      transaction: TxEnvelopeTempo.serialize({
        ...envelope,
        feePayerSignature: undefined,
      }),
    },
    {
      expected: 'it is for another chain.',
      name: 'refuses a transaction on another chain',
      transaction: TxEnvelopeTempo.serialize({ ...envelope, chainId: 42431 }),
    },
  ] as const

  for (const row of rows)
    test(row.name, () => {
      const result = (() => {
        try {
          Guest.check(row.transaction, {
            amount: 1_000_000n,
            chainId: 4217,
            memo: 'memo' in row ? row.memo : undefined,
            to,
          })
          return 'signs'
        } catch (error) {
          const { field, message } = error as Accounts.RequestError
          return field === 'transaction'
            ? message
                .replace('Invalid prepared transaction: ', '')
                .replace(
                  ' The guest account signs only the requested transfer. Try again.',
                  '',
                )
            : message
        }
      })()

      expect(result).toBe(row.expected)
    })
})

describe('machines.purchase', () => {
  test('opens the popup at once within a gesture, and ends funded once a read holds the amount', async () => {
    const purchase = start({ balances: [1_000_000n] })

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    const watching = purchase.actor.getSnapshot().value
    purchase.actor.send({ type: 'popup.return' })
    await waitFor(purchase.actor, (snapshot) => snapshot.status === 'done')

    expect(watching).toMatchInlineSnapshot(`"watching"`)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"funded"`)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
        "balance.start",
      ]
    `)
  })

  test('offers the popup outside a gesture, and opens it at Continue after the offer closes', () => {
    const purchase = start()

    purchase.actor.send({ activated: false, type: 'purchase.start' })
    const offering = purchase.actor.getSnapshot().value
    purchase.actor.send({ type: 'offer.continue' })

    expect(offering).toMatchInlineSnapshot(`"offering"`)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"watching"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "offer.start",
        "offer.stop",
        "popup.start",
      ]
    `)
    purchase.actor.stop()
  })

  test('ends cancelled at a Cancel of either dialog or a close of the popup, and closes its effects', () => {
    const results = (
      [
        { activated: false, type: 'offer.cancel' },
        { activated: true, type: 'dialog.cancel' },
        { activated: true, type: 'popup.close' },
      ] as const
    ).map((row) => {
      const purchase = start()

      purchase.actor.send({ activated: row.activated, type: 'purchase.start' })
      purchase.actor.send({ type: row.type })

      return {
        effects: purchase.effects,
        status: machines.status(purchase.actor.getSnapshot()),
      }
    })

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "effects": [
            "offer.start",
            "offer.stop",
          ],
          "status": "cancelled",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "status": "cancelled",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "status": "cancelled",
        },
      ]
    `)
  })

  test('ends aborted at an abort before the start, and opens no popup', () => {
    const purchase = start()

    purchase.actor.send({ type: 'purchase.abort' })
    const startable = purchase.actor
      .getSnapshot()
      .can({ activated: true, type: 'purchase.start' })

    expect(startable).toBe(false)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"aborted"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`[]`)
  })

  test('ends aborted at an abort in each state, and closes the effect of the state', async () => {
    const offering = start()
    offering.actor.send({ activated: false, type: 'purchase.start' })
    const watching = start()
    watching.actor.send({ activated: true, type: 'purchase.start' })
    const reading = start({ balances: [0n] })
    reading.actor.send({ activated: true, type: 'purchase.start' })
    reading.actor.send({ type: 'popup.return' })
    const synchronous = [offering, watching, reading].map(abort)
    const waiting = start({
      balances: [0n],
      delays: { pollInterval: 60_000 },
    })
    waiting.actor.send({ activated: true, type: 'purchase.start' })
    waiting.actor.send({ type: 'popup.return' })
    await waitFor(waiting.actor, (snapshot) =>
      snapshot.matches({ polling: 'waiting' }),
    )

    const results = [...synchronous, abort(waiting)]

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "effects": [
            "offer.start",
            "offer.stop",
          ],
          "from": "offering",
          "status": "aborted",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "from": "watching",
          "status": "aborted",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
            "balance.start",
            "balance.stop",
          ],
          "from": "polling.reading",
          "status": "aborted",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
            "balance.start",
          ],
          "from": "polling.waiting",
          "status": "aborted",
        },
      ]
    `)
  })

  test('ends blocked when the browser blocks the popup', () => {
    const purchase = start({ blocked: true })

    purchase.actor.send({ activated: true, type: 'purchase.start' })

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"blocked"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('ends failed with the refusal of the page, and closes the popup', () => {
    const purchase = start()
    const error = new Error('The user canceled the purchase.')

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    purchase.actor.send({ error, type: 'popup.refuse' })

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"failed"`)
    expect(purchase.actor.getSnapshot().context.error).toBe(error)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('ends failed with the error of a read', async () => {
    const purchase = start({ balances: [] })

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    purchase.actor.send({ type: 'popup.return' })
    await waitFor(purchase.actor, (snapshot) => snapshot.status === 'done')

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"failed"`)
    expect(
      (purchase.actor.getSnapshot().context.error as Error).message,
    ).toMatchInlineSnapshot(`"The read failed."`)
  })

  test('reads the balance again after the interval, until a read holds the amount', async () => {
    const purchase = start({
      balances: [0n, 999_999n, 1_000_000n],
      delays: { pollInterval: 0 },
    })

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    purchase.actor.send({ type: 'popup.return' })
    await waitFor(purchase.actor, (snapshot) => snapshot.status === 'done')

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"funded"`)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
        "balance.start",
        "balance.start",
        "balance.start",
      ]
    `)
  })

  test('ends short once the timeout passes without a read that holds the amount', async () => {
    const purchase = start({
      balances: [0n],
      delays: { pollInterval: 60_000, pollTimeout: 0 },
    })

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    purchase.actor.send({ type: 'popup.return' })
    await waitFor(purchase.actor, (snapshot) => snapshot.status === 'done')

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"short"`)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
        "balance.start",
      ]
    `)
  })

  test('reaches every state along its shortest paths, handles every event type, and ends with a context that agrees with its state', () => {
    const snapshots = getShortestPaths(machines.purchase, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map(name))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )
    // Only `failed` holds an error.
    const disagreeing = snapshots.filter(
      (snapshot) =>
        (machines.status(snapshot) === 'failed') !==
        (snapshot.context.error !== undefined),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "aborted",
        "blocked",
        "cancelled",
        "failed",
        "funded",
        "idle",
        "offering",
        "polling.reading",
        "polling.waiting",
        "short",
        "watching",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    expect(disagreeing).toEqual([])
  })

  /** The events of the machine's timers and of its read of the balance. */
  const internal = {
    done: (output: bigint) => ({
      output,
      type: 'xstate.done.actor.balance' as const,
    }),
    error: {
      error: new Error('The read failed.'),
      type: 'xstate.error.actor.balance',
    },
    pollInterval: {
      type: 'xstate.after.pollInterval.purchase.polling.waiting',
    },
    pollTimeout: { type: 'xstate.after.pollTimeout.purchase.polling' },
  } as const

  /** A machine event, or the event of a timer or of the read. */
  type Step =
    | machines.purchase.Event
    | ReturnType<typeof internal.done>
    | typeof internal.error
    | typeof internal.pollInterval
    | typeof internal.pollTimeout

  /** The events of each type that the runner, a timer, or the read sends from a snapshot. */
  const events: {
    [type in Step['type']]: (
      snapshot: machines.purchase.Snapshot,
    ) => readonly Step[]
  } = {
    'dialog.cancel': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'dialog.cancel' }] : [],
    'offer.cancel': (snapshot) =>
      snapshot.matches('offering') ? [{ type: 'offer.cancel' }] : [],
    'offer.continue': (snapshot) =>
      snapshot.matches('offering') ? [{ type: 'offer.continue' }] : [],
    'popup.blocked': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'popup.blocked' }] : [],
    'popup.close': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'popup.close' }] : [],
    'popup.refuse': (snapshot) =>
      snapshot.matches('watching')
        ? [{ error: new Error('Refused.'), type: 'popup.refuse' }]
        : [],
    'popup.return': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'popup.return' }] : [],
    'purchase.abort': () => [{ type: 'purchase.abort' }],
    'purchase.start': (snapshot) =>
      snapshot.matches('idle')
        ? [
            { activated: false, type: 'purchase.start' },
            { activated: true, type: 'purchase.start' },
          ]
        : [],
    'xstate.after.pollInterval.purchase.polling.waiting': (snapshot) =>
      snapshot.matches({ polling: 'waiting' }) ? [internal.pollInterval] : [],
    'xstate.after.pollTimeout.purchase.polling': (snapshot) =>
      snapshot.matches('polling') ? [internal.pollTimeout] : [],
    'xstate.done.actor.balance': (snapshot) =>
      snapshot.matches({ polling: 'reading' })
        ? [internal.done(0n), internal.done(1_000_000n)]
        : [],
    'xstate.error.actor.balance': (snapshot) =>
      snapshot.matches({ polling: 'reading' }) ? [internal.error] : [],
  }

  /** The traversal of the machine's graph. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: machines.purchase.Snapshot) =>
      Object.values(events).flatMap((fn) =>
        fn(snapshot),
      ) as readonly machines.purchase.Event[],
    input: { required: 1_000_000n },
    // JSON holds no bigint, so the output of a read serializes as its decimal string.
    serializeEvent: (event: machines.purchase.Event) =>
      JSON.stringify(event, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    serializeState: (snapshot: machines.purchase.Snapshot) =>
      JSON.stringify(snapshot.value),
  }

  /**
   * Starts a purchase of 1 MACH, with `delays` in place of its own, and records the start and stop
   * of each invoked effect, in order. Each read of the balance returns the next of `balances`, and
   * a read past them fails. With `blocked`, the popup reports that the browser blocked it.
   */
  function start(options: start.Options = {}) {
    const balances = [...(options.balances ?? [])]
    const effects: string[] = []
    const actor = createActor(
      machines.purchase.provide({
        actors: {
          balance: fromPromise((args) => {
            effects.push('balance.start')
            args.signal.addEventListener('abort', () =>
              effects.push('balance.stop'),
            )
            const balance = balances.shift()
            if (balance === undefined)
              return Promise.reject(new Error('The read failed.'))
            return Promise.resolve(balance)
          }),
          offer: fromCallback(() => {
            effects.push('offer.start')
            return () => effects.push('offer.stop')
          }),
          popup: fromCallback<machines.purchase.Event>((args) => {
            effects.push('popup.start')
            if (options.blocked) args.sendBack({ type: 'popup.blocked' })
            return () => effects.push('popup.stop')
          }),
        },
        delays: options.delays ?? {},
      }),
      { input: { required: 1_000_000n } },
    ).start()

    return { actor, effects }
  }

  /** Sends `purchase.abort` to `purchase`, and returns its state before, its status, and its effects. */
  function abort(purchase: ReturnType<typeof start>) {
    const from = name(purchase.actor.getSnapshot())
    purchase.actor.send({ type: 'purchase.abort' })
    return {
      effects: purchase.effects,
      from,
      status: machines.status(purchase.actor.getSnapshot()),
    }
  }

  /** Returns the name of the state of `snapshot`, with the substate of `polling`. */
  function name(snapshot: machines.purchase.Snapshot) {
    const { value } = snapshot
    return typeof value === 'string' ? value : `polling.${value.polling}`
  }
})

declare namespace start {
  type Options = {
    /** The balance of each read, in base units. */
    balances?: readonly bigint[] | undefined
    /** Whether the browser blocks the popup. */
    blocked?: boolean | undefined
    /** Milliseconds of each delay of the purchase, in place of the module's. */
    delays?:
      | {
          /** The wait between two reads. */
          pollInterval?: number
          /** The time that the purchased MACH has to arrive. */
          pollTimeout?: number
        }
      | undefined
  }
}

declare namespace transfer {
  type Options = {
    /** The amount, in base units. Defaults to 1 MACH. */
    amount?: bigint | undefined
    /** The memo, as hex. Absent for a transfer without one. */
    memo?: `0x${string}` | undefined
    /** The recipient. Defaults to the requested recipient. */
    to?: `0x${string}` | undefined
    /** The token. Defaults to MACH. */
    token?: `0x${string}` | undefined
  }
}
