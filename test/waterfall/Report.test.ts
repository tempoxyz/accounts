/**
 * Tests the waterfall's round computation and its findings on hand-written traces, one row per
 * shape of calls.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import type * as Recorder from './Recorder.js'
import * as Report from './Report.js'

/** Returns a call that opens and settles at the given events, with `dependsOn`. */
function call(
  name: string,
  opened: number,
  closed: number,
  dependsOn: readonly number[] = [],
): Recorder.Call {
  return {
    closed,
    dependsOn,
    detail: name,
    duration: 1,
    kind: 'fetch',
    name,
    opened,
    start: opened,
  }
}

describe('Report.chain', () => {
  const rows = [
    {
      calls: [call('a', 0, 1), call('b', 2, 3, [0])],
      name: 'counts a dependent call in the next round, and flags no dependent blocker',
      expected: {
        blockers: [undefined, 0],
        ideal: 2,
        parallel: [false, false],
        rounds: 2,
      },
    },
    {
      calls: [call('a', 0, 2), call('b', 1, 3)],
      name: 'counts calls that overlap in one round, with no blocker',
      expected: {
        blockers: [undefined, undefined],
        ideal: 1,
        parallel: [false, false],
        rounds: 1,
      },
    },
    {
      calls: [call('a', 0, 1), call('b', 2, 3)],
      name: 'flags a call that waits on a blocker it does not depend on',
      expected: {
        blockers: [undefined, 0],
        ideal: 1,
        parallel: [false, true],
        rounds: 2,
      },
    },
    {
      calls: [call('a', 0, 1), call('b', 2, 3, [0]), call('c', 4, 5, [1])],
      name: 'follows a chain of dependencies',
      expected: {
        blockers: [undefined, 0, 1],
        ideal: 3,
        parallel: [false, false, false],
        rounds: 3,
      },
    },
    {
      calls: [call('a', 0, 1), call('b', 2, 3, [0]), call('c', 4, 5, [0])],
      name: 'flags a call whose blocker is a sibling of its dependency',
      expected: {
        blockers: [undefined, 0, 1],
        ideal: 2,
        parallel: [false, false, true],
        rounds: 3,
      },
    },
  ] as const

  for (const row of rows)
    test(row.name, () => {
      const result = Report.chain(row.calls)

      expect({
        blockers: result.blockers,
        ideal: result.ideal,
        parallel: result.parallel,
        rounds: result.rounds,
      }).toEqual(row.expected)
    })

  test('counts no call that settles after the action, and flags none', () => {
    const result = Report.chain([
      call('a', 0, 1),
      { ...call('b', 2, 4), background: true },
    ])

    expect([result.rounds, result.parallel]).toMatchInlineSnapshot(`
      [
        1,
        [
          false,
          false,
        ],
      ]
    `)
  })
})

describe('Report.summarize', () => {
  test('lists a call that waits on a blocker it does not depend on, and a duplicate', () => {
    const trace: Report.Trace = {
      action: 'accounts.session.get',
      calls: [
        call('store.memory.getItem', 0, 1),
        { ...call('store.memory.getItem', 2, 3), same: 0 },
        call('http.POST id.test/oauth2/token', 4, 5, [0]),
      ],
      settled: 6,
      total: 3,
    }

    const summary = Report.summarize([trace])

    expect(summary.pairs).toMatchInlineSnapshot(`
      [
        {
          "actions": [
            "accounts.session.get",
          ],
          "call": "store.memory.getItem",
          "count": 1,
          "lane": "same lane",
          "waited": "store.memory.getItem",
          "write": false,
        },
        {
          "actions": [
            "accounts.session.get",
          ],
          "call": "http.POST id.test/oauth2/token",
          "count": 1,
          "lane": "cross-service",
          "waited": "store.memory.getItem",
          "write": true,
        },
      ]
    `)
    expect(summary.duplicates).toMatchInlineSnapshot(`
      [
        {
          "action": "accounts.session.get",
          "call": "store.memory.getItem",
          "count": 1,
          "samples": 1,
        },
      ]
    `)
  })
})

describe('Report.writes', () => {
  const rows = [
    { label: 'chain.eth_sendRawTransaction', expected: true },
    { label: 'chain.eth_call×16', expected: false },
    { label: 'http.GET id.test/v1/account', expected: false },
    { label: 'http.POST id.test/oauth2/revoke', expected: true },
    { label: 'store.memory.getItem', expected: false },
    { label: 'store.memory.setItem', expected: true },
  ] as const

  for (const row of rows)
    test(row.label, () => {
      expect(Report.writes(row.label)).toBe(row.expected)
    })
})
