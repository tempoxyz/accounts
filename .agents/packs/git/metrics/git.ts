/**
 * Measures the project's Git history and repository hygiene. commitlint reads the subject of each
 * recent commit with the conventional rules, and `git diff --check` reads whitespace. Local checks
 * cover what no tool reads: reasons in subjects, imperative subjects, bug fixes without a test,
 * workflow key order, changeset sentences, and tracked build output. Each commit or
 * file is an item.
 *
 * @module
 */

import * as fs from 'node:fs'

import conventional from '@commitlint/config-conventional'
import lint from '@commitlint/lint'
import createPreset from 'conventional-changelog-conventionalcommits'
import { lexicon } from 'en-lexicon'
import { split } from 'sentence-splitter'

/** Commits to read, from `HEAD` back. */
const depth = Number(process.env.UPHILL_GIT_COMMITS ?? 50)

/** commitlint rules, by the metric that reads them. */
const groups = {
  'commit-type': [
    'type-case',
    'type-empty',
    'type-enum',
    'subject-empty',
    'header-trim',
  ],
  'header-length': ['header-max-length'],
  'message-body': [
    'body-leading-blank',
    'body-max-line-length',
    'footer-leading-blank',
    'footer-max-line-length',
  ],
  'subject-case': ['subject-case'],
  'subject-full-stop': ['subject-full-stop'],
} as const

/** Directories of build output and installed packages, which Git should never track. */
const output =
  /(^|\/)(node_modules|dist|target|coverage|zig-out|\.zig-cache|\.next|\.turbo)\/|(^|\/)\.env(\.[\w.-]+)?$/

const lines: string[] = []

if (
  !Bun.spawnSync(['git', 'rev-parse', '--verify', 'HEAD'], { stderr: 'ignore' })
    .success
) {
  process.stderr.write('Found no Git commits to measure\n')
  process.exit(1)
}

await commits()
hygiene()
fs.appendFileSync(process.env.UPHILL_METRICS!, `${lines.join('\n')}\n`)

/** Writes commitlint's verdict on each recent commit, and the checks commitlint has no rule for. */
async function commits(): Promise<void> {
  // `%x00` ends each message and `%x01` separates the hash from it, since messages hold newlines.
  const log = run([
    'git',
    'log',
    '--no-merges',
    `-n${depth}`,
    '--format=%h%x01%B%x00',
  ])
  const entries = log
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = '', message = ''] = entry.split('\x01')
      return { hash, message: message.trim() }
    })
  // The conventional commits parser reads `!` before the colon as a breaking change.
  // The preset has no types, so its parser takes the type that `lint` reads.
  const preset = (await createPreset()) as {
    parser: NonNullable<NonNullable<Parameters<typeof lint>[2]>['parserOpts']>
  }
  const parserOpts = preset.parser
  let fixes = 0

  for (const entry of entries) {
    const result = await lint(entry.message, conventional.rules, { parserOpts })
    for (const [metric, names] of Object.entries(groups)) {
      const errors = [...result.errors, ...result.warnings].filter((error) =>
        (names as readonly string[]).includes(error.name),
      )
      check({
        item: entry.hash,
        metric,
        problems: errors.map(
          (error) => `${error.message}: ${subject(entry.message)}`,
        ),
      })
    }

    const header = entry.message.split('\n')[0] ?? ''
    const description = header.replace(/^\w+(\([^)]*\))?!?:\s*/, '')
    check({
      item: entry.hash,
      metric: 'subject-reasons',
      problems: /\b(because|so that|in order to)\b/i.test(description)
        ? [`states a reason: ${header}`]
        : [],
    })
    verbForm({
      form: 'VB',
      item: entry.hash,
      metric: 'imperative-subjects',
      text: description,
    })

    if (/^fix(\(|!|:)/.test(header)) {
      fixes++
      const changed = run([
        'git',
        'show',
        '--diff-filter=ACMR',
        '--name-only',
        '-z',
        '--format=',
        entry.hash,
      ]).split('\0')
      const tested = changed.some(
        (file) =>
          /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:[._-](?:test|spec)|(?:Test|Spec)(?:s)?)\.[^./]+$|(?:^|\/)test_[^/]+$/.test(
            file,
          ) &&
          /\.(?:[cm]?[jt]sx?|rs|zig|go|swift|py|rb|sh|bats|c|cc|cpp|cs|java|kt|kts|scala|php|exs|hs|lua|dart|m|mm)$/i.test(
            file,
          ) &&
          !/(?:^|\/)(?:__fixtures__|fixtures|__snapshots__)\//.test(file),
      )
      check({
        item: entry.hash,
        metric: 'fix-tests',
        problems: tested ? [] : [`changes no test: ${header}`],
      })
    }
  }
  if (fixes === 0)
    lines.push(
      `fix-tests skip note ${quote(`no fix: commits in the last ${depth}`)}`,
    )
}

/** Writes whitespace errors, workflow key order, changeset sentences, and tracked build output. */
function hygiene(): void {
  const tracked = run(['git', 'ls-files', '-z']).split('\0').filter(Boolean)
  const present = tracked.filter((file) => fs.existsSync(file))

  // `git diff --check` against the empty tree reads every tracked line for whitespace errors.
  const empty = run(['git', 'hash-object', '-t', 'tree', '/dev/null']).trim()
  const errors = run(
    [
      'git',
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-color',
      '--relative',
      '--check',
      empty,
      '--',
    ],
    [0, 2],
  )
    .split('\n')
    .map((line) => /^(.+?):(\d+): (.+)$/.exec(line))
    .filter((match) => match !== null)
  // The w/ field describes working-tree content independently of the staged blob.
  const binary = new Set(
    run(['git', 'ls-files', '--eol', '-z'])
      .split('\0')
      .filter((entry) =>
        /\bw\/-text\s/.test(entry.slice(0, entry.indexOf('\t'))),
      )
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  )
  const text = present.filter(
    (file) => !/\.(md|mdx|patch|diff|snap)$/.test(file) && !binary.has(file),
  )
  if (!text.length)
    lines.push('whitespace skip note "no applicable tracked text files"')
  for (const file of text) {
    const error = errors.find((match) => match[1] === file)
    check({
      item: file,
      metric: 'whitespace',
      problems: error ? [`line ${error[2]}: ${error[3]}`] : [],
    })
  }

  const workflows = present.filter((file) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file),
  )
  for (const file of workflows) {
    const workflow = Bun.YAML.parse(fs.readFileSync(file, 'utf8'))
    const keys =
      workflow && typeof workflow === 'object' ? Object.keys(workflow) : []
    const rest = keys.filter((key) => key !== 'name' && key !== 'on')
    const expected = [
      ...keys.filter((key) => key === 'name' || key === 'on'),
      ...[...rest].sort(),
    ]
    const first = keys[0] === 'name' && keys[1] === 'on'
    check({
      item: file,
      metric: 'workflow-keys',
      problems:
        first && keys.join() === expected.join()
          ? []
          : [
              `top-level keys are ${keys.join(', ')}, not name, on, then alphabetical`,
            ],
    })
  }
  if (workflows.length === 0)
    lines.push('workflow-keys skip note "no workflows"')

  const changesets = present.filter(
    (file) =>
      /^\.changeset\/[^/]+\.md$/.test(file) && !file.endsWith('README.md'),
  )
  for (const file of changesets) {
    const body = fs
      .readFileSync(file, 'utf8')
      .replace(/^---[\s\S]*?---/, '')
      .replace(/```[\s\S]*?```/g, '')
      .trim()
    const sentences = split(body).filter((node) => node.type === 'Sentence')
    if (sentences.length !== 1) {
      check({
        item: file,
        metric: 'changeset-sentences',
        problems: [`${sentences.length} sentences, not one`],
      })
      continue
    }

    verbForm({
      form: 'VBD',
      item: file,
      metric: 'changeset-sentences',
      text: body,
    })
  }
  if (changesets.length === 0)
    lines.push('changeset-sentences skip note "no changesets"')

  check({
    metric: 'tracked-output',
    problems: tracked
      .filter((file) => output.test(file))
      .map((file) => `Git tracks ${file}`),
  })
}

function subject(message: string): string {
  return message.split('\n')[0] ?? ''
}

/** The lexicon can confirm a word form, not the mood of a sentence or a new technical verb. */
function verbForm(options: {
  form: 'VB' | 'VBD'
  item: string
  metric: string
  text: string
}): void {
  const verb = /^\s*([A-Za-z]+)\b/.exec(options.text)?.[1]?.toLowerCase() ?? ''
  const tags = Object.hasOwn(lexicon, verb)
    ? lexicon[verb]?.split('|')
    : undefined
  if (!tags?.some((tag) => tag.startsWith('VB'))) {
    lines.push(
      `${options.metric} ${quote(options.item)} skip note ${quote(`no known verb form for the opening word: ${verb}`)}`,
    )
    return
  }

  const label = options.form === 'VB' ? 'base' : 'past-tense'
  check({
    item: options.item,
    metric: options.metric,
    problems: tags.includes(options.form)
      ? []
      : [`"${verb}" is not a ${label} form`],
  })
}

/** A whitespace diagnostic sets bit 1 of Git's status; a Git invocation error is not a check. */
function run(
  command: readonly string[],
  statuses: readonly number[] = [0],
): string {
  const result = Bun.spawnSync([...command])
  if (!statuses.includes(result.exitCode))
    throw new Error(`${command.join(' ')}: ${result.stderr}`)
  return result.stdout.toString()
}

/**
 * Writes a check for one item: it passes without problems, and fails with the first as its note.
 */
function check(options: check.Options): void {
  const { item, metric, problems } = options
  const subject = item === undefined ? metric : `${metric} ${quote(item)}`
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''
  lines.push(
    problems.length === 0
      ? `${subject} pass`
      : `${subject} fail note ${quote(`${problems[0]}${more}`)}`,
  )
}

/** Quotes an item or note for a metric line, escaping `"` and `\`. */
function quote(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ')}"`
}

declare namespace check {
  /** One check: the metric, its item, and the problems that fail it. */
  type Options = {
    item?: string | undefined
    metric: string
    problems: readonly string[]
  }
}
