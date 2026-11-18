/**
 * Runs the waterfall, or writes its report. Without `--report`, it empties `waterfall/.traces`, then
 * runs the integration tests of `accounts` in Tempo ID's checkout, `test/client/`, with each action's
 * calls recorded. `--local` runs this repository's own tests instead. With `--report`, it reads the
 * traces, and writes `waterfall/report.md` and `waterfall/summary.json`. A `--base` summary adds
 * each action's change in calls and rounds.
 *
 * Usage:
 *   pnpm waterfall [--local] [files…]
 *   pnpm waterfall:report [--base <path>] [--json <path>] [--markdown <path>]
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Util from 'node:util'
import * as Report from '../test/waterfall/Report.ts'

/** The repository's root. */
const root = Path.resolve(import.meta.dirname, '..')

/** The folder of the trace files, with one file per test process. */
const traces = Path.join(root, 'waterfall', '.traces')

const { positionals, values } = Util.parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    json: { default: 'waterfall/summary.json', type: 'string' },
    local: { default: false, type: 'boolean' },
    markdown: { default: 'waterfall/report.md', type: 'string' },
    report: { default: false, type: 'boolean' },
  },
})

if (values.report) {
  const files = Fs.existsSync(traces) ? Fs.readdirSync(traces) : []
  const lines = files
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) =>
      Fs.readFileSync(Path.join(traces, file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Report.Trace),
    )
  if (lines.length === 0)
    throw new Error(`No traces in ${traces}. Run \`pnpm waterfall\` first.`)

  const summary = Report.summarize(lines)
  const base = values.base
    ? (JSON.parse(Fs.readFileSync(values.base, 'utf8')) as Report.Summary)
    : undefined

  for (const file of [values.json, values.markdown])
    Fs.mkdirSync(Path.dirname(file), { recursive: true })
  Fs.writeFileSync(values.markdown, Report.markdown(summary, { base }))
  Fs.writeFileSync(values.json, `${JSON.stringify(summary)}\n`)
  process.stdout.write(
    `Wrote ${values.markdown} and ${values.json}: ${summary.samples} action calls in ${summary.rows.length} actions and outcomes.\n`,
  )
  process.exit(0)
}

Fs.rmSync(traces, { force: true, recursive: true })
const environment = {
  ...process.env,
  ACCOUNTS_WATERFALL: 'true',
  ACCOUNTS_WATERFALL_DIRECTORY: traces,
}

const command = (() => {
  if (values.local)
    return {
      args: ['exec', 'vp', 'test', ...positionals],
      cwd: root,
      env: {},
    }

  const id = tempoId()
  return {
    args: [
      'exec',
      'vp',
      'test',
      '--config',
      Path.join(root, 'test', 'waterfall', 'vite.config.ts'),
      '--project',
      'integration',
      ...(positionals.length ? positionals : ['test/client']),
    ],
    cwd: id,
    env: { TEMPO_ID_DIR: id },
  }
})()

const result = ChildProcess.spawnSync('pnpm', command.args, {
  cwd: command.cwd,
  env: { ...environment, ...command.env },
  stdio: 'inherit',
})
process.exit(result.status ?? 1)

/**
 * Returns Tempo ID's checkout: `TEMPO_ID_DIR`, or the parent folder when this repository is its
 * `accounts` submodule. Throws without either.
 */
function tempoId() {
  const variable = process.env.TEMPO_ID_DIR
  if (variable) return Path.resolve(variable)

  const parent = Path.resolve(root, '..')
  const submodule = Path.join(parent, 'accounts')
  if (
    Fs.existsSync(Path.join(parent, 'test', 'client')) &&
    Fs.existsSync(submodule) &&
    Fs.realpathSync(submodule) === Fs.realpathSync(root)
  )
    return parent
  throw new Error(
    "No Tempo ID checkout. Run the waterfall in the `accounts` submodule of tempoxyz/id, set TEMPO_ID_DIR to Tempo ID's checkout, or pass --local.",
  )
}
