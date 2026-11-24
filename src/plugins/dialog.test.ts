/**
 * Runs the dialog plugin's machines of a page with `backend` on their own, with no frame: the
 * preload, its outcomes, its held result, and a sign-in that cancels it, the read of a `session`
 * call, and the machine of the instance's sign-ins and reads.
 * @module
 */
import { createActor, fromPromise, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import type { PageSession } from '../internal/handlers/Backend.js'
import * as Store from '../Store.js'
import { machines } from './dialog.js'
import { dialog } from './index.js'

describe('dialog', () => {
  test('refuses signIn and signMessage outside a page, such as in Node, with `Actions.dialog.PageRequiredError`', async () => {
    const options = {
      accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
      chain: 42431,
      clientId: 'https://app.example',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    } as const
    const accounts = Accounts.create({ ...options, plugins: [dialog()] })
    const backend = Accounts.create({
      ...options,
      plugins: [dialog({ backend: true })],
    })
    const message = (error: Error) => `${error.name}: ${error.message}`

    const errors = await Promise.all([
      accounts.dialog.signIn().catch(message),
      accounts.dialog.signMessage({ message: 'Approve' }).catch(message),
      backend.dialog.signIn().catch(message),
    ])

    expect(errors).toMatchInlineSnapshot(`
      [
        "Actions.dialog.PageRequiredError: No browser page: the sign-in shows in a frame or a popup, which only a page opens. Outside a page, sign in with the \`device\` plugin.",
        "Actions.dialog.PageRequiredError: No browser page: the sign-in shows in a frame or a popup, which only a page opens. Outside a page, sign in with the \`device\` plugin.",
        "Actions.dialog.PageRequiredError: No browser page: the sign-in shows in a frame or a popup, which only a page opens. Outside a page, sign in with the \`device\` plugin.",
      ]
    `)
  })
})

describe('machines.preload', () => {
  describe('machine', () => {
    const session = {
      account: '0x0000000000000000000000000000000000000001',
      method: 'tempo-id',
      user: { email: 'user@example.com' },
    } as unknown as PageSession
    const failure = new Error('read')

    test('reaches every state along its shortest paths, and holds a result only in a held state', () => {
      // The traversal runs no invoked read or timer, so it offers their outcomes as events, each
      // only in the state where the runner delivers it. The cast admits the outcome events, which
      // `machines.preload.Event` leaves out.
      type Offer = (
        state: machines.preload.Snapshot,
      ) => machines.preload.Event[]
      const reading = (state: machines.preload.Snapshot) =>
        state.matches('reading')
      const events = {
        'session.take': (state) =>
          state.hasTag('held') ? [{ type: 'session.take' }] : [],
        'signIn.start': (state) =>
          reading(state) || state.hasTag('held')
            ? [{ type: 'signIn.start' }]
            : [],
        'xstate.after.heldFor': (state) =>
          state.hasTag('held')
            ? ([
                { type: `xstate.after.heldFor.preload.${String(state.value)}` },
              ] as unknown as machines.preload.Event[])
            : [],
        'xstate.done.actor.read': (state) =>
          reading(state)
            ? ([
                { output: { at: 0, session }, type: 'xstate.done.actor.read' },
                {
                  output: { at: 0, session: null },
                  type: 'xstate.done.actor.read',
                },
                {
                  output: { at: 0, error: failure },
                  type: 'xstate.done.actor.read',
                },
              ] as unknown as machines.preload.Event[])
            : [],
        'xstate.error.actor.read': (state) =>
          reading(state)
            ? ([
                { error: new Error('abort'), type: 'xstate.error.actor.read' },
              ] as unknown as machines.preload.Event[])
            : [],
      } satisfies Record<
        | machines.preload.Event['type']
        | 'xstate.after.heldFor'
        | 'xstate.done.actor.read'
        | 'xstate.error.actor.read',
        Offer
      >
      const paths = getShortestPaths(machines.preload, {
        events: (state) =>
          Object.values(events).flatMap<machines.preload.Event>(
            (offer: Offer) => offer(state),
          ),
      })
      // Each state handles each event that it offers, and each event type is offered somewhere,
      // also the timer of each held state.
      const offered = paths.map((path) =>
        Object.entries(events).flatMap(([type, offer]: [string, Offer]) =>
          offer(path.state).map(
            (event) => [type, path.state.can(event)] as const,
          ),
        ),
      )
      expect(offered.flat().every(([, handled]) => handled)).toBe(true)
      expect([...new Set(offered.flat().map(([type]) => type))].sort()).toEqual(
        Object.keys(events).sort(),
      )

      const ends = paths.map((path) => path.state)

      expect(
        ends.map((state) => [
          String(state.value),
          machines.held(state, { now: 0 }),
          state.can({ type: 'session.take' }),
          state.can({ type: 'signIn.start' }),
        ]),
      ).toMatchInlineSnapshot(`
        [
          [
            "reading",
            false,
            false,
            true,
          ],
          [
            "cancelled",
            false,
            false,
            false,
          ],
          [
            "signedIn",
            true,
            true,
            true,
          ],
          [
            "signedOut",
            true,
            true,
            true,
          ],
          [
            "failed",
            true,
            true,
            true,
          ],
          [
            "loaded",
            false,
            false,
            false,
          ],
          [
            "released",
            false,
            false,
            false,
          ],
        ]
      `)
      expect(
        ends.every(
          (state) =>
            state.hasTag('held') === (state.context.at !== undefined) &&
            state.matches('signedIn') === (state.context.session !== null) &&
            state.matches('failed') === (state.context.error !== undefined),
        ),
      ).toBe(true)
    })

    const cases = [
      {
        expected: ['signedIn', [], session, undefined],
        name: 'loads no frame for a session of the backend, and holds it',
        read: { at: 1, session },
      },
      {
        expected: ['signedOut', ['load'], null, undefined],
        name: 'loads the frame without a session of the backend, and holds its null',
        read: { at: 1, session: null },
      },
      {
        expected: ['failed', ['load'], null, failure],
        name: 'loads the frame after a failed read, and holds its error',
        read: { at: 1, error: failure },
      },
    ] as const

    for (const entry of cases)
      test(entry.name, async () => {
        const loads: string[] = []
        const actor = createActor(
          machines.preload.provide({
            actions: { load: () => void loads.push('load') },
            actors: {
              read: fromPromise<machines.preload.Read>(() =>
                Promise.resolve(entry.read),
              ),
            },
          }),
        ).start()

        const snapshot = await waitFor(
          actor,
          (state) => !state.matches('reading'),
        )

        expect([
          snapshot.value,
          loads,
          snapshot.context.session,
          snapshot.context.error,
        ]).toEqual(entry.expected)
        actor.stop()
      })

    const takes = [
      {
        expected: 'released',
        name: 'releases the held session at the first take',
        read: { at: 1, session },
      },
      {
        expected: 'loaded',
        name: 'releases the held null of a signed-out page at the first take',
        read: { at: 1, session: null },
      },
      {
        expected: 'loaded',
        name: 'releases the held error of a failed read at the first take',
        read: { at: 1, error: failure },
      },
    ] as const

    for (const entry of takes)
      test(entry.name, async () => {
        const actor = createActor(
          machines.preload.provide({
            actors: {
              read: fromPromise<machines.preload.Read>(() =>
                Promise.resolve(entry.read),
              ),
            },
          }),
        ).start()
        await waitFor(actor, (state) => state.hasTag('held'))

        actor.send({ type: 'session.take' })

        const snapshot = actor.getSnapshot()
        expect([
          snapshot.value,
          machines.held(snapshot, { now: 1 }),
          snapshot.context,
        ]).toEqual([
          entry.expected,
          false,
          { at: undefined, error: undefined, session: null },
        ])
      })

    test('holds no result past its time, also before a late timer fires', async () => {
      const actor = createActor(
        machines.preload.provide({
          actors: {
            read: fromPromise<machines.preload.Read>(() =>
              Promise.resolve({ at: 1_000, session }),
            ),
          },
        }),
      ).start()

      const snapshot = await waitFor(actor, (state) => state.hasTag('held'))

      expect([
        machines.held(snapshot, { now: 1_000 }),
        machines.held(snapshot, { now: 10_999 }),
        machines.held(snapshot, { now: 11_000 }),
      ]).toMatchInlineSnapshot(`
        [
          true,
          true,
          false,
        ]
      `)
      actor.stop()
    })

    test('releases the held session once its time runs out', async () => {
      const actor = createActor(
        machines.preload.provide({
          actors: {
            read: fromPromise<machines.preload.Read>(() =>
              Promise.resolve({ at: 1, session }),
            ),
          },
          delays: { heldFor: 0 },
        }),
      ).start()

      const snapshot = await waitFor(actor, (state) => state.status === 'done')

      expect([snapshot.value, snapshot.context]).toMatchInlineSnapshot(`
        [
          "released",
          {
            "at": undefined,
            "error": undefined,
            "session": null,
          },
        ]
      `)
    })

    test('stops the read at a sign-in, which aborts its request, and loads no frame', () => {
      const loads: string[] = []
      const signals: AbortSignal[] = []
      const actor = createActor(
        machines.preload.provide({
          actions: { load: () => void loads.push('load') },
          actors: {
            read: fromPromise<machines.preload.Read>(({ signal }) => {
              signals.push(signal)
              return new Promise(() => {})
            }),
          },
        }),
      ).start()

      actor.send({ type: 'signIn.start' })

      expect([
        actor.getSnapshot().value,
        loads,
        signals.map((signal) => signal.aborted),
      ]).toMatchInlineSnapshot(`
        [
          "cancelled",
          [],
          [
            true,
          ],
        ]
      `)
    })
  })
})

describe('machines.read', () => {
  describe('machine', () => {
    test('reaches every state along its shortest paths, and rests in a final state after the read', () => {
      // The traversal runs no invoked read, so it offers the read's outcomes as events, only in
      // `reading`. The cast admits the outcome events, which `machines.read.Event` leaves out.
      type Offer = (state: machines.read.Snapshot) => machines.read.Event[]
      const reading = (state: machines.read.Snapshot) =>
        state.matches('reading')
      const events = {
        'signIn.start': (state) =>
          reading(state) ? [{ type: 'signIn.start' }] : [],
        'xstate.done.actor.read': (state) =>
          reading(state)
            ? ([
                { output: null, type: 'xstate.done.actor.read' },
              ] as unknown as machines.read.Event[])
            : [],
        'xstate.error.actor.read': (state) =>
          reading(state)
            ? ([
                { error: new Error('read'), type: 'xstate.error.actor.read' },
              ] as unknown as machines.read.Event[])
            : [],
      } satisfies Record<
        | machines.read.Event['type']
        | 'xstate.done.actor.read'
        | 'xstate.error.actor.read',
        Offer
      >
      const paths = getShortestPaths(machines.read, {
        events: (state) =>
          Object.values(events).flatMap<machines.read.Event>((offer: Offer) =>
            offer(state),
          ),
      })
      // Each state handles each event that it offers, and each event type is offered somewhere,
      // also the timer of each held state.
      const offered = paths.map((path) =>
        Object.entries(events).flatMap(([type, offer]: [string, Offer]) =>
          offer(path.state).map(
            (event) => [type, path.state.can(event)] as const,
          ),
        ),
      )
      expect(offered.flat().every(([, handled]) => handled)).toBe(true)
      expect([...new Set(offered.flat().map(([type]) => type))].sort()).toEqual(
        Object.keys(events).sort(),
      )

      const ends = paths.map((path) => path.state)

      expect(
        ends.map((state) => [
          String(state.value),
          state.can({ type: 'signIn.start' }),
        ]),
      ).toMatchInlineSnapshot(`
        [
          [
            "reading",
            true,
          ],
          [
            "cancelled",
            false,
          ],
          [
            "resolved",
            false,
          ],
          [
            "failed",
            false,
          ],
        ]
      `)
    })

    const session = {
      account: '0x0000000000000000000000000000000000000001',
      method: 'tempo-id',
      user: { email: 'user@example.com' },
    } as never
    const failure = new Error('read')
    const cases = [
      {
        expected: ['resolved', session],
        name: 'returns the session of the backend',
        read: () => Promise.resolve(session),
      },
      {
        expected: ['resolved', null],
        name: 'returns null without a session of the backend',
        read: () => Promise.resolve(null),
      },
      {
        expected: ['failed', failure],
        name: 'rejects with the error of a failed read',
        read: () => Promise.reject(failure),
      },
    ] as const

    for (const entry of cases)
      test(entry.name, async () => {
        const actor = createActor(
          machines.read.provide({
            actors: { read: fromPromise<PageSession | null>(entry.read) },
          }),
        ).start()

        const snapshot = await waitFor(
          actor,
          (state) => state.status === 'done',
        )
        const value = (() => {
          try {
            return machines.session(snapshot)
          } catch (error) {
            return error
          }
        })()

        expect([snapshot.value, value]).toEqual(entry.expected)
      })

    test('stops the read at a sign-in, which aborts its request, and rejects with an AbortError', () => {
      const signals: AbortSignal[] = []
      const actor = createActor(
        machines.read.provide({
          actors: {
            read: fromPromise(({ signal }) => {
              signals.push(signal)
              return new Promise<null>(() => {})
            }),
          },
        }),
      ).start()

      actor.send({ type: 'signIn.start' })

      const snapshot = actor.getSnapshot()
      expect([
        snapshot.value,
        signals.map((signal) => signal.aborted),
        (() => {
          try {
            return machines.session(snapshot)
          } catch (error) {
            return (error as DOMException).name
          }
        })(),
      ]).toMatchInlineSnapshot(`
        [
          "cancelled",
          [
            true,
          ],
          "AbortError",
        ]
      `)
    })
  })
})

describe('machines.backend', () => {
  describe('machine', () => {
    const session = {
      account: '0x0000000000000000000000000000000000000001',
      method: 'tempo-id',
      user: { email: 'user@example.com' },
    } as unknown as PageSession

    test('reaches every state along its shortest paths, and holds the reads and sign-ins it runs', () => {
      // The runner sends `session.read` only in `idle`, since `signingIn` refuses the call, and
      // `session.done` only for a read that runs, so each state offers only those events.
      const events = {
        'session.done': (state: machines.backend.Snapshot) =>
          state.context.reads.map((id) => ({
            id,
            type: 'session.done' as const,
          })),
        'session.read': (state: machines.backend.Snapshot) =>
          state.matches('idle') && state.context.reads.length === 0
            ? [{ id: 'read', type: 'session.read' as const }]
            : [],
        'signIn.end': (state: machines.backend.Snapshot) =>
          state.context.signIns > 0 ? [{ type: 'signIn.end' as const }] : [],
        'signIn.start': (state: machines.backend.Snapshot) =>
          state.context.signIns < 2 ? [{ type: 'signIn.start' as const }] : [],
      } satisfies Record<
        machines.backend.Event['type'],
        (state: machines.backend.Snapshot) => machines.backend.Event[]
      >
      const paths = getShortestPaths(machines.backend, {
        events: (state) =>
          Object.values(events).flatMap<machines.backend.Event>((offer) =>
            offer(state),
          ),
        serializeState: (state) =>
          JSON.stringify([
            state.value,
            state.context.reads,
            state.context.signIns,
          ]),
      })

      const ends = paths.map((path) => path.state)

      expect(
        ends.map((state) => [
          String(state.value),
          state.context.reads,
          state.context.signIns,
          machines.signingIn(state),
        ]),
      ).toMatchInlineSnapshot(`
        [
          [
            "idle",
            [],
            0,
            false,
          ],
          [
            "idle",
            [
              "read",
            ],
            0,
            false,
          ],
          [
            "signingIn",
            [],
            1,
            true,
          ],
          [
            "signingIn",
            [
              "read",
            ],
            1,
            true,
          ],
          [
            "signingIn",
            [],
            2,
            true,
          ],
          [
            "signingIn",
            [
              "read",
            ],
            2,
            true,
          ],
        ]
      `)
      expect(
        ends.every(
          (state) => machines.signingIn(state) === state.context.signIns > 0,
        ),
      ).toBe(true)
      expect(
        (Object.keys(events) as machines.backend.Event['type'][]).every(
          (type) =>
            ends.some((state) =>
              state.can(
                (type.startsWith('session')
                  ? { id: 'read', type }
                  : { type }) as machines.backend.Event,
              ),
            ),
        ),
      ).toBe(true)
    })

    test('stays signingIn until the last of overlapping sign-ins ends', () => {
      const actor = createActor(machines.backend).start()

      actor.send({ type: 'signIn.start' })
      actor.send({ type: 'signIn.start' })
      actor.send({ type: 'signIn.end' })
      const overlapped = actor.getSnapshot()
      actor.send({ type: 'signIn.end' })

      expect([
        [overlapped.value, overlapped.context.signIns],
        [actor.getSnapshot().value, actor.getSnapshot().context.signIns],
      ]).toMatchInlineSnapshot(`
        [
          [
            "signingIn",
            1,
          ],
          [
            "idle",
            0,
          ],
        ]
      `)
    })

    test('returns the session of a child read, and stops the child once the call takes it', async () => {
      const actor = createActor(
        machines.backend.provide({
          actors: {
            read: machines.read.provide({
              actors: {
                read: fromPromise<PageSession | null>(() =>
                  Promise.resolve(session),
                ),
              },
            }),
          },
        }),
      ).start()

      actor.send({ id: 'read', type: 'session.read' })
      const snapshot = await waitFor(
        machines.reader(actor.getSnapshot(), { id: 'read' }),
        (state) => state.status === 'done',
      )
      actor.send({ id: 'read', type: 'session.done' })

      expect([
        machines.session(snapshot),
        Object.keys(actor.getSnapshot().children),
      ]).toEqual([session, []])
    })

    test('cancels each child read at a sign-in, which aborts its request', () => {
      const signals: AbortSignal[] = []
      const actor = createActor(
        machines.backend.provide({
          actors: {
            read: machines.read.provide({
              actors: {
                read: fromPromise<PageSession | null>(({ signal }) => {
                  signals.push(signal)
                  return new Promise(() => {})
                }),
              },
            }),
          },
        }),
      ).start()
      actor.send({ id: 'first', type: 'session.read' })
      actor.send({ id: 'second', type: 'session.read' })

      actor.send({ type: 'signIn.start' })

      const reads = ['first', 'second'].map((id) =>
        machines.reader(actor.getSnapshot(), { id }).getSnapshot(),
      )
      expect([
        actor.getSnapshot().value,
        reads.map((read) => read.value),
        signals.map((signal) => signal.aborted),
      ]).toMatchInlineSnapshot(`
        [
          "signingIn",
          [
            "cancelled",
            "cancelled",
          ],
          [
            true,
            true,
          ],
        ]
      `)
    })
  })
})
