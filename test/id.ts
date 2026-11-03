/**
 * Provides the Tempo ID that the integration and end-to-end suites run against: a checkout of
 * `tempoxyz/id` at `.tempo-id`, installed, and the global setup of its own harness.
 *
 * `id` takes this repository as its `accounts` submodule, and depends on it with `link:accounts`.
 * The checkout's `accounts` is a link to this repository in place of the submodule, so `id`'s
 * harness, helpers, test Workers, and playground runner all import and run this repository.
 *
 * - `TEMPO_ID_DIR` names a local checkout, which `.tempo-id` links to. Its `accounts` must be
 *   absent or a link to this repository.
 * - `TEMPO_ID_REF` names the branch, tag, or commit to clone. Defaults to {@link ref}.
 *
 * Run `node test/id.ts` to prepare the checkout without a suite.
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Crypto from 'node:crypto'
import * as Fs from 'node:fs'
import * as Path from 'node:path'

/** The root of this repository. */
export const root = Path.resolve(import.meta.dirname, '..')

/** The checkout of `tempoxyz/id` that the suites import from and run. */
export const dir = Path.join(root, '.tempo-id')

/** The ref that a clone checks out without `TEMPO_ID_REF`: the branch that takes `accounts` as a submodule. */
export const ref = 'jxom/tender-ramanujan-czb772'

/** The repository to clone. */
const repository = 'https://github.com/tempoxyz/id'

/**
 * The file in the checkout's `node_modules` that holds the digest of the lockfile and of this
 * repository's path, so a later run installs only after either changes.
 */
const marker = Path.join(dir, 'node_modules', '.tempo-id-accounts')

/**
 * Clones or links the checkout, links its `accounts` to this repository, and installs it. With
 * `TEMPO_ID_REF`, a clone fetches and checks out the ref again.
 */
export function prepare() {
  checkout()
  link()
  install()
}

/**
 * Runs `id`'s own global setup, `test/build.ts`, from the checkout: the suite's Postgres, the app's
 * build, and the harness's config. With `chain`, it also runs `test/e2e/setup.ts`: the local Tempo
 * node and the Tempo API. Returns the teardown.
 *
 * The harness reads its configs from paths relative to the checkout, so the process works in the
 * checkout from here on.
 */
export async function setup(options: setup.Options = {}) {
  prepare()
  process.chdir(dir)

  const build = (await import(Path.join(dir, 'test', 'build.ts'))) as Setup
  const teardowns = [await build.default(options.project)]
  try {
    if (options.chain) {
      const e2e = (await import(
        Path.join(dir, 'test', 'e2e', 'setup.ts')
      )) as Setup
      teardowns.unshift(await e2e.default())
    }
  } catch (error) {
    await teardowns[0]?.()
    throw error
  }

  return async () => {
    for (const teardown of teardowns) await teardown?.()
  }
}

export declare namespace setup {
  type Options = {
    /** Whether to start the local Tempo node and the Tempo API too. Defaults to `false`. */
    chain?: boolean | undefined
    /** Vitest's project, which `id`'s setup reads to measure coverage. */
    project?: unknown
  }
}

/** A global setup module of `id`. */
type Setup = {
  /** Starts the setup's services. Returns the teardown. */
  default: (project?: unknown) => Promise<(() => Promise<void>) | undefined>
}

/** Links `.tempo-id` to `TEMPO_ID_DIR`, or clones `TEMPO_ID_REF` into it. */
function checkout() {
  const local = process.env.TEMPO_ID_DIR
  if (local) {
    const target = Path.resolve(local)
    const current = (() => {
      try {
        return Fs.realpathSync(dir)
      } catch {
        // No checkout exists yet.
        return undefined
      }
    })()
    if (current === Fs.realpathSync(target)) return
    Fs.rmSync(dir, { force: true, recursive: true })
    Fs.symlinkSync(target, dir, 'dir')
    return
  }

  // A link from an earlier run with `TEMPO_ID_DIR` is not a clone of this run's ref.
  if (Fs.existsSync(dir) && Fs.lstatSync(dir).isSymbolicLink()) Fs.rmSync(dir)

  if (!Fs.existsSync(Path.join(dir, '.git'))) {
    Fs.mkdirSync(dir, { recursive: true })
    git(['init', '--quiet'])
    git(['remote', 'add', 'origin', repository])
  } else if (!process.env.TEMPO_ID_REF) return

  // A fetch by name or commit with depth 1 works for a branch, a tag, and a full commit hash.
  git(['fetch', '--depth', '1', '--quiet', 'origin', process.env.TEMPO_ID_REF ?? ref])
  git(['checkout', '--force', '--quiet', 'FETCH_HEAD'])
}

/** Returns the digest of the checkout's lockfile and of this repository's path. */
function digest() {
  return Crypto.createHash('sha256')
    .update(Fs.readFileSync(Path.join(dir, 'pnpm-lock.yaml')))
    .update(root)
    .digest('hex')
}

/** Runs `git` in the checkout. */
function git(args: readonly string[]) {
  ChildProcess.execFileSync('git', args, { cwd: dir, stdio: 'inherit' })
}

/**
 * Installs the checkout's dependencies, unless its lockfile is unchanged since the last install.
 * `id`'s `postinstall` also installs `accounts`, which is this repository.
 */
function install() {
  const installed = (() => {
    try {
      return Fs.readFileSync(marker, 'utf8')
    } catch {
      // No run installed the checkout yet.
      return undefined
    }
  })()
  if (installed === digest()) return

  ChildProcess.execFileSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: dir,
    stdio: 'inherit',
  })
  Fs.writeFileSync(marker, digest())
}

/**
 * Links the checkout's `accounts` to this repository, in place of the submodule. Throws if the
 * checkout holds another `accounts`, such as an initialized submodule of `TEMPO_ID_DIR`.
 */
function link() {
  const target = Path.join(dir, 'accounts')
  const stat = (() => {
    try {
      return Fs.lstatSync(target)
    } catch {
      // A clone without `--recurse-submodules` has no `accounts`.
      return undefined
    }
  })()
  if (stat?.isSymbolicLink() && Fs.realpathSync(target) === Fs.realpathSync(root)) return
  const empty = stat?.isDirectory() && Fs.readdirSync(target).length === 0
  if (stat && !empty)
    throw new Error(
      `${target} is not a link to ${root}. Remove it, so the suites run this repository.`,
    )

  Fs.rmSync(target, { force: true, recursive: true })
  Fs.symlinkSync(root, target, 'dir')
}

if (import.meta.main) prepare()
