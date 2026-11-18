/**
 * Tests of `Store.postgres` against Postgres in the process.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import { WebCryptoP256 } from 'ox'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'
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

  test('error: a value that does not serialize rejects before any query', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const queries: string[] = []
    const store = Postgres.create({
      query(text, values) {
        queries.push(text.split(' ')[0]!)
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
        queries.push(text.split(' ')[0]!)
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
