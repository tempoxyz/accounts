/**
 * Writes Uphill's metric lines for the async calls of each public action, from the waterfall of
 * this repository's own tests (`pnpm waterfall --local src`). Each action and outcome, such as
 * `accounts.signOut (rejected)`, is one item. `docs/development/waterfall.md` defines rounds, ideal
 * rounds, and duplicate calls.
 *
 * A failed test still records the traces of the tests that ran, so the script reads the traces
 * whatever the suite's status, and exits with an error only when no trace exists.
 *
 * Usage: node .agents/uphill/metrics/waterfall.ts
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import type * as Report from '../../../test/waterfall/Report.ts'

/** The repository's root. */
const root = Path.resolve(import.meta.dirname, '../../..')

/** Quotes an item or a note for a metric line. */
function quote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Formats a median, which can end in `.5`, for a metric line. */
function count(value: number) {
  return String(Math.round(value * 10) / 10)
}

ChildProcess.spawnSync(
  process.execPath,
  ['scripts/waterfall.ts', '--local', 'src'],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
)

const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'uphill-waterfall-'))
const file = Path.join(directory, 'summary.json')
ChildProcess.execFileSync(
  process.execPath,
  [
    'scripts/waterfall.ts',
    '--report',
    '--json',
    file,
    '--markdown',
    Path.join(directory, 'report.md'),
  ],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
)
const summary = JSON.parse(Fs.readFileSync(file, 'utf8')) as Report.Summary
Fs.rmSync(directory, { force: true, recursive: true })

const lines = summary.rows
  .filter((row) => row.calls > 0)
  .toSorted((a, b) => a.action.localeCompare(b.action))
  .flatMap((row) => {
    const item = quote(row.action)
    const duplicates = summary.duplicates
      .filter((entry) => entry.action === row.action)
      .map((entry) => `${entry.call} ×${entry.count}`)
    const pairs = summary.pairs
      .filter((pair) => !pair.write && pair.actions.includes(row.action))
      .map((pair) => `${pair.call} waits for ${pair.waited}`)
    // The ideal rounds are the longest chain over data dependencies, the floor of the action's
    // round trips, so they are the action's own target.
    const rounds =
      row.ideal > 0
        ? `rounds ${item} ${count(row.rounds)} target ${count(row.ideal)}${
            row.rounds > row.ideal && pairs.length > 0
              ? ` note ${quote(pairs.slice(0, 3).join(', '))}`
              : ''
          }`
        : `rounds ${item} ${count(row.rounds)}`
    return [
      `calls ${item} ${count(row.calls)}`,
      `duplicate-calls ${item} ${duplicates.length === 0 ? 'pass' : `fail note ${quote(duplicates.slice(0, 3).join(', '))}`}`,
      rounds,
    ]
  })

if (lines.length === 0)
  throw new Error(
    'No action recorded a call. Run `pnpm waterfall --local src`.',
  )

const metrics = process.env.UPHILL_METRICS
if (!metrics)
  throw new Error('Missing `UPHILL_METRICS`. Run the script through `uphill`.')
Fs.appendFileSync(metrics, `${lines.join('\n')}\n`)
