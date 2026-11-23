/**
 * Tests of `Store.postgres` against Postgres in the process.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import { WebCryptoP256 } from 'ox'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as Postgres from './Postgres.js'

describe('Store.postgres', () => {
  test('behavior: a write with an expiry sweeps the expired rows beside the write, in one round trip', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    // Each query records the queries in flight when it starts, so sequential queries record 0.
    const queries: string[] = []
    let inFlight = 0
    const store = Postgres.create({
      async query(text, values) {
        queries.push(`${text.split(' ')[0]} ${inFlight}`)
        inFlight++
        try {
          return await database.query(text, [...values])
        } finally {
          inFlight--
        }
      },
    })
    await store.setItem('expired', 'stale', { expiresAt: Date.now() - 1 })
    await store.setItem('session', 'kept')
    queries.length = 0

    await store.setItem('pending', 'new', { expiresAt: Date.now() + 60_000 })

    expect(queries).toMatchInlineSnapshot(`
      [
        "delete 0",
        "insert 1",
      ]
    `)
    expect(
      (await database.query('select key from tempo_id_store order by key'))
        .rows,
    ).toMatchInlineSnapshot(`
      [
        {
          "key": "pending",
        },
        {
          "key": "session",
        },
      ]
    `)
  })

  test('behavior: takeItem returns a value to one of concurrent calls, deletes it, and returns no expired value', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem(
      'challenge',
      { nonce: 'a' },
      { expiresAt: Date.now() + 60_000 },
    )
    await store.setItem(
      'expired',
      { nonce: 'b' },
      { expiresAt: Date.now() - 1 },
    )

    const taken = await Promise.all([
      store.takeItem!('challenge'),
      store.takeItem!('challenge'),
    ])
    const expired = await store.takeItem!('expired')

    expect({ expired, taken }).toMatchInlineSnapshot(`
      {
        "expired": undefined,
        "taken": [
          {
            "nonce": "a",
          },
          undefined,
        ],
      }
    `)
    expect(
      (await database.query('select key from tempo_id_store')).rows,
    ).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: closes each session of a `sid` that two replicas on one table link at the same time', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const [a, b] = [0, 1].map(() => {
      const accounts = Accounts.create({
        clientId: 'https://app.example.com',
        url: 'http://127.0.0.1:9',
      })
      // Each replica holds its own store on the shared table, as each process of a backend does.
      const store = Postgres.create({
        query: (text, values) => database.query(text, [...values]),
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
  })

  test('behavior: a `link` reads the index once and writes it once', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const queries: string[] = []
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const store = Postgres.create({
      query: (text, values) => {
        queries.push(text.slice(0, 40))
        return database.query(text, [...values])
      },
    })
    const sessions = BackendSessions.create(accounts.config, {
      shared: true,
      store,
    })
    await store.getItem('ready')
    queries.length = 0

    await sessions.link({
      expiresAt: Date.now() + 3_600_000,
      id: 'a',
      sid: 'sid',
    })

    expect(queries).toMatchInlineSnapshot(`
      [
        "select value from "tempo_id_store" where",
        "insert into "tempo_id_store" (key, value",
        "select value from "tempo_id_store" where",
        "select value from "tempo_id_store" where",
      ]
    `)
  })

  test('behavior: lock runs the holds of two replicas on one table in turn', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    // Each replica holds a store of its own on the table, as two processes do. Each records the
    // attempts of its lock that another lease refuses.
    const refusals = [0, 0]
    const replicas = [0, 1].map((index) =>
      Postgres.create({
        async query(text, values) {
          const result = await database.query(text, [...values])
          if (values[0] !== 'session:lock') return result
          if (text.startsWith('insert') && result.rows.length === 0)
            refusals[index]! += 1
          return result
        },
      }),
    )
    const events: string[] = []
    const release = Promise.withResolvers<void>()

    const first = replicas[0]!.lock!('session', async () => {
      events.push('start 0')
      await release.promise
      events.push('end 0')
    })
    await expect.poll(() => events).toEqual(['start 0'])
    const second = replicas[1]!.lock!('session', () => {
      events.push('start 1', 'end 1')
      return Promise.resolve()
    })
    await expect.poll(() => refusals[1]).toBeGreaterThan(0)
    const held = [...events]
    release.resolve()
    await Promise.all([first, second])

    expect(held).toMatchInlineSnapshot(`
      [
        "start 0",
      ]
    `)
    expect(events).toMatchInlineSnapshot(`
      [
        "start 0",
        "end 0",
        "start 1",
        "end 1",
      ]
    `)
    expect(
      (await database.query('select key from tempo_id_store')).rows,
    ).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: a hold whose lease another replica took deletes no lock of that replica', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })

    // The lease of the first hold expires, and another replica sets its own token.
    await store.lock!('key', () =>
      database.query(
        `update tempo_id_store set value = '{"token":"other","until":0}' where key = 'key:lock'`,
      ),
    )

    expect(
      (
        await database.query(
          "select value from tempo_id_store where key = 'key:lock'",
        )
      ).rows,
    ).toMatchInlineSnapshot(`
      [
        {
          "value": "{"token":"other","until":0}",
        },
      ]
    `)
  })

  test('behavior: lock takes a lease that expired by the clock of the database', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.getItem('ready')
    // A replica whose hold ended without a release leaves a lease that expired.
    await database.query(
      `insert into tempo_id_store (key, value) values ('key:lock', '{"token":"other","until":0}')`,
    )

    const result = await store.lock!('key', () => Promise.resolve('held'))

    expect(result).toMatchInlineSnapshot(`"held"`)
  })

  test('behavior: a sweep of expired rows keeps a held lock', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })

    const rows = await store.lock!('key', async () => {
      await store.setItem('other', 'value', { expiresAt: Date.now() + 60_000 })
      return (
        await database.query(
          "select key from tempo_id_store where key = 'key:lock'",
        )
      ).rows
    })

    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "key": "key:lock",
        },
      ]
    `)
  })

  test('behavior: a hold that runs past a third of the lease renews it, and keeps the lock', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    // The end of the lease, in milliseconds of the database's clock.
    const until = async () => {
      const { rows } = await database.query<{ until: string }>(
        "select value::json->>'until' as until from tempo_id_store where key = 'key:lock'",
      )
      return Number(rows[0]?.until)
    }

    // A hold such as a slow refresh, whose token request outlasts a third of the lease. Without a
    // renewal, the lease keeps its end, and another replica takes the lock once it passes.
    const renewed = await store.lock!('key', async () => {
      const first = await until()
      await expect
        .poll(async () => (await until()) > first, {
          interval: 500,
          timeout: 15_000,
        })
        .toBe(true)
      return true
    })
    const { rows } = await database.query(
      "select key from tempo_id_store where key = 'key:lock'",
    )

    expect({ renewed, rows }).toMatchInlineSnapshot(`
      {
        "renewed": true,
        "rows": [],
      }
    `)
  }, 30_000)

  test('behavior: a renewal keeps the lease within the deadline of the hold, and revives no expired lease', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    // The renewals that the database ran, each of which writes the lease with `least`.
    let renewals = 0
    const store = Postgres.create({
      async query(text, values) {
        const result = await database.query(text, [...values])
        if (text.includes('least(')) renewals += 1
        return result
      },
    })
    const until = async () => {
      const { rows } = await database.query<{ until: string }>(
        "select value::json->>'until' as until from tempo_id_store where key = 'key:lock'",
      )
      return Number(rows[0]?.until)
    }
    const write = (limit: number, lease: number) =>
      database.query(
        `update tempo_id_store set value = json_build_object('limit', $1::bigint, 'token', value::json->>'token', 'until', $2::bigint)::text where key = 'key:lock'`,
        [limit, lease],
      )

    // A deadline that passes before a full lease, as for a renewal that runs late. Then a lease
    // that expired, as after a renewal that waited for a connection past it.
    const leases = await store.lock!('key', async () => {
      const limit = Date.now() + 15_000
      await write(limit, limit + 45_000)
      await expect
        .poll(() => renewals, { interval: 200, timeout: 15_000 })
        .toBe(1)
      const capped = (await until()) - limit
      await write(limit + 45_000, 0)
      await expect
        .poll(() => renewals, { interval: 200, timeout: 15_000 })
        .toBe(2)
      return { capped, expired: await until() }
    })

    expect(leases).toMatchInlineSnapshot(`
      {
        "capped": 0,
        "expired": 0,
      }
    `)
  }, 45_000)

  test('behavior: a write with an expiry replaces its own expired row', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('pending', 'stale', { expiresAt: Date.now() - 1 })

    await store.setItem('pending', 'new', { expiresAt: Date.now() + 60_000 })

    expect(await store.getItem('pending')).toMatchInlineSnapshot(`"new"`)
  })

  test('behavior: a write whose expiry holds a fraction of a millisecond keeps the value, and rounds the expiry up', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    // 2100-01-01, so the entry stays live for the read.
    await store.setItem('pending', 'kept', { expiresAt: 4_102_444_800_000.5 })
    const value = await store.getItem('pending')
    const { rows } = await database.query<{ expires_at: string }>(
      'select expires_at from tempo_id_store',
    )

    expect({ expiresAt: rows[0]?.expires_at, value }).toMatchInlineSnapshot(`
      {
        "expiresAt": 4102444800001,
        "value": "kept",
      }
    `)
  })

  test('behavior: a write with an expiry succeeds when the sweep fails', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('session', 'kept')
    await database.exec(`
      create function refuse() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$;
      create trigger refuse before delete on tempo_id_store execute function refuse();
    `)

    await store.setItem('pending', 'new', { expiresAt: Date.now() + 60_000 })

    expect(await store.getItem('pending')).toMatchInlineSnapshot(`"new"`)
  })

  test('error: an update to a value without a JSON form rejects, and keeps the row', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('key', 'value')

    const error = await store.update!('key', () => ({
      result: undefined,
      value: () => undefined,
    })).catch((error: Error) => error.message)

    expect(error).toMatchInlineSnapshot(
      `"Unserializable value: the value has no JSON form. Write a value that JSON holds."`,
    )
    expect(await store.getItem('key')).toMatchInlineSnapshot(`"value"`)
  })

  test('behavior: an update retries when another replica writes the key and then deletes it between its reads', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.getItem('ready')
    let calls = 0

    await store.update!('key', () => {
      calls += 1
      // Another replica links the key before this write, and unlinks it before the next read.
      if (calls === 1) {
        void database.query(
          `insert into tempo_id_store (key, value) values ('key', '"other"')`,
        )
        void Promise.resolve().then(() =>
          database.query(`delete from tempo_id_store where key = 'key'`),
        )
      }
      return { result: undefined, value: 'next' }
    })

    expect(await store.getItem('key')).toMatchInlineSnapshot(`"next"`)
  })

  test('error: an update that a policy refuses rejects, and does not retry without end', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    let queries = 0
    const store = Postgres.create({
      query: (text, values) => {
        // A bound on the queries ends an update that retries without end.
        queries += 1
        if (queries > 20) throw new Error('Retried without end.')
        return database.query(text, [...values])
      },
    })
    await store.setItem('key', 'value')
    // A policy shows each row to `select`, and hides each from `update` and `delete`.
    await database.exec(`
      create role app;
      grant all on tempo_id_store to app;
      alter table tempo_id_store enable row level security;
      create policy reads on tempo_id_store for select to app using (true);
      set role app;
    `)

    const error = await store.update!('key', () => ({
      result: undefined,
      value: 'next',
    })).catch((error: Error) => error.message)

    expect(error).toMatchInlineSnapshot(
      `"Refused write: the conditional write of the store matched no row. Grant the role update and delete on the table."`,
    )
  })

  test('error: a value that does not serialize rejects before any query', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const queries: string[] = []
    const store = Postgres.create({
      query(text, values) {
        queries.push(text.slice(0, 40))
        return database.query(text, [...values])
      },
    })
    const value: Record<string, unknown> = {}
    value.self = value

    await expect(
      store.setItem('pending', value, { expiresAt: Date.now() + 60_000 }),
    ).rejects.toThrow(TypeError)

    expect(queries).toMatchInlineSnapshot(`[]`)
  })

  test('error: a non-extractable CryptoKey, as a browser access key, rejects before any query', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const queries: string[] = []
    const store = Postgres.create({
      query(text, values) {
        queries.push(text.slice(0, 40))
        return database.query(text, [...values])
      },
    })
    const keyPair = await WebCryptoP256.createKeyPair()

    await expect(
      store.setItem('session', { accessKey: { keyPair } }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.]`,
    )

    expect(queries).toMatchInlineSnapshot(`[]`)
  })

  test('error: a read of a damaged value rejects with the fix, and quotes none of its tokens', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const store = Postgres.create({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('session', {
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
    })
    // A stray character where a value starts makes the parser quote the characters around it.
    await database.query(
      `update tempo_id_store set value = replace(value, '"refreshToken":"', '"refreshToken":x"')`,
    )

    const error = await store.getItem('session').then(
      () => undefined,
      (error: Error) => error,
    )

    expect({
      cause: error?.cause,
      message: error?.message,
      name: error?.name,
    }).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "message": "Invalid value: the stored entry holds no valid JSON. Remove the entry, and sign in again.",
        "name": "Store.InvalidValueError",
      }
    `)
  })
})
