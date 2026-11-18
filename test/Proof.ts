/**
 * The proof of a run of the end-to-end suite: one HTML file that holds the video, the steps, and the
 * screenshots of every test, and a Markdown summary of the run. The HTML file loads no other file, so
 * a browser opens it from a workflow artifact as it is. `Reporter.ts` collects a run's tests. CI
 * splits a run into shards, each of which writes its part, and `scripts/e2e-proof.ts` merges the
 * parts. The module imports only Node built-ins, so that script runs without an install.
 * @module
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

/** A screenshot or a video of a test, as the proof embeds it. */
export type Media = {
  /** The file's content, in base64. */
  data: string
  /** The name that the test gave the file, such as `signed in`. */
  name: string
  /** The media type, such as `image/png`. */
  type: string
}

/** The run that the proof describes. */
export type Run = {
  /**
   * The commit that the run tested, or `undefined` outside CI. A pull request's workflow names its
   * head commit in `E2E_COMMIT`, since its `GITHUB_SHA` is the merge commit.
   */
  commit: string | undefined
  /**
   * The messages of the errors outside a test, without terminal colors, such as a service that did
   * not start. A run with one ran no test, or not every test.
   */
  errors: readonly string[]
  /** The services that the run tested against, by name: each one's URL, or the image of its container. */
  stack: Readonly<Record<string, string>>
  /** The time that the run ended, in ISO 8601. */
  time: string
}

/** A shard's part of the proof: the tests that one of a run's parallel jobs ran. */
export type Shard = {
  /** The shard's name, such as `3`, which no other shard of the run has. */
  name: string
  /** The count of the run's shards. */
  of: number
  /** The shard's run. */
  run: Run
  /** The shard's tests. */
  tests: readonly Test[]
}

/** A step of a test, with the screenshots that the test took in it. */
export type Step = {
  /** The screenshots, in the order that the test took them. */
  captures: readonly Media[]
  /** The step's title. */
  title: string
}

/** A test's last attempt, as the proof shows it. */
export type Test = {
  /** The duration, in milliseconds. */
  duration: number
  /** The error's message, without terminal colors. Absent for a test that passed. */
  error?: string | undefined
  /** The spec's path, from the suite's folder. */
  file: string
  /** `passed`, `failed`, `flaky`, or `skipped`. A flaky test failed, then passed on a retry. */
  result: 'failed' | 'flaky' | 'passed' | 'skipped'
  /** The page's last screenshot, for a test that did not pass, whose steps can lack one. */
  screenshot?: Media | undefined
  /** The steps, in order. */
  steps: readonly Step[]
  /** The test's title, with its `describe` titles. */
  title: string
  /** The video of the test's first page. A popup or another tab has a video of its own, which the proof omits. */
  video?: Media | undefined
}

/** Orders two tests as the proof shows them: by the spec's path, then by the title. */
export function compare(a: Test, b: Test) {
  return `${a.file} ${a.title}`.localeCompare(`${b.file} ${b.title}`)
}

/** The folder of the proof, which CI uploads from. */
export const folder = Path.resolve(import.meta.dirname, 'e2e', 'proof')

/** Returns each part that a shard saved to {@link folder}, in the order of the files' names. */
export function load(): readonly Shard[] {
  if (!Fs.existsSync(folder)) return []
  return Fs.readdirSync(folder)
    .filter((file) => /^shard-.+\.json$/.test(file))
    .toSorted()
    .map((file) => JSON.parse(Fs.readFileSync(Path.join(folder, file), 'utf8')))
}

/** The comment that marks the pull request's proof, so each run updates one comment. */
export const marker = '<!-- accounts-e2e-proof -->'

/** Returns the proof's HTML document, which holds each file as a data URL. */
export function html(options: html.Options) {
  const { run, tests } = options
  const stack = Object.entries(run.stack)
    .map(
      (entry) =>
        `<li>${escape(entry[0])}: <code>${escape(entry[1])}</code></li>`,
    )
    .join('')
  const sections = tests
    .map((test) => {
      const steps = test.steps
        .map((step) => {
          const captures = step.captures
            .map(
              (capture) =>
                `<figure><img alt="${escape(capture.name)}" loading="lazy" src="${source(capture)}"><figcaption>${escape(capture.name)}</figcaption></figure>`,
            )
            .join('')
          return `<li><p>${escape(step.title)}</p>${captures}</li>`
        })
        .join('')
      return [
        `<section class="${test.result}">`,
        `<h2>${escape(test.title)}</h2>`,
        `<p><strong>${test.result}</strong> in ${seconds(test.duration)}, <code>${escape(test.file)}</code></p>`,
        test.error ? `<pre>${escape(test.error)}</pre>` : '',
        test.video
          ? `<video controls muted preload="metadata" src="${source(test.video)}"></video>`
          : '',
        `<ol>${steps}</ol>`,
        test.screenshot
          ? `<figure><img alt="The page at the end of the test" loading="lazy" src="${source(test.screenshot)}"><figcaption>The page at the end of the test</figcaption></figure>`
          : '',
        '</section>',
      ].join('\n')
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta content="width=device-width, initial-scale=1" name="viewport">
<title>End-to-end proof</title>
<style>
body { color: #1f2328; font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 24px; }
code, pre { font: 13px/1.5 ui-monospace, monospace; }
figure { margin: 12px 0; }
figcaption { color: #59636e; font-size: 13px; }
img, video { border: 1px solid #d1d9e0; border-radius: 6px; max-width: 100%; }
ol { padding-left: 20px; }
pre { background: #f6f8fa; border-radius: 6px; overflow: auto; padding: 12px; }
section { border-left: 4px solid #d1d9e0; margin: 32px 0; padding-left: 16px; }
section.failed { border-color: #cf222e; }
section.flaky { border-color: #9a6700; }
section.passed { border-color: #1a7f37; }
</style>
</head>
<body>
<h1>End-to-end proof</h1>
<p>${escape(headline({ run, tests }))}</p>
<ul>${stack}</ul>
${run.errors.map((error) => `<pre>${escape(error)}</pre>`).join('\n')}
${sections}
</body>
</html>
`
}

export declare namespace html {
  type Options = {
    /** The run. */
    run: Run
    /** The tests, in the order that the document shows them. */
    tests: readonly Test[]
  }
}

/** Returns the run's summary in Markdown: {@link marker}, the totals, the stack, and a row per test. */
export function markdown(options: markdown.Options) {
  const { run, tests } = options
  const rows = tests.map((test) => {
    const captures = test.steps.reduce(
      (count, step) => count + step.captures.length,
      0,
    )
    return `| ${cell(test.title)} | ${test.result} | ${seconds(test.duration)} | ${test.steps.length} | ${captures} | ${test.video ? 'yes' : 'no'} |`
  })

  return [
    marker,
    '## End-to-end proof',
    '',
    headline({ run, tests }),
    '',
    ...Object.entries(run.stack).map(
      (entry) => `- ${entry[0]}: \`${entry[1]}\``,
    ),
    '',
    ...run.errors.flatMap((error) => ['```', error, '```', '']),
    '| Test | Result | Duration | Steps | Screenshots | Video |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

export declare namespace markdown {
  type Options = {
    /** The run. */
    run: Run
    /** The tests, in the order of the table's rows. */
    tests: readonly Test[]
  }
}

/**
 * Returns one run from the parts of its shards: every test in the proof's order, the errors of each
 * shard under its name, and the services of all. A run that lacks a shard holds an error that names
 * the shards it has, so its proof never reads as the whole run. Throws if `shards` is empty, or if
 * its parts name different commits or counts of shards, which only parts of different runs do.
 */
export function merge(options: merge.Options): html.Options {
  const { shards } = options
  const first = shards[0]
  if (!first)
    throw new Error(
      'The run holds no part of the proof. Write one with `E2E_SHARD` before the merge.',
    )

  const stale = shards.find(
    (shard) => shard.of !== first.of || shard.run.commit !== first.run.commit,
  )
  if (stale)
    throw new Error(
      `The parts of shards ${first.name} and ${stale.name} are of different runs. Remove the parts of the earlier run before the merge.`,
    )

  const names = shards.map((shard) => shard.name).toSorted(compare_names)
  const of = first.of
  const missing =
    shards.length < of
      ? [
          `The proof holds ${shards.length} of ${of} shards: ${names.join(', ')}. Each other shard uploaded no part. Either it failed before its tests ended, and its job holds the log, or its part expired before a later attempt of the run.`,
        ]
      : []

  return {
    run: {
      commit: first.run.commit,
      errors: [
        ...missing,
        ...shards.flatMap((shard) =>
          shard.run.errors.map((error) => `Shard ${shard.name}: ${error}`),
        ),
      ],
      stack: Object.assign({}, ...shards.map((shard) => shard.run.stack)),
      time: shards
        .map((shard) => shard.run.time)
        .toSorted()
        .at(-1)!,
    },
    tests: shards.flatMap((shard) => shard.tests).toSorted(compare),
  }
}

export declare namespace merge {
  type Options = {
    /** The parts, in any order. */
    shards: readonly Shard[]
  }
}

/** Writes the part of `shard` to {@link folder} as `shard-<name>.json`, which {@link load} reads. */
export function save(shard: Shard) {
  Fs.mkdirSync(folder, { recursive: true })
  Fs.writeFileSync(
    Path.join(folder, `shard-${shard.name}.json`),
    JSON.stringify(shard),
  )
}

/** Writes `e2e-proof.html` and `summary.md` of a run to {@link folder}. */
export function write(options: html.Options) {
  Fs.mkdirSync(folder, { recursive: true })
  Fs.writeFileSync(Path.join(folder, 'e2e-proof.html'), html(options))
  Fs.writeFileSync(Path.join(folder, 'summary.md'), markdown(options))
}

/** Returns `value` as a cell of a Markdown table. */
function cell(value: string) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

/** Orders two shard names: numbers by value, then other names by their letters. */
function compare_names(a: string, b: string) {
  return a.localeCompare(b, 'en', { numeric: true })
}

/** Returns `value` as HTML text, also for a quoted attribute. */
function escape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Returns the totals of the run, its commit, and its time, as one sentence. */
function headline(options: html.Options) {
  const { run, tests } = options
  const passed = tests.filter((test) => test.result === 'passed').length
  const commit = run.commit ? ` at \`${run.commit.slice(0, 7)}\`` : ''
  const errors = run.errors.length > 0 ? ' The run failed outside a test.' : ''
  return `${passed} of ${tests.length} tests passed${commit}, on ${run.time}.${errors}`
}

/** Returns a duration of `milliseconds` in seconds, such as `3.2 s`. */
function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)} s`
}

/** Returns the data URL of `value`. */
function source(value: Media) {
  return `data:${value.type};base64,${value.data}`
}
