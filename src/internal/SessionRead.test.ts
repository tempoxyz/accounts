/**
 * Tests the reads of an instance's session: the machine of a status subscription's read beside the
 * reads of the page, and the runner that keeps a failure for the page's next read.
 * @module
 */
import { createActor, fromPromise, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import { describe, expect, test } from 'vite-plus/test'
import * as SessionRead from './SessionRead.js'

describe('machines.read', () => {
  test('keeps the failure of a read that no read of the page overlapped, which the next read takes', async () => {
    const actor = createActor(
      SessionRead.machines.read.provide({
        actors: {
          read: fromPromise(() => Promise.reject(new Error('Refused.'))),
        },
      }),
    ).start()

    actor.send({ loaded: false, type: 'follow.start' })
    await expect.poll(() => actor.getSnapshot().value).toBe('unreported')
    const failure = SessionRead.machines.failure(actor.getSnapshot())
    actor.send({ type: 'failure.take' })

    expect({
      failure: failure && (failure.error as Error).message,
      value: actor.getSnapshot().value,
    }).toMatchInlineSnapshot(`
      {
        "failure": "Refused.",
        "value": "idle",
      }
    `)
  })

  test('keeps no failure that a read of the page beside it rejected with, since that read joined its hooks', async () => {
    const refusal = new Error('Refused.')
    const settle = Promise.withResolvers<unknown>()
    const actor = createActor(
      SessionRead.machines.read.provide({
        actors: {
          read: fromPromise(() => settle.promise),
        },
      }),
    ).start()

    actor.send({ loaded: false, type: 'follow.start' })
    actor.send({ type: 'page.start' })
    actor.send({ failure: { error: refusal }, type: 'page.end' })
    settle.reject(refusal)
    await expect.poll(() => actor.getSnapshot().value).toBe('idle')

    expect(actor.getSnapshot().context).toMatchInlineSnapshot(`
      {
        "delivered": [],
        "failure": undefined,
        "pages": 0,
      }
    `)
  })

  test('keeps the failure beside a read of the page that resolved, since that read ran the hooks again', async () => {
    const settle = Promise.withResolvers<unknown>()
    const actor = createActor(
      SessionRead.machines.read.provide({
        actors: {
          read: fromPromise(() => settle.promise),
        },
      }),
    ).start()

    actor.send({ loaded: false, type: 'follow.start' })
    actor.send({ type: 'page.start' })
    actor.send({ type: 'page.end' })
    settle.reject(new Error('Refused.'))
    await expect.poll(() => actor.getSnapshot().value).toBe('unreported')

    const failure = SessionRead.machines.failure(actor.getSnapshot())
    expect(failure && (failure.error as Error).message).toMatchInlineSnapshot(
      `"Refused."`,
    )
  })

  test('drops the kept failure once a read of the page that ran beside the read rejects with it', async () => {
    const refusal = new Error('Refused.')
    const actor = createActor(
      SessionRead.machines.read.provide({
        actors: {
          read: fromPromise(() => Promise.reject(refusal)),
        },
      }),
    ).start()

    actor.send({ loaded: false, type: 'follow.start' })
    actor.send({ type: 'page.start' })
    await expect.poll(() => actor.getSnapshot().value).toBe('unreported')
    actor.send({ failure: { error: refusal }, type: 'page.end' })

    expect(actor.getSnapshot().value).toMatchInlineSnapshot(`"idle"`)
  })

  test('starts no read for a loaded session, or beside a read of the page', () => {
    const reads: string[] = []
    const actor = createActor(
      SessionRead.machines.read.provide({
        actors: {
          read: fromPromise<unknown>(() => {
            reads.push('read')
            return Promise.resolve()
          }),
        },
      }),
    ).start()

    actor.send({ loaded: true, type: 'follow.start' })
    actor.send({ type: 'page.start' })
    actor.send({ loaded: false, type: 'follow.start' })

    expect({ reads, value: actor.getSnapshot().value }).toMatchInlineSnapshot(`
      {
        "reads": [],
        "value": "idle",
      }
    `)
  })

  test('reaches every state along its shortest paths, and handles every event type', () => {
    const snapshots = getShortestPaths(
      SessionRead.machines.read,
      traversal,
    ).map((path) => path.state)

    const reached = new Set(
      snapshots.map((snapshot) => JSON.stringify(snapshot.value)),
    )
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
        ""idle"",
        ""reading"",
        ""unreported"",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    // The raw context agrees with each state: only `unreported` holds a failure.
    expect(
      snapshots.every(
        (snapshot) =>
          (snapshot.context.failure !== undefined) ===
          snapshot.matches('unreported'),
      ),
    ).toBe(true)
  })

  /** The events of the invoked read, which settles in `reading`. */
  const done = { output: undefined, type: 'xstate.done.actor.read' } as const
  const failed = {
    error: new Error('Refused.'),
    type: 'xstate.error.actor.read',
  } as const

  /** A machine event, or an event of the invoked read. */
  type Step = SessionRead.machines.read.Event | typeof done | typeof failed

  /** The events of each type that the runner sends from a snapshot. */
  const events: {
    [type in Step['type']]: (
      snapshot: SessionRead.machines.read.Snapshot,
    ) => readonly Step[]
  } = {
    'failure.take': (snapshot) =>
      snapshot.matches('unreported') ? [{ type: 'failure.take' }] : [],
    'follow.start': () => [
      { loaded: false, type: 'follow.start' },
      { loaded: true, type: 'follow.start' },
    ],
    // The runner ends only a read that started, and starts none while a failure waits.
    'page.end': (snapshot) =>
      snapshot.context.pages > 0
        ? [
            { type: 'page.end' },
            { failure: { error: failed.error }, type: 'page.end' },
          ]
        : [],
    'page.start': (snapshot) =>
      snapshot.matches('unreported') || snapshot.context.pages > 0
        ? []
        : [{ type: 'page.start' }],
    'session.change': () => [{ type: 'session.change' }],
    'xstate.done.actor.read': (snapshot) =>
      snapshot.matches('reading') ? [done] : [],
    'xstate.error.actor.read': (snapshot) =>
      snapshot.matches('reading') ? [failed] : [],
  }

  /** The traversal of the machine's graph, keyed by the state, whether a read of the page runs, and whether one delivered a failure. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: SessionRead.machines.read.Snapshot) =>
      Object.values(events).flatMap((fn) =>
        fn(snapshot),
      ) as readonly SessionRead.machines.read.Event[],
    serializeState: (snapshot: SessionRead.machines.read.Snapshot) =>
      JSON.stringify([
        snapshot.value,
        snapshot.context.pages > 0,
        snapshot.context.delivered.length > 0,
      ]),
  }
})

describe('create', () => {
  /** Returns reads whose subscription's read fails, as `refusal` describes, once. */
  function refusing(refusal: 'hook' | 'store') {
    let refused = false
    const failure = new Error('Refused.')
    const reads = SessionRead.create({
      // The session stays unread, also for a hook's failure beside a failed read of the store.
      loaded: () => false,
      read: () => {
        if (refused) return Promise.resolve()
        refused = true
        return Promise.reject(failure)
      },
      refused: (error) => refusal === 'hook' && error === failure,
    })
    return reads
  }

  /** Runs two reads of the page, and returns their results. */
  async function page(reads: SessionRead.create.ReturnType) {
    const first = await reads
      .run(() => Promise.resolve('read'))
      .catch((error: Error) => error.message)
    const second = await reads.run(() => Promise.resolve('read'))
    return { first, second }
  }

  /** Waits for the subscription's read, which starts after the code that subscribes, to settle. */
  const settled = async (reads: SessionRead.create.ReturnType) => {
    await Promise.resolve()
    await waitFor(reads.actor, (snapshot) => !snapshot.matches('reading'), {
      timeout: 1_000,
    })
  }

  test("throws a restore hook's failure in a subscription's read at the next read of the page, once", async () => {
    const reads = refusing('hook')

    reads.follow()
    await settled(reads)

    expect(await page(reads)).toMatchInlineSnapshot(`
      {
        "first": "Refused.",
        "second": "read",
      }
    `)
  })

  test("keeps no failure of the store's read, so the next read of the page reads again", async () => {
    const reads = refusing('store')

    reads.follow()
    await settled(reads)

    expect(await page(reads)).toMatchInlineSnapshot(`
      {
        "first": "read",
        "second": "read",
      }
    `)
  })

  test('drops the failure at a change of the session, such as a sign-in', async () => {
    const reads = refusing('hook')

    reads.follow()
    await settled(reads)
    reads.change()

    expect(await page(reads)).toMatchInlineSnapshot(`
      {
        "first": "read",
        "second": "read",
      }
    `)
  })
})
