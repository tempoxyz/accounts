/**
 * Runs the session's machine on its own, with no I/O: the statuses that its events reach, the
 * counters of the race guard, the sign-outs in progress, the writes that it requests, and the pure
 * decisions of the runner. `Accounts.test.ts` runs the same machine through the instance, against the harness.
 * @module
 */
import * as Session from '../Session.js'
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createActor } from 'xstate'
import { beforeAll, describe, expect, test } from 'vite-plus/test'
import { getShortestPaths } from 'xstate/graph'
import { create, machines, toChain } from './Session.js'

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
    /** The shortest paths of the machine's graph, which the graph tests share. */
    let shortest: ReturnType<typeof getShortestPaths<typeof machines.session>>
    const paths = () => shortest
    beforeAll(() => {
      shortest = getShortestPaths(machines.session, traversal)
    }, 30_000)

    test('reaches every status along its shortest paths', () => {
      const all = paths()

      const reached = new Set(all.map((path) => path.state.value))

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
      const snapshots = paths().map((path) => path.state)

      const stale = snapshots
        .filter(
          (snapshot) => snapshot.value !== machines.select(snapshot.context),
        )
        .map((snapshot) => [snapshot.value, machines.select(snapshot.context)])

      expect(snapshots.length).toBeGreaterThan(4)
      expect(stale).toEqual([])
    })

    test('shows the session that the instance holds while signedIn, and none while signedOut, in every state that it reaches', () => {
      const snapshots = paths().map((path) => path.state)

      const disagree = snapshots
        .map((snapshot) => ({
          // The instance keeps a session that expired while it held it, but shows none.
          held:
            snapshot.context.session !== undefined &&
            snapshot.context.session !== snapshot.context.expired,
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
      const snapshots = paths().map((path) => path.state)

      const sent = new Set(
        snapshots.flatMap((snapshot) =>
          traversal
            .events(snapshot)
            .filter((event) => snapshot.can(event))
            .map((event) => event.type),
        ),
      )

      expect([...sent].sort()).toEqual(
        [...Object.keys(events), expiry.type].sort(),
      )
    })

    test('holds the context that its state cannot express consistent, in every state that it reaches', () => {
      const snapshots = paths().map((path) => path.state)

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

    test('reads the store for the kept expired session once while authorizations run, until another one starts, a change, or the last one ends', () => {
      const actor = createActor(machines.session).start()
      const checked = () => machines.checked(actor.getSnapshot().context)
      const seen: boolean[] = []

      actor.send({ renewing: expired, session: undefined, type: 'set' })
      actor.send({ type: 'lapsed.checked' })
      seen.push(checked())
      actor.send({ type: 'authorize.start' })
      actor.send({ type: 'lapsed.checked' })
      seen.push(checked())
      actor.send({ type: 'authorize.start' })
      seen.push(checked())
      actor.send({ type: 'lapsed.checked' })
      actor.send({ type: 'authorize.end' })
      seen.push(checked())
      actor.send({
        renewing: expired,
        session: undefined,
        signIn: false,
        type: 'adopt',
      })
      seen.push(checked())
      actor.send({ type: 'lapsed.checked' })
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'authorize.start' })
      seen.push(checked())

      expect(seen).toEqual([false, true, false, true, false, false])
    })

    test('keeps the read of the kept expired session only for the first authorization that starts in the callback of the only authorization in progress', () => {
      const actor = createActor(machines.session).start()
      const checked = () => machines.checked(actor.getSnapshot().context)
      const seen: boolean[] = []

      actor.send({ renewing: expired, session: undefined, type: 'set' })
      actor.send({ type: 'authorize.start' })
      actor.send({ type: 'lapsed.checked' })
      actor.send({ type: 'delegate.start' })
      actor.send({ type: 'authorize.start' })
      seen.push(checked())
      actor.send({ type: 'authorize.start' })
      seen.push(checked())
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'lapsed.checked' })
      actor.send({ type: 'authorize.start' })
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'authorize.start' })
      seen.push(checked())
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'delegate.end' })
      actor.send({ type: 'authorize.start' })
      seen.push(checked())

      expect(seen).toEqual([true, false, false, false])
    })

    test("marks the session that another context saved as adopted, until the instance's own change", () => {
      const actor = createActor(machines.session).start()
      const seen: boolean[] = []

      seen.push(machines.adopted(actor.getSnapshot()))
      actor.send({ session: renewed, signIn: false, type: 'adopt' })
      seen.push(machines.adopted(actor.getSnapshot()))
      actor.send({ session: other, signIn: true, type: 'set' })
      seen.push(machines.adopted(actor.getSnapshot()))

      expect(seen).toEqual([false, true, false])
    })

    test("moves the kept expired session's access keys to the chain that a switch selects", () => {
      const actor = createActor(machines.session).start()
      const accessKey = { account: '0x1', chainId: 4217 } as never

      actor.send({
        renewing: { ...expired, accessKey },
        session: undefined,
        type: 'set',
      })
      actor.send({ chainId: 42431, type: 'renewing.move' })
      const moved = actor.getSnapshot().context.renewing
      actor.send({ chainId: 4217, type: 'renewing.move' })
      const back = actor.getSnapshot().context.renewing

      expect({
        accessKeys: moved?.accessKeys,
        back: back?.accessKey,
        moved: moved?.accessKey,
      }).toEqual({
        accessKeys: [accessKey],
        back: accessKey,
        moved: undefined,
      })
    })

    test('moves a kept expired session that the instance adopts after a switch, until a change sets a session', () => {
      const actor = createActor(machines.session).start()
      const accessKey = { account: '0x1', chainId: 4217 } as never

      actor.send({ chainId: 42431, type: 'renewing.move' })
      // A read that started before the switch adopts the earlier chain's copy, which moves too.
      actor.send({
        renewing: { ...expired, accessKey },
        session: undefined,
        signIn: false,
        type: 'adopt',
      })
      const adopted = actor.getSnapshot().context.renewing?.accessKey
      actor.send({ session: renewed, type: 'set' })
      actor.send({
        renewing: { ...expired, accessKey },
        session: undefined,
        type: 'set',
      })
      const kept = actor.getSnapshot().context.renewing?.accessKey

      expect({ adopted, kept }).toEqual({ adopted: undefined, kept: accessKey })
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

    test('holds reauthorizing with the held session whose access key expired, from the start of the authorization that renews it', () => {
      const actor = createActor(machines.session).start()
      const seen: unknown[] = []

      actor.send({ type: 'load' })
      actor.send({ session: expired, type: 'set' })
      actor.send(expiry)
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ type: 'authorize.start' })
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ renewing: expired, session: undefined, type: 'set' })
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ session: renewed, type: 'set' })
      actor.send({ type: 'authorize.end' })
      seen.push(machines.status(actor.getSnapshot()))

      expect(seen.map((entry) => JSON.stringify(entry))).toMatchInlineSnapshot(`
        [
          "{"status":"signedOut"}",
          "{"session":{"accessToken":"expired","expiresAt":1,"refreshToken":"expired","user":{"email":"tempo-id-test+session@example.org","id":"user_1"}},"status":"reauthorizing"}",
          "{"session":{"accessToken":"expired","expiresAt":1,"refreshToken":"expired","user":{"email":"tempo-id-test+session@example.org","id":"user_1"}},"status":"reauthorizing"}",
          "{"session":{"accessToken":"renewed","expiresAt":2,"refreshToken":"renewed","user":{"email":"tempo-id-test+session@example.org","id":"user_1"}},"status":"signedIn"}",
        ]
      `)
    })

    test('keeps the expired session that load emptied outside an authorization, so the next authorization renews it, until a sign-out', () => {
      const actor = createActor(machines.session).start()
      const seen: unknown[] = []

      actor.send({ type: 'load' })
      actor.send({ renewing: expired, session: undefined, type: 'set' })
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ type: 'authorize.start' })
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ session: undefined, type: 'set' })
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'authorize.start' })
      seen.push(machines.status(actor.getSnapshot()))
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'signOut' })
      actor.send({ type: 'authorize.start' })
      seen.push(machines.status(actor.getSnapshot()))

      expect(seen.map((entry) => JSON.stringify(entry))).toMatchInlineSnapshot(`
        [
          "{"status":"signedOut"}",
          "{"session":{"accessToken":"expired","expiresAt":1,"refreshToken":"expired","user":{"email":"tempo-id-test+session@example.org","id":"user_1"}},"status":"reauthorizing"}",
          "{"session":{"accessToken":"expired","expiresAt":1,"refreshToken":"expired","user":{"email":"tempo-id-test+session@example.org","id":"user_1"}},"status":"reauthorizing"}",
          "{"status":"pending"}",
        ]
      `)
      expect(actor.getSnapshot().context.renewing).toBeUndefined()
    })

    test('ends the renewal at a refusal outside an authorization, since the refused sign-in can be another user', () => {
      const actor = createActor(machines.session).start()

      actor.send({ type: 'load' })
      actor.send({ renewing: expired, session: undefined, type: 'set' })
      actor.send({ type: 'change.refuse' })
      actor.send({ type: 'authorize.start' })

      expect(machines.status(actor.getSnapshot())).toMatchInlineSnapshot(`
        {
          "session": undefined,
          "status": "pending",
        }
      `)
      expect(actor.getSnapshot().context.renewing).toBeUndefined()
    })

    test('reads idle while every authorization waits for a callback inside it, or once one sets the session, and not while one runs alone', () => {
      const actor = createActor(machines.session).start()
      const idle: boolean[] = []

      idle.push(machines.idle(actor.getSnapshot()))
      actor.send({ type: 'authorize.start' })
      idle.push(machines.idle(actor.getSnapshot()))
      actor.send({ type: 'delegate.start' })
      idle.push(machines.idle(actor.getSnapshot()))
      actor.send({ type: 'authorize.start' })
      idle.push(machines.idle(actor.getSnapshot()))
      actor.send({ type: 'authorize.end' })
      actor.send({ type: 'delegate.end' })
      idle.push(machines.idle(actor.getSnapshot()))
      actor.send({ type: 'load' })
      actor.send({ session: renewed, type: 'set' })
      idle.push(machines.idle(actor.getSnapshot()))

      expect(idle).toMatchInlineSnapshot(`
        [
          true,
          false,
          true,
          false,
          false,
          true,
        ]
      `)
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
              "pending": 2,
              "runs": 2,
            },
            {
              "everywhere": true,
              "pending": 1,
              "runs": 1,
            },
            undefined,
          ]
        `)
      expect([both, last, none].map((context) => context.logouts))
        .toMatchInlineSnapshot(`
          [
            {
              "remote": 0,
              "running": 1,
              "started": 1,
              "succeeded": 0,
              "unknown": 0,
            },
            {
              "remote": 0,
              "running": 1,
              "started": 1,
              "succeeded": 0,
              "unknown": 0,
            },
            {
              "remote": 0,
              "running": 0,
              "started": 1,
              "succeeded": 0,
              "unknown": 0,
            },
          ]
        `)
    })

    test('joins a sign-out in progress that has not emptied the session yet, even after a change, since its emptying overtakes it', () => {
      const join = { everywhere: true, type: 'signOut.join' } as const
      const started = createActor(machines.session).start()
      started.send({ everywhere: true, type: 'signOut.start' })
      const before = started.getSnapshot().can(join)
      started.send({ session: renewed, signIn: true, type: 'set' })
      const changed = started.getSnapshot().can(join)
      started.send({ type: 'signOut' })
      const emptied = started.getSnapshot().can(join)
      started.send({ session: renewed, signIn: true, type: 'set' })
      const followed = started.getSnapshot().can(join)

      expect({ before, changed, emptied, followed }).toMatchInlineSnapshot(`
        {
          "before": true,
          "changed": true,
          "emptied": true,
          "followed": false,
        }
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

    test("clears the instance's copy of the signed-out mark when it adopts another tab's session, and keeps it for an adopted sign-out", () => {
      const actor = createActor(machines.session).start()
      actor.send({ everywhere: false, type: 'signOut.start' })
      actor.send({ everywhere: false, type: 'signOut.finish' })

      actor.send({
        renewing: undefined,
        session: undefined,
        signIn: false,
        type: 'adopt',
      })
      const emptied = actor.getSnapshot().context.marked
      // A tab that signed out holds no session, so the adoption of another tab's sign-in is no switch.
      actor.send({ session: renewed, signIn: false, type: 'adopt' })
      const adopted = actor.getSnapshot().context.marked

      expect({ adopted, emptied }).toMatchInlineSnapshot(`
        {
          "adopted": false,
          "emptied": true,
        }
      `)
    })

    test('sets the signed-out mark when a sign-out with everywhere rejects, unless a sign-in followed', () => {
      const actor = createActor(machines.session).start()
      actor.send({ everywhere: true, type: 'signOut.start' })

      actor.send({ type: 'signOut.reject' })
      const rejected = actor.getSnapshot().context.marked
      actor.send({ type: 'change.commit' })
      actor.send({ session: renewed, signIn: true, type: 'set' })
      actor.send({ type: 'signOut.reject' })
      const signedIn = actor.getSnapshot().context.marked

      expect({ rejected, signedIn }).toEqual({
        rejected: true,
        signedIn: false,
      })
    })

    test('counts the logout that succeeded, and none for the run whose logout Tempo ID refused', () => {
      const actor = createActor(machines.session).start()

      actor.send({ everywhere: true, type: 'signOut.start' })
      actor.send({ everywhere: true, type: 'signOut.finish' })
      const refused = actor.getSnapshot().context.logouts
      actor.send({ everywhere: true, type: 'signOut.start' })
      actor.send({ type: 'logout.succeed' })
      const succeeded = actor.getSnapshot().context.logouts
      actor.send({ everywhere: true, type: 'signOut.finish' })
      const ended = actor.getSnapshot().context.logouts

      expect([refused, succeeded, ended]).toMatchInlineSnapshot(`
        [
          {
            "remote": 0,
            "running": 0,
            "started": 1,
            "succeeded": 0,
            "unknown": 0,
          },
          {
            "remote": 0,
            "running": 1,
            "started": 2,
            "succeeded": 1,
            "unknown": 0,
          },
          {
            "remote": 0,
            "running": 0,
            "started": 2,
            "succeeded": 1,
            "unknown": 0,
          },
        ]
      `)
    })

    test('counts the logout of unknown outcome, in a run and outside one', () => {
      const actor = createActor(machines.session).start()

      actor.send({ everywhere: true, type: 'signOut.start' })
      actor.send({ type: 'logout.unknown' })
      const unanswered = actor.getSnapshot().context.logouts
      actor.send({ everywhere: true, type: 'signOut.finish' })
      actor.send({ type: 'logout.unknown' })
      const overtaken = actor.getSnapshot().context.logouts

      expect([unanswered, overtaken]).toMatchInlineSnapshot(`
        [
          {
            "remote": 0,
            "running": 1,
            "started": 1,
            "succeeded": 0,
            "unknown": 1,
          },
          {
            "remote": 0,
            "running": 0,
            "started": 1,
            "succeeded": 0,
            "unknown": 2,
          },
        ]
      `)
    })

    test("counts another tab's logout as one that started, and none that runs here", () => {
      const actor = createActor(machines.session).start()

      actor.send({ type: 'logout.remote' })

      expect(actor.getSnapshot().context.logouts).toEqual({
        remote: 1,
        running: 0,
        started: 1,
        succeeded: 0,
        unknown: 0,
      })
      expect(actor.getSnapshot().context.signingOut).toBeUndefined()
    })

    test("holds reauthorizing when another tab empties the expired session during this tab's authorization, then signedIn with the new session", () => {
      const actor = createActor(machines.session).start()
      actor.send({ type: 'authorize.start' })
      actor.send({ expired: true, session: expired, type: 'hydrate' })

      actor.send({
        renewing: expired,
        session: undefined,
        signIn: false,
        type: 'adopt',
      })
      const renewing = machines.status(actor.getSnapshot())
      actor.send({ session: renewed, type: 'set' })
      actor.send({ type: 'authorize.end' })

      expect(renewing).toEqual({ session: expired, status: 'reauthorizing' })
      expect(machines.status(actor.getSnapshot())).toEqual({
        session: renewed,
        status: 'signedIn',
      })
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
      actor.send({ marked: true, type: 'signOut.remote' })
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

    test("holds the signed-out mark at another tab's sign-out without `everywhere`, so a call with `reauthorize` holds no status", () => {
      const actor = createActor(machines.session).start()

      actor.send({ session: renewed, signIn: true, type: 'adopt' })
      actor.send({ marked: true, type: 'signOut.remote' })
      const app = machines.declined(actor.getSnapshot())
      actor.send({ marked: false, type: 'signOut.remote' })
      const kept = machines.declined(actor.getSnapshot())
      actor.send({ session: renewed, signIn: true, type: 'adopt' })
      actor.send({ marked: false, type: 'signOut.remote' })
      const everywhere = machines.declined(actor.getSnapshot())

      expect({ app, everywhere, kept }).toMatchInlineSnapshot(`
        {
          "app": true,
          "everywhere": false,
          "kept": true,
        }
      `)
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

    test('requests no write at a set of a session that the store holds, and sets it', () => {
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

      actor.send({ session: expired, type: 'set' })
      actor.send({ saved: true, session: renewed, type: 'set' })

      const { session, version } = actor.getSnapshot().context
      expect({
        saved,
        session: session?.refreshToken,
        value: actor.getSnapshot().value,
        version,
      }).toMatchInlineSnapshot(`
        {
          "saved": [
            "expired",
          ],
          "session": "renewed",
          "value": "signedIn",
          "version": 2,
        }
      `)
    })
  })

  describe('expiry', () => {
    test("changes to signedOut at the expiry of the session's access keys, keeps the session, and changes to signedIn for the next session", async () => {
      const actor = createActor(
        machines.session.provide({ delays: { expiry: 0 } }),
      ).start()
      const statuses: string[] = []
      actor.subscribe((snapshot) => statuses.push(String(snapshot.value)))

      actor.send({ session: renewed, type: 'set' })
      await expect
        .poll(() => actor.getSnapshot().value, { timeout: 1_000 })
        .toBe('signedOut')
      const held = actor.getSnapshot().context.session
      actor.send({ session: other, type: 'set' })

      expect(held).toBe(renewed)
      expect(statuses).toEqual(['signedIn', 'signedOut', 'signedIn'])
    })
  })

  describe('expiresAt', () => {
    /** Returns an access key that expires at `expiry`, in Unix seconds, or never without one. */
    const accessKey = (expiry?: number) => {
      const owner = Secp256k1.randomPrivateKey()
      const authorization = KeyAuthorization.from({
        address: Address.fromPublicKey(
          Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
        ),
        chainId: 4217n,
        ...(expiry ? { expiry } : {}),
        type: 'secp256k1',
      })
      const signature = Secp256k1.sign({
        payload: KeyAuthorization.getSignPayload(authorization),
        privateKey: owner,
      })
      return {
        account: Address.fromPublicKey(
          Secp256k1.getPublicKey({ privateKey: owner }),
        ),
        chainId: 4217,
        keyAuthorization: KeyAuthorization.toRpc(
          KeyAuthorization.from(authorization, { signature }),
        ),
      }
    }

    const cases = [
      ['an access key', { accessKey: accessKey(100) }, 100_000],
      [
        'an access key and a later one on another chain',
        { accessKey: accessKey(100), accessKeys: [accessKey(200)] },
        200_000,
      ],
      [
        'an access key and one on another chain without an expiry',
        { accessKey: accessKey(100), accessKeys: [accessKey()] },
        Infinity,
      ],
      [
        'an access key on another chain, and no refresh token',
        { accessKeys: [accessKey(100)], refreshToken: undefined },
        100_000,
      ],
      [
        'no access key, and an access token that expires later than the access key on another chain',
        {
          accessKeys: [accessKey(100)],
          expiresAt: 300_000,
          refreshToken: undefined,
        },
        300_000,
      ],
      ['no access key, and a refresh token', {}, Infinity],
      ['no access key, and no refresh token', { refreshToken: undefined }, 1],
    ] as const

    for (const [name, fields, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.expiresAt(
          Session.from({ ...expired, ...fields }),
        )

        expect(result).toBe(expected)
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
        failed: false,
        local: renewed,
        stored: later,
      })

      expect(result).toEqual({ empty: true, kept: false, session: later })
    })

    test("ends the later tokens of the session after another context's chain switch, which moved its access keys", () => {
      const accessKeyA = { chainId: 4217, keyAuthorization: { keyId: '0xA' } }
      const accessKeyB = { chainId: 42431, keyAuthorization: { keyId: '0xB' } }
      const ended = Session.from({
        ...renewed,
        accessKey: accessKeyA as never,
        accessKeys: [accessKeyB] as never,
      })
      const switched = Session.from({
        ...renewed,
        accessKey: accessKeyB as never,
        accessKeys: [accessKeyA] as never,
        expiresAt: 3,
        refreshToken: 'r3',
      })

      const result = machines.ending({
        before: ended,
        current: undefined,
        failed: false,
        local: ended,
        stored: switched,
      })

      expect(result).toEqual({ empty: true, kept: false, session: switched })
    })

    test("empties a stored copy of the ended session's own tokens", () => {
      const result = machines.ending({
        before: renewed,
        current: undefined,
        failed: false,
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
        failed: false,
        local: renewed,
        stored: other,
      })

      expect(result).toEqual({ empty: false, kept: true, session: renewed })
    })

    test('leaves a later sign-in in this instance, which the sign-out never ends', () => {
      const result = machines.ending({
        before: renewed,
        current: expired,
        failed: false,
        local: renewed,
        stored: expired,
      })

      expect(result).toEqual({ empty: false, kept: false, session: renewed })
    })

    test("ends the instance's session when the store holds none after a failed write, such as a sign-in whose save the store refused", () => {
      const result = machines.ending({
        before: undefined,
        current: undefined,
        failed: true,
        local: renewed,
        stored: undefined,
      })

      expect(result).toEqual({ empty: false, kept: false, session: renewed })
    })

    test("ends the instance's unsaved session, not another context's sign-in of the same user that the store holds after the sign-out", () => {
      const signIn = Session.from({
        ...renewed,
        refreshToken: 'r3',
        expiresAt: 3,
      })

      const result = machines.ending({
        before: undefined,
        current: undefined,
        failed: true,
        local: renewed,
        stored: signIn,
      })

      expect(result).toEqual({
        empty: false,
        kept: false,
        session: renewed,
        unsaved: undefined,
      })
    })

    test("ends another user's session that the store holds after a failed write, and the instance's unsaved session beside it", () => {
      const result = machines.ending({
        before: other,
        current: undefined,
        failed: true,
        local: renewed,
        stored: undefined,
      })

      expect(result).toEqual({
        empty: false,
        kept: false,
        session: other,
        unsaved: renewed,
      })
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
        failed: false,
        local: renewed,
        stored: undefined,
      })
      const none = machines.ending({
        before: undefined,
        current: undefined,
        failed: false,
        local: undefined,
        stored: undefined,
      })

      expect(newer.session).toBe(later)
      expect(none).toEqual({ empty: false, kept: false, session: undefined })
    })
  })

  describe('ended', () => {
    const cases = [
      ['after a refusal', { refusals: 1 }, true],
      ['after a sign-out', { signOuts: 1 }, true],
      ['after a sign-in', { signIns: 1, version: 1 }, false],
      ['after no change', {}, false],
    ] as const

    for (const [name, current, expected] of cases)
      test(`returns ${expected} ${name}`, () => {
        const result = machines.ended({
          current: context(current),
          started: context(),
        })

        expect(result).toBe(expected)
      })
  })

  describe('expired', () => {
    const cases = [
      ['without a session', undefined, false, false],
      ['while the session holds', renewed, false, false],
      ["after the session's expiry", renewed, true, true],
      ['after a set empties the expired session', undefined, true, false],
    ] as const

    for (const [name, session, expire, expected] of cases)
      test(`returns ${expected} ${name}`, async () => {
        const actor = createActor(
          machines.session.provide({
            delays: { expiry: expire ? 0 : 2 ** 31 - 1 },
          }),
        ).start()
        actor.send({ session: renewed, type: 'set' })
        if (expire)
          await expect
            .poll(() => actor.getSnapshot().matches('signedOut'))
            .toBe(true)
        if (!session || !expire) actor.send({ session, type: 'set' })

        const result = machines.expired(actor.getSnapshot())

        expect(result).toBe(expected)
      })
  })

  describe('loaded', () => {
    const cases = [
      ['before the first load', [], false],
      ['after the load', [{ type: 'load' }], true],
      [
        'after a set before the load',
        [{ session: undefined, type: 'set' }],
        true,
      ],
    ] as const

    for (const [name, events, expected] of cases)
      test(`returns ${expected} ${name}`, () => {
        const actor = createActor(machines.session).start()
        for (const event of events) actor.send(event)

        const result = machines.loaded(actor.getSnapshot())

        expect(result).toBe(expected)
      })
  })

  describe('shares', () => {
    const rotation = { at: 1, from: '0xsent' }
    const cases = [
      ['after a failed read of the rotations', [], undefined, true],
      [
        'when the revoked digests hold the new token',
        ['0xreceived'],
        [rotation],
        true,
      ],
      [
        'when a rotation names the new token as its successor',
        [],
        [{ ...rotation, to: 'received' }],
        true,
      ],
      [
        'when a rotation starts from the new token',
        [],
        [{ at: 1, from: '0xreceived' }],
        true,
      ],
      ['when no record names the new token', ['0xsent'], [rotation], false],
    ] as const

    for (const [name, digests, entries, expected] of cases)
      test(`returns ${expected} ${name}`, () => {
        const result = machines.shares({
          digest: '0xreceived',
          digests,
          entries,
          received: 'received',
        })

        expect(result).toBe(expected)
      })
  })

  describe('refusal', () => {
    // `expired` is the ended session, `renewed` its successor, and `other` another user's.
    const cases = [
      [
        'a store that holds the successor',
        {},
        renewed,
        { empty: true, session: renewed },
      ],
      ['an empty store', {}, undefined, { empty: true, session: expired }],
      [
        "a store that holds another user's session",
        {},
        other,
        { empty: false, session: expired },
      ],
      [
        'a sign-in after the refusal',
        { signIns: 1 },
        renewed,
        { empty: false, session: expired },
      ],
    ] as const

    for (const [name, current, stored, expected] of cases)
      test(`returns ${JSON.stringify({ empty: expected.empty })} for ${name}`, () => {
        const result = machines.refusal({
          current: context(current),
          ended: expired,
          refused: context(),
          stored,
        })

        expect(result).toEqual(expected)
      })
  })

  describe('refused', () => {
    const cases = [
      ['after a refusal', { refusals: 1 }, true],
      ['after a sign-out', { signOuts: 1 }, false],
      ["after another tab's change", { version: 1 }, false],
      ['after no change', {}, false],
    ] as const

    for (const [name, current, expected] of cases)
      test(`returns ${expected} ${name}`, () => {
        const result = machines.refused({
          current: context(current),
          started: context(),
        })

        expect(result).toBe(expected)
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
        { signingOut: { everywhere: false, pending: 0, runs: 1 } },
        true,
      ],
      [
        'a restore that started while a sign-out ran',
        { restore: true, started: { everywhere: false, pending: 0, runs: 1 } },
        {},
        true,
      ],
      ['a restore, after a sign-out', { restore: true }, { signOuts: 1 }, true],
      ['a restore, after no change', { restore: true }, {}, false],
      ['a sign-in, after a sign-in', {}, { signIns: 1, version: 1 }, false],
      [
        'a sign-in, while a sign-out runs',
        {},
        { signingOut: { everywhere: false, pending: 0, runs: 1 } },
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

  describe('overwrites', () => {
    const cases = [
      [
        "another context's sign-in, where none is held",
        expired,
        undefined,
        'expired',
      ],
      ["another user's session", other, renewed, 'renewed'],
      ['later tokens of the same user', renewed, expired, 'renewed'],
      ['an earlier copy of the held session', expired, renewed, undefined],
      ['the held session', renewed, renewed, undefined],
      ['an empty store', undefined, renewed, undefined],
    ] as const

    for (const [name, stored, held, expected] of cases)
      test(`returns ${expected ?? 'undefined'} for ${name}`, () => {
        const result = machines.overwrites({ held, stored })

        expect(result?.refreshToken).toBe(expected)
      })
  })

  describe('handoff', () => {
    const base = {
      held: true,
      kept: { ended: false, successor: 'k', token: 'k' },
      lacks: false,
      overwritten: { ended: false, successor: 'o', token: 'o' },
      refreshed: false,
      stored: true,
    } as const
    const cases = [
      ['no change', {}, 'yield'],
      ['a store without kept', { stored: false }, 'declined'],
      ['an instance without kept', { held: false }, 'declined'],
      ['unknown rotations', { lacks: true }, 'rotated'],
      [
        'a rotated overwritten token',
        { overwritten: { ended: false, successor: 'p', token: 'o' } },
        'rotated',
      ],
      [
        'a revoked overwritten token',
        { overwritten: { ended: true, successor: 'o', token: 'o' } },
        'rotated',
      ],
      [
        'a revoked kept token',
        { kept: { ended: true, successor: 'k', token: 'k' } },
        'kept',
      ],
      [
        'a rotated kept token',
        { kept: { ended: false, successor: undefined, token: 'k' } },
        'kept',
      ],
      ['a refresh of the replaced session', { refreshed: true }, 'kept'],
    ] as const

    for (const [name, change, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.handoff({ ...base, ...change })

        expect(result).toBe(expected)
      })
  })

  describe('yields', () => {
    /** Returns an access token that the DPoP key of thumbprint `jkt` binds. */
    const bound = (jkt: string) =>
      `e30.${btoa(JSON.stringify({ cnf: { jkt } })).replaceAll('=', '')}.sig`
    const dpop = Session.from({ ...expired, accessToken: bound('first') })
    const cases = [
      ['later tokens of the same user', expired, renewed, true],
      [
        'a later receipt of tokens that expire sooner, such as a sign-in sent before a refresh',
        Session.from({ ...renewed, receivedAt: 1 }),
        Session.from({ ...expired, receivedAt: 2 }),
        true,
      ],
      [
        'an earlier receipt of tokens that expire later, which an earlier release adopts',
        Session.from({ ...expired, receivedAt: 2 }),
        Session.from({ ...renewed, receivedAt: 1 }),
        true,
      ],
      ['the same expiry of the same user', renewed, renewed, false],
      ['earlier tokens of the same user', renewed, expired, false],
      ["another user's session", renewed, other, false],
      [
        'later tokens of the same DPoP key',
        dpop,
        Session.from({ ...renewed, accessToken: bound('first') }),
        true,
      ],
      [
        'later tokens of another DPoP key',
        dpop,
        Session.from({ ...renewed, accessToken: bound('second') }),
        false,
      ],
      ['later tokens without a DPoP key', dpop, renewed, false],
      [
        "later tokens of the user's other account",
        Session.from({ ...expired, address: `0x${'1'.repeat(40)}` }),
        Session.from({ ...renewed, address: `0x${'2'.repeat(40)}` }),
        false,
      ],
      [
        'later tokens of the same account',
        Session.from({ ...expired, address: `0x${'a'.repeat(40)}` }),
        Session.from({ ...renewed, address: `0x${'A'.repeat(40)}` }),
        true,
      ],
    ] as const

    for (const [name, kept, overwritten, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.yields({ kept, overwritten })

        expect(result).toBe(expected)
      })
  })

  describe('revokesKept', () => {
    const cases = [
      [
        'a later receipt and a later expiry',
        Session.from({ ...expired, receivedAt: 1 }),
        Session.from({ ...renewed, receivedAt: 2 }),
        true,
      ],
      [
        'a later receipt of an earlier expiry, which an earlier release rejects',
        Session.from({ ...renewed, receivedAt: 1 }),
        Session.from({ ...expired, receivedAt: 2 }),
        false,
      ],
      [
        'an earlier receipt of a later expiry, which this release can adopt back',
        Session.from({ ...expired, receivedAt: 2 }),
        Session.from({ ...renewed, receivedAt: 1 }),
        false,
      ],
      ['a later expiry without receipts', expired, renewed, true],
    ] as const

    for (const [name, kept, overwritten, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.revokesKept({ kept, overwritten })

        expect(result).toBe(expected)
      })
  })

  describe('clears', () => {
    const running = (runs: number) => ({ everywhere: false, pending: 0, runs })
    const cases = [
      ['no sign-out runs', undefined, undefined, true],
      ['a sign-out started after the change', undefined, running(1), false],
      ['a sign-out ran as the change started', running(1), running(1), true],
      [
        'another sign-out run started after the change',
        running(1),
        running(2),
        false,
      ],
      ['a sign-out run ended after the change', running(2), running(1), true],
    ] as const

    for (const [name, started, current, expected] of cases)
      test(`returns ${expected} when ${name}`, () => {
        const result = machines.clears({
          current: context({ signingOut: current }),
          started: context({ signingOut: started }),
        })

        expect(result).toBe(expected)
      })
  })

  describe('adopts', () => {
    const held = {
      expiresAt: 1_000,
      refreshToken: 'R0',
      user: { id: 'a' },
    } as never
    const entries = [{ at: 0, expiresAt: 1_500, from: 'digest', to: 'R1' }]
    const cases = [
      [
        'the held token, and a later session of the same user',
        'R0',
        2_000,
        'a',
        true,
      ],
      [
        'the held token, and an earlier session of the same user',
        'R0',
        500,
        'a',
        false,
      ],
      [
        'a successor, and a later session of the same user',
        'R1',
        2_000,
        'a',
        true,
      ],
      [
        'a successor, and an earlier session of the same user',
        'R1',
        1_200,
        'a',
        false,
      ],
      ['a successor, and a session of another user', 'R1', 1_200, 'b', true],
      ['a successor without an expiry', 'R2', 2_000, 'a', false],
    ] as const

    for (const [name, refreshToken, expiresAt, user, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.adopts({
          entries,
          held,
          refreshToken,
          stored: { expiresAt, user: { id: user } } as never,
        })

        expect(result).toBe(expected)
      })

    test('returns false without a stored session', () => {
      const result = machines.adopts({
        entries,
        held,
        refreshToken: 'R0',
        stored: undefined,
      })

      expect(result).toBe(false)
    })

    describe('with receipts', () => {
      const received = {
        expiresAt: 1_000,
        receivedAt: 100,
        refreshToken: 'R0',
        user: { id: 'a' },
      } as never
      const rotated = [{ at: 200, expiresAt: 1_500, from: 'digest', to: 'R1' }]
      const cases = [
        [
          'the held token, and a later receipt and expiry',
          'R0',
          2_000,
          300,
          true,
        ],
        [
          'the held token, and a later receipt of an earlier expiry, which an earlier release keeps',
          'R0',
          500,
          300,
          false,
        ],
        [
          'the held token, and an earlier receipt of a later expiry, which this release keeps',
          'R0',
          2_000,
          50,
          false,
        ],
        ['a successor, and a receipt after its save', 'R1', 2_000, 300, true],
        [
          "a successor, and a receipt after the held token's but before the successor's save",
          'R1',
          2_000,
          150,
          false,
        ],
        [
          'a successor, and an earlier receipt of a later expiry',
          'R1',
          2_000,
          50,
          false,
        ],
        [
          'a successor, and a later receipt of an earlier expiry',
          'R1',
          1_200,
          300,
          false,
        ],
      ] as const

      for (const [name, refreshToken, expiresAt, receivedAt, expected] of cases)
        test(`returns ${expected} for ${name}`, () => {
          const result = machines.adopts({
            entries: rotated,
            held: received,
            refreshToken,
            stored: { expiresAt, receivedAt, user: { id: 'a' } } as never,
          })

          expect(result).toBe(expected)
        })
    })
  })

  describe('lacks', () => {
    const entry = (at: number, truncated?: boolean) => ({
      at,
      from: 'digest',
      ...(truncated ? { truncated } : {}),
    })
    const cases = [
      ['no rotations', [], false],
      ['a short list that starts after the read', [entry(5_000)], false],
      [
        'a truncated list that starts after the read',
        [entry(5_000, true)],
        true,
      ],
      [
        'a truncated list that starts before the read',
        [entry(500, true)],
        false,
      ],
      [
        'a truncated list that starts within one second of the read',
        [entry(1_500, true)],
        true,
      ],
      [
        'a full list that starts after the read',
        Array.from({ length: 8 }, (_, index) => entry(5_000 + index)),
        true,
      ],
      [
        'a full list that starts before the read',
        Array.from({ length: 8 }, (_, index) => entry(500 + index)),
        false,
      ],
    ] as const

    for (const [name, entries, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.lacks({ entries, since: 2_000 })

        expect(result).toBe(expected)
      })
  })

  describe('resent', () => {
    const retained = new Map([
      ['r1', 0],
      ['r2', 1],
    ])
    const cases = [
      ['no logout since the tokens entered', 1, ['r2']],
      ["another tab's logout since every token entered", 2, []],
      ['no context', undefined, ['r1', 'r2']],
    ] as const

    for (const [name, remote, expected] of cases)
      test(`returns ${JSON.stringify(expected)} for ${name}`, () => {
        expect(machines.resent({ remote, retained })).toEqual(expected)
      })
  })

  describe('retains', () => {
    const base = {
      live: ['u1'],
      logouts: 3,
      persisted: undefined,
      retained: new Map<string, number>(),
      unsaved: ['u1'],
    }
    const cases = [
      ['an unsaved token without an answer', {}, [['u1', 3]]],
      ['an unanswered entry that the store took', { persisted: ['u1'] }, []],
      [
        'an unanswered entry that holds only the later tokens',
        { live: ['u1', 'u2'], persisted: ['u2'], unsaved: ['u1', 'u2'] },
        [['u1', 3]],
      ],
      ['an answered revocation', { live: [] }, []],
      [
        "a live token of a saved session, which the sign-out's own revocation left",
        { live: ['s1'], unsaved: ['s1'] },
        [['s1', 3]],
      ],
      [
        'a live token of an earlier sign-out, which the refused entry still holds',
        { unsaved: [] },
        [],
      ],
      [
        'a retained token without an answer again, which keeps its count',
        { retained: new Map([['u0', 1]]), live: ['u0'], unsaved: [] },
        [['u0', 1]],
      ],
      [
        'a retained token that received its answer',
        { retained: new Map([['u0', 1]]) },
        [['u1', 3]],
      ],
    ] as const

    for (const [name, values, expected] of cases)
      test(`returns ${JSON.stringify(expected)} for ${name}`, () => {
        const result = machines.retains({ ...base, ...values })

        expect([...result]).toEqual(expected)
      })
  })

  describe('revocable', () => {
    const rotation = { at: 5_000, from: 'digest', to: 'r2' }
    const base = {
      entries: [],
      held: true,
      live: 'r1',
      remote: false,
      revoked: undefined,
      since: 2_000,
      token: 'r1',
    } as const
    const cases = [
      ['an unrotated token', {}, true],
      ['no token', { token: undefined }, false],
      ['a token that Tempo ID revoked already', { revoked: 'r1' }, false],
      [
        "another tab's logout since the instance obtained the token",
        { remote: true },
        false,
      ],
      ['unreadable rotations', { entries: undefined }, false],
      [
        'a full list that can lack the rotation',
        { entries: Array.from({ length: 8 }, () => rotation) },
        false,
      ],
      [
        'a token that another context rotated',
        { entries: [rotation], live: 'r2' },
        false,
      ],
      ['a token whose lineage is unknown', { live: undefined }, false],
      [
        'a token that no store held, with unreadable rotations',
        { entries: undefined, held: false, live: undefined },
        true,
      ],
      [
        'a token that no store held, with a list that can lack the rotation',
        {
          entries: Array.from({ length: 8 }, () => rotation),
          held: false,
        },
        true,
      ],
      [
        "a token that no store held, after another tab's logout",
        { held: false, remote: true },
        false,
      ],
      [
        'a token that no store held, which Tempo ID revoked already',
        { held: false, revoked: 'r1' },
        false,
      ],
    ] as const

    for (const [name, values, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.revocable({ ...base, ...values })

        expect(result).toBe(expected)
      })
  })

  describe('restored', () => {
    const none = { remote: 0, running: 0, started: 0, succeeded: 0, unknown: 0 }
    const cases = [
      ['no logout overlapped', none, none, false],
      [
        'a logout of this instance runs',
        none,
        { remote: 0, running: 1, started: 1, succeeded: 0, unknown: 0 },
        undefined,
      ],
      [
        'Tempo ID refused a logout of this instance',
        none,
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
        false,
      ],
      [
        'Tempo ID refused a logout that ran at the start',
        { remote: 0, running: 1, started: 1, succeeded: 0, unknown: 0 },
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
        false,
      ],
      [
        'a logout of this instance succeeded, and its run continues',
        none,
        { remote: 0, running: 1, started: 1, succeeded: 1, unknown: 0 },
        true,
      ],
      [
        'a logout of this instance succeeded, and Tempo ID refused a later one',
        none,
        { remote: 0, running: 0, started: 2, succeeded: 1, unknown: 0 },
        true,
      ],
      [
        'a logout succeeded before the start, and Tempo ID refused a later one',
        { remote: 0, running: 0, started: 1, succeeded: 1, unknown: 0 },
        { remote: 0, running: 0, started: 2, succeeded: 1, unknown: 0 },
        false,
      ],
      [
        'a logout of this instance has an unknown outcome, and its run continues',
        none,
        { remote: 0, running: 1, started: 1, succeeded: 0, unknown: 1 },
        true,
      ],
      [
        "a logout of this instance has an unknown outcome, such as an overtaken sign-in's",
        none,
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 1 },
        true,
      ],
      [
        'a logout had an unknown outcome before the start, and Tempo ID refused a later one',
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 1 },
        { remote: 0, running: 0, started: 2, succeeded: 0, unknown: 1 },
        false,
      ],
      [
        "another tab's logout started",
        none,
        { remote: 1, running: 0, started: 1, succeeded: 0, unknown: 0 },
        true,
      ],
      [
        "another tab's logout started, and one of this instance runs",
        none,
        { remote: 1, running: 1, started: 2, succeeded: 0, unknown: 0 },
        true,
      ],
    ] as const

    for (const [name, started, current, expected] of cases)
      test(`returns ${expected} when ${name}`, () => {
        const result = machines.restored({
          current: context({ logouts: current }),
          started: context({ logouts: started }),
        })

        expect(result).toBe(expected)
      })
  })

  describe('loggedOut', () => {
    const cases = [
      [
        'no logout overlapped',
        { remote: 0, running: 0, started: 0, succeeded: 0, unknown: 0 },
        { remote: 0, running: 0, started: 0, succeeded: 0, unknown: 0 },
        false,
      ],
      [
        'a logout started since',
        { remote: 0, running: 0, started: 0, succeeded: 0, unknown: 0 },
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
        true,
      ],
      [
        'a logout ran at the start',
        { remote: 0, running: 1, started: 1, succeeded: 0, unknown: 0 },
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
        true,
      ],
      [
        'a logout ended before the start',
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
        { remote: 0, running: 0, started: 1, succeeded: 0, unknown: 0 },
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
        { signingOut: { everywhere: false, pending: 0, runs: 1 } },
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

  describe('reloadable', () => {
    const cases = [
      ['no change, and no sign-out', {}, true],
      ['a change during the read', { version: 2 }, false],
      [
        'a sign-out in progress that emptied no session yet',
        { signingOut: { everywhere: false, pending: 0, runs: 1 } },
        true,
      ],
      [
        'a sign-out in progress that emptied the session',
        {
          signedOut: 1,
          signingOut: { everywhere: false, pending: 0, runs: 1 },
        },
        false,
      ],
      [
        'a change that followed the sign-out in progress',
        {
          signedOut: 0,
          signingOut: { everywhere: false, pending: 0, runs: 1 },
        },
        true,
      ],
      ['a sign-out that ended', { signedOut: 1 }, true],
    ] as const

    for (const [name, current, expected] of cases)
      test(`returns ${expected} after ${name}`, () => {
        const result = machines.reloadable({
          current: context({ version: 1, ...current }),
          version: 1,
        })

        expect(result).toBe(expected)
      })
  })

  describe('arranged', () => {
    /** Returns an access key of `id` on `chainId`, with `lifetime`. */
    const entry = (
      id: string,
      chainId: number,
      lifetime?: number,
      account = '0x1',
    ) =>
      ({
        account,
        chainId,
        keyAuthorization: { keyId: id },
        ...(lifetime === undefined ? {} : { lifetime }),
      }) as never
    const account = { address: '0x1' } as never
    const held = Session.from({
      ...renewed,
      accessKeys: [entry('0xa', 1337)],
      account,
    })
    const refreshed = Session.from({
      ...renewed,
      accessKey: entry('0xa', 1337, 3600),
      accessToken: 'refreshed',
    })
    const signedIn = Session.from({ ...renewed, accessToken: 'signed-in' })
    const switched = Session.from({
      ...renewed,
      accessKey: entry('0xb', 42431),
      accessKeys: [entry('0xa', 1337)],
    })
    const cases = [
      [
        "keeps the held layout and account, with the stored tokens and entries, for another context's refresh on another chain",
        { chainId: 42431, current: held, stored: refreshed },
        {
          accessKey: undefined,
          accessKeys: ['1337:0xa:3600'],
          accessToken: 'refreshed',
          account: true,
        },
      ],
      [
        'takes a stored session without access keys as it is',
        { chainId: 1337, current: signedIn, stored: signedIn },
        {
          accessKey: undefined,
          accessKeys: [],
          accessToken: 'signed-in',
          account: false,
        },
      ],
      [
        "takes another user's session, and selects its access key on the chain",
        {
          chainId: 1337,
          current: held,
          stored: { ...switched, user: other.user },
        },
        {
          accessKey: '1337:0xa:',
          accessKeys: ['42431:0xb:'],
          accessToken: 'renewed',
          account: false,
        },
      ],
      [
        'takes the stored session as it is before the stored chain selection loads',
        { chainId: undefined, current: undefined, stored: switched },
        {
          accessKey: '42431:0xb:',
          accessKeys: ['1337:0xa:'],
          accessToken: 'renewed',
          account: false,
        },
      ],
      [
        "takes the stored layout where the held one holds another chain's access key as `accessKey`",
        {
          chainId: 42431,
          current: Session.from({
            ...switched,
            accessKey: entry('0xa', 1337),
            accessKeys: [entry('0xb', 42431)],
            account,
          }),
          stored: switched,
        },
        {
          accessKey: '42431:0xb:',
          accessKeys: ['1337:0xa:'],
          accessToken: 'renewed',
          account: false,
        },
      ],
      [
        'keeps the held account of a chain without an access key when the store authorizes a parked entry for another account',
        {
          chainId: 42431,
          current: held,
          stored: Session.from({
            ...refreshed,
            accessKey: entry('0xa', 1337, undefined, '0x2'),
          }),
        },
        {
          accessKey: undefined,
          accessKeys: ['1337:0xa:'],
          accessToken: 'refreshed',
          account: true,
        },
      ],
      [
        'drops the held account when the store authorizes its `accessKey` for another account',
        {
          chainId: 42431,
          current: Session.from({ ...switched, account }),
          stored: Session.from({
            ...switched,
            accessKey: entry('0xa', 1337),
            accessKeys: [entry('0xb', 42431, undefined, '0x2')],
            accessToken: 'refreshed',
          }),
        },
        {
          accessKey: '42431:0xb:',
          accessKeys: ['1337:0xa:'],
          accessToken: 'refreshed',
          account: false,
        },
      ],
    ] as const

    /** Returns the fields of `session` that the cases compare. */
    function fields(session: Session.Any | undefined) {
      const id = (entry: NonNullable<Session.Any['accessKey']>) =>
        `${entry.chainId}:${entry.keyAuthorization.keyId}:${entry.lifetime ?? ''}`
      return {
        accessKey: session?.accessKey ? id(session.accessKey) : undefined,
        accessKeys: (session?.accessKeys ?? []).map(id),
        accessToken: session?.accessToken,
        account: !!session?.account,
      }
    }

    for (const [name, options, expected] of cases)
      test(name, () => {
        const result = machines.arranged(options)

        expect(fields(result)).toEqual(expected)
      })
  })

  describe('empties', () => {
    const cases = [
      ['no session held', false, undefined, false],
      ['a session held', false, renewed, true],
      ['no session held, after a failed write', true, undefined, true],
      ['a session held, after a failed write', true, renewed, true],
    ] as const

    for (const [name, failed, current, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.empties({ current, failed })

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

  describe('renews', () => {
    const cases = [
      [
        'an expired session and an empty store',
        undefined,
        expired,
        true,
        expired,
      ],
      [
        'an expired session and a stored session',
        renewed,
        expired,
        true,
        undefined,
      ],
      [
        'a session that holds and an empty store',
        undefined,
        renewed,
        false,
        undefined,
      ],
      ['no session held', undefined, undefined, false, undefined],
    ] as const

    for (const [name, stored, current, expired, expected] of cases)
      test(`returns ${expected ? 'the session' : 'undefined'} for ${name}`, () => {
        const result = machines.renews({ current, expired, stored })

        expect(result).toBe(expected)
      })
  })

  describe('keepsAccount', () => {
    const address = '0x00000000000000000000000000000000000000Aa'
    const base = { accessToken: 'A0', user: { id: 'a' } }
    const accessKey = { account: address.toLowerCase(), chainId: 1 }
    const cases = [
      ['a session without an account', base, 1, true],
      ['no session', undefined, 1, false],
      ['a session with an account', { ...base, account: {} }, 1, false],
      ['another access token', { ...base, accessToken: 'A1' }, 1, false],
      ['another selected chain', base, 2, false],
      ['the access key of the account', { ...base, accessKey }, 1, true],
      [
        'an access key on another chain',
        { ...base, accessKey: { ...accessKey, chainId: 2 } },
        1,
        false,
      ],
      [
        'an access key of another account',
        { ...base, accessKey: { ...accessKey, account: '0xbb' } },
        1,
        false,
      ],
    ] as const

    for (const [name, session, selected, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.keepsAccount({
          accessToken: 'A0',
          account: { address },
          chainId: 1,
          selected,
          session: session as never,
        })

        expect(result).toBe(expected)
      })
  })

  describe('rotated', () => {
    const cases = [
      ['later tokens of the same user', renewed, 1, 0, expired, 0, true],
      [
        'later tokens of the same user obtained before the refresh started',
        renewed,
        1,
        0,
        expired,
        2,
        false,
      ],
      [
        'later tokens of the same user obtained in the millisecond the refresh started',
        renewed,
        1,
        0,
        expired,
        1,
        false,
      ],
      [
        'later tokens of the same user whose access token expired',
        renewed,
        1,
        2,
        expired,
        1,
        false,
      ],
      [
        'later tokens of the same user of unknown lifetime',
        renewed,
        undefined,
        0,
        expired,
        1,
        false,
      ],
      [
        'later tokens of the same user received after the refresh started, from a request that started before it',
        Session.from({ ...renewed, expiresAt: 3, receivedAt: 2 }),
        2,
        0,
        expired,
        1,
        true,
      ],
      [
        'later tokens of the same user received before the refresh started, from a request that started before it',
        Session.from({ ...renewed, expiresAt: 3, receivedAt: 1 }),
        2,
        0,
        expired,
        1,
        false,
      ],
      ['the same tokens', expired, 0, 0, expired, 0, false],
      ["another user's session", other, 1, 0, expired, 1, false],
      [
        'no session when the refresh started, and tokens obtained after it started',
        renewed,
        1,
        0,
        undefined,
        0,
        true,
      ],
      [
        'no session when the refresh started, and tokens obtained before it started',
        renewed,
        1,
        0,
        undefined,
        1,
        false,
      ],
    ] as const

    for (const [
      name,
      current,
      lifetime,
      now,
      started,
      startedAt,
      expected,
    ] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.rotated({
          current,
          lifetime,
          now,
          started,
          startedAt,
        })

        expect(result).toBe(expected)
      })
  })

  test('tracks no user at a refusal, so a refusal without an end, such as a failed save, keeps no user out', () => {
    const actor = createActor(machines.session).start()

    actor.send({ session: renewed, type: 'set' })
    actor.send({ type: 'change.refuse' })
    const refused = actor.getSnapshot().context.refusing
    actor.send({ type: 'refusal.start', userId: 'user_1' })
    const started = actor.getSnapshot().context.refusing
    actor.send({ type: 'refusal.end', userId: 'user_1' })

    expect({
      ended: actor.getSnapshot().context.refusing,
      refused,
      started,
    }).toMatchInlineSnapshot(`
      {
        "ended": [],
        "refused": [],
        "started": [
          "user_1",
        ],
      }
    `)
  })

  test('keeps the user of overlapping refusal ends until the last end', () => {
    const actor = createActor(machines.session).start()

    actor.send({ type: 'refusal.start', userId: 'user_1' })
    actor.send({ type: 'refusal.start', userId: 'user_1' })
    actor.send({ type: 'refusal.end', userId: 'user_1' })
    const first = actor.getSnapshot().context.refusing
    actor.send({ type: 'refusal.end', userId: 'user_1' })

    expect({
      first,
      last: actor.getSnapshot().context.refusing,
    }).toMatchInlineSnapshot(`
      {
        "first": [
          "user_1",
        ],
        "last": [],
      }
    `)
  })

  describe('refusing', () => {
    const cases = [
      ['the ended user', ['user_1'], renewed, true],
      ["a successor of the ended user's session", ['user_1'], expired, true],
      ['after the end of the refusal', [], renewed, false],
      ["another user's session", ['user_1'], other, false],
      ['an empty store', ['user_1'], undefined, false],
    ] as const

    for (const [name, refusing, stored, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.refusing({
          context: context({ refusing }),
          stored,
        })

        expect(result).toBe(expected)
      })
  })

  describe('signsIn', () => {
    const cases = [
      ['no session held', undefined, renewed, true],
      ["another user's session", other, renewed, true],
      ['the same user', expired, renewed, false],
      ['no adopted session', renewed, undefined, false],
    ] as const

    for (const [name, current, session, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.signsIn({ current, session })

        expect(result).toBe(expected)
      })
  })

  describe('signsOut', () => {
    const cases = [
      ['no sign-out', { signOut: false, stored: renewed }, false],
      ['a sign-out that emptied the store', { signOut: true }, true],
      [
        'a sign-out that the store does not show',
        { signOut: true, stored: renewed },
        false,
      ],
      [
        'a sign-out with everywhere on a shared store',
        { everywhere: true, signOut: true, stored: renewed },
        false,
      ],
      [
        'a sign-out with everywhere on a local store, after the sign-in and before a refresh',
        {
          at: 2,
          everywhere: true,
          local: true,
          signedIn: 1,
          signOut: true,
          stored: renewed,
        },
        true,
      ],
      [
        'a sign-out with everywhere on a local store, before a later sign-in',
        {
          at: 1,
          everywhere: true,
          local: true,
          signedIn: 2,
          signOut: true,
          stored: renewed,
        },
        false,
      ],
      [
        'a sign-out with everywhere on a local store, from a message without a time',
        {
          everywhere: true,
          local: true,
          signedIn: 2,
          signOut: true,
          stored: renewed,
        },
        true,
      ],
      [
        "a sign-out with everywhere on a local store, through the store's connect, before a later sign-in of the sender",
        {
          at: 2,
          connected: true,
          everywhere: true,
          local: true,
          signedIn: 0,
          signOut: true,
          stored: renewed,
        },
        false,
      ],
      [
        'a sign-out without everywhere on a local store',
        { at: 2, local: true, signedIn: 1, signOut: true, stored: renewed },
        false,
      ],
    ] as const

    for (const [name, options, expected] of cases)
      test(`returns ${expected} for ${name}`, () => {
        const result = machines.signsOut({
          at: undefined,
          connected: undefined,
          everywhere: undefined,
          local: undefined,
          signedIn: 0,
          stored: undefined,
          ...options,
        })

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
      { renewing: expired, session: undefined, signIn: false, type: 'adopt' },
    ],
    'authorize.end': (snapshot) =>
      snapshot.context.authorizations > 0 ? [{ type: 'authorize.end' }] : [],
    'authorize.start': (snapshot) =>
      snapshot.context.authorizations < 2 ? [{ type: 'authorize.start' }] : [],
    'change.commit': () => [{ type: 'change.commit' }],
    'change.refuse': () => [{ type: 'change.refuse' }],
    // A callback runs only inside an authorization, and ends only after it starts.
    'delegate.end': (snapshot) =>
      snapshot.context.delegations > 0 ? [{ type: 'delegate.end' }] : [],
    'delegate.start': (snapshot) =>
      snapshot.context.delegations < snapshot.context.authorizations
        ? [{ type: 'delegate.start' }]
        : [],
    hydrate: () => [
      { expired: true, session: expired, type: 'hydrate' },
      { expired: false, session: renewed, type: 'hydrate' },
      { expired: false, session: undefined, type: 'hydrate' },
    ],
    'lapsed.checked': () => [{ type: 'lapsed.checked' }],
    load: () => [{ type: 'load' }],
    'logout.remote': () => [{ type: 'logout.remote' }],
    // A logout succeeds only while its run is in progress.
    'logout.succeed': (snapshot) =>
      snapshot.context.logouts.running > 0 ? [{ type: 'logout.succeed' }] : [],
    // A logout in a run can have an unknown outcome, and an overtaken sign-in's starts after a
    // sign-out, in any state.
    'logout.unknown': () => [{ type: 'logout.unknown' }],
    // A refusal's end follows only its refusal.
    'refusal.end': (snapshot) =>
      snapshot.context.refusing.map((userId) => ({
        type: 'refusal.end' as const,
        userId,
      })),
    // The end of a refusal starts after a refusal empties a loaded session, one at a time.
    'refusal.start': (snapshot) =>
      snapshot.context.authorizations > 0 ||
      !snapshot.context.loaded ||
      snapshot.context.refusing.length > 0 ||
      snapshot.context.session
        ? []
        : [{ type: 'refusal.start', userId: 'user_1' }],
    'renewing.move': () => [{ chainId: 4217, type: 'renewing.move' }],
    save: () => [{ type: 'save' }],
    set: () => [
      { session: renewed, signIn: true, type: 'set' },
      { session: undefined, type: 'set' },
      { renewing: expired, session: undefined, type: 'set' },
    ],
    // A run empties the session once, after it starts.
    signOut: (snapshot) =>
      (snapshot.context.signingOut?.pending ?? 0) > 0
        ? [{ type: 'signOut' } as const]
        : [],
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
    'signOut.reject': () => [{ type: 'signOut.reject' }],
    'signOut.remote': () => [
      { marked: false, type: 'signOut.remote' },
      { marked: true, type: 'signOut.remote' },
    ],
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
   * The event of the timer of `signedIn`, which XState sends at the expiry of the session's access
   * keys. The runner sends no such event.
   */
  const expiry = {
    type: 'xstate.after.expiry.session.signedIn',
  } as unknown as machines.session.Event

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
      ...events['change.refuse'](snapshot),
      ...events['delegate.end'](snapshot),
      ...events['delegate.start'](snapshot),
      ...events.hydrate(snapshot),
      ...events['lapsed.checked'](snapshot),
      ...events.load(snapshot),
      ...events['logout.remote'](snapshot),
      ...events['logout.succeed'](snapshot),
      ...events['logout.unknown'](snapshot),
      ...events['refusal.end'](snapshot),
      ...events['refusal.start'](snapshot),
      ...events['renewing.move'](snapshot),
      ...events.save(snapshot),
      ...events.set(snapshot),
      ...events.signOut(snapshot),
      ...events['signOut.empty'](snapshot),
      ...events['signOut.finish'](snapshot),
      ...events['signOut.join'](snapshot),
      ...events['signOut.reject'](snapshot),
      ...events['signOut.remote'](snapshot),
      ...events['signOut.start'](snapshot),
      ...(snapshot.matches('signedIn') ? [expiry] : []),
    ],
    serializeState: (snapshot: machines.session.Snapshot) => {
      const {
        authorizations,
        checked,
        delegations,
        expired,
        loaded,
        logouts,
        marked,
        refusing,
        renewing,
        session,
        signedOut,
        signingOut,
        version,
      } = snapshot.context
      return JSON.stringify([
        snapshot.value,
        authorizations,
        checked === version,
        delegations,
        session !== undefined && session === expired,
        loaded,
        logouts.running,
        marked,
        refusing.length > 0,
        renewing?.refreshToken,
        session?.refreshToken,
        signedOut === version,
        signingOut,
      ])
    },
  }
})

describe('create', () => {
  test('clears the signed-out mark at a sign-in of an instance without a session machine', async () => {
    const session = Session.from({
      accessToken: 'a',
      expiresAt: 1,
      refreshToken: 'r',
      user: { email: 'tempo-id-test@example.org', id: 'user_1' },
    })
    const instance = create({
      chainId: () => 42431,
      enabled: false,
      name: 'tempo-id:session',
      signOut: () => Promise.resolve(),
    })

    await instance.signOut()
    const signedOut = await instance.signedOut()
    await instance.change().commit(session)
    const signedIn = await instance.signedOut()

    expect({ signedIn, signedOut }).toMatchInlineSnapshot(`
      {
        "signedIn": false,
        "signedOut": true,
      }
    `)
  })
})

describe('toChain', () => {
  const accessKeyA = { account: '0x1', chainId: 4217 } as never
  const accessKeyB = { account: '0x1', chainId: 42431 } as never
  const base = Session.from({
    accessToken: 'a',
    expiresAt: 1,
    refreshToken: 'r',
    user: { email: 'tempo-id-test@example.org', id: 'user_1' },
  })
  const account = { address: '0x1' } as never

  test('returns the session itself when its access key is on the chain', () => {
    const session = {
      ...base,
      accessKey: accessKeyA,
      accessKeys: [accessKeyB],
      account,
    }

    expect(toChain(session, { chainId: 4217 })).toBe(session)
  })

  test('returns the session itself without an access key', () => {
    const session = { ...base, account }

    expect(toChain(session, { chainId: 42431 })).toBe(session)
  })

  test('selects the access key on the chain, keeps the other in `accessKeys`, and drops the account', () => {
    const session = {
      ...base,
      accessKey: accessKeyA,
      accessKeys: [accessKeyB],
      account,
    }

    expect(toChain(session, { chainId: 42431 })).toEqual({
      ...base,
      accessKey: accessKeyB,
      accessKeys: [accessKeyA],
    })
  })

  test('moves the access key to `accessKeys` on a chain without one, and drops the account', () => {
    const session = { ...base, accessKey: accessKeyA, account }

    expect(toChain(session, { chainId: 42431 })).toEqual({
      ...base,
      accessKeys: [accessKeyA],
    })
  })
})
