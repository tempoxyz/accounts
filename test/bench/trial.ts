/**
 * Prepares, grades, and reports the trials of the integration bench. A trial is one agent's
 * integration of one cell: a copy of the cell's starter, with its packages installed, in a folder
 * outside the repository, and the instruction that the agent receives.
 *
 * ```sh
 * node test/bench/trial.ts prepare <id> <starter> <task> <docs URL> [profile]  # the instruction
 * node test/bench/trial.ts oracle <id> <starter> <task>               # the solution of the cell
 * node test/bench/trial.ts score <id>                                 # grades the agent's app
 * node test/bench/trial.ts report <prefix>...                        # the table of each phase
 * ```
 *
 * Trials live in `BENCH_DIR`, which defaults to `/tmp/bench/trials`, and the oracles' trials in
 * `BENCH_ORACLES`, which defaults to `/tmp/bench/oracles`. Each grade, and the app's
 * sources without its packages, also land in `BENCH_KEEP`, which defaults to `/tmp/bench/keep`,
 * outside the checkout, so they outlast the folder of the trial. The cache of each starter's packages
 * is in `~/.cache/accounts-bench`.
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Crypto from 'node:crypto'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Tasks from './Tasks.ts'

const root = Path.resolve(import.meta.dirname, '../..')
const trials = process.env.BENCH_DIR ?? '/tmp/bench/trials'
// The oracles' solutions live apart from the agents' trials, so a run hides them with one folder.
const oracles = process.env.BENCH_ORACLES ?? '/tmp/bench/oracles'
const keep = process.env.BENCH_KEEP ?? '/tmp/bench/keep'
// The cache's packages run in each trial, so it lives in the user's own folder, not in `/tmp`.
const cache = Path.join(Os.homedir(), '.cache', 'accounts-bench')

/** The trial's metadata, beside its app. */
type Trial = Tasks.Cell & {
  /** The URL of the docs that the agent read. */
  docsUrl: string
  /** The trial's ID: its phase, its cell, and its run, such as `docs-before-react-transfer-1`. */
  id: string
  /** What the agent may read beside the docs. */
  profile: Tasks.Profile
}

const [command, ...args] = process.argv.slice(2)

// Each command but `report` deletes a folder named by the ID, so an ID never names a root or its parent.
if (command !== 'report' && !/^[\w-]+$/.test(args[0] ?? ''))
  throw new Error(
    `The ID "${args[0] ?? ''}" holds characters other than letters, digits, "_", and "-".`,
  )

if (command === 'prepare' || command === 'oracle') {
  const [id, starter, task, docsUrl = 'none', profile = 'docs'] = args as [
    string,
    Tasks.Starter,
    Tasks.Task,
    string | undefined,
    Tasks.Profile | undefined,
  ]
  if (
    !Tasks.cells.some((cell) => cell.starter === starter && cell.task === task)
  )
    throw new Error(`No cell holds ${starter} with ${task}.`)
  const folder = Path.join(command === 'oracle' ? oracles : trials, id)
  const appDir = Path.join(folder, 'app')
  Fs.rmSync(folder, { force: true, recursive: true })
  Fs.mkdirSync(folder, { recursive: true })
  Fs.cpSync(Path.join(import.meta.dirname, 'starters', starter), appDir, {
    recursive: true,
  })
  // A user's app holds its packages already. The cache installs each version of a starter's
  // `package.json` once, in a folder that it renames into place only after the install.
  const manifest = Fs.readFileSync(Path.join(appDir, 'package.json'))
  const hash = Crypto.createHash('sha256')
    .update(manifest)
    .digest('hex')
    .slice(0, 12)
  const installed = Path.join(cache, `${starter}-${hash}`)
  if (!Fs.existsSync(installed)) {
    const pending = `${installed}-${crypto.randomUUID()}`
    Fs.cpSync(Path.join(import.meta.dirname, 'starters', starter), pending, {
      recursive: true,
    })
    // The packages' install scripts see only the variables they need.
    ChildProcess.execSync('npm install --no-audit --no-fund', {
      cwd: pending,
      env: Tasks.environment(),
      stdio: 'inherit',
    })
    Fs.renameSync(pending, installed)
  }
  ChildProcess.execFileSync('cp', [
    '-a',
    Path.join(installed, 'node_modules'),
    Path.join(appDir, 'node_modules'),
  ])
  Fs.cpSync(
    Path.join(installed, 'package-lock.json'),
    Path.join(appDir, 'package-lock.json'),
  )
  const trial: Trial = { docsUrl, id, profile, starter, task }
  Fs.writeFileSync(
    Path.join(folder, 'trial.json'),
    JSON.stringify(trial, null, 2),
  )
  const text = Tasks.instruction({ appDir, cell: trial, docsUrl, profile })
  Fs.writeFileSync(Path.join(folder, 'instruction.md'), text)
  // The oracle's files prove that the cell is solvable, and that the grader passes a solution.
  if (command === 'oracle')
    Fs.cpSync(
      Path.join(import.meta.dirname, 'oracles', `${starter}-${task}`),
      appDir,
      { recursive: true },
    )
  else process.stdout.write(text)
} else if (command === 'score') {
  const [id] = args as [string]
  const folder = [trials, oracles]
    .map((root) => Path.join(root, id))
    .find((candidate) => Fs.existsSync(candidate))
  if (!folder) throw new Error(`No trial holds the ID ${id}.`)
  const trial = JSON.parse(
    Fs.readFileSync(Path.join(folder, 'trial.json'), 'utf8'),
  ) as Trial
  const result = Path.join(folder, 'grade.json')
  Fs.rmSync(result, { force: true })
  ChildProcess.spawnSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'test/bench/playwright.config.ts',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        BENCH_APP: Path.join(folder, 'app'),
        BENCH_RESULT: result,
        BENCH_STARTER: trial.starter,
        BENCH_TASK: trial.task,
        // The grade reads the codes of the stack's Tempo ID, not of another one in the shell.
        TEMPO_ID_URL: Tasks.stack.tempoIdUrl,
      },
      stdio: 'inherit',
    },
  )
  const grade = Fs.existsSync(result)
    ? JSON.parse(Fs.readFileSync(result, 'utf8'))
    : {
        error: 'The grader wrote no grade.',
        signIn: false,
        stage: 'none',
        task: false,
      }
  const kept = Path.join(keep, id)
  Fs.rmSync(kept, { force: true, recursive: true })
  Fs.cpSync(folder, kept, {
    filter: (source) =>
      !/\/(node_modules|dist|\.expo|\.git)(\/|$)/.test(source),
    recursive: true,
  })
  Fs.writeFileSync(
    Path.join(kept, 'grade.json'),
    JSON.stringify(grade, null, 2),
  )
  process.stdout.write(
    `${id}: signIn ${grade.signIn ? 'pass' : 'fail'}, task ${grade.task ? 'pass' : 'fail'}${grade.error ? ` (${grade.error})` : ''}\n`,
  )
} else if (command === 'report') {
  const rows = Tasks.cells.map((cell) => {
    const columns = args.flatMap((prefix) => {
      const grades = (Fs.existsSync(keep) ? Fs.readdirSync(keep) : [])
        .filter((id) =>
          id.startsWith(`${prefix}-${cell.starter}-${cell.task}-`),
        )
        .map(
          (id) =>
            JSON.parse(
              Fs.readFileSync(Path.join(keep, id, 'grade.json'), 'utf8'),
            ) as { signIn: boolean; task: boolean },
        )
      const count = (key: 'signIn' | 'task') =>
        `${grades.filter((grade) => grade[key]).length}/${grades.length}`
      return [count('signIn'), count('task')]
    })
    return `| ${cell.starter} | ${cell.task} | ${columns.join(' | ')} |`
  })
  const header = args.flatMap((prefix) => [
    `${prefix} sign-in`,
    `${prefix} task`,
  ])
  process.stdout.write(
    [
      `| Starter | Task | ${header.join(' | ')} |`,
      `| --- | --- | ${header.map(() => '---:').join(' | ')} |`,
      ...rows,
    ].join('\n') + '\n',
  )
} else throw new Error('Run `prepare`, `score`, or `report`.')
