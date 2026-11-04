/**
 * Runs the session's machine on its own, with no I/O: the statuses that its events reach, the
 * counters of the race guard, the sign-outs in progress, the writes that it requests, and the pure
 * decisions of the runner. `Id.test.ts` runs the same machine through the instance, against the harness.
 * @module
 */
import * as Session from '../Session.js'
import { createActor } from 'xstate'
import { describe, expect, test } from 'vite-plus/test'
import { getShortestPaths } from 'xstate/graph'
import { machines } from './session.js'

describe('machines.session', () => {
  /** A saved session whose access key expired, which an authorization renews. */
  const expired = Session.from({
    accessToken: 'expired',
    expiresAt: 1,
    refreshToken: 'expired',
    user: { email: 'tempo-id-test+session@example.org', id: 'user_1' },
  })

  /** The same user's session after the authorization. */
  const renewed = Session.from({
    ...expired,
    accessToken: 'renewed',
    expiresAt: 2,
    refreshToken: 'renewed',
  })

  /** Another user's session. */
  const other = Session.from({
    ...renewed,
    user: { email: 'tempo-id-test+other@example.org', id: 'user_2' },
  })

  describe('machine', () => {
    test('reaches every status along its shortest paths', () => {
      const paths = getShortestPaths(machines.session, traversal)

      const reached = new Set(paths.map((path) => path.state.value))

      expect([...reached].sort()).toMatchInlineSnapshot(`
        [
          "pending",
          "reauthorizing",
          "signedIn",
          "signedOut",
        ]
      `)
    })

    test('rests in the status that its context selects, in every state that it reaches', () => {
      // A shortest path ends at each distinct state, so the paths' ends cover every state. A
      // transition that changes a value of `select` without `settling` leaves a stale status here.
      const snapshots = getShortestPaths(machines.session, traversal).map(
        (path) => path.state,
      )

      const stale = snapshots
        .filter(
          (snapshot) => snapshot.value !== machines.select(snapshot.context),
        )
        .map((snapshot) => [snapshot.value, machines.select(snapshot.context)])

      expect(snapshots.length).toBeGreaterThan(4)
      expect(stale).toEqual([])
    })

    test('shows the session that the instance holds while signedIn, and none while signedOut, in every state that it reaches', () => {
      const snapshots = getShortestPaths(machines.session, traversal).map(
        (path) => path.state,
      )

      const disagree = snapshots
        .map((snapshot) => ({
          held: snapshot.context.session !== undefined,
          status: machines.status(snapshot),
        }))
        .filter((entry) => {
          if (entry.status.status === 'signedIn') return !entry.held
          if (entry.status.status === 'signedOut') return entry.held
          return entry.status.status === 'reauthorizing' && entry.held
        })

      expect(disagree).toEqual([])
    })

    test('sends every event type of the machine from the states that it reaches', () => {
      const snapshots = getShortestPaths(machines.session, traversal).map(
        (path) => path.state,
      )

      const sent = new Set(
        snapshots.flatMap((snapshot) =>
          traversal
            .events(snapshot)
            .filter((event) => snapshot.can(event))
            .map((event) => event.type),
        ),
      )

      expect([...sent].sort()).toEqual(Object.keys(events).sort())
    })

    test('holds the context that its state cannot express consistent, in every state that it reaches', () => {
      const snapshots = getShortestPaths(machines.session, traversal).map(
        (path) => path.state,
      )

      // A logout in progress is a run of a sign-out in progress, and a run never ends below zero.
      const inconsistent = snapshots.filter((snapshot) => {
        const { logouts, signingOut } = snapshot.context
        if (logouts.running < 0) return true
        if (logouts.running > logouts.started) return true
        if (signingOut && signingOut.runs < 1) return true
        return logouts.running > (signingOut?.runs ?? 0)
      })

      expect(inconsistent).toEqual([])
    })

    test('holds reauthorizing while an authorization renews an expired session, then signedIn with the new session', () => {
      const actor = createActor(machines.session).start()

      actor.send({ type: 'authorize.start' })
      actor.send({ renewing: expired, session: undefined, type: 'set' })
      const renewing = machines.status(actor.getSnapshot())
      actor.send({ session: renewed, type: 'set' })
      actor.send({ type: 'authorize.end' })
      const signedIn = machines.status(actor.getSnapshot())

      expect(renewing).toEqual({ session: expired, status: 'reauthorizing' })
      expect(signedIn).toEqual({ session: renewed, status: 'signedIn' })
      expect(actor.getSnapshot().context.renewing).toBeUndefined()
    })

    test('holds pending after a sign-out during a renewal, then signedOut when the authorization ends', () => {
      const actor = createActor(machines.session).start()
      actor.send({ type: 'authorize.start' })
      actor.send({ renewing: expired, session: undefined, type: 'set' })

      actor.send({ type: 'signOut' })
      const during = actor.getSnapshot().value
      actor.send({ type: 'authorize.end' })

      expect(during).toBe('pending')
      expect(actor.getSnapshot().value).toBe('signedOut')
      expect(actor.getSnapshot().context.renewing).toBeUndefined()
    })

    test("keeps a session that a change set before the store's session loaded", () => {
      const actor = createActor(machines.session).start()

      actor.send({ session: renewed, signIn: true, type: 'set' })
      actor.send({ expired: true, session: expired, type: 'hydrate' })

      expect(actor.getSnapshot().context.session).toBe(renewed)
      expect(actor.getSnapshot().value).toBe('signedIn')
    })

    test('shows a session whose access key holds from a read of the store that completes after load, and none that expired', () => {
      const valid = createActor(machines.session).start()
      const stale = createActor(machines.session).start()
      valid.send({ type: 'load' })
      stale.send({ type: 'load' })

      valid.send({ expired: false, session: renewed, type: 'hydrate' })
      stale.send({ expired: true, session: expired, type: 'hydrate' })

      expect(machines.status(valid.getSnapshot())).toEqual({
        session: renewed,
        status: 'signedIn',
      })
      expect(stale.getSnapshot().value).toBe('signedOut')
      expect(stale.getSnapshot().context.session).toBeUndefined()
    })

    test('counts each change, sign-in, and sign-out, a joined sign-out too, and records the version of the last sign-out', () => {
      const actor = createActor(machines.session).start()

      actor.send({ session: renewed, signIn: true, type: 'set' })
      actor.send({ everywhere: false, type: 'signOut.start' })
      actor.send({ type: 'signOut' })
      actor.send({ everywhere: false, type: 'signOut.join' })
      const { signedOut, signIns, signOuts, version } =
        actor.getSnapshot().context

      expect({ signedOut, signIns, signOuts, version }).toMatchInlineSnapshot(`
        {
          "signIns": 1,
          "signOuts": 2,
          "signedOut": 2,
          "version": 2,
        }
      `)
    })

    test('records a sign-out in progress from its first run to its last, with the latest scope and the logouts that run', () => {
      const actor = createActor(machines.session).start()

      actor.send({ everywhere: false, type: 'signOut.start' })
      actor.send({ everywhere: true, type: 'signOut.start' })
      const both = actor.getSnapshot().context
      actor.send({ everywhere: false, type: 'signOut.finish' })
      const last = actor.getSnapshot().context
      actor.send({ everywhere: true, type: 'signOut.finish' })
      const none = actor.getSnapshot().context

      expect([both, last, none].map((context) => context.signingOut))
        .toMatchInlineSnapshot(`
        [
          {
            "everywhere": true,
            "runs": 2,
          },
          {
            "everywhere": true,
            "runs": 1,
          },
          undefined,
        ]
      `)
      expect([both, last, none].map((context) => context.logouts))
        .toMatchInlineSnapshot(`
        [
          {
            "running": 1,
            "started": 1,
          },
          {
            "running": 1,
            "started": 1,
          },
          {
            "running": 0,
            "started": 1,
          },
        ]
      `)
    })

    test('joins a sign-out in progress only while no change followed it, and only for a scope that it serves', () => {
      const join = (everywhere: boolean) =>
        ({ everywhere, type: 'signOut.join' }) as const
      const idle = createActor(machines.session).start()
      const local = createActor(machines.session).start()
      const global = createActor(machines.session).start()
      const followed = createActor(machines.session).start()
      local.send({ everywhere: false, type: 'signOut.start' })
      local.send({ type: 'signOut' })
      global.send({ everywhere: true, type: 'signOut.start' })
      global.send({ type: 'signOut' })
      followed.send({ everywhere: false, type: 'signOut.start' })
      followed.send({ type: 'signOut' })
      followed.send({ session: renewed, signIn: true, type: 'set' })

      const joins = {
        followed: followed.getSnapshot().can(join(false)),
        global: [
          global.getSnapshot().can(join(false)),
          global.getSnapshot().can(join(true)),
        ],
        idle: idle.getSnapshot().can(join(false)),
        local: [
          local.getSnapshot().can(join(false)),
          local.getSnapshot().can(join(true)),
        ],
      }
      const before = local.getSnapshot().context.signOuts
      local.send(join(true))

      expect(joins).toMatchInlineSnapshot(`
        {
          "followed": false,
          "global": [
            true,
            true,
          ],
          "idle": false,
          "local": [
            true,
            false,
          ],
        }
      `)
      expect(local.getSnapshot().context.signOuts).toBe(before)
    })

    test('sets the signed-out mark at a sign-out without everywhere, and clears it at a sign-out with it and at a commit', () => {
      const actor = createActor(machines.session).start()

      actor.send({ everywhere: false, type: 'signOut.start' })
      const local = actor.getSnapshot().context.marked
      actor.send({ type: 'change.commit' })
      const committed = actor.getSnapshot().context.marked
      actor.send({ everywhere: false, type: 'signOut.start' })
      actor.send({ everywhere: true, type: 'signOut.start' })
      const global = actor.getSnapshot().context.marked

      expect([local, committed, global]).toEqual([true, false, false])
    })

    test("counts another tab's logout as one that started, and none that runs here", () => {
      const actor = createActor(machines.session).start()

      actor.send({ type: 'logout.remote' })

      expect(actor.getSnapshot().context.logouts).toEqual({
        running: 0,
        started: 1,
      })
      expect(actor.getSnapshot().context.signingOut).toBeUndefined()
    })

    test("sets another tab's session and sign-out without a write, and counts the sign-out", () => {
      const saved: (string | undefined)[] = []
      const actor = createActor(
        machines.session.provide({
          actions: {
            save: (args) => {
              saved.push(args.context.session?.refreshToken)
            },
          },
        }),
      ).start()

      actor.send({ session: renewed, signIn: true, type: 'adopt' })
      const adopted = machines.status(actor.getSnapshot())
      actor.send({ type: 'signOut.remote' })
      const { signedOut, signIns, signOuts, version } =
        actor.getSnapshot().context

      expect(adopted).toEqual({ session: renewed, status: 'signedIn' })
      expect(actor.getSnapshot().value).toBe('signedOut')
      expect({ signedOut, signIns, signOuts, version }).toMatchInlineSnapshot(`
        {
          "signIns": 1,
          "signOuts": 1,
          "signedOut": 2,
          "version": 2,
        }
      `)
      expect(saved).toEqual([])
    })

    test('requests a write at each change and at save, with the session of that change, and none at hydrate or load', () => {
      const saved: (string | undefined)[] = []
      const actor = createActor(
        machines.session.provide({
          actions: {
            save: ({ context }) => {
              saved.push(context.session?.refreshToken)
            },
          },
        }),
      ).start()

      actor.send({ expired: true, session: expired, type: 'hydrate' })
      actor.send({ type: 'load' })
      actor.send({ session: renewed, type: 'set' })
      actor.send({ type: 'save' })
      actor.send({ everywhere: false, type: 'signOut.start' })
      actor.send({ type: 'signOut' })
      actor.send({ type: 'signOut.empty' })
      actor.send({ everywhere: false, type: 'signOut.join' })
      actor.send({ type: 'change.commit' })
      actor.send({ type: 'logout.remote' })
      actor.send({ everywhere: false, type: 'signOut.finish' })

      expect(saved).toMatchInlineSnapshot(`
        [
          "renewed",
          "renewed",
          undefined,
          undefined,
        ]
      `)
    })
  })

  describe('ending', () => {
    test("ends the later tokens that another context's refresh saved after the sign-out, and empties the store", () => {
      const later = Session.from({
        ...renewed,
        expiresAt: 3,
        refreshToken: 'r3',
      })

      const result = machines.ending({
        before: renewed,
        current: undefined,
        local: renewed,
        stored: later,
      })

      expect(result).toEqual({ empty: true, kept: false, session: later })
    })

    test("empties a stored copy of the ended session's own tokens", () => {
      const result = machines.ending({
        before: renewed,
        current: undefined,
        local: renewed,
        stored: renewed,
      })

      expect(result).toEqual({ empty: true, kept: false, session: renewed })
    })

    test("keeps another user's later sign-in in the store, which holds the Tempo ID session", () => {
      const other = Session.from({
        ...renewed,
        refreshToken: 'other',
        user: { email: 'tempo-id-test+other@example.org', id: 'user_2' },
      })

      const result = machines.ending({
        before: renewed,
        current: undefined,
        local: renewed,
        stored: other,
      })

      expect(result).toEqual({ empty: false, kept: true, session: renewed })
    })

    test('leaves a later sign-in in this instance, which the sign-out never ends', () => {
      const result = machines.ending({
        before: renewed,
        current: expired,
        local: renewed,
        stored: expired,
      })

      expect(result).toEqual({ empty: false, kept: false, session: renewed })
    })

    test("ends the newer of the instance's session and the stored one, and nothing without either", () => {
      const later = Session.from({
        ...renewed,
        expiresAt: 3,
        refreshToken: 'r3',
      })

      const newer = machines.ending({
        before: later,
        current: undefined,
        local: renewed,
        stored: undefined,
      })
      const none = machines.ending({
        before: undefined,
        current: undefined,
        local: undefined,
        stored: undefined,
      })

      expect(newer.session).toBe(later)
      expect(none).toEqual({ empty: false, kept: false, session: undefined })
    })
  })

  describe('overtaken', () => {
    const cases = [
      ['an update, after any change', { update: true }, { version: 1 }, true],
      ['an update, after no change', { update: true }, {}, false],
      ['a restore, after a sign-in', { restore: true }, { signIns: 1 }, true],
      [
        'a restore, while a sign-out runs',
        { restore: true },
        { signingOut: { everywhere: false, runs: 1 } },
        true,
      ],
      [
        'a restore that started while a sign-out ran',
        { restore: true, started: { everywhere: false, runs: 1 } },
        {},
        true,
      ],
      ['a restore, after a sign-out', { restore: true }, { signOuts: 1 }, true],
      ['a restore, after no change', { restore: true }, {}, false],
      ['a sign-in, after a sign-in', {}, { signIns: 1, version: 1 }, false],
      [
        'a sign-in, while a sign-out runs',
        {},
        { signingOut: { everywhere: false, runs: 1 } },
        false,
      ],
      ['a sign-in, after a sign-out', {}, { signOuts: 1 }, true],
    ] as const

    for (const [name, change, current, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const started = context({
          signingOut: 'started' in change ? change.started : undefined,
        })

        const result = machines.overtaken({
          current: context(current),
          restore: 'restore' in change ? change.restore : undefined,
          started,
          update: 'update' in change ? change.update : undefined,
        })

        expect(result).toBe(expected)
      })
  })

  describe('loggedOut', () => {
    const cases = [
      [
        'no logout overlapped',
        { running: 0, started: 0 },
        { running: 0, started: 0 },
        false,
      ],
      [
        'a logout started since',
        { running: 0, started: 0 },
        { running: 0, started: 1 },
        true,
      ],
      [
        'a logout ran at the start',
        { running: 1, started: 1 },
        { running: 0, started: 1 },
        true,
      ],
      [
        'a logout ended before the start',
        { running: 0, started: 1 },
        { running: 0, started: 1 },
        false,
      ],
    ] as const

    for (const [name, started, current, expected] of cases)
      test(`returns ${expected} when ${name}`, () => {
        const result = machines.loggedOut({
          current: context({ logouts: current }),
          started: context({ logouts: started }),
        })

        expect(result).toBe(expected)
      })
  })

  describe('logout', () => {
    const cases = [
      [
        'a sign-out with everywhere',
        { everywhere: true, kept: false, signIns: 1 },
        true,
      ],
      [
        'a sign-out without everywhere',
        { everywhere: false, kept: false, signIns: 1 },
        false,
      ],
      [
        'a later sign-in here',
        { everywhere: true, kept: false, signIns: 2 },
        false,
      ],
      [
        "another user's sign-in in the store",
        { everywhere: true, kept: true, signIns: 1 },
        false,
      ],
    ] as const

    for (const [name, options, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.logout({ ...options, started: 1 })

        expect(result).toBe(expected)
      })
  })

  describe('adoptable', () => {
    const cases = [
      ['no change, and no sign-out', {}, true],
      ['a change during the read', { version: 1 }, false],
      [
        'a sign-out in progress',
        { signingOut: { everywhere: false, runs: 1 } },
        false,
      ],
    ] as const

    for (const [name, current, expected] of cases)
      test(`returns ${expected} after ${name}`, () => {
        const result = machines.adoptable({
          current: context(current),
          version: 0,
        })

        expect(result).toBe(expected)
      })
  })

  describe('replaces', () => {
    const cases = [
      ['later tokens of the same user', false, renewed, expired, true],
      ["another user's session", false, other, expired, true],
      ['an empty store', false, undefined, expired, true],
      ['earlier tokens of the same user', false, expired, renewed, false],
      [
        'later tokens of the same user, after a failed write',
        true,
        renewed,
        expired,
        true,
      ],
      [
        "another user's session, after a failed write",
        true,
        other,
        expired,
        false,
      ],
      ['an empty store, after a failed write', true, undefined, expired, false],
      [
        'a session where none is held, after a failed write',
        true,
        renewed,
        undefined,
        false,
      ],
    ] as const

    for (const [name, failed, stored, current, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.replaces({ current, failed, stored })

        expect(result).toBe(expected)
      })
  })

  describe('switches', () => {
    const cases = [
      ["another user's session", other, renewed, true],
      ['the same user', expired, renewed, false],
      ['an empty store', undefined, renewed, false],
      ['no session held', other, undefined, false],
    ] as const

    for (const [name, stored, current, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.switches({ current, stored })

        expect(result).toBe(expected)
      })
  })

  /** Returns the machine's initial context, with `values` in place of its own. */
  function context(
    values: Partial<machines.session.Context> = {},
  ): machines.session.Context {
    return {
      ...createActor(machines.session).getSnapshot().context,
      ...values,
    }
  }

  /**
   * The events of each type that the instance sends from a snapshot. A `Record` of every event type,
   * so a new event fails the type check until the traversal sends it. An authorization ends only
   * after it starts, and at most two overlap, so the traversal is finite.
   */
  const events: {
    [type in machines.session.Event['type']]: (
      snapshot: machines.session.Snapshot,
    ) => readonly Extract<machines.session.Event, { type: type }>[]
  } = {
    adopt: () => [
      { session: renewed, signIn: true, type: 'adopt' },
      { session: undefined, signIn: false, type: 'adopt' },
    ],
    'authorize.end': (snapshot) =>
      snapshot.context.authorizations > 0 ? [{ type: 'authorize.end' }] : [],
    'authorize.start': (snapshot) =>
      snapshot.context.authorizations < 2 ? [{ type: 'authorize.start' }] : [],
    'change.commit': () => [{ type: 'change.commit' }],
    hydrate: () => [
      { expired: true, session: expired, type: 'hydrate' },
      { expired: false, session: renewed, type: 'hydrate' },
      { expired: false, session: undefined, type: 'hydrate' },
    ],
    load: () => [{ type: 'load' }],
    'logout.remote': () => [{ type: 'logout.remote' }],
    save: () => [{ type: 'save' }],
    set: () => [
      { session: renewed, signIn: true, type: 'set' },
      { session: undefined, type: 'set' },
      { renewing: expired, session: undefined, type: 'set' },
    ],
    signOut: () => [{ type: 'signOut' }],
    'signOut.empty': () => [{ type: 'signOut.empty' }],
    // A run ends only after it starts. A run with `everywhere` counts a logout in progress.
    'signOut.finish': (snapshot) => {
      const { logouts, signingOut } = snapshot.context
      if (!signingOut) return []
      return [
        ...(logouts.running > 0
          ? [{ everywhere: true, type: 'signOut.finish' } as const]
          : []),
        ...(signingOut.runs > logouts.running
          ? [{ everywhere: false, type: 'signOut.finish' } as const]
          : []),
      ]
    },
    // The runner sends a join only when the `joins` guard accepts it.
    'signOut.join': (snapshot) =>
      [
        { everywhere: false, type: 'signOut.join' } as const,
        { everywhere: true, type: 'signOut.join' } as const,
      ].filter((event) => snapshot.can(event)),
    'signOut.remote': () => [{ type: 'signOut.remote' }],
    // At most two runs overlap, so the traversal is finite.
    'signOut.start': (snapshot) =>
      (snapshot.context.signingOut?.runs ?? 0) < 2
        ? [
            { everywhere: false, type: 'signOut.start' },
            { everywhere: true, type: 'signOut.start' },
          ]
        : [],
  }

  /**
   * The traversal of the machine's graph. The counters of the race guard grow at each change, so a
   * snapshot's key holds only the values that select the status and the session to show, the
   * bounded sign-out values, and whether a change followed the last sign-out, which a join reads.
   */
  const traversal = {
    events: (
      snapshot: machines.session.Snapshot,
    ): readonly machines.session.Event[] => [
      ...events.adopt(snapshot),
      ...events['authorize.end'](snapshot),
      ...events['authorize.start'](snapshot),
      ...events['change.commit'](snapshot),
      ...events.hydrate(snapshot),
      ...events.load(snapshot),
      ...events['logout.remote'](snapshot),
      ...events.save(snapshot),
      ...events.set(snapshot),
      ...events.signOut(snapshot),
      ...events['signOut.empty'](snapshot),
      ...events['signOut.finish'](snapshot),
      ...events['signOut.join'](snapshot),
      ...events['signOut.remote'](snapshot),
      ...events['signOut.start'](snapshot),
    ],
    serializeState: (snapshot: machines.session.Snapshot) => {
      const {
        authorizations,
        loaded,
        logouts,
        marked,
        renewing,
        session,
        signedOut,
        signingOut,
        version,
      } = snapshot.context
      return JSON.stringify([
        snapshot.value,
        authorizations,
        loaded,
        logouts.running,
        marked,
        renewing?.refreshToken,
        session?.refreshToken,
        signedOut === version,
        signingOut,
      ])
    },
  }
})
