/**
 * A store in a Postgres table, as `Store.postgres` returns it.
 * @module
 */
import { Json } from 'ox'
import type * as Store from '../Store.js'

/**
 * Returns a store in a Postgres table. On first use, it creates the table and an index on
 * `expires_at` unless the table exists. Each value is stored as ox's `Json`, so a `bigint` survives.
 * A write with an expiry deletes the expired rows, and a read skips them.
 *
 * `client` is any client with `query(text, values)`, such as a `pg` pool.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg'
 *
 * const store = Store.postgres(new Pool({ connectionString: process.env.DATABASE_URL }))
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
      await client.query(
        `create table if not exists ${table} (key text primary key, value text not null, expires_at bigint)`,
        [],
      )
      // The sweep of each write with an expiry reads only the rows that expire.
      await client.query(
        `create index if not exists ${index} on ${table} (expires_at) where expires_at is not null`,
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
      return row ? Json.parse(row.value) : undefined
    },
    async removeItem(key) {
      await ready()
      await client.query(`delete from ${table} where key = $1`, [key])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      await ready()
      // Only entries with an expiry, such as redirects in progress, expire, so their writes sweep.
      if (expiresAt !== undefined)
        await client.query(`delete from ${table} where expires_at <= $1`, [
          Date.now(),
        ])
      await client.query(
        `insert into ${table} (key, value, expires_at) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`,
        [key, Json.stringify(value), expiresAt ?? null],
      )
    },
  }
}

export declare namespace create {
  /** A Postgres client, such as a `pg` pool or client. */
  type Client = {
    /** Runs `text` with the positional `values`, and resolves with the rows. */
    query: (
      text: string,
      values: readonly unknown[],
    ) => Promise<{ rows: readonly unknown[] }>
  }

  type Options = {
    /** The table, optionally schema-qualified. Defaults to `tempo_id_store`. */
    table?: string | undefined
  }
}
