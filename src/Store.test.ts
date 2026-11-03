/**
 * Runs each store against its real service: a file, Postgres, Redis, and a Durable Object in
 * workerd. Each one keeps a value with its `bigint`, deletes it, and expires it at `expiresAt`.
 * @module
 */
import { Store } from 'accounts'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Json } from 'ox'
import { Pool } from 'pg'
import { createClient } from 'redis'
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'
import { createTestHarness } from 'wrangler'
import { Database } from '../test/TempoId.js'

/** The variable that names an existing Redis server in place of a container. */
const redisVariable = 'TEST_REDIS_URL'

/** The table of this file's Postgres store, which `afterAll` drops. */
const table = `store_${crypto.randomUUID().replaceAll('-', '')}`

const pool = new Pool({
  connectionString: process.env[Database.variable],
  max: 1,
})
const worker = createTestHarness({
  workers: [
    {
      configPath: Path.resolve(
        import.meta.dirname,
        '..',
        'test',
        'fixtures',
        'workers',
        'store',
        'wrangler.json',
      ),
    },
  ],
})
let container: StartedTestContainer | undefined
let redis: (Store.redis.Client & { close: () => Promise<void> }) | undefined

beforeAll(async () => {
  const url = await (async () => {
    const existing = process.env[redisVariable]
    if (existing) return existing
    container = await new GenericContainer('redis:8.2-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()
    return `redis://${container.getHost()}:${container.getMappedPort(6379)}`
  })()
  redis = await createClient({ url }).connect()
  await worker.listen()
}, 120_000)

afterAll(async () => {
  await pool.query(`drop table if exists "${table}"`)
  await Promise.all([pool.end(), redis?.close(), worker.close()])
  await container?.stop()
})

/** Each store, created for one test, so no two tests share keys. */
const stores = {
  durableObject: () => durableObject({ name: crypto.randomUUID() }),
  file: () => Store.file(temporaryFile()),
  memory: () => Store.memory(),
  postgres: () => Store.postgres(pool, { table }),
  redis: () => Store.redis(redis!),
} as const

for (const [name, create] of Object.entries(stores))
  describe(name, () => {
    test('returns a stored value with its bigint, and undefined after its removal', async () => {
      const store = create()
      const key = `key-${crypto.randomUUID()}`

      await store.setItem(key, { limit: 10n, scopes: ['transfer'] })
      const stored = await store.getItem(key)
      await store.removeItem(key)
      const removed = await store.getItem(key)

      expect(stored).toMatchInlineSnapshot(`
        {
          "limit": 10n,
          "scopes": [
            "transfer",
          ],
        }
      `)
      expect(removed).toMatchInlineSnapshot(`undefined`)
    })

    test('returns undefined once an expiry passes, and keeps a value that a later write stores without one', async () => {
      const store = create()
      const expiring = `key-${crypto.randomUUID()}`
      const passed = `key-${crypto.randomUUID()}`
      const replaced = `key-${crypto.randomUUID()}`

      await store.setItem(expiring, 'expiring', {
        expiresAt: Date.now() + 500,
      })
      await store.setItem(passed, 'passed', { expiresAt: Date.now() - 1 })
      await store.setItem(replaced, 'first', { expiresAt: Date.now() + 500 })
      await store.setItem(replaced, 'second')

      expect(await store.getItem(expiring)).toMatchInlineSnapshot(`"expiring"`)
      expect(await store.getItem(passed)).toMatchInlineSnapshot(`undefined`)
      await expect
        .poll(() => store.getItem(expiring), { timeout: 5_000 })
        .toBeUndefined()
      expect(await store.getItem(replaced)).toMatchInlineSnapshot(`"second"`)
    })
  })

describe('file', () => {
  test('keeps the writes of several writers of one file, each of which reads and writes the whole file', async () => {
    const path = temporaryFile()
    // Each store holds its own write queue, as a process of its own does, so only the file's lock
    // keeps one writer's read and write apart from another's.
    const writers = Array.from({ length: 8 }, () => Store.file(path))

    await Promise.all(
      writers.map((writer, index) => writer.setItem(`key-${index}`, index)),
    )
    const values = await Promise.all(
      writers.map((_, index) => Store.file(path).getItem(`key-${index}`)),
    )

    expect(values).toMatchInlineSnapshot(`
      [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
      ]
    `)
    await expect(Fs.access(`${path}.lock`)).rejects.toThrow()
  })

  test('removes a stale lock that an ended process left', async () => {
    const path = temporaryFile()
    await Fs.mkdir(Path.dirname(path), { recursive: true })
    await Fs.writeFile(`${path}.lock`, '')
    const stale = new Date(Date.now() - 60_000)
    await Fs.utimes(`${path}.lock`, stale, stale)

    await Store.file(path).setItem('key', 'value')

    expect(await Store.file(path).getItem('key')).toMatchInlineSnapshot(
      `"value"`,
    )
  })
})

describe('durableObject', () => {
  test('sets the alarm to the earliest expiry, and the alarm deletes only the expired entries', async () => {
    const store = durableObject({ name: crypto.randomUUID() })
    const now = Date.now()

    await store.setItem('later', 'later', { expiresAt: now + 60_000 })
    // The earlier expiry is far enough ahead that the alarm does not fire before the read.
    await store.setItem('passed', 'passed', { expiresAt: now + 2_000 })
    await store.setItem('kept', 'kept')
    const first = await store.nextAlarm()
    await expect
      .poll(() => store.getItem('passed'), { timeout: 10_000 })
      .toBeUndefined()
    await store.alarm()
    const next = await store.nextAlarm()

    expect(first).toBe(now + 2_000)
    expect(next).toBe(now + 60_000)
    expect(await store.getItem('later')).toMatchInlineSnapshot(`"later"`)
    expect(await store.getItem('kept')).toMatchInlineSnapshot(`"kept"`)
  })

  test("keeps a caller's key that starts like an expiry apart from the expiry of another key", async () => {
    const store = durableObject({ name: crypto.randomUUID() })
    const expiresAt = Date.now() + 60_000

    await store.setItem('key', 'value', { expiresAt })
    await store.setItem('expires:key', 'caller')
    await store.alarm()

    expect(await store.getItem('key')).toMatchInlineSnapshot(`"value"`)
    expect(await store.getItem('expires:key')).toMatchInlineSnapshot(`"caller"`)
    expect(await store.nextAlarm()).toBe(expiresAt)
  })
})

describe('postgres', () => {
  test('creates the table with an index on the rows that expire', async () => {
    const name = `store_${crypto.randomUUID().replaceAll('-', '')}`

    try {
      await Store.postgres(pool, { table: name }).setItem('key', 'value')
      const { rows } = await pool.query(
        'select indexdef from pg_indexes where tablename = $1 order by indexname',
        [name],
      )

      expect(
        rows.map((row: { indexdef: string }) =>
          row.indexdef.replaceAll(name, '<table>'),
        ),
      ).toMatchInlineSnapshot(`
        [
          "CREATE INDEX <table>_expires_at_idx ON public.<table> USING btree (expires_at) WHERE (expires_at IS NOT NULL)",
          "CREATE UNIQUE INDEX <table>_pkey ON public.<table> USING btree (key)",
        ]
      `)
    } finally {
      await pool.query(`drop table if exists "${name}"`)
    }
  })

  test('reads and writes an existing table with a role that may not create tables', async () => {
    const name = `store_${crypto.randomUUID().replaceAll('-', '')}`
    const password = crypto.randomUUID()
    await Store.postgres(pool, { table: name }).setItem('seeded', 'seeded')
    // The role may read and write the table, and may not create a table in its schema.
    await pool.query(`create role "${name}" login password '${password}'`)
    await pool.query(
      `grant select, insert, update, delete on "${name}" to "${name}"`,
    )
    const url = new URL(process.env[Database.variable]!)
    url.username = name
    url.password = password
    const limited = new Pool({ connectionString: url.href, max: 1 })

    try {
      const store = Store.postgres(limited, { table: name })
      await store.setItem('key', 'value', { expiresAt: Date.now() + 60_000 })

      expect(await store.getItem('key')).toMatchInlineSnapshot(`"value"`)
      expect(await store.getItem('seeded')).toMatchInlineSnapshot(`"seeded"`)
      await expect(
        limited.query(`create table "${name}_other" (key text)`),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[error: permission denied for schema public]`,
      )
    } finally {
      await limited.end()
      await pool.query(`drop table if exists "${name}"`)
      await pool.query(`drop owned by "${name}"`)
      await pool.query(`drop role "${name}"`)
    }
  })

  test('refuses a table name that is not an identifier', () => {
    expect(() =>
      Store.postgres(pool, { table: 'store; drop table users' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid table: store; drop table users. Name a table, or a schema and a table, of letters, digits, and underscores.]`,
    )
  })
})

/**
 * Returns a store that applies each operation to `Store.durableObject` in the Durable Object
 * `name`, with `alarm` and the object's next alarm.
 */
function durableObject(options: { name: string }) {
  async function apply(operation: Record<string, unknown>) {
    const response = await worker
      .getWorker('store')
      .fetch(`/?${new URLSearchParams({ name: options.name })}`, {
        body: Json.stringify(operation),
        method: 'POST',
      })
    const { result } = Json.parse(await response.text()) as {
      result: unknown
    }
    return result ?? undefined
  }

  return {
    ...Store.from({
      getItem: (key) => apply({ key, op: 'get' }),
      removeItem: async (key) => {
        await apply({ key, op: 'remove' })
      },
      setItem: async (key, value, setOptions = {}) => {
        await apply({ expiresAt: setOptions.expiresAt, key, op: 'set', value })
      },
    }),
    alarm: async () => {
      await apply({ op: 'alarm' })
    },
    nextAlarm: () => apply({ op: 'nextAlarm' }),
  }
}

/** Returns the path of a file in a directory of its own, which no other test uses. */
function temporaryFile() {
  return Path.join(
    Os.tmpdir(),
    `tempo-id-store-${crypto.randomUUID()}`,
    'session.json',
  )
}
