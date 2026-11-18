/**
 * Runs the CLI test app of `test/apps/cli` on the suite's own machine, as a user runs a program in a
 * terminal. An instance holds its own folder, which each command receives as `TEMPO_HOME`. The
 * program passes no `store`, so its commands share the session file `id/store.json` of the folder,
 * and a second command reads what the first one saved. `test` extends the suite's `test` with an
 * instance per test, and with `terminal`, which adds the commands and their output to the report as
 * a terminal shows them. A failed test attaches the same transcript to the report.
 * @module
 */
import type { Page } from '@playwright/test'
import { type ChildProcess, spawn } from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Apps from './Apps.js'
import * as Chain from './Chain.js'
import * as Playwright from './Playwright.js'
import * as TempoId from './TempoId.js'

/** The CLI test app of one test: its files, and its commands. */
export type Cli = {
  /** The path of the session file, which each command reads and writes. */
  file: string
  /** The path of the file that holds the grant of `authorize` until `poll` redeems it. */
  grantFile: string
  /** Stops each command that still runs, and removes the folder. */
  remove: () => Promise<void>
  /** Runs a command to its end, and returns what it printed. */
  run: (options: start.Options) => Promise<Result>
  /** Starts a command, and returns its process while it runs. */
  start: (options: start.Options) => Process
  /** Returns each command with its output so far, as a terminal shows them. */
  transcript: () => string
}

/** A command that runs. */
export type Process = {
  /**
   * Returns the first line of the output that matches `pattern`, once the command prints it.
   * Rejects if the command ends without such a line.
   */
  line: (options: line.Options) => Promise<string>
  /** The lines that the command printed so far, in order. */
  lines: readonly string[]
  /** What the command printed, once it ends. Rejects if its last line holds no outcome. */
  result: Promise<Result>
  /** Writes `text` as one line to the command's input. */
  write: (options: write.Options) => void
}

/** What a command printed, and how it ended. */
export type Result = {
  /** The exit code: `0` for an action that returned, and `1` for one that threw. */
  code: number | null
  /** The lines that the command printed, in order. */
  lines: readonly string[]
  /** What the command's action returned or threw: the last line of the output. */
  outcome: Playwright.Outcome
}

/** The folder of the CLI test app. */
const folder = Path.resolve(import.meta.dirname, 'apps', 'cli')

/** The suite's `test`, with the CLI test app of the test. */
export const test = Playwright.test.extend<{
  /** The CLI test app, in a folder of its own that the test's end removes. */
  cli: Cli
  /**
   * Adds a screenshot of the commands and their output so far to the report under `name`, as proof
   * of a step that no page shows.
   */
  terminal: (name: string) => Promise<void>
}>({
  // Playwright reads fixture dependencies from the destructured parameter, so this one stays empty.
  // oxlint-disable-next-line no-empty-pattern
  cli: async ({}, use, testInfo) => {
    const cli = await create()
    await use(cli)
    // The page of a failed test shows nothing of a command, so the report holds the transcript. It
    // leaves out the output of each `hidden` command.
    if (testInfo.status !== testInfo.expectedStatus)
      await testInfo.attach('terminal', {
        body: cli.transcript(),
        contentType: 'text/plain',
      })
    await cli.remove()
  },
  terminal: async ({ capture, cli, context }, use) => {
    // The tab opens at the first screenshot, after the test's page. The proof shows the video of a
    // test's first page.
    let tab: Promise<Page> | undefined
    await use(async (name) => {
      const page = await (tab ??= context.newPage())
      await page.setContent(
        '<body style="background: #0d1117; color: #e6edf3; margin: 16px"><pre style="font: 13px/1.5 monospace; white-space: pre-wrap; word-break: break-all"></pre></body>',
      )
      // The text is set as text, so the page reads no output as markup.
      await page.locator('pre').evaluate((element, text) => {
        element.textContent = text
        window.scrollTo(0, document.body.scrollHeight)
      }, cli.transcript())
      await capture(name, page)
    })
  },
})

/**
 * Returns the CLI test app in a new folder of the machine's temporary folder. Each command runs
 * `index.ts` of `test/apps/cli` in a Node process of its own, with the suite's Tempo ID and node,
 * and with the folder as `TEMPO_HOME`, which holds the session file.
 */
export async function create(): Promise<Cli> {
  const home = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-e2e-cli-'))
  const file = Path.join(home, 'id', 'store.json')
  const children = new Set<ChildProcess>()
  const commands: Command[] = []

  function start(options: start.Options): Process {
    const { args, hidden = false } = options
    const lines: string[] = []
    commands.push({ args, hidden, lines })

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'index.ts', ...args],
      {
        cwd: folder,
        env: {
          ...process.env,
          CLIENT_ID: Apps.cli.clientId,
          // Playwright sets this for its workers. Node warns about it beside `NO_COLOR`, and the
          // warning is no output of the program.
          FORCE_COLOR: undefined,
          TEMPO_HOME: home,
          TEMPO_ID_URL: TempoId.url,
          TEMPO_RPC_URL: Chain.rpcUrl,
        },
      },
    )
    children.add(child)
    // A stream ends a chunk inside a line, so each stream holds its own unfinished line.
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        const parts = `${rest}${chunk}`.split('\n')
        rest = parts.pop() ?? ''
        lines.push(...parts)
      })
      stream.on('end', () => {
        if (rest) lines.push(rest)
      })
    }

    // The streams end before the process closes, so `lines` holds the whole output from then on.
    let closed = false
    const result = new Promise<Result>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        closed = true
        children.delete(child)
        try {
          resolve({ code, lines, outcome: JSON.parse(lines.at(-1) ?? '') })
        } catch {
          reject(
            new Error(
              `The command \`${args.join(' ')}\` exited with code ${code} and printed no outcome. Read its output in the test's \`terminal\` attachment.`,
            ),
          )
        }
      })
    })
    // A test that fails before the command ends awaits no result, and reports its own failure.
    void result.catch(() => undefined)

    return {
      async line(options) {
        let found: string | undefined
        await Playwright.expect
          .poll(
            () => {
              found = lines.find((line) => options.pattern.test(line))
              // A command that ended prints no further line, so the wait ends with it. The message
              // holds no output, since a command can print a token.
              if (found === undefined && closed)
                throw new Error(
                  `The command \`${args.join(' ')}\` ended before it printed a line that matches ${options.pattern}. Read its output in the test's \`terminal\` attachment.`,
                )
              return found
            },
            {
              message: `A line of \`${args.join(' ')}\` that matches ${options.pattern}`,
              timeout: 20_000,
            },
          )
          .toBeDefined()
        return found!
      },
      lines,
      result,
      write(options) {
        child.stdin.write(`${options.text}\n`)
      },
    }
  }

  return {
    file,
    grantFile: Path.join(home, 'grant.json'),
    async remove() {
      for (const child of children) child.kill()
      await Fs.rm(home, { force: true, recursive: true })
    },
    run(options) {
      return start(options).result
    },
    start,
    transcript() {
      return commands
        .map((command) => {
          const output = command.hidden
            ? ['(The output holds a token, so the report shows none of it.)']
            : command.lines
          return [`$ cli ${command.args.map(quote).join(' ')}`, ...output].join(
            '\n',
          )
        })
        .join('\n\n')
    },
  }
}

export declare namespace line {
  type Options = {
    /** The pattern that the line matches. */
    pattern: RegExp
  }
}

export declare namespace start {
  type Options = {
    /** The command's name, its arguments, and its flags, such as `['login', '--limit', '5']`. */
    args: readonly string[]
    /**
     * Whether the transcript leaves out the command's output, such as for one that prints a token.
     * Defaults to `false`.
     */
    hidden?: boolean | undefined
  }
}

export declare namespace write {
  type Options = {
    /** The line, without its end. */
    text: string
  }
}

/** A command of the transcript. */
type Command = {
  /** The command's name, its arguments, and its flags. */
  args: readonly string[]
  /** Whether the transcript leaves out the output. */
  hidden: boolean
  /** The lines that the command printed so far. */
  lines: readonly string[]
}

/** Returns `arg` as a shell shows it: in single quotes, unless it holds only plain characters. */
function quote(arg: string) {
  return /^[\w./:@=+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`
}
