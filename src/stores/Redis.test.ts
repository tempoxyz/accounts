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
import { createActor, initialTransition, transition, waitFor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
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
  test('behavior: refreshes under the lock a session that a save replaces with one that can refresh while a read of the ended session is in flight', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const commands: string[] = []
    const store = Redis.create({
      sendCommand: (args) => {
        commands.push(args[0]!)
        return client.call(...(args as [string, ...string[]]))
      },
    })
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const sessions = BackendSessions.create(accounts.config, {
      shared: true,
      store,
    })
    const user = { email: 'user@example.com', id: 'user_1' }
    // The access token ended, and no refresh token renews it.
    const { id } = await sessions.save({
      session: Session.from({
        accessToken: 'access-token',
        expiresAt: Date.now() - 1000,
        user,
      }),
    })
    commands.length = 0

    // Redis answers the read with the ended session, and then runs the save's write of a session
    // whose access token also ended, but which a refresh token renews.
    await Promise.allSettled([
      sessions.get({ id }),
      sessions.save({
        id,
        session: Session.from({
          accessToken: 'access-token-2',
          expiresAt: Date.now() - 1000,
          refreshToken: 'refresh-token-2',
          user,
        }),
      }),
    ])
    client.disconnect()
    await container.stop()

    // The refresh of the replacement takes the lock (`SET` with `NX`) and releases it (`EVAL`).
    expect(commands).toMatchInlineSnapshot(`
      [
        "GET",
        "SET",
        "GET",
        "SET",
        "GET",
        "GET",
        "DEL",
        "EVAL",
      ]
    `)
  }, 120_000)

  test('behavior: keeps a session that a save writes while a read of the ended session is in flight', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const commands: string[] = []
    const store = Redis.create({
      sendCommand: (args) => {
        commands.push(args[0]!)
        return client.call(...(args as [string, ...string[]]))
      },
    })
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const sessions = BackendSessions.create(accounts.config, {
      shared: true,
      store,
    })
    const user = { email: 'user@example.com', id: 'user_1' }
    // The access token ended, and no refresh token renews it.
    const { id } = await sessions.save({
      session: Session.from({
        accessToken: 'access-token',
        expiresAt: Date.now() - 1000,
        user,
      }),
    })
    commands.length = 0

    // Redis answers the read with the ended session, and then runs the save's write.
    const [read] = await Promise.all([
      sessions.get({ id }),
      sessions.save({
        id,
        session: Session.from({
          accessToken: 'access-token-2',
          expiresAt: Date.now() + 3_600_000,
          user,
        }),
      }),
    ])
    const stored = await client.exists(`tempo-id:session:${id}`)
    client.disconnect()
    await container.stop()

    expect({
      commands,
      read: read && 'accessToken' in read ? read.accessToken : read,
      stored,
    }).toMatchInlineSnapshot(`
      {
        "commands": [
          "GET",
          "SET",
          "GET",
        ],
        "read": "access-token-2",
        "stored": 1,
      }
    `)
  }, 120_000)

  test('behavior: ends a session that cannot refresh in two reads and one deletion, without the refresh lock', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    const commands: string[] = []
    const store = Redis.create({
      sendCommand: (args) => {
        commands.push(args[0]!)
        return client.call(...(args as [string, ...string[]]))
      },
    })
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const sessions = BackendSessions.create(accounts.config, {
      shared: true,
      store,
    })
    // The access token ended, and no refresh token renews it.
    const { id } = await sessions.save({
      session: Session.from({
        accessToken: 'access-token',
        expiresAt: Date.now() - 1000,
        user: { email: 'user@example.com', id: 'user_1' },
      }),
    })
    commands.length = 0

    const session = await sessions.get({ id })
    const stored = await client.exists(`tempo-id:session:${id}`)
    client.disconnect()
    await container.stop()

    expect({ commands, session, stored }).toMatchInlineSnapshot(`
      {
        "commands": [
          "GET",
          "GET",
          "DEL",
        ],
        "session": undefined,
        "stored": 0,
      }
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
        if (args[0] === 'EVAL' && reply === 'LOCKED') refused++
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

  test('behavior: updates an entry with a client that returns each integer reply as a string', async () => {
    const container = await new GenericContainer('redis:7.4-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    const client = new IORedis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    })
    let writes = 0
    const store = Redis.create({
      async sendCommand(args) {
        const reply = await client.call(...(args as [string, ...string[]]))
        if (args[0] === 'EVAL' && args[2] === '2') writes++
        return typeof reply === 'number' ? String(reply) : reply
      },
    })

    await store.update!('index', () => ({ result: undefined, value: ['a'] }))
    const index = await store.getItem('index')
    client.disconnect()
    await container.stop()

    expect({ index, writes }).toMatchInlineSnapshot(`
      {
        "index": [
          "a",
        ],
        "writes": 1,
      }
    `)
  }, 30_000)

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

  test('behavior: a hold that runs past the lease keeps the lock', async () => {
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

    // A hold such as a slow refresh, whose token request outlasts a third of the lease. Without a
    // renewal, the lease only shortens, and another replica takes the lock once it expires.
    const renewed = await store.lock!('key', async () => {
      // The least time to live read so far. A renewal reads more than it.
      let least = Number.POSITIVE_INFINITY
      await expect
        .poll(
          async () => {
            const ttl = await client.pttl('key:lock')
            const longer = ttl > least
            least = Math.min(least, ttl)
            return longer
          },
          { interval: 500, timeout: 15_000 },
        )
        .toBe(true)
      return true
    })
    const lock = await client.get('key:lock')
    client.disconnect()
    await container.stop()

    expect({ lock, renewed }).toMatchInlineSnapshot(`
      {
        "lock": null,
        "renewed": true,
      }
    `)
  }, 120_000)

  test('behavior: a sign-out of one instance empties the session of another instance on the store in the same process', async () => {
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
    // `fetch` records each request, and answers the revocation.
    const requests: string[] = []
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        fetch(input) {
          requests.push(new URL(String(input)).pathname)
          return Promise.resolve(new Response(null, { status: 200 }))
        },
        store,
        url: 'http://127.0.0.1:9',
      })
    const first = create()
    const second = create()
    await Promise.all([first.session.get(), second.session.get()])

    // The second instance reads no store before its next refresh, so only a message tells it of the
    // sign-out.
    const { session, status } = await (async () => {
      try {
        await first.signOut()
        await expect
          .poll(() => second.session.status.get().status, { timeout: 1_000 })
          .toBe('signedOut')
        return {
          session: await second.session.get(),
          status: second.session.status.get().status,
        }
      } finally {
        client.disconnect()
        await container.stop()
      }
    })()

    expect({ requests, session, status }).toMatchInlineSnapshot(`
      {
        "requests": [
          "/oauth2/revoke",
        ],
        "session": undefined,
        "status": "signedOut",
      }
    `)
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

describe('machines.renewal', () => {
  test('renews the lease nine times, so it ends 120 seconds after the hold starts, then lets it lapse', async () => {
    const renews: number[] = []
    const actor = createActor(
      Redis.machines.renewal.provide({
        actions: {
          renew: (args) => {
            renews.push(args.context.renewals)
          },
        },
        // A short interval runs the nine renewals at once, in the order of the real timers.
        delays: { renewalInterval: 1 },
      }),
    ).start()

    const lapsing = await waitFor(actor, (snapshot) =>
      snapshot.matches('lapsing'),
    )
    actor.send({ type: 'hold.end' })

    expect({ renewals: lapsing.context.renewals, renews })
      .toMatchInlineSnapshot(`
      {
        "renewals": 9,
        "renews": [
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
        ],
      }
    `)
    expect(actor.getSnapshot().status).toMatchInlineSnapshot(`"done"`)
  })

  test('cancels the timer of the next renewal when the hold ends', () => {
    const [initial] = initialTransition(Redis.machines.renewal)

    const [released, actions] = transition(Redis.machines.renewal, initial, {
      type: 'hold.end',
    })

    expect({
      actions: actions.map((action) => action.type),
      status: released.status,
      value: released.value,
    }).toMatchInlineSnapshot(`
      {
        "actions": [
          "xstate.cancel",
        ],
        "status": "done",
        "value": "released",
      }
    `)
  })

  test('reaches every state along its shortest paths, and handles every event type', () => {
    const snapshots = getShortestPaths(Redis.machines.renewal, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "lapsing",
        "released",
        "renewing",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
  })

  /** The event of the timer of a renewal, which `after` sends in `renewing`. */
  const interval = {
    type: 'xstate.after.renewalInterval.renewal.renewing',
  } as const

  /** A machine event, or the event of the timer of a renewal. */
  type Step = Redis.machines.renewal.Event | typeof interval

  /** The events of each type that the runner sends from a snapshot. */
  const events: {
    [type in Step['type']]: (
      snapshot: Redis.machines.renewal.Snapshot,
    ) => readonly Step[]
  } = {
    'hold.end': (snapshot) =>
      snapshot.status === 'active' ? [{ type: 'hold.end' }] : [],
    'xstate.after.renewalInterval.renewal.renewing': (snapshot) =>
      snapshot.matches('renewing') ? [interval] : [],
  }

  /** The traversal of the machine's graph, keyed by the state and the count of renewals. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: Redis.machines.renewal.Snapshot) =>
      Object.values(events).flatMap((fn) =>
        fn(snapshot),
      ) as readonly Redis.machines.renewal.Event[],
    // The guard bounds the count at nine, so the graph stays finite, and `lapsing` follows only the
    // ninth renewal.
    serializeState: (snapshot: Redis.machines.renewal.Snapshot) =>
      JSON.stringify([snapshot.value, snapshot.context.renewals]),
  }
})
