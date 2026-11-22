/**
 * Tests of `Store.file` against files in a temporary directory.
 * @module
 */
import * as Esbuild from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { WebCryptoP256 } from 'ox'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as File from './File.js'

describe('Store.file', () => {
  test('behavior: in a Worker with `nodejs_compat`, whose file system each isolate keeps in memory, creation throws NodeRequiredError', async () => {
    // A Worker's `node:fs` writes to memory of its isolate, which other isolates never read and
    // which an eviction drops, so a session there would vanish.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'neutral',
      stdin: {
        contents: [
          "import * as File from './File.ts'",
          'export default {',
          '  async fetch() {',
          '    try {',
          "      const store = File.create('/tmp/session.json')",
          "      await store.setItem('session', { refreshToken: 'refresh-token' })",
          "      return new Response('created')",
          '    } catch (error) {',
          "      return new Response(error.name + ': ' + error.message)",
          '    }',
          '  },',
          '}',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    // `no_global_navigator` removes `navigator`, so the check holds without it.
    const texts = await Promise.all(
      [['nodejs_compat'], ['nodejs_compat', 'no_global_navigator']].map(
        async (flags) => {
          const miniflare = new Miniflare(
            convertV4MiniflareOptions({
              compatibilityDate: '2026-10-01',
              compatibilityFlags: flags,
              modules: true,
              script: output.outputFiles[0]!.text,
            }),
          )
          onTestFinished(() => miniflare.dispose())
          const response = await miniflare.dispatchFetch('http://localhost/')
          return response.text()
        },
      ),
    )

    expect(texts).toMatchInlineSnapshot(`
      [
        "Store.NodeRequiredError: Invalid runtime: the runtime has no file system that persists. Run the program in Node, or use another store.",
        "Store.NodeRequiredError: Invalid runtime: the runtime has no file system that persists. Run the program in Node, or use another store.",
      ]
    `)
  })

  test('behavior: a stored string that ends with the bigint suffix or its escape reads back as written, beside a bigint, and fails no other key', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    await store.setItem('siwe', {
      resources: [
        'x#__bigint',
        'x#__string',
        'x#__string#__bigint',
        '1#__bigint',
      ],
      statement: 'Sign in#__bigint',
    })
    await store.setItem('amount', 1n)

    // A file of an earlier version holds each string verbatim, also one that ends with the suffix
    // or its escape.
    const earlier = Path.join(directory, 'earlier.json')
    await Fs.writeFile(
      earlier,
      JSON.stringify({
        amount: { value: '2#__bigint' },
        other: { value: 'x#__bigint' },
        statement: { value: 'Sign in#__string' },
      }),
    )

    expect({
      amount: await store.getItem('amount'),
      earlier: {
        amount: await File.create(earlier).getItem('amount'),
        other: await File.create(earlier).getItem('other'),
        statement: await File.create(earlier).getItem('statement'),
      },
      siwe: await store.getItem('siwe'),
    }).toMatchInlineSnapshot(`
      {
        "amount": 1n,
        "earlier": {
          "amount": 2n,
          "other": "x#__bigint",
          "statement": "Sign in#__string",
        },
        "siwe": {
          "resources": [
            "x#__bigint",
            "x#__string",
            "x#__string#__bigint",
            "1#__bigint",
          ],
          "statement": "Sign in#__bigint",
        },
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write to a damaged file rejects with the path and the fix, and quotes none of its tokens', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const store = File.create(path)
    await store.setItem('session', {
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
    })
    // A stray character where a value starts, such as from a hand edit, makes the parser quote the
    // characters around it.
    const text = await Fs.readFile(path, 'utf8')
    await Fs.writeFile(
      path,
      text.replace('"refreshToken":"', '"refreshToken":x"'),
    )

    const error = await store.setItem('session', undefined).then(
      () => undefined,
      (error: Error) => error,
    )

    expect({
      cause: error?.cause,
      message: error?.message.replace(directory, '<directory>'),
      name: error?.name,
    }).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "message": "Invalid file: <directory>/session.json holds no valid JSON. Remove the file, and sign in again.",
        "name": "Store.InvalidFileError",
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test.each(['null', '[]', '"session"'])(
    'behavior: a write to a file that holds %s rejects with InvalidFileError, and writes nothing',
    async (text) => {
      const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
      const path = Path.join(directory, 'session.json')
      await Fs.writeFile(path, text)
      const store = File.create(path)

      const error = await store.setItem('session', 'value').then(
        () => undefined,
        (error: Error) => error,
      )

      expect(error).toBeInstanceOf(File.InvalidFileError)
      expect(await Fs.readFile(path, 'utf8')).toBe(text)
      await Fs.rm(directory, { force: true, recursive: true })
    },
  )

  test('behavior: a removal of an absent entry writes no file, creates no folder, and leaves the file as it was', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const missing = Path.join(directory, 'missing', 'session.json')
    const path = Path.join(directory, 'session.json')
    const store = File.create(path)
    await store.setItem('session', 'value')
    const before = await Fs.stat(path)

    await File.create(missing).removeItem('tempo-id:signed-out')
    await store.removeItem('tempo-id:signed-out')
    const after = await Fs.stat(path)

    expect({
      folder: await Fs.stat(Path.dirname(missing)).then(
        () => true,
        () => false,
      ),
      replaced: after.ino !== before.ino,
      value: await store.getItem('session'),
    }).toMatchInlineSnapshot(`
      {
        "folder": false,
        "replaced": false,
        "value": "value",
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write of the value that an entry holds writes no file, so a second sign-out of a CLI leaves the file as it was', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        store: File.create(path),
        url: 'http://127.0.0.1:9',
      })
    await create().signOut()
    // A file system can give a later file the inode of a removed one, so the change time tells a
    // replaced file too.
    const before = await Fs.stat(path, { bigint: true })

    // A second run of the CLI's logout finds the user signed out already.
    await create().signOut()
    const after = await Fs.stat(path, { bigint: true })

    expect({
      replaced: after.ino !== before.ino || after.ctimeNs !== before.ctimeNs,
      signedOut: await File.create(path).getItem(
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]:signed-out',
      ),
    }).toMatchInlineSnapshot(`
      {
        "replaced": false,
        "signedOut": true,
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write of the value that an entry holds persists a change that the value receives after the call, before the queued write', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    await store.setItem('key', { amount: 1 })
    const value = { amount: 1 }

    const write = store.setItem('key', value)
    value.amount = 2
    await write

    expect(await File.create(path).getItem('key')).toMatchInlineSnapshot(`
      {
        "amount": 2,
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write of another expiry or another value replaces the file', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    const stat = async () => {
      const { ctimeNs, ino } = await Fs.stat(path, { bigint: true })
      return `${ino}:${ctimeNs}`
    }
    const expiresAt = Date.now() + 60_000
    await store.setItem('key', { amount: 1n })
    const files = [await stat()]
    await store.setItem('key', { amount: 1n })
    files.push(await stat())
    await store.setItem('key', { amount: 1n }, { expiresAt })
    files.push(await stat())
    await store.setItem('key', { amount: 1n }, { expiresAt })
    files.push(await stat())
    await store.setItem('key', { amount: 2n }, { expiresAt })
    files.push(await stat())

    expect({
      replaced: files.slice(1).map((file, index) => file !== files[index]),
      value: await store.getItem('key'),
    }).toMatchInlineSnapshot(`
      {
        "replaced": [
          false,
          true,
          false,
          true,
        ],
        "value": {
          "amount": 2n,
        },
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: without a path, the file is `id/store.json` in the folder of `TEMPO_HOME`, or else in `~/.tempo`', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const before = { home: process.env.HOME, tempo: process.env.TEMPO_HOME }
    // Node reads the user's home directory from `HOME`, so the test writes no file of the user's.
    process.env.HOME = Path.join(directory, 'home')

    try {
      process.env.TEMPO_HOME = Path.join(directory, 'tempo')
      await File.create().setItem('named', true)
      // An empty value names no folder, as an absent one.
      process.env.TEMPO_HOME = ''
      await File.create().setItem('empty', true)
      delete process.env.TEMPO_HOME
      await File.create().setItem('absent', true)
    } finally {
      for (const [name, value] of [
        ['HOME', before.home],
        ['TEMPO_HOME', before.tempo],
      ] as const)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }

    const files = (await Fs.readdir(directory, { recursive: true })).sort()
    expect(
      await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) => {
            const path = Path.join(directory, file)
            const [folder, stat, text] = await Promise.all([
              Fs.stat(Path.dirname(path)),
              Fs.stat(path),
              Fs.readFile(path, 'utf8'),
            ])
            return `${file} ${(folder.mode & 0o777).toString(8)} ${(stat.mode & 0o777).toString(8)} ${text}`
          }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "home/.tempo/id/store.json 700 600 {"empty":{"value":true},"absent":{"value":true}}",
        "tempo/id/store.json 700 600 {"named":{"value":true}}",
      ]
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: sends one refresh for two processes on one file, whose Web Locks span one process', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    await File.create(path).setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 3_600_000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    // Each process runs Node with its global `navigator`, whose Web Locks span only that process.
    // `fetch` records each request, and answers the refresh with new tokens after 200 milliseconds.
    const output = await Esbuild.build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import * as Fs from 'node:fs/promises'",
          "import * as Path from 'node:path'",
          "import * as Accounts from '../Accounts.ts'",
          "import * as Store from '../Store.ts'",
          'const requests = []',
          `const path = ${JSON.stringify(path)}`,
          'const accounts = Accounts.create({',
          '  chain: 1337,',
          "  clientId: 'https://app.example.com',",
          '  async fetch(input, init) {',
          "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
          "    requests.push(new URL(String(input)).pathname + ' ' + token)",
          '    await new Promise((resolve) => setTimeout(resolve, 200))',
          "    return Response.json({ access_token: 'access-token-1', expires_in: 3600, refresh_token: 'refresh-token-1', token_type: 'Bearer' })",
          '  },',
          '  store: Store.file(path),',
          "  url: 'http://127.0.0.1:9',",
          '})',
          'await accounts.session.get()',
          // Both processes refresh once both hold the stored session. The wait ends after 10 seconds.
          "await Fs.writeFile(Path.join(Path.dirname(path), 'ready-' + crypto.randomUUID()), '')",
          'for (let attempt = 0; ; attempt++) {',
          "  const ready = (await Fs.readdir(Path.dirname(path))).filter((name) => name.startsWith('ready-'))",
          '  if (ready.length === 2) break',
          "  if (attempt > 1_000) throw new Error('The other process never loaded the session.')",
          '  await new Promise((resolve) => setTimeout(resolve, 10))',
          '}',
          'const session = await accounts.session.refresh()',
          'console.log(JSON.stringify({ refreshToken: session?.refreshToken, requests }))',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const child = ChildProcess.spawn(process.execPath, [
          '--input-type=module',
        ])
        let stderr = ''
        let stdout = ''
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.on('close', (code) => {
          if (code === 0) resolve(stdout)
          else reject(new Error(stderr))
        })
        child.stdin.end(output.outputFiles[0]!.text)
      })

    const results = await Promise.all([run(), run()])
    await Fs.rm(directory, { force: true, recursive: true })

    const parsed = results.map(
      (result) =>
        JSON.parse(result) as { refreshToken: string; requests: string[] },
    )
    expect({
      refreshTokens: parsed.map((result) => result.refreshToken),
      requests: parsed.flatMap((result) => result.requests),
    }).toMatchInlineSnapshot(`
      {
        "refreshTokens": [
          "refresh-token-1",
          "refresh-token-1",
        ],
        "requests": [
          "/oauth2/token refresh-token",
        ],
      }
    `)
  }, 60_000)

  test('behavior: lock keeps a hold longer than the stale lock from the lock of another store of the file', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const first = File.create(path)
    const second = File.create(path)
    const events: string[] = []
    let holding = () => {}
    const holds = new Promise<void>((resolve) => (holding = resolve))

    // The first hold lasts longer than the 10 seconds after which a lock without renewal is stale.
    const held = first.lock!('session', async () => {
      const started = Date.now()
      events.push('first start')
      holding()
      await expect
        .poll(() => Date.now() - started, { interval: 500, timeout: 15_000 })
        .toBeGreaterThan(10_500)
      events.push('first end')
    })
    await holds
    await second.lock!('session', () => {
      events.push('second start')
      return Promise.resolve()
    })
    await held
    await Fs.rm(directory, { force: true, recursive: true })

    expect(events).toMatchInlineSnapshot(`
      [
        "first start",
        "first end",
        "second start",
      ]
    `)
  }, 30_000)

  test('behavior: lock removes the lock file of a relative path after its hold changes the working directory', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const other = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const cwd = process.cwd()
    process.chdir(directory)
    const store = File.create('store.json')

    await store.lock!('session', () => {
      process.chdir(other)
      return Promise.resolve()
    })
    process.chdir(cwd)
    const names = await Fs.readdir(directory)
    await Fs.rm(directory, { force: true, recursive: true })
    await Fs.rm(other, { force: true, recursive: true })

    expect(
      names.filter((name) => name.endsWith('.lock')),
    ).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: takeItem returns a value once across two stores of one file, such as of two processes', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const first = File.create(path)
    const second = File.create(path)
    await first.setItem('challenge', 'value')

    const taken = await Promise.all(
      [first, second, first, second].map((store) =>
        Promise.resolve(store.takeItem?.('challenge')),
      ),
    )

    expect({
      after: await second.getItem('challenge'),
      taken: taken.filter((value) => value !== undefined),
    }).toMatchInlineSnapshot(`
      {
        "after": undefined,
        "taken": [
          "value",
        ],
      }
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('error: a non-extractable CryptoKey, as a browser access key, rejects before it takes the lock, and leaves the folder as it was', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    const keyPair = await WebCryptoP256.createKeyPair()
    // Another process holds the lock, so a write that takes it waits instead of rejecting.
    await Fs.writeFile(`${path}.lock`, 'other')

    const error = await store
      .setItem('session', { accessKey: { keyPair } })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect({
      files: (await Fs.readdir(directory)).sort(),
      message: String(error),
    }).toMatchInlineSnapshot(`
      {
        "files": [
          "store.json.lock",
        ],
        "message": "TypeError: Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.",
      }
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('error: a CryptoKey that the value receives after the call, before the queued write, rejects the write, and leaves no file', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    const keyPair = await WebCryptoP256.createKeyPair()
    const value: { accessKey?: unknown } = {}

    const write = store.setItem('session', value)
    value.accessKey = { keyPair }
    const error = await write.then(
      () => undefined,
      (error: Error) => error,
    )

    expect({
      files: (await Fs.readdir(directory)).sort(),
      message: String(error),
    }).toMatchInlineSnapshot(`
      {
        "files": [],
        "message": "TypeError: Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.",
      }
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write removes the temporary file of a write that ended before its rename, with the tokens that it held', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    await store.setItem('session', { refreshToken: 'refresh-token-secret' })
    // A process that ended between its write and its rename, such as at Ctrl-C, left its file.
    const stale = `${path}.${crypto.randomUUID()}.tmp`
    await Fs.writeFile(
      stale,
      '{"session":{"value":{"refreshToken":"refresh-token-secret"}}}',
      { mode: 0o600 },
    )
    const past = new Date(Date.now() - 60_000)
    await Fs.utimes(stale, past, past)

    await store.removeItem('session')

    expect((await Fs.readdir(directory)).sort()).toMatchInlineSnapshot(`
      [
        "store.json",
      ]
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write of the value that an entry holds removes the temporary file of a write that ended before its rename, with the tokens that it held', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    await store.setItem('signed-out', true)
    // A sign-in that ended between its write and its rename, such as at Ctrl-C, left its file.
    const stale = `${path}.${crypto.randomUUID()}.tmp`
    await Fs.writeFile(
      stale,
      '{"session":{"value":{"refreshToken":"refresh-token-secret"}}}',
      { mode: 0o600 },
    )
    const past = new Date(Date.now() - 60_000)
    await Fs.utimes(stale, past, past)

    // A later sign-out writes the signed-out mark that the file holds.
    await store.setItem('signed-out', true)

    expect((await Fs.readdir(directory)).sort()).toMatchInlineSnapshot(`
      [
        "store.json",
      ]
    `)
    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write keeps a temporary file younger than the stale lock, which another process can still rename', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    const recent = `${path}.00000000-0000-4000-8000-000000000000.tmp`
    await Fs.writeFile(recent, '{}', { mode: 0o600 })

    await store.setItem('session', { refreshToken: 'refresh-token-secret' })

    expect((await Fs.readdir(directory)).sort()).toMatchInlineSnapshot(`
      [
        "store.json",
        "store.json.00000000-0000-4000-8000-000000000000.tmp",
      ]
    `)

    await Fs.rm(directory, { force: true, recursive: true })
  })

  test('behavior: a write succeeds when a stale temporary file cannot be removed, such as a folder of that name', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'store.json')
    const store = File.create(path)
    const stuck = `${path}.00000000-0000-4000-8000-000000000000.tmp`
    await Fs.mkdir(stuck)
    const past = new Date(Date.now() - 60_000)
    await Fs.utimes(stuck, past, past)

    const error = await store
      .setItem('session', { refreshToken: 'refresh-token-secret' })
      .then(
        () => undefined,
        (error: Error) => error.name,
      )

    expect(error).toMatchInlineSnapshot(`undefined`)

    await Fs.rm(directory, { force: true, recursive: true })
  })
})
