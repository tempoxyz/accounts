import assert from 'node:assert/strict'
import test from 'node:test'

import { type CommandResult, publishPackage, type RunCommand } from './publish.ts'

const manifest = { name: 'accounts', version: '0.18.5' }

function mockRun(results: CommandResult[]) {
  const calls: [string, readonly string[]][] = []
  const run: RunCommand = (command, args) => {
    calls.push([command, args])
    const result = results.shift()
    assert.ok(result, `unexpected command: ${command} ${args.join(' ')}`)
    return result
  }
  return { calls, run }
}

test('publishes an unpublished package and reports its tag', () => {
  const { calls, run } = mockRun([
    { status: 1, stderr: 'npm error code E404' },
    { status: 0 },
    { status: 0 },
    { status: 0 },
  ])
  const logs: string[] = []

  publishPackage({ manifest, run, log: (message) => logs.push(message) })

  assert.deepEqual(
    calls.map(([, args]) => args),
    [
      ['view', 'accounts@0.18.5', 'version', '--json'],
      ['publish:prepare'],
      ['publish'],
      ['publish:post'],
    ],
  )
  assert.deepEqual(logs, ['New tag: accounts@0.18.5'])
})

test('reports an already-published package without publishing again', () => {
  const { calls, run } = mockRun([{ status: 0, stdout: '"0.18.5"\n' }])
  const logs: string[] = []

  publishPackage({ manifest, run, log: (message) => logs.push(message) })

  assert.equal(calls.length, 1)
  assert.deepEqual(logs, ['New tag: accounts@0.18.5'])
})

test('restores the package when publishing fails and does not report a tag', () => {
  const { calls, run } = mockRun([
    { status: 1, stderr: 'npm error code E404' },
    { status: 0 },
    { status: 1 },
    { status: 0 },
  ])
  const logs: string[] = []

  assert.throws(
    () => publishPackage({ manifest, run, log: (message) => logs.push(message) }),
    /npm publish exited with code 1/,
  )

  assert.deepEqual(calls.at(-1)?.[1], ['publish:post'])
  assert.deepEqual(logs, [])
})

test('stops on registry errors instead of assuming the package is unpublished', () => {
  const { calls, run } = mockRun([{ status: 1, stderr: 'npm error code ENETWORK' }])

  assert.throws(() => publishPackage({ manifest, run }), /npm view exited with code 1/)
  assert.equal(calls.length, 1)
})
