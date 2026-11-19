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
    'internal/BackendSessions.ts',
    'internal/Rpc.ts',
    'plugins/backend.ts',
  ],
  device: ['actions/device.ts', 'plugins/device.ts'],
  dialog: ['actions/dialog.ts', 'internal/Sheet.ts', 'plugins/dialog.ts'],
  email: ['actions/email.ts', 'plugins/email.ts'],
  passkey: ['actions/passkey.ts', 'plugins/passkey.ts'],
  redirect: ['plugins/redirect.ts'],
  viem: ['internal/viem/AccessKey.ts', 'internal/Signer.ts', 'plugins/viem.ts'],
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
      const {
        loaded: { files: included },
      } = await bundle(
        `import { Accounts, Store } from '${Path.join(source, 'index.ts')}'
        import { ${name} } from '${Path.join(source, 'plugins', 'index.ts')}'
        import { tempo } from 'viem/tempo/chains'
        export const tempoId = Accounts.create({
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

  test('imports no mppx from the entry of the plugins, or from an instance before its first payment', async () => {
    const { loaded } = await bundle(
      `export * from '${Path.join(source, 'plugins/index.ts')}'`,
    )
    const { lazy, loaded: instance } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test' })`,
    )

    expect(loaded.imports.filter((name) => name.startsWith('mppx'))).toEqual([])
    expect(instance.imports.filter((name) => name.startsWith('mppx'))).toEqual(
      [],
    )
    expect(instance.files).not.toContain('mpp/index.ts')
    expect(lazy).toContain('mpp/index.ts')
  })

  test("bundles the default funding plugin with the instance, without the dialog's modules", async () => {
    const {
      loaded: { files: instance },
    } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      import { email } from '${Path.join(source, 'plugins/index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test', plugins: [email()] })`,
    )

    expect(instance).toContain('plugins/funding.ts')
    expect(modules.dialog.filter((file) => instance.includes(file))).toEqual([])
  })

  test('bundles no default plugin with the instance of `accounts/lite`', async () => {
    const { chunks, loaded } = await bundle(
      `import { Accounts } from '${Path.join(source, 'lite/index.ts')}'
      import { email } from '${Path.join(source, 'plugins/index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test', plugins: [email()] })`,
    )
    const files = chunks.flat()

    expect(loaded.files).toContain('plugins/email.ts')
    expect(
      [
        'internal/DefaultDialog.ts',
        'internal/DefaultMpp.ts',
        'mpp/index.ts',
        'plugins/funding.ts',
      ].filter((file) => files.includes(file)),
    ).toEqual([])
  })

  test("loads `accounts.connections` and the router of `accounts.handler` from chunks of their own, so a page's instance bundles neither", async () => {
    const { chunks } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test' })`,
    )
    const instance = chunks.find((files) => files.includes('Accounts.ts')) ?? []
    const connections =
      chunks.find((files) => files.includes('internal/Connections.ts')) ?? []

    expect(instance).not.toContain('internal/Connections.ts')
    expect(instance).not.toContain('AccessToken.ts')
    expect(instance).not.toContain('internal/handlers/Server.ts')
    expect(connections).not.toContain('Accounts.ts')
  })

  test("loads the access token verifier of the viem plugin from a chunk of its own, so a page's wagmi app bundles neither it nor jose", async () => {
    const { loaded } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      import { viem } from '${Path.join(source, 'plugins/index.ts')}'
      import { wagmi } from '${Path.join(source, 'wagmi/index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test', plugins: [viem(), wagmi()] })`,
    )

    expect(loaded.files).toContain('plugins/viem.ts')
    expect(loaded.files).not.toContain('AccessToken.ts')
    expect(loaded.imports.filter((name) => name.startsWith('jose'))).toEqual([])
  })

  test("imports no chain definitions of Viem for an app of redirect, since each one loads Viem's Tempo actions and their ABIs with the page", async () => {
    const { loaded } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      import { redirect } from '${Path.join(source, 'plugins/index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test', plugins: [redirect()] })`,
    )

    expect(
      loaded.imports.filter((name) => name.startsWith('viem/tempo/chains')),
    ).toMatchInlineSnapshot(`[]`)
  })

  test('loads the default dialog of an instance without a sign-in plugin from a chunk of its own', async () => {
    const { entry, lazy } = await bundle(
      `import { Accounts } from '${Path.join(source, 'index.ts')}'
      export const tempoId = Accounts.create({ clientId: 'client_test' })`,
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
 * its source, the modules of each chunk, the packages that the chunks import, and the modules and
 * packages that the entry chunk loads with its static imports.
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
    // A lazy chunk that shares the instance's modules leaves the first chunk an empty facade, so
    // the entry is the chunk that renders the entry module.
    const first =
      chunks.find((chunk) => (chunk.modules[file]?.renderedLength ?? 0) > 0) ??
      chunks[0]
    if (!first) throw new Error('The build returned no chunk.')
    const files = (chunk: Rollup.OutputChunk) =>
      Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => Path.relative(source, id))
    // The chunks that load with the entry, through static imports only.
    const statics = new Set([first])
    for (const chunk of statics)
      for (const name of chunk.imports) {
        const imported = chunks.find((entry) => entry.fileName === name)
        if (imported) statics.add(imported)
      }
    return {
      chunks: chunks.map(files),
      entry: files(first),
      imports: chunks.flatMap((chunk) => chunk.imports),
      lazy: chunks.filter((chunk) => chunk !== first).flatMap(files),
      loaded: {
        files: [...statics].flatMap(files),
        imports: [...statics].flatMap((chunk) => chunk.imports),
      },
    }
  } finally {
    Fs.rmSync(directory, { force: true, recursive: true })
  }
}
