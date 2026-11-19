/**
 * Tests the decisions of the popup that need no browser window: whether a page on `http:` signs in
 * with a popup in place of a frame, and the watch that decides when the user closed a popup.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import { createActor, fromCallback, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Popup from './Popup.js'
import { machines } from './Popup.js'

/** Milliseconds of each delay of the watch that a test sets, in place of the module's. */
type Delays = {
  /** The grace of a closed popup for a late callback. */
  closeGrace?: number
  /** The time that the handle reads open on a foreign page before the popup counts as open. */
  settle?: number
}

describe('http', () => {
  const rows = [
    {
      expected: true,
      name: 'opens a popup on a local page for a Tempo ID on `https:`',
      page: 'http://localhost:5190/',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: true,
      name: 'opens a popup on a page of a loopback address for a Tempo ID on `https:`',
      page: 'http://127.0.0.1:5190/settings?tab=keys',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: false,
      name: 'keeps the frame on a page on `https:`',
      page: 'https://app.example/',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: false,
      name: 'keeps the frame on a local page for a local Tempo ID on `http:`',
      page: 'http://localhost:5290/',
      url: 'http://localhost:8787',
    },
    {
      expected: false,
      name: 'keeps the frame on a page on `https:` for a local Tempo ID on `http:`',
      page: 'https://localhost:5290/',
      url: 'http://localhost:8787',
    },
  ] as const

  for (const row of rows)
    test(row.name, () => {
      const result = Popup.http({ page: row.page, url: row.url })

      expect(result).toBe(row.expected)
    })
})

describe('machines.watch', () => {
  test('closes a popup whose page reported that it loaded, after the grace for a late callback', async () => {
    const watch = start({ closeGrace: 0 })

    watch.actor.send({ type: 'handle.local' })
    watch.actor.send({ type: 'popup.open' })
    watch.actor.send({ type: 'handle.closed' })
    const closing = watch.actor.getSnapshot().value
    await waitFor(watch.actor, (snapshot) => snapshot.status === 'done')

    expect(closing).toMatchInlineSnapshot(`"closing"`)
    expect(watch.actor.getSnapshot().value).toMatchInlineSnapshot(`"closed"`)
    expect(watch.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "closed",
        "close",
        "popup.stop",
      ]
    `)
  })

  test('closes a popup that stays open on a page of another origin for the settle, such as an offline error page', async () => {
    const watch = start({ closeGrace: 0, settle: 0 })

    watch.actor.send({ type: 'handle.foreign' })
    await waitFor(watch.actor, (snapshot) => snapshot.matches('open'))
    watch.actor.send({ type: 'handle.closed' })
    await waitFor(watch.actor, (snapshot) => snapshot.status === 'done')

    expect(watch.actor.getSnapshot().value).toMatchInlineSnapshot(`"closed"`)
    expect(watch.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "closed",
        "close",
        "popup.stop",
      ]
    `)
  })

  test('keeps the watch of a handle that severs before the settle, or before the page reports', () => {
    const watch = start({ settle: 60_000 })

    watch.actor.send({ type: 'handle.foreign' })
    watch.actor.send({ type: 'handle.closed' })
    watch.actor.send({ type: 'handle.closed' })

    expect(watch.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"unconfirmed"`,
    )
    expect(watch.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
      ]
    `)
    watch.actor.stop()
  })

  test('delivers a callback that arrives during the grace, and no close', () => {
    const watch = start({ closeGrace: 60_000 })

    watch.actor.send({ type: 'popup.open' })
    watch.actor.send({ type: 'handle.closed' })
    watch.actor.send({
      callback: { url: 'https://app.example/callback?code=1&state=2' },
      type: 'popup.callback',
    })

    expect(watch.actor.getSnapshot().value).toMatchInlineSnapshot(`"received"`)
    expect(watch.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "closed",
        {
          "callback": {
            "url": "https://app.example/callback?code=1&state=2",
          },
        },
        "popup.stop",
      ]
    `)
  })

  test('ends at a stop with no effect, and stops the poll', () => {
    const watch = start()

    watch.actor.send({ type: 'popup.open' })
    watch.actor.send({ type: 'watch.stop' })

    expect(watch.actor.getSnapshot().value).toMatchInlineSnapshot(`"stopped"`)
    expect(watch.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('reaches every state along its shortest paths, handles every event type, and ends in no transient state', () => {
    const snapshots = getShortestPaths(machines.watch, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
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
        "closed",
        "closing",
        "open",
        "received",
        "settling",
        "stopped",
        "unconfirmed",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
  })

  /** The events of the watch's timers, which `after` sends in each state. */
  const expiries = {
    closeGrace: { type: 'xstate.after.closeGrace.watch.closing' },
    settle: { type: 'xstate.after.settle.watch.settling' },
  } as const

  /** A machine event, or the event of a timer. */
  type Step = machines.watch.Event | (typeof expiries)[keyof typeof expiries]

  /** The events of each type that the runner sends, or that a timer sends, from a snapshot. */
  const events: {
    [type in Step['type']]: (
      snapshot: machines.watch.Snapshot,
    ) => readonly Step[]
  } = {
    'handle.closed': () => [{ type: 'handle.closed' }],
    'handle.foreign': () => [{ type: 'handle.foreign' }],
    'handle.local': () => [{ type: 'handle.local' }],
    'popup.callback': () => [
      {
        callback: { url: 'https://app.example/callback?code=1&state=2' },
        type: 'popup.callback',
      },
    ],
    'popup.open': () => [{ type: 'popup.open' }],
    'watch.stop': () => [{ type: 'watch.stop' }],
    'xstate.after.closeGrace.watch.closing': (snapshot) =>
      snapshot.matches('closing') ? [expiries.closeGrace] : [],
    'xstate.after.settle.watch.settling': (snapshot) =>
      snapshot.matches('settling') ? [expiries.settle] : [],
  }

  /** The traversal of the machine's graph. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: machines.watch.Snapshot) =>
      Object.values(events).flatMap((fn) =>
        fn(snapshot),
      ) as readonly machines.watch.Event[],
    serializeState: (snapshot: machines.watch.Snapshot) =>
      JSON.stringify(snapshot.value),
  }

  /**
   * Starts the watch with `delays` in place of its own, and records the provided actions and the
   * start and stop of the invoked poll, in order.
   */
  function start(delays: Delays = {}) {
    const effects: unknown[] = []
    const actor = createActor(
      machines.watch.provide({
        actions: {
          callback: (_args, params) => effects.push(params),
          close: () => effects.push('close'),
          closed: () => effects.push('closed'),
        },
        actors: {
          popup: fromCallback(() => {
            effects.push('popup.start')
            return () => effects.push('popup.stop')
          }),
        },
        delays,
      }),
    ).start()

    return { actor, effects }
  }
})
