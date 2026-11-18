/**
 * Playwright's reporter of the end-to-end suite's proof. It holds each test's last attempt, and
 * writes the proof of `Proof.ts` when the run ends. With `E2E_SHARD`, the run is one shard of a
 * larger one, and the reporter writes the shard's part in place of the proof.
 * @module
 */
import type {
  FullResult,
  Reporter as PlaywrightReporter,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Chain from './Chain.js'
import * as Proof from './Proof.js'
import * as TempoApi from './TempoApi.js'
import * as TempoId from './TempoId.js'

/**
 * The reporter. It holds each test's last attempt. When the run ends, it writes `e2e-proof.html` and
 * `summary.md` to `Proof.folder`, or the part of the shard that `E2E_SHARD` names.
 */
export default class Reporter implements PlaywrightReporter {
  /** The errors outside a test, such as one of the global setup. */
  private errors: TestError[] = []

  /** Each test's last result, by the test's ID, so a retry replaces its earlier attempt. */
  private results = new Map<string, { result: TestResult; test: TestCase }>()

  onEnd(_result: FullResult) {
    const tests = [...this.results.values()]
      .map((entry) => from(entry))
      .toSorted(Proof.compare)
    const run = {
      commit: process.env.E2E_COMMIT || process.env.GITHUB_SHA || undefined,
      errors: this.errors.map((error) =>
        plain(error.message ?? error.value ?? 'An error without a message.'),
      ),
      stack: {
        // Only a run with a test of the Tempo API starts it.
        ...([...this.results.values()].some((entry) =>
          entry.test.tags.includes(TempoApi.tag),
        )
          ? { 'Tempo API': TempoApi.external ?? TempoApi.image }
          : {}),
        'Tempo ID': TempoId.external ?? TempoId.image,
        'Tempo node': Chain.external ?? Chain.image,
      },
      time: new Date().toISOString(),
    }

    const shard = process.env.E2E_SHARD
    if (shard) {
      const [name, of] = shard.split('/')
      if (!name || !of || !Number.isInteger(Number(of)) || Number(of) < 1)
        throw new Error(
          `\`E2E_SHARD\` holds "${shard}". Set it to the shard's name and the count of shards, such as \`3/16\`.`,
        )
      Proof.save({ name, of: Number(of), run, tests })
      return
    }

    Fs.rmSync(Proof.folder, { force: true, recursive: true })
    Proof.write({ run, tests })
  }

  onError(error: TestError) {
    this.errors.push(error)
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.set(test.id, { result, test })
  }

  printsToStdio() {
    return false
  }
}

/** Returns a test's last attempt as the proof shows it, with each of its files read. */
function from(options: { result: TestResult; test: TestCase }): Proof.Test {
  const { result, test } = options
  const named = (name: string) =>
    result.attachments
      .filter((attachment) => attachment.name === name)
      .map((attachment) => media(attachment))
      .find((value) => value !== undefined)
  // Playwright saves the video of the first page of a test as `video.webm`, and of each later
  // page, such as a popup or the tab of a transcript, as `video-<count>.webm`. It attaches each
  // one once its save ends, so the first attachment is the video of any page.
  const videos = result.attachments.filter(
    (attachment) => attachment.name === 'video',
  )
  const first = videos.filter(
    (attachment) =>
      attachment.path !== undefined &&
      Path.basename(attachment.path) === 'video.webm',
  )
  const error = result.errors[0]?.message

  return {
    duration: result.duration,
    ...(error ? { error: plain(error) } : {}),
    file: Path.relative(
      Path.join(import.meta.dirname, 'e2e'),
      test.location.file,
    ),
    result: (() => {
      if (test.outcome() === 'flaky') return 'flaky'
      if (result.status === 'passed' || result.status === 'skipped')
        return result.status
      return 'failed'
    })(),
    ...(result.status === 'passed' ? {} : { screenshot: named('screenshot') }),
    steps: result.steps
      .filter((step) => step.category === 'test.step')
      .map((step) => ({ captures: captures(step), title: step.title })),
    // The file's titles are the project, the spec's path, each `describe`, and the test.
    title: test.titlePath().slice(3).join(' › '),
    video: [...first, ...videos]
      .map((attachment) => media(attachment))
      .find((value) => value !== undefined),
  }
}

/** Returns the screenshots that a test attached in `step` and in the steps within it, in order. */
function captures(step: TestStep): readonly Proof.Media[] {
  return [
    ...step.attachments
      .map((attachment) => media(attachment))
      .filter((value) => value !== undefined),
    ...step.steps.flatMap((child) => captures(child)),
  ]
}

/** Returns an attachment of a test as the proof embeds it, or `undefined` if it holds no content. */
function media(
  attachment: TestResult['attachments'][number],
): Proof.Media | undefined {
  const body = (() => {
    if (attachment.body) return attachment.body
    if (attachment.path && Fs.existsSync(attachment.path))
      return Fs.readFileSync(attachment.path)
    return undefined
  })()
  if (!body) return undefined
  return {
    data: body.toString('base64'),
    name: attachment.name,
    type: attachment.contentType,
  }
}

/** Returns an error's message without the terminal's color codes, which Playwright adds. */
function plain(message: string) {
  // oxlint-disable-next-line no-control-regex
  return message.replace(/\u001B\[[0-9;]*m/g, '')
}
