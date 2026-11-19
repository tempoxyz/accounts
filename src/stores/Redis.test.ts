/**
 * Tests of `Store.redis` with an `ioredis` client, against Redis in a container.
 * @module
 */
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Util from 'node:util'
import { Redis as IORedis } from 'ioredis'
import { GenericContainer, Wait } from 'testcontainers'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as Session from '../Session.js'
import * as Redis from './Redis.js'

describe('Store.redis', () => {
  test('behavior: a refusal of the server quotes no key or value of the command', async () => {
    // A server without `GETDEL`, such as a managed Redis that disables it, quotes the key in its
    // refusal.
    const container = await new GenericContainer('redis:7.4-alpine')
      .withCommand(['redis-server', '--rename-command', 'GETDEL', ''])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const options = {
      host: container.getHost(),
      port: container.getMappedPort(6379),
    }
    // A user without the store's commands receives a refusal of each command from Redis.
    const admin = new IORedis(options)
    await admin.call(
      'ACL',
      'SETUSER',
      'app',
      'on',
      'nopass',
      '~*',
      '+@all',
      '-del',
      '-get',
      '-set',
    )
    const client = new IORedis({ ...options, username: 'app' })
    const store = Redis.create({
      sendCommand: (args) => client.call(...(args as [string, ...string[]])),
    })
    const key = 'tempo-id:session:3Jb7cQx9'
    const secret = 'refresh-token-4Fv8Kd2w'

    const errors = await Promise.all([
      store
        .setItem(key, { refreshToken: secret })
        .catch((error: Error) => error),
      store.getItem(key).catch((error: Error) => error),
      store.takeItem!(key).catch((error: Error) => error),
      store.removeItem(key).catch((error: Error) => error),
    ])
    admin.disconnect()
    client.disconnect()
    await container.stop()

    expect(
      (errors as Error[]).map((error) => {
        const text = Util.inspect(error, { depth: Infinity })
        return {
          message: error.message,
          quotes: text.includes(key) || text.includes(secret),
        }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "message": "SET failed with NOPERM.",
          "quotes": false,
        },
        {
          "message": "GET failed with NOPERM.",
          "quotes": false,
        },
        {
          "message": "GETDEL failed with ERR.",
          "quotes": false,
        },
        {
          "message": "DEL failed with NOPERM.",
          "quotes": false,
        },
      ]
    `)
  }, 120_000)
  test('behavior: closes each session of a `sid` that two replicas on one Redis link at the same time', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const options = {
      host: container.getHost(),
      port: container.getMappedPort(6379),
    }
    // Each replica holds its own connection, as each process of a backend does.
    const clients = [new IORedis(options), new IORedis(options)]
    await Promise.all(clients.map((client) => client.ping()))
    const [a, b] = clients.map((client) => {
      const accounts = Accounts.create({
        clientId: 'https://app.example.com',
        url: 'http://127.0.0.1:9',
      })
      const store = Redis.create({
        sendCommand: (args) => client.call(...(args as [string, ...string[]])),
      })
      return BackendSessions.create(accounts.config, { shared: true, store })
    }) as [
      ReturnType<typeof BackendSessions.create>,
      ReturnType<typeof BackendSessions.create>,
    ]
    const expiresAt = Date.now() + 3_600_000
    const sids = Array.from({ length: 10 }, (_, index) => `sid-${index}`)

    await Promise.all(
      sids.flatMap((sid) => [
        a.link({ expiresAt, id: `a-${sid}`, sid }),
        b.link({ expiresAt, id: `b-${sid}`, sid }),
      ]),
    )
    const closed = await Promise.all(sids.map((sid) => a.close({ sid })))
    for (const client of clients) client.disconnect()
    await container.stop()

    expect(closed.map((entries) => entries.length)).toMatchInlineSnapshot(`
      [
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
      ]
    `)
  }, 120_000)

  test('behavior: links a session of a `sid` in a read and a conditional write', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const commands: string[] = []
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const store = Redis.create({
      sendCommand(args) {
        commands.push(args[0]!)
        return client.call(...(args as [string, ...string[]]))
      },
    })
    const sessions = BackendSessions.create(accounts.config, {
      shared: true,
      store,
    })

    await sessions.link({
      expiresAt: Date.now() + 3_600_000,
      id: 'a-sid',
      sid: 'sid',
    })
    client.disconnect()
    await container.stop()

    expect(commands).toMatchInlineSnapshot(`
      [
        "GET",
        "EVAL",
        "GET",
        "GET",
      ]
    `)
  }, 120_000)

  test('behavior: writes no update while a replica without `update` holds the lock of the key', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    let refused = 0
    const store = Redis.create({
      async sendCommand(args) {
        const reply = await client.call(...(args as [string, ...string[]]))
        if (args[0] === 'EVAL' && args[2] === '2' && reply === 0) refused++
        return reply
      },
    })

    let write: Promise<undefined> | undefined
    await store.lock!('index', async () => {
      const index = (await store.getItem('index')) ?? []
      write = store.update!('index', (value) => ({
        result: undefined,
        value: [...((value as string[] | undefined) ?? []), 'new'],
      }))
      await expect.poll(() => refused).toBeGreaterThan(0)
      await store.setItem('index', [...(index as string[]), 'old'])
    })
    await write
    const index = await store.getItem('index')
    client.disconnect()
    await container.stop()

    expect(index).toMatchInlineSnapshot(`
      [
        "old",
        "new",
      ]
    `)
  }, 120_000)

  test('behavior: updates an entry on Redis Cluster, where the entry and its lock occupy two hash slots', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withCommand(['redis-server', '--cluster-enabled', 'yes'])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    await client.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383')
    await expect
      .poll(async () => String(await client.call('CLUSTER', 'INFO')), {
        timeout: 30_000,
      })
      .toContain('cluster_state:ok')
    const store = Redis.create({
      sendCommand(args) {
        return client.call(...(args as [string, ...string[]]))
      },
    })
    const append = (entry: string) =>
      store.update!('tempo-id:sid:sid', (value) => ({
        result: undefined,
        value: [...((value as string[] | undefined) ?? []), entry],
      }))

    await Promise.all([append('a'), append('b')])
    const index = (await store.getItem('tempo-id:sid:sid')) as string[]
    client.disconnect()
    await container.stop()

    expect([...index].sort()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
      ]
    `)
  }, 120_000)

  test('behavior: a hold whose lease another replica took deletes no lock of that replica', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const store = Redis.create({
      sendCommand: (args) => client.call(...(args as [string, ...string[]])),
    })

    // The lease of the first hold expires, and another replica sets its own token.
    await store.lock!('key', () => client.set('key:lock', 'other'))
    const lock = await client.get('key:lock')
    client.disconnect()
    await container.stop()

    expect(lock).toMatchInlineSnapshot(`"other"`)
  }, 120_000)

  test('behavior: sends one refresh for two processes on one Redis, whose Web Locks span one process', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const options = {
      host: container.getHost(),
      port: container.getMappedPort(6379),
    }
    const client = new IORedis(options)
    const store = Redis.create({
      sendCommand: (args) => client.call(...(args as [string, ...string[]])),
    })
    await store.setItem(
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
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      stdin: {
        contents: [
          "import { Redis as IORedis } from 'ioredis'",
          "import * as Accounts from '../Accounts.ts'",
          "import * as Store from '../Store.ts'",
          'const requests = []',
          `const client = new IORedis(${JSON.stringify(options)})`,
          'const accounts = Accounts.create({',
          '  chain: 1337,',
          "  clientId: 'https://app.example.com',",
          '  async fetch(input, init) {',
          "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
          "    requests.push(new URL(String(input)).pathname + ' ' + token)",
          '    await new Promise((resolve) => setTimeout(resolve, 200))',
          "    return Response.json({ access_token: 'access-token-1', expires_in: 3600, refresh_token: 'refresh-token-1', token_type: 'Bearer' })",
          '  },',
          '  store: Store.redis({ sendCommand: (args) => client.call(...args) }),',
          "  url: 'http://127.0.0.1:9',",
          '})',
          `const barrier = new IORedis(${JSON.stringify(options)})`,
          'await accounts.session.get()',
          // Both processes refresh once both hold the stored session. The wait ends after 10 seconds.
          "if ((await barrier.incr('ready')) === 2) await barrier.rpush('go', '1', '1')",
          "if (!(await barrier.blpop('go', 10))) throw new Error('The other process never loaded the session.')",
          'const session = await accounts.session.refresh()',
          'barrier.disconnect()',
          'client.disconnect()',
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

    const results = await (async () => {
      try {
        return await Promise.all([run(), run()])
      } finally {
        client.disconnect()
        await container.stop()
      }
    })()

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
  }, 120_000)
})
