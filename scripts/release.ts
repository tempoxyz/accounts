/**
 * Resolves the next `accounts` release for the Main workflow, from the squash commit titles on
 * `main` since the last release.
 *
 * - Each version is `<breaking>.<time>.<n>`, such as `1.20261118194700.0`: `<time>` is the commit's
 *   UTC time, and `<n>` is `0` unless `latest` holds the same time, so a rerun of a commit resolves the
 *   same version. No version is a prerelease, so a caret range resolves each later release.
 * - A title marked breaking, such as `feat!: …` or one whose commit says `BREAKING CHANGE:`, raises
 *   `<breaking>`. It starts at `1`, after the `0.x` releases of `tempoxyz/accounts`. A `dogfood: ` prefix is
 *   read past, so `dogfood: feat!: …` is breaking too.
 * - `ci` and `test` commits change nothing that the package ships, so they release nothing alone. A
 *   later release's notes leave them out. A manual run of Main releases them anyway.
 * - Each release counts its commits from the `gitHead` that npm records for the last version. A rerun
 *   of a commit that npm already has resumes its release rather than publishing again.
 * - The notes list one past-tense entry per commit under a section per commit type, as the
 *   changesets releases did. Each entry is the `## Changelog` section of the pull request's
 *   description, which the squash commit's body holds, or else the commit's title.
 * - It runs before the dependencies install, and reads only Node.js, git, gh, and npm.
 *
 * `node scripts/release.ts resolve` writes the version to `GITHUB_OUTPUT` and the notes to
 * `.tmp/release/notes.md`, or writes no version when the commit does not release.
 *
 * @module
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'

/** A commit since the last release. */
type Commit = { message: string; sha: string }

const title = /^(?:dogfood: )?(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?: /

/** A release version, such as `1.20261118194700.0` or the earlier `0.21.1`. The `1.0.0-alpha.…` versions don't match. */
const release = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9a-z]+)?$/

/**
 * A version of this scheme, such as `1.20261118194700.0`, or one that it published under `alpha`
 * before, such as `1.20261118194700.0-86519034c`.
 */
const channel = /^[1-9]\d*\.\d{14}\.\d+(?:-[0-9a-z]+)?$/

/**
 * Returns the version after `latest` that `commits` release, from the commit made at `time`, or
 * `undefined` when they release nothing. Without `base`, no commit raises `<breaking>`.
 */
function next(
  latest: string,
  commits: readonly Commit[],
  time: Date,
  options: { base?: string | undefined; force?: boolean | undefined } = {},
): string | undefined {
  const { base, force = false } = options
  const match = release.exec(latest)
  if (!match || latest.startsWith('0.0.0'))
    throw new Error(`npm's latest version ${latest} is not a release version.`)
  const major = Number(match[1])

  const releasing = commits.filter((commit) => {
    const type = title.exec(subject(commit))?.groups?.type
    return type !== 'ci' && type !== 'test'
  })
  if (releasing.length === 0 && !force) return undefined

  // Without the commit of `latest`, such as the `1.x` releases from `tempoxyz/accounts2`'s private
  // history, the commits since it are unknown, so `<breaking>` stays.
  const raised = !!base && commits.some(breaking)
  // The `0.x` releases came before this scheme, so its first release is 1 either way.
  const breakingVersion = Math.max(1, raised ? major + 1 : major)
  const at = timestamp(time)
  // npm refuses a version twice, so a release in the same second as `latest` raises the last number.
  const patch = latest.startsWith(`${breakingVersion}.${at}.`)
    ? Number(match[3]) + 1
    : 0
  return `${breakingVersion}.${at}.${patch}`
}

/** Returns `time` in UTC as `YYYYMMDDHHMMSS`. */
function timestamp(time: Date): string {
  return time.toISOString().replace(/\D/g, '').slice(0, 14)
}

/**
 * Returns the release notes for `commits`, as the changesets releases read: one entry per commit
 * under a heading per section, newest first. GitHub links each `(#123)` to its pull request.
 */
function notes(commits: readonly Commit[]): string {
  // A forced release of only `ci` and `test` commits lists them, so its notes are never empty.
  const shipping = commits.filter((commit) => section(commit) !== undefined)
  const listed = shipping.length > 0 ? shipping : commits

  const blocks = sections.flatMap((heading) => {
    const items = listed
      .filter((commit) => (section(commit) ?? 'Other changes') === heading)
      .map((commit) => {
        const pr = /\(#(\d+)\)$/.exec(subject(commit))?.[1]
        const reference = pr ? `#${pr}` : commit.sha.slice(0, 7)
        // An entry can span lines, such as a code block, which stays inside its bullet.
        const [first, ...rest] = entry(commit).split('\n')
        return [
          `- ${first} (${reference})`,
          ...rest.map((line) => (line ? `  ${line}` : '')),
        ].join('\n')
      })
    return items.length === 0 ? [] : [`### ${heading}\n\n${items.join('\n')}`]
  })
  return `${blocks.join('\n\n')}\n`
}

/**
 * Returns the entry of `commit`: the `## Changelog` section of its pull request's description, which
 * the squash commit's body holds, or else its title without its type and pull request number.
 */
function entry(commit: Commit): string {
  const changelog = /^## Changelog[ \t]*\n(?<text>[\s\S]*?)(?=^## |(?![\s\S]))/m
    .exec(commit.message)
    ?.groups?.text?.trim()
    .replace(/^[-*] /, '')
  if (changelog) return changelog
  const text = subject(commit)
    .replace(title, '')
    .replace(/ \(#\d+\)$/, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function subject(commit: Commit): string {
  return commit.message.split('\n', 1)[0]!.trim()
}

function breaking(commit: Commit): boolean {
  return (
    title.exec(subject(commit))?.groups?.breaking === '!' ||
    /^BREAKING[ -]CHANGE: /m.test(commit.message)
  )
}

/** The sections of the release notes, in the order that they appear. */
const sections = [
  'Breaking changes',
  'Features',
  'Fixes',
  'Performance',
  'Other changes',
] as const

/** Returns the section that lists `commit`, or `undefined` for a `ci` or `test` commit, which ships nothing. */
function section(commit: Commit): (typeof sections)[number] | undefined {
  if (breaking(commit)) return 'Breaking changes'
  const type = title.exec(subject(commit))?.groups?.type
  if (type === 'ci' || type === 'test') return undefined
  if (type === 'feat') return 'Features'
  if (type === 'fix') return 'Fixes'
  if (type === 'perf') return 'Performance'
  return 'Other changes'
}

function run(command: string, args: string[], cwd?: string): string {
  return ChildProcess.execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
  }).trim()
}

/**
 * Returns the release that npm took just before `latest`, from npm's `time` map of each version to
 * when it was published, among the versions of this scheme. Publish order decides, not the version, so a release from the same commit
 * second as `latest` counts as before it.
 */
export function previous(
  times: Readonly<Record<string, string>>,
  options: { latest: string },
): string | undefined {
  const { latest } = options
  const at = (version: string) => Date.parse(times[version]!)
  return Object.keys(times)
    .filter(
      (version) =>
        channel.test(version) && version !== latest && at(version) < at(latest),
    )
    .sort((a, b) => at(a) - at(b))
    .at(-1)
}

/** Options for {@link resolve}. */
export type ResolveOptions = {
  /** The commit that npm's `latest` was published from, when known. */
  base?: string | undefined
  /** The repository's working directory. */
  cwd?: string | undefined
  /** Whether to release commits that change only CI or tests, as a manual run of Main does. */
  force?: boolean | undefined
  /** npm's `latest` version. */
  latest: string
  /** The commit of `main` to release. */
  sha: string
}

/**
 * Returns the version and release notes that `sha` publishes after `latest`, from the repository's
 * first-parent commits since `base`, or `undefined` when they change only CI or tests and `force` is
 * not set.
 */
export function resolve(
  options: ResolveOptions,
): { notes: string; version: string } | undefined {
  const { base, cwd, force, latest, sha } = options
  const commits = log(base, sha, cwd)
  const time = new Date(run('git', ['log', '-1', '--format=%cI', sha], cwd))
  const version = next(latest, commits, time, { base, force })
  if (!version) return undefined
  return { notes: notes(commits), version }
}

function main() {
  const sha = process.env.GITHUB_SHA!
  const output = (line: string) =>
    Fs.appendFileSync(process.env.GITHUB_OUTPUT!, `${line}\n`)
  const summary = (line: string) =>
    Fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY!, `${line}\n`)

  // Only the tip of main releases, since the `latest` dist-tag follows each release: an older commit, such as
  // a rerun, would publish its code over a newer one. A newer release includes it.
  const tip = run('gh', [
    'api',
    `repos/${process.env.GITHUB_REPOSITORY}/commits/main`,
    '--jq',
    '.sha',
  ])
  if (tip !== sha)
    return summary(`Skipped \`${sha}\`, since main moved to \`${tip}\`.`)

  // Releases go under the `latest` dist-tag. Until the first one, `latest` holds `0.21.1`, and the
  // releases of this scheme are under `alpha`, so the first release counts from `alpha`.
  const tagged = run('npm', ['view', 'accounts', 'dist-tags.latest'])
  const latest = (() => {
    if (channel.test(tagged)) return tagged
    const alpha = run('npm', ['view', 'accounts', 'dist-tags.alpha'])
    return channel.test(alpha) ? alpha : tagged
  })()

  // A rerun after npm took this commit's version resumes that release: the GitHub release runs again,
  // and Publish skips the version that npm already has.
  if (head(latest) === sha) {
    const times = JSON.parse(
      run('npm', ['view', 'accounts', 'time', '--json']),
    ) as Record<string, string>
    const before = previous(times, { latest })
    write(latest, notes(log(before && head(before), sha)))
    return summary(
      `Resuming \`accounts@${latest}\`, which npm already has from this commit.`,
    )
  }

  const force = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  const resolved = resolve({ base: head(latest), force, latest, sha })
  if (!resolved)
    return summary(
      `No release: the commits since \`${latest}\` change only CI or tests.`,
    )
  write(resolved.version, resolved.notes)
  summary(`Releasing \`accounts@${resolved.version}\` after \`${latest}\`.`)

  function write(version: string, notes: string) {
    Fs.mkdirSync('.tmp/release', { recursive: true })
    Fs.writeFileSync('.tmp/release/notes.md', notes)
    output(`version=${version}`)
  }
}

/**
 * Returns the commit that `version` was published from: the `gitHead` that Publish writes into the
 * manifest, or else the release's tag, which versions before that have.
 */
function head(version: string): string | undefined {
  const published = run('npm', ['view', `accounts@${version}`, 'gitHead'])
  // A version published from another repository's history, such as the `0.x` releases of
  // `tempoxyz/accounts`, records a commit that this clone lacks.
  if (/^[0-9a-f]{40}$/.test(published) && known(published)) return published
  const tag = ChildProcess.spawnSync(
    'git',
    [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/tags/accounts@${version}^{commit}`,
    ],
    { encoding: 'utf8' },
  )
  return tag.status === 0 ? tag.stdout.trim() : undefined
}

/** Returns whether this clone has the commit `sha`. */
function known(sha: string): boolean {
  return (
    ChildProcess.spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`])
      .status === 0
  )
}

/** Returns the first-parent commits after `base` up to `sha`, or only `sha` without a base. */
function log(base: string | undefined, sha: string, cwd?: string): Commit[] {
  const range = base ? [`${base}..${sha}`] : ['-1', sha]
  // Each message is read on its own, since a commit body can hold any separator.
  return run('git', ['rev-list', '--first-parent', ...range], cwd)
    .split('\n')
    .filter(Boolean)
    .map((hash) => ({
      message: run('git', ['log', '-1', '--format=%B', hash], cwd),
      sha: hash,
    }))
}

if (import.meta.main) {
  if (process.argv[2] === 'resolve') main()
  else throw new Error('Usage: node scripts/release.ts resolve')
}
