/**
 * Tests the `dpop` plugin with a memory store, without a server: the DPoP key that it sets on the
 * instance, the DPoP key that it keeps in the store, an entry that holds no DPoP key, and a
 * runtime without `crypto.subtle`.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import * as Esbuild from 'esbuild'
import { EmbeddedJWK, jwtVerify } from 'jose'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Vm from 'node:vm'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Dpop from '../internal/Dpop.js'
import * as Store from '../Store.js'
import { dpop } from './dpop.js'

/** Returns the DPoP key that `plugin` sets on an instance. */
function keyOf(plugin: Awaited<ReturnType<typeof dpop>>) {
  const value = plugin.config?.().dpop
  if (!value) throw new Error('The plugin sets no DPoP key.')
  return value
}

describe('dpop', () => {
  test("sets the instance's DPoP key, which the store holds", async () => {
    const store = Store.memory()

    const accounts = Accounts.create({
      clientId: 'https://app.example',
      plugins: [await dpop({ store })],
      store,
    })

    const stored = await store.getItem('tempo-id:dpop')
    expect(accounts.config.dpop).toBeDefined()
    expect(Dpop.thumbprint(accounts.config.dpop!)).toBe(
      Dpop.thumbprint(stored as Dpop.Dpop),
    )
    expect(accounts.config.dpop!.privateKey.extractable).toBe(false)
  })

  test("keeps the DPoP key that `Accounts.create` receives over the plugin's", async () => {
    const own = await Dpop.create()

    const accounts = Accounts.create({
      clientId: 'https://app.example',
      dpop: own,
      plugins: [await dpop({ store: Store.memory() })],
    })

    expect(accounts.config.dpop).toBe(own)
  })

  test('returns the stored DPoP key at the next call on the same store, which signs proofs', async () => {
    const store = Store.memory()
    const url = 'https://api.example/me'

    const first = keyOf(await dpop({ store }))
    const second = keyOf(await dpop({ store }))
    const proof = await Dpop.proof(second, { method: 'GET', url })

    expect(Dpop.thumbprint(second)).toBe(Dpop.thumbprint(first))
    const verified = await jwtVerify(proof, EmbeddedJWK, {
      typ: 'dpop+jwt',
    })
    expect(verified.payload.htu).toMatchInlineSnapshot(
      `"https://api.example/me"`,
    )
  })

  test('keeps no private key in a shared store, and resolves with a DPoP key for the process when the store refuses the read or the write', async () => {
    const database = new PGlite()
    const store = Store.postgres({
      query: (text: string, values: readonly unknown[]) =>
        database.query(text, [...values]),
    })
    // The file store of a folder rejects each read, as a closed IndexedDB does.
    const folder = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-dpop-'))
    const unreadable = Store.file(folder)
    // A folder that only its owner reads refuses each write of the file store in it, also of the JWK.
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-dpop-'))
    Fs.chmodSync(directory, 0o500)
    const readOnly = Store.file(Path.join(directory, 'store.json'))

    const first = await dpop({ store })
    const second = await dpop({ store })
    await database.close()
    const refusedRead = await dpop({ store: unreadable }).finally(() =>
      Fs.rmSync(folder, { force: true, recursive: true }),
    )
    const refusedWrite = await dpop({ store: readOnly }).finally(() => {
      Fs.chmodSync(directory, 0o700)
      Fs.rmSync(directory, { force: true, recursive: true })
    })

    // A database row would hold the private key beside the refresh token that it binds, so the
    // store holds none, and each call creates its own.
    expect(Dpop.thumbprint(keyOf(second))).not.toBe(
      Dpop.thumbprint(keyOf(first)),
    )
    expect(
      [refusedRead, refusedWrite].map(
        (plugin) => Dpop.thumbprint(keyOf(plugin)).length,
      ),
    ).toEqual([43, 43])
  })

  test('sends no query to a shared store, such as Store.postgres, which can hold no DPoP key', async () => {
    const database = new PGlite()
    // Each query records its first word, such as `select`.
    const queries: string[] = []
    const store = Store.postgres({
      query(text: string, values: readonly unknown[]) {
        queries.push(text.split(' ')[0]!)
        return database.query(text, [...values])
      },
    })

    const plugin = await dpop({ store })
    await database.close()

    expect(Dpop.thumbprint(keyOf(plugin)).length).toBe(43)
    expect(queries).toMatchInlineSnapshot(`[]`)
  })

  test('returns the DPoP key of an earlier run from Store.file, which keeps it as a JWK, and imports it as non-extractable', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-dpop-'))
    const file = Path.join(directory, 'store.json')

    try {
      // Each call reads the file anew, as each run of a CLI does.
      const first = keyOf(await dpop({ store: Store.file(file) }))
      const second = keyOf(await dpop({ store: Store.file(file) }))
      const proof = await Dpop.proof(second, {
        method: 'GET',
        url: 'https://api.example/me',
      })
      const verified = await jwtVerify(proof, EmbeddedJWK, { typ: 'dpop+jwt' })

      expect({
        extractable: [first, second].map((key) => key.privateKey.extractable),
        header: Object.keys(verified.protectedHeader.jwk ?? {}).sort(),
        // The file holds a private key, so only the user reads it.
        mode: Fs.existsSync(file) ? Fs.statSync(file).mode & 0o777 : undefined,
        same: Dpop.thumbprint(second) === Dpop.thumbprint(first),
      }).toMatchInlineSnapshot(`
        {
          "extractable": [
            false,
            false,
          ],
          "header": [
            "crv",
            "kty",
            "x",
            "y",
          ],
          "mode": 384,
          "same": true,
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('returns one DPoP key for concurrent first calls on one store', async () => {
    const store = Store.memory()

    const plugins = await Promise.all([dpop({ store }), dpop({ store })])

    const [first, second] = plugins.map((plugin) =>
      Dpop.thumbprint(keyOf(plugin)),
    )
    expect(second).toBe(first)
  })

  test('returns one DPoP key for concurrent first runs of two processes on one Store.file, such as two first runs of a CLI', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-dpop-'))
    const path = Path.join(directory, 'store.json')
    // Each process runs Node with its global `navigator`, whose Web Locks span only that process.
    // Each reports that it started over IPC, and calls the factory once the test releases both.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import * as Dpop from '../internal/Dpop.ts'",
          "import * as Store from '../Store.ts'",
          "import { dpop } from './dpop.ts'",
          `const path = ${JSON.stringify(path)}`,
          "const released = new Promise((resolve) => process.once('message', resolve))",
          "process.send('ready')",
          'await released',
          'const plugin = await dpop({ store: Store.file(path) })',
          'console.log(Dpop.thumbprint(plugin.config().dpop))',
          'process.disconnect()',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    const children = [0, 1].map(() =>
      ChildProcess.spawn(process.execPath, ['--input-type=module'], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }),
    )
    let ready = 0
    const results = children.map(
      (child) =>
        new Promise<string>((resolve, reject) => {
          let stderr = ''
          let stdout = ''
          child.on('message', () => {
            ready++
          })
          child.stderr!.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
          })
          child.stdout!.on('data', (chunk: Buffer) => {
            stdout += chunk.toString()
          })
          child.on('close', (code) => {
            if (code === 0) resolve(stdout.trim())
            else reject(new Error(stderr))
          })
          child.stdin!.end(output.outputFiles[0]!.text)
        }),
    )

    try {
      await expect.poll(() => ready, { timeout: 10_000 }).toBe(2)
      for (const child of children) child.send('start')
      const thumbprints = await Promise.all(results)
      // The next run reads the DPoP key that the file keeps, which binds the sessions of both.
      const next = Dpop.thumbprint(
        keyOf(await dpop({ store: Store.file(path) })),
      )

      expect({
        same: thumbprints.every((thumbprint) => thumbprint === next),
      }).toMatchInlineSnapshot(`
        {
          "same": true,
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  }, 20_000)

  test('creates a new DPoP key at each call without a store outside a browser', async () => {
    const plugins = await Promise.all([dpop(), dpop()])

    const [first, second] = plugins.map((plugin) =>
      Dpop.thumbprint(keyOf(plugin)),
    )
    expect(second).not.toBe(first)
  })

  const malformed = {
    'a DPoP key after a JSON round trip': async () =>
      JSON.parse(JSON.stringify(await Dpop.create())) as unknown,
    'a JWK without `y`': async () => {
      const { jwk, privateKey } = await Dpop.create()
      return { jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x }, privateKey }
    },
    'a JWK with its private scalar': async () => {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )
      const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      )
      return {
        jwk: { crv: jwk.crv, d: jwk.d, kty: jwk.kty, x: jwk.x, y: jwk.y },
        privateKey,
      }
    },
    'a P-384 private key': async () => {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        false,
        ['sign', 'verify'],
      )
      return { jwk: (await Dpop.create()).jwk, privateKey: pair.privateKey }
    },
    'a private key of another key pair': async () => ({
      jwk: (await Dpop.create()).jwk,
      privateKey: (await Dpop.create()).privateKey,
    }),
    'an extractable private key': async () => {
      const { jwk, privateKey } = await Dpop.create({ extractable: true })
      return { jwk, privateKey }
    },
    'a public key': async () => {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify'],
      )
      return { jwk: (await Dpop.create()).jwk, privateKey: pair.publicKey }
    },
    'a string': () => Promise.resolve('dpop'),
    'an HMAC key': async () => ({
      jwk: (await Dpop.create()).jwk,
      privateKey: await crypto.subtle.generateKey(
        { hash: 'SHA-256', name: 'HMAC' },
        false,
        ['sign'],
      ),
    }),
  }

  for (const [name, value] of Object.entries(malformed))
    test(`replaces ${name} in the store with a new DPoP key`, async () => {
      const store = Store.memory()
      const seeded = await value()
      await store.setItem('tempo-id:dpop', seeded)

      const created = keyOf(await dpop({ store }))
      const proof = await Dpop.proof(created, {
        method: 'GET',
        url: 'https://api.example/me',
      })

      const stored = await store.getItem('tempo-id:dpop')
      expect(Dpop.thumbprint(stored as Dpop.Dpop)).toBe(
        Dpop.thumbprint(created),
      )
      expect(created).not.toBe(seeded)
      expect(created.privateKey.extractable).toBe(false)
      const verified = await jwtVerify(proof, EmbeddedJWK, {
        typ: 'dpop+jwt',
      })
      expect(verified.payload.htm).toMatchInlineSnapshot(`"GET"`)
    })

  test('rejects with a TypeError that names the fix in a runtime without `crypto.subtle`, such as React Native, before any store write', async () => {
    // A new `node:vm` realm holds only the ECMAScript globals, so it has no `crypto.subtle`, as
    // React Native has none.
    const output = await Esbuild.build({
      bundle: true,
      format: 'iife',
      globalName: 'program',
      logLevel: 'silent',
      platform: 'neutral',
      stdin: {
        contents: [
          "import * as Dpop from '../internal/Dpop.ts'",
          "import * as Store from '../Store.ts'",
          "import { dpop } from './dpop.ts'",
          'export async function run() {',
          '  const store = Store.memory()',
          '  const errors = []',
          '  for (const call of [() => dpop(), () => dpop({ store }), () => Dpop.create()])',
          '    await call().then(() => errors.push(undefined), (error) => errors.push(error.name + ": " + error.message))',
          "  return JSON.stringify({ errors, stored: (await store.getItem('tempo-id:dpop')) ?? null })",
          '}',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })

    const result = await Vm.runInNewContext(
      `${output.outputFiles[0]!.text};program.run()`,
    )

    expect(JSON.parse(result)).toMatchInlineSnapshot(`
      {
        "errors": [
          "TypeError: Invalid DPoP key: the runtime has no \`crypto.subtle\`, which generates the key and signs its proofs. Install a \`crypto.subtle\` before the call, or create the instance without \`dpop\`.",
          "TypeError: Invalid DPoP key: the runtime has no \`crypto.subtle\`, which generates the key and signs its proofs. Install a \`crypto.subtle\` before the call, or create the instance without \`dpop\`.",
          "TypeError: Invalid DPoP key: the runtime has no \`crypto.subtle\`, which generates the key and signs its proofs. Install a \`crypto.subtle\` before the call, or create the instance without \`dpop\`.",
        ],
        "stored": null,
      }
    `)
  }, 20_000)
})
