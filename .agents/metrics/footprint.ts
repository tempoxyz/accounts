/**
 * Writes Uphill's metric lines for the browser bundle of each typical use of the package. Each case
 * of `scripts/size.ts` is one item: the Brotli size of its initial load, and of every chunk. A case
 * above `noteAbove` gets a note that names the packages of its initial load with the most bytes,
 * from `scripts/size.ts --inputs`.
 *
 * Usage: node .agents/metrics/footprint.ts
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'

/** The repository's root. */
const root = Path.resolve(import.meta.dirname, '../..')

/** The initial load, in bytes, above which a line names its largest packages. */
const noteAbove = 15_000

/** The sizes of one case, in bytes, as `scripts/size.ts --json` writes them. */
type Size = {
  /** The initial load's Brotli size. */
  initial: number
  /** The Brotli size of every chunk. */
  total: number
}

/** Runs `scripts/size.ts` with `args`, and returns its standard output. */
function size(args: readonly string[]) {
  return ChildProcess.execFileSync(
    process.execPath,
    ['scripts/size.ts', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
}

/** Quotes an item or a note for a metric line. */
function quote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Returns the three packages with the most bytes in the initial load of a case. */
function largest(name: string) {
  const lines = size(['--inputs', name]).split('\n')
  const start = lines.findIndex((line) => line.startsWith('Initial load'))
  return lines
    .slice(start + 1)
    .map((line) => line.trim())
    .filter((line) => /^[\d.]+ KB {2}\S/.test(line))
    .slice(0, 3)
    .join(', ')
}

const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'uphill-footprint-'))
const file = Path.join(directory, 'sizes.json')
size(['--json', file])
const sizes = JSON.parse(Fs.readFileSync(file, 'utf8')) as Record<string, Size>
Fs.rmSync(directory, { force: true, recursive: true })

const lines = Object.entries(sizes).flatMap(([name, value]) => {
  const note =
    value.initial > noteAbove
      ? ` note ${quote(`before minification: ${largest(name)}`)}`
      : ''
  return [
    `initial-size ${quote(name)} ${value.initial}B${note}`,
    `total-size ${quote(name)} ${value.total}B`,
  ]
})

const manifest = JSON.parse(
  Fs.readFileSync(Path.join(root, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string> | undefined
  peerDependencies?: Record<string, string> | undefined
  peerDependenciesMeta?: Record<string, { optional?: boolean }> | undefined
}
const required = Object.keys(manifest.peerDependencies ?? {}).filter(
  (name) => !manifest.peerDependenciesMeta?.[name]?.optional,
)
lines.push(
  `dependencies ${Object.keys(manifest.dependencies ?? {}).length}`,
  `peer-dependencies ${required.length}`,
)

const metrics = process.env.UPHILL_METRICS
if (!metrics)
  throw new Error('Missing `UPHILL_METRICS`. Run the script through `uphill`.')
Fs.appendFileSync(metrics, `${lines.join('\n')}\n`)
