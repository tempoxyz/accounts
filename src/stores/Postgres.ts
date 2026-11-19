/**
 * A store in a Postgres table, as `Store.postgres` returns it.
 * @module
 */
import * as StoreValue from '../internal/StoreValue.js'
import type * as Store from '../Store.js'

/**
 * Returns a store in a Postgres table. On first use, it creates the table and an index on
 * `expires_at` unless the table exists. The table holds `key text primary key`,
 * `value text not null`, and `expires_at bigint`, in whole milliseconds, so a fraction of `expiresAt`
 * rounds up. Replicas that first use a new table at the same time all succeed, also in
 * transactions, though only one of them creates it.
 * Each value is stored as ox's `Json`, so a `bigint` survives. A write with an expiry deletes the
 * expired rows in a query beside it, and a read skips them. `takeItem` reads and deletes in one
 * `delete … returning`, so replicas that share the table take each value once. `update` writes only
 * if the row still holds the value it read, so replicas that share the table write the logout
 * index of a `sid` without losing each other's sessions, in a read and a write.
 *
 * `client` is any client with `query(text, values)`, such as a `pg` pool.
 *
 * Do not expose the table to other roles. Each row holds a refresh token, and an access key's
 * private key.
 *
 * @throws {Error} When `options.table` is not a table name, or a schema and a table name. The
 * function throws before any query.
 * @throws {StoreValue.InvalidValueError} When a read finds a row that holds no valid JSON, such as
 * after a hand edit. The error quotes none of the row.
 * @throws {TypeError} When `setItem` receives a value that has no JSON form, such as a value with a
 * cycle, or a `CryptoKey`. In a browser, a session's access key is a non-extractable `CryptoKey`,
 * so a sign-in that generates its access key rejects with this error before any request. Keep a
 * browser's session in the default store.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { backend } from 'accounts/plugins'
 * import { Pool } from 'pg'
 *
 * const accounts = Accounts.create({
 *   clientId: process.env.CLIENT_ID!,
 *   clientSecret: process.env.CLIENT_SECRET!,
 *   plugins: [
 *     backend({
 *       store: Store.postgres(
 *         new Pool({ connectionString: process.env.DATABASE_URL }),
 *       ),
 *     }),
 *   ],
 * })
 * ```
 */
export function create(
  client: create.Client,
  options: create.Options = {},
): Store.Store {
  const { table: name = 'tempo_id_store' } = options
  if (!/^[a-z_]\w*(\.[a-z_]\w*)?$/i.test(name))
    throw new Error(
      `Invalid table: ${name}. Name a table, or a schema and a table, of letters, digits, and underscores.`,
    )
  const parts = name.split('.')
  const table = parts.map((part) => `"${part}"`).join('.')
  const index = `"${parts.at(-1)}_expires_at_idx"`

  // One check for each store, which every operation awaits. A table that exists needs no `create`,
  // so a role with only read and write rights on it works.
  let created: Promise<unknown> | undefined
  function ready() {
    created ??= (async () => {
      const { rows } = await client.query(
        'select to_regclass($1) is not null as exists',
        [table],
      )
      const [row] = rows as readonly { exists: boolean }[]
      if (row?.exists) return
      // One block creates the table and its index. Its lock, which holds until the transaction
      // ends, makes the creates of replicas run in turn, since creates that run at once refuse each
      // other or deadlock, also with `if not exists`. A refusal from a store without the lock is
      // caught in the database, so a client in a transaction keeps its transaction. The table name
      // is a checked identifier, so the block holds no input.
      await client.query(
        `do $$ begin perform pg_advisory_xact_lock(hashtext('${table}')); begin create table if not exists ${table} (key text primary key, value text not null, expires_at bigint); exception when duplicate_object or duplicate_table or unique_violation then null; end; begin create index if not exists ${index} on ${table} (expires_at) where expires_at is not null; exception when duplicate_object or duplicate_table or unique_violation then null; end; end $$`,
        [],
      )
    })().catch((error: unknown) => {
      created = undefined
      throw error
    })
    return created
  }

  return {
    async getItem(key) {
      await ready()
      const { rows } = await client.query(
        `select value from ${table} where key = $1 and (expires_at is null or expires_at > $2)`,
        [key, Date.now()],
      )
      const [row] = rows as readonly { value: string }[]
      return row ? StoreValue.parse(row.value) : undefined
    },
    json: true,
    async removeItem(key) {
      await ready()
      await client.query(`delete from ${table} where key = $1`, [key])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      // Serialization throws before any query starts, so no query is left without a handler. The
      // column holds whole milliseconds, so a fraction rounds up, and the row never expires early.
      const values = [
        key,
        StoreValue.stringify(value),
        expiresAt === undefined ? null : Math.ceil(expiresAt),
      ]
      const upsert = `insert into ${table} (key, value, expires_at) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`
      await ready()
      if (expiresAt === undefined) {
        await client.query(upsert, values)
        return
      }
      // Only entries with an expiry, such as redirects in progress, expire, so their writes sweep.
      // The sweep is a statement of its own, so no write holds its row locks while it waits on its
      // own row, and it runs beside the write, so it adds no round trip. A client in a transaction
      // runs the sweep first, with the written key, so every transaction locks rows in the order
      // of the sweep. A failed sweep fails no write, since a read skips the rows that it leaves.
      const [, write] = await Promise.allSettled([
        client.query(`delete from ${table} where expires_at <= $1`, [
          Date.now(),
        ]),
        client.query(upsert, values),
      ])
      if (write.status === 'rejected') throw write.reason
    },
    async update(key, fn) {
      await ready()
      // The text of the row that the previous attempt read, or `null` for no row.
      let previous: string | null | undefined
      // The attempts in a row whose write matched no row while the read value stayed the same.
      let unchanged = 0
      while (true) {
        const now = Date.now()
        const { rows } = await client.query(
          `select value from ${table} where key = $1 and (expires_at is null or expires_at > $2)`,
          [key, now],
        )
        const [row] = rows as readonly { value: string }[]
        // A write that matched no row while the read value stayed the same is a refusal, such as
        // by a row-level security policy, or a peer that wrote the key and then restored it. A
        // peer rarely does so three times in a row, so the third such attempt rejects.
        unchanged =
          previous !== undefined && previous === (row?.value ?? null)
            ? unchanged + 1
            : 0
        if (unchanged >= 3)
          throw new Error(
            'Refused write: the conditional write of the store matched no row. Grant the role update and delete on the table.',
          )
        const { expiresAt, result, value } = fn(
          row ? StoreValue.parse(row.value) : undefined,
        )
        // Serialization throws before the write starts, so no query is left without a handler. A
        // value without a JSON form, such as a function, rejects, and never deletes the row.
        const next =
          value === undefined
            ? undefined
            : (StoreValue.stringify(value) as string | undefined)
        if (value !== undefined && next === undefined)
          throw new TypeError(
            'Unserializable value: the value has no JSON form. Write a value that JSON holds.',
          )
        const expires = expiresAt === undefined ? null : Math.ceil(expiresAt)
        // Each write lands only if the row still holds the text that `fn` read, in one
        // statement, so of concurrent updates that read one value only one writes, and each
        // other reads again. A row that expired counts as absent, also one that expired after
        // the read, so the write reads the clock again.
        const written = await (async () => {
          const now = Date.now()
          if (row && next === undefined)
            return client.query(
              `delete from ${table} where key = $1 and value = $2 and (expires_at is null or expires_at > $3) returning key`,
              [key, row.value, now],
            )
          if (row)
            return client.query(
              `update ${table} set value = $2, expires_at = $3 where key = $1 and value = $4 and (expires_at is null or expires_at > $5) returning key`,
              [key, next, expires, row.value, now],
            )
          if (next === undefined)
            // An absent entry that stays absent is already written.
            return { rows: [key] }
          return client.query(
            `insert into ${table} (key, value, expires_at) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at where ${table}.expires_at <= $4 returning key`,
            [key, next, expires, now],
          )
        })()
        if (written.rows.length > 0) return result
        previous = row?.value ?? null
      }
    },
    async takeItem(key) {
      await ready()
      // One statement reads and deletes the row, so of concurrent calls only one returns it.
      const { rows } = await client.query(
        `delete from ${table} where key = $1 returning value, expires_at`,
        [key],
      )
      const [row] = rows as readonly {
        expires_at: number | string | null
        value: string
      }[]
      if (!row) return undefined
      if (row.expires_at !== null && Number(row.expires_at) <= Date.now())
        return undefined
      return StoreValue.parse(row.value)
    },
  }
}

export declare namespace create {
  /**
   * A Postgres client with positional parameters, such as a `pg` pool or client. For `postgres`,
   * pass `{ query: async (text, values) => ({ rows: await sql.unsafe(text, values) }) }`.
   */
  type Client = {
    /** Runs `text` with the positional `values`, and resolves with the rows. */
    query: (
      text: string,
      values: readonly unknown[],
    ) => Promise<{ rows: readonly unknown[] }>
  }

  type Options = {
    /**
     * The table, optionally with its schema, such as `auth.sessions`. Each part holds only letters,
     * digits, and underscores. Defaults to `tempo_id_store`.
     */
    table?: string | undefined
  }
}
