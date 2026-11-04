/**
 * Runs the React plugin's restore machine on its own: which mounts authorize, which share a run,
 * when a page stays signed out, when a decline ends, and which failures are transient. The graph
 * tests step the machine with `getNextSnapshot`, so the retry's delay needs no timer.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import {
  createActor,
  fromPromise,
  getNextSnapshot,
  initialTransition,
  waitFor,
} from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Accounts from '../Accounts.js'
import { machines } from './index.js'

describe('machines.restore', () => {
  describe('machine', () => {
    test('authorizes at the first mount, shares that run with a mount during it, and checks without an authorization after a decline', async () => {
      const restores = start([declined, declined])

      restores.actor.send({ type: 'component.mount' })
      restores.actor.send({ type: 'component.mount' })
      await settled(restores.actor)
      restores.actor.send({ type: 'component.mount' })
      await settled(restores.actor)

      expect(restores.inputs).toEqual([
        { reauthorize: true },
        { reauthorize: false },
      ])
      expect(restores.actor.getSnapshot().value).toEqual({
        declined: 'waiting',
      })
    })

    test('authorizes again at the next mount after a status change ends a decline', async () => {
      const restores = start([declined, signedIn])

      restores.actor.send({ type: 'component.mount' })
      await settled(restores.actor)
      restores.actor.send({ type: 'session.status' })
      restores.actor.send({ type: 'component.mount' })
      await settled(restores.actor)

      expect(restores.inputs).toEqual([
        { reauthorize: true },
        { reauthorize: true },
      ])
      expect(restores.actor.getSnapshot().value).toBe('idle')
    })

    test('records the error of a failed restore, which the next mount clears as it authorizes again', async () => {
      const error = new Error('The store is unavailable.')
      const restores = start([error, signedIn])

      restores.actor.send({ type: 'component.mount' })
      const failed = await settled(restores.actor)
      restores.actor.send({ type: 'component.mount' })
      const retried = await settled(restores.actor)

      expect(failed.context.error).toBe(error)
      expect(retried.context.error).toBeUndefined()
      expect(restores.inputs).toEqual([
        { reauthorize: true },
        { reauthorize: true },
      ])
    })

    test('declines after a transient failure, checks without an authorization at a mount, and authorizes again after the delay', () => {
      const [initial] = initialTransition(machines.restore)

      const failed = step(initial, { type: 'component.mount' }, done(transient))
      const checked = step(failed, { type: 'component.mount' }, done(transient))
      const retried = step(checked, delay)

      expect(failed.value).toEqual({ declined: 'waiting' })
      expect(step(failed, { type: 'component.mount' }).value).toEqual({
        declined: 'checking',
      })
      expect(checked.context.retry).toBe(true)
      expect(retried.value).toBe('idle')
      expect(step(retried, { type: 'component.mount' }).value).toBe(
        'authorizing',
      )
    })

    test('keeps a decline after a refusal that repeats past the delay, until the status changes', () => {
      const [initial] = initialTransition(machines.restore)

      const refused = step(initial, { type: 'component.mount' }, done(declined))

      expect(refused.context.retry).toBe(false)
      expect(step(refused, delay).value).toEqual({ declined: 'waiting' })
      expect(step(refused, { type: 'session.status' }).value).toBe('idle')
    })

    test('authorizes again at the deadline of a transient decline, also while mounts check the session more often than the delay', async () => {
      const restores = start([transient, ...Array(1_000).fill(declined)], {
        retry: 50,
      })

      restores.actor.send({ type: 'component.mount' })
      await settled(restores.actor)
      const mounts = setInterval(
        () => restores.actor.send({ type: 'component.mount' }),
        10,
      )
      const retried = await waitFor(
        restores.actor,
        (snapshot) =>
          snapshot.matches('idle') || snapshot.matches('authorizing'),
        { timeout: 1_000 },
      ).finally(() => clearInterval(mounts))

      expect(retried.matches('declined')).toBe(false)
      expect(restores.inputs.at(0)).toEqual({ reauthorize: true })
      expect(
        restores.inputs.filter((input) => !input.reauthorize).length,
      ).toBeGreaterThan(1)
    })

    test('lets a check settle when the deadline or a status change ends the decline during it, and then leaves the decline', () => {
      const [initial] = initialTransition(machines.restore)
      const failed = step(initial, { type: 'component.mount' }, done(transient))
      const checking = step(failed, { type: 'component.mount' })

      const due = step(checking, delay)
      const changed = step(checking, { type: 'session.status' })

      expect(due.value).toEqual({ declined: 'checking' })
      expect(machines.running(due)).toBe(true)
      expect(step(due, done(declined)).value).toBe('idle')
      expect(changed.value).toEqual({ declined: 'checking' })
      expect(step(changed, done(declined)).value).toBe('idle')
      expect(step(changed, failure).context.error).toBe(failure.error)
    })

    test('reaches every state along its shortest paths, and handles every event type from a state that it reaches', () => {
      const snapshots = getShortestPaths(machines.restore, traversal).map(
        (path) => path.state,
      )

      const reached = new Set(snapshots.map((snapshot) => name(snapshot.value)))
      const handled = new Set(
        snapshots.flatMap((snapshot) =>
          traversal
            .events(snapshot)
            .filter((event) => snapshot.can(event))
            .map((event) => event.type),
        ),
      )

      expect([...reached].sort()).toMatchInlineSnapshot(`
        [
          "authorizing",
          "declined.checking",
          "declined.waiting",
          "idle",
        ]
      `)
      expect([...handled].sort()).toEqual(Object.keys(events).sort())
    })

    test('starts no authorization at a mount on a page that it declined, in every state that it reaches', () => {
      const snapshots = getShortestPaths(machines.restore, traversal).map(
        (path) => path.state,
      )

      const authorizing = snapshots
        .filter((snapshot) => snapshot.matches('declined'))
        .map((snapshot) => step(snapshot, { type: 'component.mount' }))

      expect(authorizing.length).toBeGreaterThan(0)
      expect(
        authorizing.every(
          (snapshot) =>
            snapshot.matches('declined') && !snapshot.matches('authorizing'),
        ),
      ).toBe(true)
    })
  })

  describe('transient', () => {
    test('retries an error without an answer, a server error, and a refusal for load', () => {
      expect(machines.transient(new TypeError('Failed to fetch'))).toBe(true)
      expect(machines.transient(refusal({ status: 0 }))).toBe(true)
      expect(machines.transient(refusal({ status: 503 }))).toBe(true)
      expect(
        machines.transient(refusal({ reason: 'rate_limited', status: 429 })),
      ).toBe(true)
      expect(
        machines.transient(
          refusal({ reason: 'upstream_unavailable', status: 503 }),
        ),
      ).toBe(true)
    })

    test('declines a refusal that repeats at every attempt', () => {
      expect(
        machines.transient(
          refusal({ reason: 'webauthn_required', status: 403 }),
        ),
      ).toBe(false)
      expect(
        machines.transient(
          refusal({ reason: 'reauthentication_required', status: 401 }),
        ),
      ).toBe(false)
      expect(
        machines.transient(refusal({ reason: 'rejected', status: 400 })),
      ).toBe(false)
    })
  })

  /** The output of a restore that found the session. */
  const signedIn: machines.restore.Output = {
    declined: false,
    transient: false,
  }

  /** The output of a restore that left the page signed out, such as after a refusal that repeats. */
  const declined: machines.restore.Output = { declined: true, transient: false }

  /** The output of a restore whose authorization failed transiently. */
  const transient: machines.restore.Output = { declined: true, transient: true }

  /** The event of the retry's delay, which the machine schedules in `declined`. */
  const delay = { type: 'xstate.after.retry.restore.declined' } as const

  /** Returns the done event of the invoked restore, with `output`. */
  function done(output: machines.restore.Output) {
    return { output, type: 'xstate.done.actor.restore' } as const
  }

  /** The event that the invoked restore sends when it fails. */
  const failure = {
    error: new Error('The store is unavailable.'),
    type: 'xstate.error.actor.restore',
  } as const

  /** A machine event, or an event that the machine's invoked restore or its delay sends. */
  type Step =
    | machines.restore.Event
    | ReturnType<typeof done>
    | typeof delay
    | typeof failure

  /** Returns the snapshot after `steps`, in order, from `snapshot`. */
  function step(
    snapshot: machines.restore.Snapshot,
    ...steps: readonly Step[]
  ) {
    return steps.reduce(
      (current, event) =>
        // The invoked restore's and the delay's events are not in `Event`, which the machine's
        // types name, but the machine handles them.
        getNextSnapshot(
          machines.restore,
          current,
          event as machines.restore.Event,
        ),
      snapshot,
    )
  }

  /**
   * The events of each type that the machine receives from a snapshot: its own, and those of its
   * invoked restore and its delay. A `Record` of every type, so a new event fails the type check until
   * the traversal sends it.
   */
  const events: {
    [type in Step['type']]: (
      snapshot: machines.restore.Snapshot,
    ) => readonly Step[]
  } = {
    'component.mount': () => [{ type: 'component.mount' }],
    'session.status': () => [{ type: 'session.status' }],
    'xstate.after.retry.restore.declined': () => [delay],
    'xstate.done.actor.restore': () => [
      done(signedIn),
      done(declined),
      done(transient),
    ],
    'xstate.error.actor.restore': () => [failure],
  }

  /**
   * The traversal of the machine's graph, keyed by the state, whether the decline ended during a check,
   * and the retry of the last decline.
   */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: machines.restore.Snapshot) =>
      [
        ...events['component.mount'](snapshot),
        ...events['session.status'](snapshot),
        ...events['xstate.after.retry.restore.declined'](snapshot),
        ...events['xstate.done.actor.restore'](snapshot),
        ...events['xstate.error.actor.restore'](snapshot),
      ] as readonly machines.restore.Event[],
    serializeState: (snapshot: machines.restore.Snapshot) =>
      JSON.stringify([
        snapshot.value,
        snapshot.context.ended,
        snapshot.context.retry,
      ]),
  }

  /** Returns the dotted path of a state value, such as `declined.checking`. */
  function name(value: machines.restore.Snapshot['value']) {
    if (typeof value === 'string') return value
    return Object.entries(value)
      .map((entry) => `${entry[0]}.${String(entry[1])}`)
      .join()
  }

  /** Returns a refusal of Tempo ID with `status`, and `reason` when it names one. */
  function refusal(options: {
    reason?: Accounts.RequestError.Reason | undefined
    status: number
  }) {
    return new Accounts.RequestError({
      code: 'invalid_request',
      message: 'Refused.',
      reason: options.reason,
      status: options.status,
    })
  }

  /**
   * Starts the machine with a restore that returns, or throws, each of `results` in order, and records
   * the input of each restore. `delays.retry` replaces the retry's delay, in milliseconds.
   */
  function start(
    results: readonly (machines.restore.Output | Error)[],
    delays: { retry?: number | undefined } = {},
  ) {
    const inputs: machines.restore.Input[] = []
    const actor = createActor(
      machines.restore.provide({
        ...(delays.retry === undefined
          ? {}
          : { delays: { retry: delays.retry } }),
        actors: {
          restore: fromPromise<machines.restore.Output, machines.restore.Input>(
            (args) => {
              const result = results[inputs.length]
              inputs.push(args.input)
              if (result instanceof Error) return Promise.reject(result)
              return Promise.resolve(result ?? signedIn)
            },
          ),
        },
      }),
    ).start()
    return { actor, inputs }
  }

  /** Returns the snapshot once no restore runs. */
  function settled(actor: machines.restore.Actor) {
    return waitFor(actor, (snapshot) => !machines.running(snapshot))
  }
})
