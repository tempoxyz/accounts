/**
 * Tests that the account actions that send a credential to Tempo ID follow no redirect, so a redirect never
 * sends the request on to another origin, and the machine of an approval page's readiness and its
 * guest account's one signature.
 * @module
 */
import { createActor, fromPromise, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as AccountActions from './account.js'
import { machines } from './account.js'

describe('Actions.account.connection', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.connection(auth, { accessToken: 'token' }).catch(
      () => undefined,
    )

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/connection redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.connections', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.connections(auth).catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/account/connections redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.get', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.get(auth, { accessToken: 'token' }).catch(
      () => undefined,
    )

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/account redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.updateAccessKey', () => {
  test('refuses a negative limit and a repeated token before any request', async () => {
    const { auth, requests } = recording()
    const token = '0x20c0000000000000000000000000000000000000'
    const options = {
      accessKey: '0x9f1000000000000000000000000000000000f08',
      account: '0xff5deded16eb46018387144ff8bf41f26afb41af',
      chainId: 42431,
    } as const

    const errors = await Promise.all(
      [
        [{ limit: -1n, token }],
        [
          { limit: 1n, token },
          { limit: 2n, token: token.toUpperCase().replace('0X', '0x') },
        ],
        [
          { limit: 1n, token: '0x20c0' },
          { limit: 2n, token: '0x20C0' },
        ],
      ].map((limits) =>
        AccountActions.updateAccessKey(auth, {
          ...options,
          limits: limits as { limit: bigint; token: `0x${string}` }[],
        }).catch((error: unknown) =>
          error instanceof Accounts.RequestError
            ? { field: error.field, reason: error.reason }
            : String(error),
        ),
      ),
    )

    expect({ errors, requests }).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "field": "limits.0.limit",
            "reason": "invalid_field",
          },
          {
            "field": "limits.1.token",
            "reason": "invalid_field",
          },
          {
            "field": "limits.1.token",
            "reason": "invalid_field",
          },
        ],
        "requests": [],
      }
    `)
  })
})

/**
 * Returns an instance whose `fetch` records each request's path and redirect mode, then sends it to
 * an address where nothing listens, so each call rejects with no response.
 */
describe('machines.approval', () => {
  const session = Session.from({
    address: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
    kind: 'guest',
    publicKey: '0x04',
    revision: 1,
  })
  /** The page that posts each transaction, which the machine passes to the signature. */
  const source = { postMessage: () => {} }
  /** The transaction that the page posts. */
  const signature = { id: 1, source, transaction: '0x76' } as const
  /** The machine with a start and a signature that never settle, for the traversal. */
  const traversed = machines.approval.provide({
    actors: {
      sign: fromPromise(() => new Promise<void>(() => {})),
      start: fromPromise(() => new Promise<Session.GuestSession>(() => {})),
    },
  })

  /**
   * Returns the events that the runner sends from `snapshot`, keyed by every event type, and the
   * start's completion and failures, which the invoked actor sends.
   */
  function events(snapshot: machines.approval.Snapshot) {
    const all: Record<
      machines.approval.Event['type'],
      machines.approval.Event | undefined
    > = {
      'challenge.resolve':
        snapshot.context.challenge && snapshot.context.message === undefined
          ? { message: 'Sign in', type: 'challenge.resolve' }
          : undefined,
      'guest.resolve':
        snapshot.context.guest || snapshot.matches({ offer: 'started' })
          ? { type: 'guest.resolve', value: 'request' }
          : undefined,
      'offer.start': snapshot.context.offer
        ? { type: 'offer.start' }
        : undefined,
      'sign.start':
        machines.values(snapshot).guest !== undefined &&
        machines.signs(snapshot)
          ? { ...signature, type: 'sign.start' }
          : undefined,
    }
    const signed = snapshot.matches({ page: 'signing' })
      ? ([
          { output: undefined, type: 'xstate.done.actor.sign' },
          { error: new Error('Failed.'), type: 'xstate.error.actor.sign' },
        ] as never[])
      : []
    const started = snapshot.matches({ offer: 'starting' })
      ? ([
          { output: session, type: 'xstate.done.actor.start' },
          { error: new Error('Failed.'), type: 'xstate.error.actor.start' },
          {
            error: new Accounts.SupersededError(),
            type: 'xstate.error.actor.start',
          },
        ] as never[])
      : []
    return [
      ...Object.values(all).filter((event) => event !== undefined),
      ...signed,
      ...started,
    ]
  }

  test('reaches each state along its shortest paths, where the status agrees with the context', () => {
    const ends = [
      { challenge: false, guest: false, offer: false },
      { challenge: false, guest: false, offer: true },
      { challenge: false, guest: true, offer: false },
      { challenge: true, guest: false, offer: false },
      { challenge: true, guest: false, offer: true },
      { challenge: true, guest: true, offer: false },
    ].flatMap((input) =>
      getShortestPaths(traversed, {
        events,
        input,
        // The requests grow at each renewal, so the traversal reads only whether one arrived.
        serializeState: (snapshot) =>
          JSON.stringify([
            snapshot.value,
            snapshot.context.message !== undefined,
            snapshot.context.requests.length > 0,
          ]),
      }).map((path) => path.state),
    )

    expect(
      [...new Set(ends.map((state) => JSON.stringify(state.value)))]
        .sort()
        .map((value) => JSON.parse(value) as unknown),
    ).toMatchInlineSnapshot(`
      [
        {
          "offer": "failed",
          "page": "ready",
        },
        {
          "offer": "failed",
          "page": "waiting",
        },
        {
          "offer": "idle",
          "page": "ready",
        },
        {
          "offer": "idle",
          "page": "waiting",
        },
        {
          "offer": "none",
          "page": "ready",
        },
        {
          "offer": "none",
          "page": "signed",
        },
        {
          "offer": "none",
          "page": "signing",
        },
        {
          "offer": "none",
          "page": "waiting",
        },
        {
          "offer": "started",
          "page": "ready",
        },
        {
          "offer": "started",
          "page": "signed",
        },
        {
          "offer": "started",
          "page": "signing",
        },
        {
          "offer": "started",
          "page": "waiting",
        },
        {
          "offer": "starting",
          "page": "ready",
        },
        {
          "offer": "starting",
          "page": "waiting",
        },
        {
          "offer": "superseded",
          "page": "ready",
        },
        {
          "offer": "superseded",
          "page": "waiting",
        },
      ]
    `)
    expect(
      ends.every(
        (state) =>
          !state.matches({ offer: 'settling' }) &&
          !state.matches({ page: 'settling' }) &&
          machines.ready(state) ===
            (machines.select(state.context) === 'ready') &&
          state.matches({ offer: 'started' }) ===
            (state.context.session !== undefined) &&
          (state.matches({ offer: 'failed' }) ||
            state.matches({ offer: 'superseded' })) ===
            (state.context.failure !== undefined),
      ),
    ).toBe(true)
  })

  test('handles every event type in some state', () => {
    const handled = new Set<string>()
    const record = (actor: machines.approval.Actor) => {
      for (const event of [
        { message: 'm', type: 'challenge.resolve' },
        { type: 'guest.resolve', value: 'v' },
        { type: 'offer.start' },
        { ...signature, type: 'sign.start' },
      ] as const)
        if (actor.getSnapshot().can(event)) handled.add(event.type)
    }
    const actor = createActor(traversed, {
      input: { challenge: true, guest: true, offer: false },
    }).start()
    const offer = createActor(traversed, {
      input: { challenge: false, guest: false, offer: true },
    }).start()

    record(actor)
    record(offer)
    actor.send({ message: 'Sign in', type: 'challenge.resolve' })
    actor.send({ type: 'guest.resolve', value: 'first' })
    record(actor)
    actor.send({ ...signature, type: 'sign.start' })
    record(actor)

    expect([...handled].sort()).toMatchInlineSnapshot(`
      [
        "challenge.resolve",
        "guest.resolve",
        "offer.start",
        "sign.start",
      ]
    `)
  })

  test('waits for the first guest request, and holds each renewal in the URL', () => {
    const actor = createActor(machines.approval, {
      input: { challenge: false, guest: true, offer: false },
    }).start()
    const waiting = machines.ready(actor.getSnapshot())

    actor.send({ type: 'guest.resolve', value: 'first' })
    actor.send({ type: 'guest.resolve', value: 'second' })
    const snapshot = actor.getSnapshot()

    expect([
      waiting,
      snapshot.value,
      machines.values(snapshot),
      machines.issued(snapshot, { value: 'first' }),
      machines.issued(snapshot, { value: 'other' }),
      machines.guest(snapshot),
    ]).toMatchInlineSnapshot(`
      [
        false,
        {
          "offer": "none",
          "page": "ready",
        },
        {
          "guest": "second",
          "message": undefined,
        },
        true,
        false,
        {
          "type": "none",
        },
      ]
    `)
  })

  test("opens a guest offer's page at once, starts the guest session once at the user's selection, holds the first guest request, and signs one transaction", async () => {
    const starts: AbortSignal[] = []
    // A guest offer's URL waits for no guest request, so the input names none.
    const actor = createActor(
      machines.approval.provide({
        actors: {
          sign: fromPromise(() => Promise.resolve()),
          start: fromPromise((args) => {
            starts.push(args.signal)
            return Promise.resolve(session)
          }),
        },
      }),
      { input: { challenge: false, guest: false, offer: true } },
    ).start()
    const opened = machines.ready(actor.getSnapshot())
    const before = machines.guest(actor.getSnapshot())

    actor.send({ type: 'offer.start' })
    actor.send({ type: 'offer.start' })
    const started = await waitFor(actor, (snapshot) =>
      snapshot.matches({ offer: 'started' }),
    )
    actor.send({ type: 'offer.start' })
    actor.send({ type: 'guest.resolve', value: 'first' })
    const selected = actor.getSnapshot()
    actor.send({ ...signature, type: 'sign.start' })
    await waitFor(actor, (snapshot) => snapshot.matches({ page: 'signed' }))

    expect([
      opened,
      before,
      starts.length,
      machines.guest(started),
      machines.values(selected).guest,
      machines.issued(selected, { value: 'first' }),
      actor.getSnapshot().value,
      machines.signs(actor.getSnapshot()),
    ]).toMatchInlineSnapshot(`
      [
        true,
        {
          "type": "idle",
        },
        1,
        {
          "session": {
            "address": "0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326",
            "kind": "guest",
            "publicKey": "0x04",
            "revision": 1,
          },
          "type": "started",
        },
        "first",
        true,
        {
          "offer": "started",
          "page": "signed",
        },
        false,
      ]
    `)
  })

  test('starts the guest session again after a failed start, and holds a supersession', async () => {
    const results = [
      new Error('Failed.'),
      new Accounts.SupersededError(),
    ] as const
    const actor = createActor(
      machines.approval.provide({
        actors: {
          start: fromPromise<Session.GuestSession>(() =>
            Promise.reject(results[starts++]),
          ),
        },
      }),
      { input: { challenge: false, guest: false, offer: true } },
    ).start()
    let starts = 0

    actor.send({ type: 'offer.start' })
    const failed = machines.guest(
      await waitFor(actor, (snapshot) => snapshot.matches({ offer: 'failed' })),
    )
    actor.send({ type: 'offer.start' })
    const superseded = machines.guest(
      await waitFor(actor, (snapshot) =>
        snapshot.matches({ offer: 'superseded' }),
      ),
    )
    actor.send({ type: 'offer.start' })

    expect([
      failed.type,
      failed.type === 'failed' && failed.error === results[0],
      superseded.type,
      superseded.type === 'superseded' && superseded.error === results[1],
      starts,
      machines.guest(actor.getSnapshot()).type,
    ]).toMatchInlineSnapshot(`
      [
        "failed",
        true,
        "superseded",
        true,
        2,
        "superseded",
      ]
    `)
  })

  test("aborts the start of the guest session at the machine's end, and discards its result", async () => {
    const signals: AbortSignal[] = []
    let resolve: ((value: Session.GuestSession) => void) | undefined
    const actor = createActor(
      machines.approval.provide({
        actors: {
          start: fromPromise((args) => {
            signals.push(args.signal)
            return new Promise<Session.GuestSession>((settle) => {
              resolve = settle
            })
          }),
        },
      }),
      { input: { challenge: false, guest: false, offer: true } },
    ).start()
    actor.send({ type: 'offer.start' })

    actor.stop()
    resolve?.(session)
    await Promise.resolve()

    expect([
      signals.map((signal) => signal.aborted),
      machines.guest(actor.getSnapshot()).type,
      actor.getSnapshot().context.session,
    ]).toMatchInlineSnapshot(`
      [
        [
          true,
        ],
        "starting",
        undefined,
      ]
    `)
  })

  test('signs one transaction for each payment, and another after a failed signature', async () => {
    const inputs: unknown[] = []
    const results = [Promise.reject(new Error('Failed.')), Promise.resolve()]
    results[0]!.catch(() => {})
    const actor = createActor(
      machines.approval.provide({
        actors: {
          sign: fromPromise((args) => {
            inputs.push(args.input.transaction)
            return results[inputs.length - 1]!
          }),
        },
      }),
      { input: { challenge: false, guest: true, offer: false } },
    ).start()
    actor.send({ type: 'guest.resolve', value: 'first' })

    actor.send({ ...signature, transaction: '0x01', type: 'sign.start' })
    const concurrent = machines.signs(actor.getSnapshot())
    await waitFor(actor, (snapshot) => snapshot.matches({ page: 'ready' }))
    const retry = machines.signs(actor.getSnapshot())
    actor.send({ ...signature, transaction: '0x02', type: 'sign.start' })
    await waitFor(actor, (snapshot) => snapshot.matches({ page: 'signed' }))
    const after = machines.signs(actor.getSnapshot())

    expect([inputs, concurrent, retry, actor.getSnapshot().value, after])
      .toMatchInlineSnapshot(`
        [
          [
            "0x01",
            "0x02",
          ],
          false,
          true,
          {
            "offer": "none",
            "page": "signed",
          },
          false,
        ]
      `)
  })

  test("aborts the signature at the machine's end, so its runner posts no signature", async () => {
    const signals: AbortSignal[] = []
    let resolve: (() => void) | undefined
    const actor = createActor(
      machines.approval.provide({
        actors: {
          sign: fromPromise((args) => {
            signals.push(args.signal)
            return new Promise<void>((settle) => {
              resolve = settle
            })
          }),
        },
      }),
      { input: { challenge: false, guest: true, offer: false } },
    ).start()
    actor.send({ type: 'guest.resolve', value: 'first' })
    actor.send({ ...signature, type: 'sign.start' })

    actor.stop()
    resolve?.()
    await Promise.resolve()

    expect([signals.map((signal) => signal.aborted), actor.getSnapshot().value])
      .toMatchInlineSnapshot(`
      [
        [
          true,
        ],
        {
          "offer": "none",
          "page": "signing",
        },
      ]
    `)
  })
})

describe('machines.payer', () => {
  // The guest account signed a transfer in each row. Only the return URL names the account that paid.
  test.for([
    [
      'a failed start of the guest session, then a sign-in that pays',
      '0x000000000000000000000000000000000000dead',
      '0x000000000000000000000000000000000000dEaD',
    ],
    [
      "a guest's signed transfer that never landed, then a sign-in that pays",
      '0x000000000000000000000000000000000000dead',
      '0x000000000000000000000000000000000000dEaD',
    ],
    [
      "the guest's transfer that landed",
      '0x1f9090aae28b8a3dceadf281b0f12828e676c326',
      '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
    ],
    ['a return without `account`', undefined, undefined],
    ['a malformed `account`', '0x1234', undefined],
  ] as const)('returns the payer of %s', ([, account, expected]) => {
    expect(machines.payer({ account })).toBe(expected)
  })

  const held = '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326'

  test.for([
    ['a return URL without `account`', undefined, held],
    ['a return URL that names the guest account', held.toLowerCase(), held],
    [
      'a return URL that names another account',
      '0x000000000000000000000000000000000000dead',
      undefined,
    ],
  ] as const)(
    'returns the payer of a held guest session with %s',
    ([, account, expected]) => {
      expect(machines.payer({ account, held })).toBe(expected)
    },
  )
})

describe('machines.select', () => {
  test.for([
    [
      { challenge: false, guest: false, message: undefined, requests: [] },
      'ready',
    ],
    [
      { challenge: true, guest: false, message: undefined, requests: [] },
      'waiting',
    ],
    [{ challenge: true, guest: false, message: 'm', requests: [] }, 'ready'],
    [
      { challenge: false, guest: true, message: undefined, requests: [] },
      'waiting',
    ],
    [
      { challenge: false, guest: true, message: undefined, requests: ['r'] },
      'ready',
    ],
    [
      { challenge: true, guest: true, message: undefined, requests: ['r'] },
      'waiting',
    ],
  ] as const)('returns %o as %s', ([context, status]) => {
    expect(
      machines.select({
        ...context,
        failure: undefined,
        offer: false,
        session: undefined,
      }),
    ).toBe(status)
  })
})

function recording() {
  const requests: string[] = []
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push(
      `${new URL(String(input)).pathname} redirect=${init?.redirect ?? 'follow'}`,
    )
    return globalThis.fetch(input, init)
  }
  const auth = Accounts.from({
    clientId: 'client_test',
    fetch,
    url: 'http://127.0.0.1:9',
  })
  return { auth, requests }
}
