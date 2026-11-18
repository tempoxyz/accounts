/**
 * Measures the browser bundle of each entry's typical use. Each case bundles a small app from
 * `src/` with Rolldown, Vite's bundler: minified ESM for the browser, with code splitting, and React
 * external. The initial load is the entry chunk and every chunk that it imports statically. "All
 * chunks" adds every chunk that a dynamic import reaches. Each size is the sum of each chunk's
 * Brotli size at quality 11, as a CDN serves it.
 *
 * Usage:
 *   node scripts/size.ts [--base <path>] [--external <specifier>…] [--json <path>] [--markdown <path>]
 *   node scripts/size.ts --inputs <case> [--external <specifier>…]
 *
 * `--json` writes the sizes. `--base` reads the sizes of another commit, and adds each change to
 * the table. `--markdown` writes the table to a file. `--inputs` prints the packages and modules of a
 * case's initial load, by bytes before minification. `--external` leaves a specifier out of the
 * bundles, such as `mppx/client`.
 * @module
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Util from 'node:util'
import * as Zlib from 'node:zlib'
import { rolldown } from 'vite/rolldown'

/** The repository's root. */
const root = Path.resolve(import.meta.dirname, '..')

/** The cases to measure: an app's source for each entry, keyed by its name. */
const cases = {
  accounts: `
    import { Accounts } from 'accounts'
    export const accounts = Accounts.create()
  `,
  'accounts + handler': `
    import { Accounts } from 'accounts'
    export const accounts = Accounts.create()
    export const fetch = (request) => accounts.handler.fetch(request)
  `,
  'accounts/hint': `
    import { Hint } from 'accounts/hint'
    export const hinted = Hint.has(document.cookie)
  `,
  'accounts/plugins (dialog)': `
    import { Accounts } from 'accounts'
    import { dialog } from 'accounts/plugins'
    export const accounts = Accounts.create({ plugins: [dialog()] })
  `,
  'accounts/plugins (email)': `
    import { Accounts } from 'accounts'
    import { email } from 'accounts/plugins'
    export const accounts = Accounts.create({ plugins: [email()] })
  `,
  'accounts/plugins (passkey)': `
    import { Accounts } from 'accounts'
    import { passkey } from 'accounts/plugins'
    export const accounts = Accounts.create({ plugins: [passkey()] })
  `,
  'accounts/plugins (redirect)': `
    import { Accounts } from 'accounts'
    import { redirect } from 'accounts/plugins'
    export const accounts = Accounts.create({ plugins: [redirect()] })
  `,
  'accounts/plugins (viem)': `
    import { Accounts } from 'accounts'
    import { viem } from 'accounts/plugins'
    export const accounts = Accounts.create({ plugins: [viem()] })
  `,
  'accounts/react': `
    import { Accounts } from 'accounts'
    import { react } from 'accounts/react'
    export const accounts = Accounts.create({ plugins: [react()] })
  `,
} as const

/** A case's name. */
type Name = keyof typeof cases

/** One output chunk of a bundle. */
type Chunk = {
  /** The chunk's code. */
  code: Uint8Array
  /** The file names of the chunks that it imports statically. */
  imports: readonly string[]
  /** The bytes of each input module in the chunk, before minification, by its path. */
  inputs: Readonly<Record<string, number>>
}

/** A bundle's chunks, by file name, and the file name of its entry chunk. */
type Bundle = {
  /** The chunks, by file name. */
  chunks: Readonly<Record<string, Chunk>>
  /** The file name of the app's entry chunk. */
  entry: string
}

/** The sizes of one case, in bytes. */
type Size = {
  /** The initial load's Brotli size. */
  initial: number
  /** The Brotli size of every chunk. */
  total: number
}

/** The sizes of every case, by name, as `--json` writes them. */
type Sizes = Partial<Record<Name, Size>>

const { values } = Util.parseArgs({
  options: {
    base: { type: 'string' },
    external: { default: [], multiple: true, type: 'string' },
    inputs: { type: 'string' },
    json: { type: 'string' },
    markdown: { type: 'string' },
  },
})

/** Each entry of the package, mapped to its source, from `package.json`. Longer specifiers first. */
const alias = (() => {
  const manifest = JSON.parse(
    Fs.readFileSync(Path.join(root, 'package.json'), 'utf8'),
  ) as { exports: Record<string, { src?: string } | string> }
  return Object.fromEntries(
    Object.entries(manifest.exports)
      .flatMap(([path, target]) => {
        if (typeof target === 'string' || !target.src) return []
        return [[path.replace(/^\./, 'accounts'), Path.join(root, target.src)]]
      })
      .sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0)),
  ) as Record<string, string>
})()

/** The specifiers that every bundle leaves out. */
const external = ['react', 'react/jsx-runtime', ...values.external]

/** Bundles a case. */
async function bundle(options: bundle.Options): Promise<Bundle> {
  const input = Path.join(root, 'node_modules', '.size', 'app.js')
  Fs.mkdirSync(Path.dirname(input), { recursive: true })
  Fs.writeFileSync(input, cases[options.name])

  try {
    const build = await rolldown({
      cwd: root,
      external,
      input,
      onLog: () => undefined,
      platform: 'browser',
      resolve: { alias },
    })
    const result = await build.generate({ format: 'esm', minify: true })
    await build.close()

    const chunks: Record<string, Chunk> = {}
    let entry: string | undefined
    for (const output of result.output) {
      if (output.type !== 'chunk') continue
      if (output.isEntry) entry = output.fileName
      chunks[output.fileName] = {
        code: new TextEncoder().encode(output.code),
        imports: output.imports,
        inputs: Object.fromEntries(
          Object.entries(output.modules).map(([path, module]) => [
            Path.relative(root, path),
            module.renderedLength,
          ]),
        ),
      }
    }
    if (!entry) throw new Error(`The case ${options.name} has no entry chunk.`)
    return { chunks, entry }
  } finally {
    Fs.rmSync(Path.dirname(input), { force: true, recursive: true })
  }
}

declare namespace bundle {
  type Options = {
    /** The case to bundle. */
    name: Name
  }
}

/** Returns the file names of the entry chunk and every chunk that it imports statically. */
function initial(value: Bundle) {
  const files = new Set<string>()
  const pending = [value.entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || files.has(file)) continue
    files.add(file)
    pending.push(...(value.chunks[file]?.imports ?? []))
  }
  return [...files]
}

/** Returns the sizes of a bundle. */
function measure(value: Bundle): Size {
  const sum = (files: readonly string[], fn: (code: Uint8Array) => number) =>
    files.reduce((total, file) => {
      const chunk = value.chunks[file]
      return chunk ? total + fn(chunk.code) : total
    }, 0)
  const brotli = (code: Uint8Array) =>
    Zlib.brotliCompressSync(code, {
      params: {
        [Zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [Zlib.constants.BROTLI_PARAM_SIZE_HINT]: code.length,
      },
    }).length

  return {
    initial: sum(initial(value), brotli),
    total: sum(Object.keys(value.chunks), brotli),
  }
}

/** Returns the package of an input path, or the path itself for this package's own modules. */
function owner(input: string) {
  const match =
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(
      input,
    )
  return match?.[1] ?? input
}

/** Formats a size in kilobytes, with one decimal. */
function kb(value: number) {
  return `${(value / 1000).toFixed(1)} KB`
}

/** Formats a size, with its change from `base` when there is one. */
function cell(value: number, base: number | undefined) {
  if (base === undefined) return kb(value)
  const change = value - base
  if (Math.abs(change) < 50) return `${kb(value)} (±0)`
  const sign = change > 0 ? '+' : '−'
  return `${kb(value)} (${sign}${kb(Math.abs(change))})`
}

if (values.inputs) {
  const name = values.inputs as Name
  if (!(name in cases))
    throw new Error(
      `The case ${name} is unknown. Use one of: ${Object.keys(cases).join(', ')}.`,
    )

  const value = await bundle({ name })
  const inputs: Record<string, number> = {}
  for (const file of initial(value))
    for (const [path, bytes] of Object.entries(
      value.chunks[file]?.inputs ?? {},
    ))
      inputs[path] = (inputs[path] ?? 0) + bytes

  const packages: Record<string, number> = {}
  for (const [path, bytes] of Object.entries(inputs)) {
    const key = path.startsWith('src/') ? 'accounts' : owner(path)
    packages[key] = (packages[key] ?? 0) + bytes
  }
  const sorted = (record: Record<string, number>) =>
    Object.entries(record)
      .filter(([, bytes]) => bytes > 0)
      .sort((a, b) => b[1] - a[1])

  const lines = [
    `Initial load of \`${name}\`, by package, before minification:`,
    ...sorted(packages).map(
      ([key, bytes]) => `  ${kb(bytes).padStart(10)}  ${key}`,
    ),
    '',
    'Modules of this package:',
    ...sorted(inputs)
      .filter(([path]) => path.startsWith('src/'))
      .map(([path, bytes]) => `  ${kb(bytes).padStart(10)}  ${path}`),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
} else {
  const base = values.base
    ? (JSON.parse(Fs.readFileSync(values.base, 'utf8')) as Sizes)
    : undefined

  const sizes: Sizes = {}
  for (const name of Object.keys(cases) as Name[])
    sizes[name] = measure(await bundle({ name }))

  const lines = [
    '| Case | Initial (brotli) | All chunks (brotli) |',
    '| --- | --: | --: |',
    ...(Object.keys(cases) as Name[]).flatMap((name) => {
      const size = sizes[name]
      if (!size) return []
      const before = base?.[name]
      return [
        `| \`${name}\` | ${cell(size.initial, before?.initial)} | ${cell(size.total, before?.total)} |`,
      ]
    }),
  ]
  const table = `${lines.join('\n')}\n`
  process.stdout.write(table)
  if (values.json)
    Fs.writeFileSync(values.json, `${JSON.stringify(sizes, null, 2)}\n`)
  if (values.markdown) Fs.writeFileSync(values.markdown, table)
}
