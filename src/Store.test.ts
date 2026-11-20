/**
 * Tests the stores that `Store` exports, apart from their services.
 * @module
 */
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Vm from 'node:vm'
import { describe, expect, test } from 'vite-plus/test'
import * as Store from './Store.js'

/**
 * Records each `node:` import as an error, before the package's `browser` field applies. Webpack 5
 * fails each such import with `UnhandledSchemeError`, whatever the `browser` field maps.
 */
const nodeScheme = {
  name: 'node-scheme',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({
      errors: [
        {
          text: `${args.path} from ${Path.relative(import.meta.dirname, args.importer)}`,
        },
      ],
    }))
  },
} satisfies Esbuild.Plugin

describe('Store.file', () => {
  test('bundles the root entry for a browser, without a `node:` import', async () => {
    const errors = await Esbuild.build({
      bundle: true,
      entryPoints: [Path.join(import.meta.dirname, 'index.ts')],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [nodeScheme],
      write: false,
    }).then(
      (output) => output.errors.map((entry) => entry.text),
      (error: Esbuild.BuildFailure) => error.errors.map((entry) => entry.text),
    )

    expect(errors).toMatchInlineSnapshot(`[]`)
  })

  test('reads and writes the file in a Node program bundled for a browser', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      stdin: {
        contents: [
          "import { Store } from './index.ts'",
          `const store = Store.file(${JSON.stringify(Path.join(directory, 'session.json'))})`,
          "await store.setItem('key', 'value')",
          "console.log(await store.getItem('key'))",
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })

    const result = ChildProcess.spawnSync(
      process.execPath,
      ['--input-type=module'],
      { encoding: 'utf8', input: output.outputFiles[0]!.text },
    )

    expect(result.stdout.trim()).toMatchInlineSnapshot(`"value"`)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('throws NodeRequiredError at creation in a runtime without Node modules, before an instance reads the store', async () => {
    const output = await Esbuild.build({
      bundle: true,
      format: 'iife',
      logLevel: 'silent',
      platform: 'browser',
      stdin: {
        contents: [
          "import * as Store from './Store.ts'",
          'globalThis.outcome = (() => {',
          '  try {',
          "    Store.file('~/.config/tempo-test/session.json')",
          "    return 'created'",
          '  } catch (error) {',
          "    return error instanceof Store.NodeRequiredError ? error.name + ': ' + error.message : 'other'",
          '  }',
          '})()',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    // A new context holds only the language's globals, with no `process`, as in a browser.
    const context = Vm.createContext({})

    Vm.runInContext(output.outputFiles[0]!.text, context)

    expect(context.outcome).toMatchInlineSnapshot(
      `"Store.NodeRequiredError: Invalid runtime: the runtime has no file system that persists, such as a browser or a Worker. Run the program in Node, or use another store."`,
    )
  })
})

describe('Store.memory', () => {
  test('writes in constant time on average, so a write to a store of many sessions reads no other entry', async () => {
    const store = Store.memory()
    const expiresAt = Date.now() + 3_600_000

    // A write reads no other entry, so 20,000 writes stay far below the budget on a slow runner.
    const start = performance.now()
    for (let index = 0; index < 20_000; index++)
      await store.setItem(`session:${index}`, { index }, { expiresAt })
    const elapsed = performance.now() - start

    expect(elapsed < 1_000).toMatchInlineSnapshot(`true`)
    expect(await store.getItem('session:19999')).toMatchInlineSnapshot(`
      {
        "index": 19999,
      }
    `)
  }, 60_000)

  test('keeps a copy of each value, as structured-clone storage does, so a change to a written or read value changes no stored value', async () => {
    const store = Store.memory()
    const session = {
      accessKey: { privateKey: '0x01' },
      refreshToken: 'refresh',
      user: { email: 'user@example.org' },
    }

    await store.setItem('session', session)
    session.accessKey.privateKey = '[redacted]'
    const read = (await store.getItem('session')) as typeof session
    read.accessKey.privateKey = '[redacted]'
    read.user.email = '[redacted]'
    const stored = await store.getItem('session')
    const taken = (await store.takeItem!('session')) as typeof session
    taken.refreshToken = '[redacted]'

    expect(stored).toMatchInlineSnapshot(`
      {
        "accessKey": {
          "privateKey": "0x01",
        },
        "refreshToken": "refresh",
        "user": {
          "email": "user@example.org",
        },
      }
    `)
    expect(taken === stored).toMatchInlineSnapshot(`false`)
  })

  test('rejects a write of a value that a structured clone refuses, such as a function, and keeps the entry as it was', async () => {
    const store = Store.memory()
    await store.setItem('session', { refreshToken: 'refresh' })

    const error = await store
      .setItem('session', { sign: () => undefined })
      .catch((error: unknown) => error)

    expect((error as Error).name).toMatchInlineSnapshot(`"DataCloneError"`)
    expect(await store.getItem('session')).toMatchInlineSnapshot(`
      {
        "refreshToken": "refresh",
      }
    `)
  })

  test('keeps a non-extractable CryptoKey, which a copy holds as the same key', async () => {
    const store = Store.memory()
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    )

    await store.setItem('key', { privateKey: pair.privateKey })
    const read = (await store.getItem('key')) as { privateKey: CryptoKey }
    const signature = await crypto.subtle.sign(
      { hash: 'SHA-256', name: 'ECDSA' },
      read.privateKey,
      new Uint8Array([1]),
    )

    expect({
      algorithm: read.privateKey.algorithm,
      extractable: read.privateKey.extractable,
      verified: await crypto.subtle.verify(
        { hash: 'SHA-256', name: 'ECDSA' },
        pair.publicKey,
        signature,
        new Uint8Array([1]),
      ),
    }).toMatchInlineSnapshot(`
      {
        "algorithm": {
          "name": "ECDSA",
          "namedCurve": "P-256",
        },
        "extractable": false,
        "verified": true,
      }
    `)
  })
})
