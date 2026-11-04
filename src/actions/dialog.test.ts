/**
 * Runs the machine of an instance's dialog on its own, with no frame: the sign-in that holds the
 * dialog, the replacement that the next one emits, the frame that a sign-in takes or keeps, and
 * `ending`'s decision for each case. The `test/e2e/web-dialog.e2e.ts` of `tempoxyz/id` runs the same
 * machine through its web playground.
 * @module
 */
import type * as Sheet from '../internal/Sheet.js'
import { createActor } from 'xstate'
import { describe, expect, test } from 'vite-plus/test'
import { getShortestPaths } from 'xstate/graph'
import { machines } from './dialog.js'

describe('machines.dialog', () => {
  describe('machine', () => {
    test('reaches each pair of states along its shortest paths, and holds an entry only while preloaded', () => {
      const paths = getShortestPaths(machines.dialog, {
        events: (snapshot) => [
          { type: 'discard' as const },
          { entry: entry('a'), type: 'preload' as const },
          { type: 'replace' as const },
          { type: 'start' as const },
          { reuse: true, type: 'take' as const },
          { reuse: false, type: 'take' as const },
          {
            call: snapshot.context.call ?? 0,
            kept: undefined,
            type: 'end' as const,
          },
          {
            call: snapshot.context.call ?? 0,
            kept: entry('b'),
            type: 'end' as const,
          },
        ],
        // The token grows at each start, so the traversal reads only whether a sign-in holds the dialog.
        serializeState: (snapshot) =>
          JSON.stringify([snapshot.value, snapshot.context.entry?.redirectUri]),
      })

      const ends = paths.map((path) => path.state)

      expect(
        [...new Set(ends.map((state) => JSON.stringify(state.value)))].sort(),
      ).toMatchInlineSnapshot(`
        [
          "{"call":"idle","frame":"empty"}",
          "{"call":"idle","frame":"preloaded"}",
          "{"call":"running","frame":"empty"}",
          "{"call":"running","frame":"preloaded"}",
        ]
      `)
      expect(
        ends.every(
          (state) =>
            state.matches({ frame: 'preloaded' }) ===
            (state.context.entry !== undefined),
        ),
      ).toBe(true)
    })

    test('emits replaced for the sign-in that holds the dialog, and ends only the latest sign-in', () => {
      const replaced: number[] = []
      const actor = createActor(machines.dialog).start()
      actor.on('replaced', (event) => replaced.push(event.call))

      actor.send({ type: 'replace' })
      actor.send({ type: 'start' })
      actor.send({ type: 'replace' })
      actor.send({ type: 'start' })
      const ended = machines.ending(actor.getSnapshot(), {
        call: 1,
        framed: true,
      })
      actor.send({ call: 1, kept: undefined, type: 'end' })
      const running = actor.getSnapshot().context.call
      actor.send({ call: 2, kept: undefined, type: 'end' })

      expect(replaced).toEqual([1])
      expect(ended).toEqual({ keep: false, owned: false })
      expect(running).toBe(2)
      expect(actor.getSnapshot().value).toEqual({
        call: 'idle',
        frame: 'empty',
      })
    })

    test('keeps the replaced sign-in as the holder when the replacing one never starts, such as when the browser blocks its popup', () => {
      const actor = createActor(machines.dialog).start()
      actor.send({ type: 'replace' })
      actor.send({ type: 'start' })

      actor.send({ type: 'replace' })

      expect(
        machines.ending(actor.getSnapshot(), { call: 1, framed: true }),
      ).toEqual({ keep: true, owned: true })
    })

    test('closes the preloaded frame that a sign-in does not show, and at a discard or a new preload', () => {
      const closed: (string | undefined)[] = []
      const actor = createActor(
        machines.dialog.provide({
          actions: {
            close: ({ context }) => closed.push(context.entry?.redirectUri),
          },
        }),
      ).start()

      actor.send({ entry: entry('a'), type: 'preload' })
      actor.send({ entry: entry('b'), type: 'preload' })
      actor.send({ reuse: false, type: 'take' })
      actor.send({ entry: entry('c'), type: 'preload' })
      actor.send({ reuse: true, type: 'take' })
      actor.send({ entry: entry('d'), type: 'preload' })
      actor.send({ type: 'discard' })

      expect(closed).toEqual(['a', 'b', 'd'])
      expect(machines.entry(actor.getSnapshot())).toBeUndefined()
    })

    test('holds the frame that the latest sign-in kept, and keeps none while another preload holds the place', () => {
      const actor = createActor(machines.dialog).start()
      actor.send({ type: 'replace' })
      actor.send({ type: 'start' })
      actor.send({ entry: entry('preload'), type: 'preload' })

      const during = machines.ending(actor.getSnapshot(), {
        call: 1,
        framed: true,
      })
      actor.send({ type: 'discard' })
      const after = machines.ending(actor.getSnapshot(), {
        call: 1,
        framed: true,
      })
      actor.send({ call: 1, kept: entry('kept'), type: 'end' })

      expect(during).toEqual({ keep: false, owned: true })
      expect(after).toEqual({ keep: true, owned: true })
      expect(machines.entry(actor.getSnapshot())?.redirectUri).toBe('kept')
      expect(actor.getSnapshot().value).toEqual({
        call: 'idle',
        frame: 'preloaded',
      })
    })
  })

  describe('ending', () => {
    const rows = [
      {
        call: 1,
        expected: { keep: true, owned: true },
        framed: true,
        name: 'keeps the frame of the latest sign-in',
      },
      {
        call: 1,
        expected: { keep: false, owned: true },
        framed: false,
        name: 'keeps no frame of a sign-in in a popup',
      },
      {
        call: 0,
        expected: { keep: false, owned: false },
        framed: true,
        name: 'keeps no frame of a replaced sign-in',
      },
    ] as const

    for (const row of rows)
      test(row.name, () => {
        const actor = createActor(machines.dialog).start()
        actor.send({ type: 'start' })

        const result = machines.ending(actor.getSnapshot(), {
          call: row.call,
          framed: row.framed,
        })

        expect(result).toEqual(row.expected)
      })
  })

  /** Returns a preloaded frame of `redirectUri`, whose sheet the machine never calls. */
  function entry(redirectUri: string): machines.dialog.Entry {
    const sheet = {} as Sheet.create.ReturnType
    return { options: {}, redirectUri, sheet }
  }
})
