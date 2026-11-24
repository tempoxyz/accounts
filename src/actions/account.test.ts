/**
 * Tests that the account actions that send a credential to Tempo ID follow no redirect, so a redirect never
 * sends the request on to another origin, and the machine of an approval page's readiness and its
 * guest account's one signature.
 * @module
 */
import { createActor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
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
  /** Returns the events that the runner sends from `snapshot`, keyed by every event type. */
  function events(snapshot: machines.approval.Snapshot) {
    const all: Record<
      machines.approval.Event['type'],
      machines.approval.Event | undefined
    > = {
      'challenge.resolve':
        snapshot.context.challenge && snapshot.context.message === undefined
          ? { message: 'Sign in', type: 'challenge.resolve' }
          : undefined,
      'guest.resolve': snapshot.context.guest
        ? { type: 'guest.resolve', value: 'request' }
        : undefined,
      'sign.end': snapshot.matches('signing')
        ? { type: 'sign.end' }
        : undefined,
      'sign.fail': snapshot.matches('signing')
        ? { type: 'sign.fail' }
        : undefined,
      'sign.start':
        snapshot.context.guest && machines.signs(snapshot)
          ? { type: 'sign.start' }
          : undefined,
    }
    return Object.values(all).filter((event) => event !== undefined)
  }

  test('reaches each state along its shortest paths, where the status agrees with the context', () => {
    const ends = [
      { challenge: false, guest: false },
      { challenge: false, guest: true },
      { challenge: true, guest: false },
      { challenge: true, guest: true },
    ].flatMap((input) =>
      getShortestPaths(machines.approval, {
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
      [...new Set(ends.map((state) => JSON.stringify(state.value)))].sort(),
    ).toMatchInlineSnapshot(`
      [
        ""ready"",
        ""signed"",
        ""signing"",
        ""waiting"",
      ]
    `)
    expect(
      ends.every(
        (state) =>
          !state.matches('settling') &&
          machines.ready(state) ===
            (machines.select(state.context) === 'ready'),
      ),
    ).toBe(true)
  })

  test('handles every event type in some state', () => {
    const actor = createActor(machines.approval, {
      input: { challenge: true, guest: true },
    }).start()
    const handled = new Set<string>()
    const record = () => {
      for (const event of [
        { message: 'm', type: 'challenge.resolve' },
        { type: 'guest.resolve', value: 'v' },
        { type: 'sign.end' },
        { type: 'sign.fail' },
        { type: 'sign.start' },
      ] as const)
        if (actor.getSnapshot().can(event)) handled.add(event.type)
    }

    record()
    actor.send({ message: 'Sign in', type: 'challenge.resolve' })
    actor.send({ type: 'guest.resolve', value: 'first' })
    record()
    actor.send({ type: 'sign.start' })
    record()

    expect([...handled].sort()).toMatchInlineSnapshot(`
      [
        "challenge.resolve",
        "guest.resolve",
        "sign.end",
        "sign.fail",
        "sign.start",
      ]
    `)
  })

  test('waits for the first guest request, and holds each renewal in the URL', () => {
    const actor = createActor(machines.approval, {
      input: { challenge: false, guest: true },
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
    ]).toMatchInlineSnapshot(`
      [
        false,
        "ready",
        {
          "guest": "second",
          "message": undefined,
        },
        true,
        false,
      ]
    `)
  })

  test("opens a guest offer's page at once, holds the first guest request once the user selects Continue as guest, and signs one transaction", () => {
    // A guest offer's URL waits for no guest request, so the input names none.
    const actor = createActor(machines.approval, {
      input: { challenge: false, guest: false },
    }).start()
    const opened = machines.ready(actor.getSnapshot())
    const before = machines.values(actor.getSnapshot()).guest

    actor.send({ type: 'guest.resolve', value: 'first' })
    const selected = actor.getSnapshot()
    actor.send({ type: 'sign.start' })
    actor.send({ type: 'sign.end' })

    expect([
      opened,
      before,
      machines.values(selected).guest,
      machines.issued(selected, { value: 'first' }),
      actor.getSnapshot().value,
      machines.signs(actor.getSnapshot()),
    ]).toMatchInlineSnapshot(`
      [
        true,
        undefined,
        "first",
        true,
        "signed",
        false,
      ]
    `)
  })

  test('signs one transaction for each payment, and another after a failed signature', () => {
    const actor = createActor(machines.approval, {
      input: { challenge: false, guest: true },
    }).start()
    actor.send({ type: 'guest.resolve', value: 'first' })

    actor.send({ type: 'sign.start' })
    const concurrent = machines.signs(actor.getSnapshot())
    actor.send({ type: 'sign.fail' })
    const retry = machines.signs(actor.getSnapshot())
    actor.send({ type: 'sign.start' })
    actor.send({ type: 'sign.end' })
    const after = machines.signs(actor.getSnapshot())

    expect([concurrent, retry, actor.getSnapshot().value, after])
      .toMatchInlineSnapshot(`
      [
        false,
        true,
        "signed",
        false,
      ]
    `)
  })
})

describe('machines.payer', () => {
  const guest = '0x1f9090aae28b8a3dceadf281b0f12828e676c326'
  const user = '0x000000000000000000000000000000000000dead'

  test.for([
    [
      'a failed start of the guest session, then a sign-in on the page',
      { account: user, signer: undefined },
      '0x000000000000000000000000000000000000dEaD',
    ],
    [
      "the guest account's signature",
      { account: undefined, signer: guest },
      guest,
    ],
    [
      'a selected guest offer whose guest account signed nothing, without `account`',
      { account: undefined, signer: undefined },
      undefined,
    ],
    [
      'a malformed `account`',
      { account: '0x1234', signer: undefined },
      undefined,
    ],
  ] as const)('returns the payer of %s', ([, options, expected]) => {
    expect(machines.payer(options)).toBe(expected)
  })
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
    expect(machines.select(context)).toBe(status)
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
