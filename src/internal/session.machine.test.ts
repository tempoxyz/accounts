/**
 * Runs the session's machine on its own, with no I/O: the statuses that its events reach, the
 * counters of the race guard, the writes that it requests, and the sign-out's decision of what it
 * ends. `Id.test.ts` runs the same machine through the instance, against the harness.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import { createActor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Session from '../Session.js'
import * as SessionMachine from './session.machine.js'

describe('machine', () => {
  test('reaches every status along its shortest paths', () => {
    const paths = getShortestPaths(SessionMachine.machine, traversal)

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
    const snapshots = getShortestPaths(SessionMachine.machine, traversal).map(
      (path) => path.state,
    )

    const stale = snapshots
      .filter(
        (snapshot) =>
          snapshot.value !== SessionMachine.select(snapshot.context),
      )
      .map((snapshot) => [
        snapshot.value,
        SessionMachine.select(snapshot.context),
      ])

    expect(snapshots.length).toBeGreaterThan(4)
    expect(stale).toEqual([])
  })

  test('shows the session that the instance holds while signedIn, and none while signedOut, in every state that it reaches', () => {
    const snapshots = getShortestPaths(SessionMachine.machine, traversal).map(
      (path) => path.state,
    )

    const disagree = snapshots
      .map((snapshot) => ({
        held: snapshot.context.session !== undefined,
        status: SessionMachine.status(snapshot),
      }))
      .filter((entry) => {
        if (entry.status.status === 'signedIn') return !entry.held
        if (entry.status.status === 'signedOut') return entry.held
        return entry.status.status === 'reauthorizing' && entry.held
      })

    expect(disagree).toEqual([])
  })

  test('sends every event type of the machine from the states that it reaches', () => {
    const snapshots = getShortestPaths(SessionMachine.machine, traversal).map(
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

  test('holds reauthorizing while an authorization renews an expired session, then signedIn with the new session', () => {
    const actor = createActor(SessionMachine.machine).start()

    actor.send({ type: 'authorize.start' })
    actor.send({ renewing: expired, session: undefined, type: 'set' })
    const renewing = SessionMachine.status(actor.getSnapshot())
    actor.send({ session: renewed, type: 'set' })
    actor.send({ type: 'authorize.end' })
    const signedIn = SessionMachine.status(actor.getSnapshot())

    expect(renewing).toEqual({ session: expired, status: 'reauthorizing' })
    expect(signedIn).toEqual({ session: renewed, status: 'signedIn' })
    expect(actor.getSnapshot().context.renewing).toBeUndefined()
  })

  test('holds pending after a sign-out during a renewal, then signedOut when the authorization ends', () => {
    const actor = createActor(SessionMachine.machine).start()
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
    const actor = createActor(SessionMachine.machine).start()

    actor.send({ session: renewed, signIn: true, type: 'set' })
    actor.send({ expired: true, session: expired, type: 'hydrate' })

    expect(actor.getSnapshot().context.session).toBe(renewed)
    expect(actor.getSnapshot().value).toBe('signedIn')
  })

  test('shows a session whose access key holds from a read of the store that completes after load, and none that expired', () => {
    const valid = createActor(SessionMachine.machine).start()
    const stale = createActor(SessionMachine.machine).start()
    valid.send({ type: 'load' })
    stale.send({ type: 'load' })

    valid.send({ expired: false, session: renewed, type: 'hydrate' })
    stale.send({ expired: true, session: expired, type: 'hydrate' })

    expect(SessionMachine.status(valid.getSnapshot())).toEqual({
      session: renewed,
      status: 'signedIn',
    })
    expect(stale.getSnapshot().value).toBe('signedOut')
    expect(stale.getSnapshot().context.session).toBeUndefined()
  })

  test('counts each change, sign-in, and sign-out, a joined sign-out too, and records the version of the last sign-out', () => {
    const actor = createActor(SessionMachine.machine).start()

    actor.send({ session: renewed, signIn: true, type: 'set' })
    actor.send({ type: 'signOut' })
    actor.send({ type: 'signOut.join' })
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

  test("sets another tab's session and sign-out without a write, and counts the sign-out", () => {
    const saved: (string | undefined)[] = []
    const actor = createActor(
      SessionMachine.machine.provide({
        actions: {
          save: (args) => {
            saved.push(args.context.session?.refreshToken)
          },
        },
      }),
    ).start()

    actor.send({ session: renewed, signIn: true, type: 'adopt' })
    const adopted = SessionMachine.status(actor.getSnapshot())
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
      SessionMachine.machine.provide({
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
    actor.send({ type: 'signOut' })
    actor.send({ type: 'signOut.empty' })

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
    const later = Session.from({ ...renewed, expiresAt: 3, refreshToken: 'r3' })

    const result = SessionMachine.ending({
      before: renewed,
      current: undefined,
      local: renewed,
      stored: later,
    })

    expect(result).toEqual({ empty: true, kept: false, session: later })
  })

  test("empties a stored copy of the ended session's own tokens", () => {
    const result = SessionMachine.ending({
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

    const result = SessionMachine.ending({
      before: renewed,
      current: undefined,
      local: renewed,
      stored: other,
    })

    expect(result).toEqual({ empty: false, kept: true, session: renewed })
  })

  test('leaves a later sign-in in this instance, which the sign-out never ends', () => {
    const result = SessionMachine.ending({
      before: renewed,
      current: expired,
      local: renewed,
      stored: expired,
    })

    expect(result).toEqual({ empty: false, kept: false, session: renewed })
  })

  test("ends the newer of the instance's session and the stored one, and nothing without either", () => {
    const later = Session.from({ ...renewed, expiresAt: 3, refreshToken: 'r3' })

    const newer = SessionMachine.ending({
      before: later,
      current: undefined,
      local: renewed,
      stored: undefined,
    })
    const none = SessionMachine.ending({
      before: undefined,
      current: undefined,
      local: undefined,
      stored: undefined,
    })

    expect(newer.session).toBe(later)
    expect(none).toEqual({ empty: false, kept: false, session: undefined })
  })
})

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

/**
 * The events of each type that the instance sends from a snapshot. A `Record` of every event type,
 * so a new event fails the type check until the traversal sends it. An authorization ends only
 * after it starts, and at most two overlap, so the traversal is finite.
 */
const events: {
  [type in SessionMachine.Event['type']]: (
    snapshot: SessionMachine.Snapshot,
  ) => readonly Extract<SessionMachine.Event, { type: type }>[]
} = {
  adopt: () => [
    { session: renewed, signIn: true, type: 'adopt' },
    { session: undefined, signIn: false, type: 'adopt' },
  ],
  'authorize.end': (snapshot) =>
    snapshot.context.authorizations > 0 ? [{ type: 'authorize.end' }] : [],
  'authorize.start': (snapshot) =>
    snapshot.context.authorizations < 2 ? [{ type: 'authorize.start' }] : [],
  hydrate: () => [
    { expired: true, session: expired, type: 'hydrate' },
    { expired: false, session: renewed, type: 'hydrate' },
    { expired: false, session: undefined, type: 'hydrate' },
  ],
  load: () => [{ type: 'load' }],
  save: () => [{ type: 'save' }],
  set: () => [
    { session: renewed, signIn: true, type: 'set' },
    { session: undefined, type: 'set' },
    { renewing: expired, session: undefined, type: 'set' },
  ],
  signOut: () => [{ type: 'signOut' }],
  'signOut.empty': () => [{ type: 'signOut.empty' }],
  'signOut.join': () => [{ type: 'signOut.join' }],
  'signOut.remote': () => [{ type: 'signOut.remote' }],
}

/**
 * The traversal of the machine's graph. The counters of the race guard grow at each change, so a
 * snapshot's key holds only the values that select the status and the session to show.
 */
const traversal = {
  events: (
    snapshot: SessionMachine.Snapshot,
  ): readonly SessionMachine.Event[] => [
    ...events.adopt(snapshot),
    ...events['authorize.end'](snapshot),
    ...events['authorize.start'](snapshot),
    ...events.hydrate(snapshot),
    ...events.load(snapshot),
    ...events.save(snapshot),
    ...events.set(snapshot),
    ...events.signOut(snapshot),
    ...events['signOut.empty'](snapshot),
    ...events['signOut.join'](snapshot),
    ...events['signOut.remote'](snapshot),
  ],
  serializeState: (snapshot: SessionMachine.Snapshot) => {
    const { authorizations, loaded, renewing, session } = snapshot.context
    return JSON.stringify([
      snapshot.value,
      authorizations,
      loaded,
      renewing?.refreshToken,
      session?.refreshToken,
    ])
  },
}
