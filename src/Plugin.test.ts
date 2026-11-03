/**
 * Bundles an app of each plugin with Vite, and checks that its bundle holds the code of no other
 * plugin, so an app pays only for the plugins that it imports. The app imports its plugin by name
 * from the entry of the plugins, as `accounts/plugins` exports it.
 * @module
 */
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { build, type Rollup } from 'vite'
import { describe, expect, test } from 'vite-plus/test'

/** The package's source. */
const source = import.meta.dirname

/** The modules that only one plugin's flow imports, by plugin. */
const modules = {
  backend: [
    'internal/backendSessions.ts',
    'internal/rpc.ts',
    'plugins/backend.ts',
  ],
  device: ['actions/device.ts', 'plugins/device.ts'],
  dialog: ['actions/dialog.ts', 'internal/sheet.ts', 'plugins/dialog.ts'],
  email: ['actions/email.ts', 'plugins/email.ts'],
  passkey: ['actions/passkey.ts', 'plugins/passkey.ts'],
  redirect: ['plugins/redirect.ts'],
  viem: ['internal/viem/accessKey.ts', 'internal/signer.ts', 'plugins/viem.ts'],
} as const

/** Each plugin's options in the app, where it needs some. */
const options: Partial<Record<keyof typeof modules, string>> = {
  backend: '{ store: Store.memory() }',
  device: '{ onCode: () => {} }',
  viem: '{ chain: tempo }',
}

describe('Plugin', () => {
  test.each(Object.keys(modules) as (keyof typeof modules)[])(
    "bundles none of another plugin's modules for an app of %s",
    async (name) => {
      const { entry: included } = await bundle(
        `import { Id, Store } from '${Path.join(source, 'index.ts')}'
        import { ${name} } from '${Path.join(source, 'plugins', 'index.ts')}'
        import { tempo } from 'viem/tempo/chains'
        export const tempoId = Id.create({
          clientId: 'client_test',
          plugins: [${name}(${options[name] ?? ''})],
        })`,
      )

      const foreign = Object.entries(modules)
        .filter(([other]) => other !== name)
        .flatMap(([, files]) => files)
        .filter((file) => included.includes(file))
      expect(foreign).toEqual([])
      expect(included).toContain(`plugins/${name}.ts`)
    },
  )

  test('imports no React from the entry of the plugins, whose React plugin has an entry of its own', async () => {
    const { imports } = await bundle(
      `export * from '${Path.join(source, 'plugins', 'index.ts')}'`,
    )

    expect(imports).not.toContain('react')
  })

  test('imports no mppx from the entry of the plugins, whose mpp plugin has an entry of its own', async () => {
    const { imports } = await bundle(
      `export * from '${Path.join(source, 'plugins/index.ts')}'`,
    )

    expect(imports.filter((name) => name.startsWith('mppx'))).toEqual([])
  })

  test("bundles the default funding plugin with the instance, without the dialog's modules", async () => {
    const { chunks } = await bundle(
      `import { Id } from '${Path.join(source, 'index.ts')}'
      import { email } from '${Path.join(source, 'plugins/index.ts')}'
      export const tempoId = Id.create({ clientId: 'client_test', plugins: [email()] })`,
    )
    const instance = chunks.find((files) => files.includes('Id.ts')) ?? []

    expect(instance).toContain('plugins/funding.ts')
    expect(modules.dialog.filter((file) => instance.includes(file))).toEqual([])
  })

  test('loads the default dialog of an instance without a sign-in plugin from a chunk of its own', async () => {
    const { entry, lazy } = await bundle(
      `import { Id } from '${Path.join(source, 'index.ts')}'
      export const tempoId = Id.create({ clientId: 'client_test' })`,
    )

    expect(modules.dialog.filter((file) => entry.includes(file))).toEqual([])
    expect(modules.dialog.filter((file) => lazy.includes(file))).toEqual([
      ...modules.dialog,
    ])
  })
})

/**
 * Builds `entry` as a library with Vite, with every package external, and returns the package's
 * modules that hold code in the entry chunk, and in the chunks that it loads on demand, relative to
 * its source, the modules of each chunk, and the packages that the chunks import.
 */
async function bundle(entry: string) {
  const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tempo-id-bundle-'))
  try {
    const file = Path.join(directory, 'entry.ts')
    Fs.writeFileSync(file, entry)
    const result = (await build({
      build: {
        lib: { entry: file, fileName: 'app', formats: ['es'] },
        minify: false,
        rollupOptions: {
          external: (id) => !id.startsWith('.') && !Path.isAbsolute(id),
        },
        write: false,
      },
      configFile: false,
      logLevel: 'silent',
      root: directory,
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const chunks = (Array.isArray(result) ? result[0]! : result).output.filter(
      (output) => output.type === 'chunk',
    )
    const [first, ...rest] = chunks
    if (!first) throw new Error('The build returned no chunk.')
    const files = (chunk: Rollup.OutputChunk) =>
      Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => Path.relative(source, id))
    return {
      chunks: chunks.map(files),
      entry: files(first),
      imports: chunks.flatMap((chunk) => chunk.imports),
      lazy: rest.flatMap(files),
    }
  } finally {
    Fs.rmSync(directory, { force: true, recursive: true })
  }
}
