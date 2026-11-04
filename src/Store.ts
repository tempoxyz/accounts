/**
 * Where a redirect keeps its state until Tempo ID redirects back, and where a backend keeps its
 * sessions. `memory`, `durableObject`, `postgres`, and `redis` return a store for a backend.
 * @module
 */
import { Json } from 'ox'

/** Thrown inside `Store.file` when another process took over a write's lock, which then runs again. */
class LockLostError extends Error {
  override readonly name = 'Store.LockLostError'
}

/**
 * Keeps a redirect's state, or a backend's sessions, as structured-clone storage such as IndexedDB or
 * a Durable Object's storage does.
 */
export type Store = {
  /** Reads the value at `key`, or `undefined`. */
  getItem: (key: string) => Promise<unknown>
  /** Deletes the value at `key`. */
  removeItem: (key: string) => Promise<void>
  /**
   * Writes `value` at `key`, without serializing it. A store that expires entries deletes it after
   * `options.expiresAt`, such as with a Durable Object's alarm.
   */
  setItem: (
    key: string,
    value: unknown,
    options?: setItem.Options,
  ) => Promise<void>
}

export declare namespace setItem {
  type Options = {
    /** When the entry may be deleted, in milliseconds. Absent, the entry stays until a deletion. */
    expiresAt?: number | undefined
  }
}

/**
 * Returns a store in one JSON file of the user's, such as a CLI's session. Each write replaces the
 * file atomically with mode `0600`, so a crash leaves the earlier file and no other user reads it.
 * Each write holds a lock file beside it, `<path>.lock`, so the writes of several processes, such
 * as two runs of a CLI, never overwrite each other. Each value is stored as ox's `Json`, so a `bigint` survives. A path that starts with `~/` starts in
 * the user's home directory. A read skips an expired entry, and a write deletes the expired entries.
 *
 * @example
 * ```ts
 * const store = Store.file('~/.config/my-cli/session.json')
 * ```
 */
export function file(path: string): Store {
  // Writes run in order, so a later write never lands before an earlier one.
  let pending: Promise<void> = Promise.resolve()

  /** Reads the file's entries, or none for a file that does not exist. */
  async function read(): Promise<Record<string, Entry<unknown>>> {
    // The Node modules load on first use, so a browser bundle holds none of them.
    const Fs = await import('node:fs/promises')
    try {
      return Json.parse(await Fs.readFile(await resolve(), 'utf8')) as Record<
        string,
        Entry<unknown>
      >
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return {}
      throw error
    }
  }

  /** Returns the path, with `~/` in place of the user's home directory. */
  async function resolve() {
    if (!path.startsWith('~/')) return path
    const Os = await import('node:os')
    const Path = await import('node:path')
    return Path.join(Os.homedir(), path.slice(2))
  }

  /**
   * Applies `fn` to the entries after every earlier write, and writes the file. The read and the
   * write hold the file's lock, so a write of another process, such as a second run of a CLI, never
   * lands between them and is never lost.
   */
  function update(fn: (entries: Record<string, Entry<unknown>>) => void) {
    const next = pending
      .catch(() => undefined)
      .then(async () => {
        const Fs = await import('node:fs/promises')
        const Path = await import('node:path')
        const target = await resolve()
        await Fs.mkdir(Path.dirname(target), { mode: 0o700, recursive: true })
        await locked(target, async (check) => {
          const entries = await read()
          fn(entries)
          for (const [key, entry] of Object.entries(entries))
            if (expired(entry)) delete entries[key]
          // A rename replaces the file in one step, so a reader sees the earlier file or the new one.
          const temporary = `${target}.${crypto.randomUUID()}.tmp`
          await Fs.writeFile(temporary, Json.stringify(entries), {
            mode: 0o600,
          })
          await check().catch(async (error: unknown) => {
            await Fs.rm(temporary, { force: true })
            throw error
          })
          await Fs.rename(temporary, target)
        })
      })
    pending = next
    return next
  }

  return {
    async getItem(key) {
      await pending.catch(() => undefined)
      const entry = (await read())[key]
      if (!entry || expired(entry)) return undefined
      return entry.value
    },
    removeItem: (key) =>
      update((entries) => {
        delete entries[key]
      }),
    setItem: (key, value, options = {}) =>
      update((entries) => {
        entries[key] = { expiresAt: options.expiresAt, value }
      }),
  }
}

/**
 * Runs `fn` while this process holds the lock of the file at `target`: a file beside it, which an
 * exclusive create makes in one step, and which holds a token of its owner. `fn` calls `check`
 * before it replaces the file, which throws {@link LockLostError} when another process took the
 * lock over, and the write then runs again. A lock older than {@link staleLock} belongs to a process
 * that ended before it released it, so another process takes it over.
 */
async function locked<value>(
  target: string,
  fn: (check: () => Promise<void>) => Promise<value>,
): Promise<value> {
  const Fs = await import('node:fs/promises')
  const lock = `${target}.lock`
  const started = Date.now()

  while (true) {
    const token = crypto.randomUUID()
    const acquired = await Fs.writeFile(lock, token, {
      flag: 'wx',
      mode: 0o600,
    }).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 'EEXIST') return false
        throw error
      },
    )

    if (acquired) {
      const owned = async () =>
        (await Fs.readFile(lock, 'utf8').catch(() => undefined)) === token
      try {
        return await fn(async () => {
          if (!(await owned())) throw new LockLostError()
        })
      } catch (error) {
        if (error instanceof LockLostError) continue
        throw error
      } finally {
        // A lock that another process took over is that process's own.
        if (await owned()) await Fs.rm(lock, { force: true })
      }
    }

    // One handle reads the lock's age and its token, so both belong to one file, also when another
    // process replaces the lock between the two reads.
    const stale = await (async () => {
      const handle = await Fs.open(lock, 'r').catch(() => undefined)
      if (!handle) return undefined
      try {
        const stat = await handle.stat()
        if (Date.now() - stat.mtimeMs <= staleLock) return undefined
        return await handle.readFile('utf8')
      } catch {
        return undefined
      } finally {
        await handle.close()
      }
    })()
    if (stale !== undefined) {
      await takeOver(lock, { token: stale })
      continue
    }
    if (Date.now() - started > 2 * staleLock)
      throw new Error(
        `Timed out on the lock of ${target}. Remove ${lock} if no other process uses the file.`,
      )
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * Removes the stale lock whose token is `options.token`. The rename moves one file in one step, so
 * of two processes that found the lock stale, only one moves it. A lock that another process created
 * since holds another token, so it goes back in place.
 */
async function takeOver(lock: string, options: takeOver.Options) {
  const Fs = await import('node:fs/promises')
  const moved = `${lock}.${crypto.randomUUID()}`
  const renamed = await Fs.rename(lock, moved).then(
    () => true,
    () => false,
  )
  if (!renamed) return
  if (
    (await Fs.readFile(moved, 'utf8').catch(() => undefined)) !== options.token
  )
    // A link fails when a third process holds the lock already. Its owner's check then fails.
    await Fs.link(moved, lock).catch(() => undefined)
  await Fs.rm(moved, { force: true })
}

declare namespace takeOver {
  type Options = {
    /** The token that the stale lock held when the process found it stale. */
    token: string
  }
}

/** The age in milliseconds after which a lock of `Store.file` is stale. A write holds it for less. */
const staleLock = 10_000

/**
 * Instantiates a {@link Store}.
 *
 * @example
 * ```ts
 * const store = Store.from({
 *   getItem: (key) => idb.get(key),
 *   removeItem: (key) => idb.del(key),
 *   setItem: (key, value) => idb.set(key, value),
 * })
 * ```
 */
export function from(value: Store): Store {
  return value
}

/**
 * Returns a store in a Durable Object's storage, which keeps each value as it is. `DurableObject.sessions` uses it for each session. An entry with an
 * expiry sets the object's alarm, and the object's `alarm` handler calls the returned `alarm`, which
 * deletes the expired entries. A read skips an expired entry before the alarm runs.
 *
 * @example
 * ```ts
 * export class Notes extends DurableObject<Env> {
 *   store = Store.durableObject(this.ctx.storage)
 *
 *   alarm() {
 *     return this.store.alarm()
 *   }
 * }
 * ```
 */
export function durableObject(
  storage: durableObject.Storage,
): durableObject.ReturnType {
  /** Sets the alarm to `expiresAt`, unless an earlier one is set. */
  async function schedule(expiresAt: number) {
    const alarm = await storage.getAlarm()
    if (alarm === null || expiresAt < alarm) await storage.setAlarm(expiresAt)
  }

  return {
    async alarm() {
      const expiries = await storage.list<number>({ prefix: expiryPrefix })
      const now = Date.now()
      let next: number | undefined
      for (const [name, expiresAt] of expiries) {
        if (expiresAt <= now) {
          await storage.delete([
            name,
            `${valuePrefix}${name.slice(expiryPrefix.length)}`,
          ])
          continue
        }
        if (next === undefined || expiresAt < next) next = expiresAt
      }
      // An alarm can fire more than once, so it deletes only expired entries, and sets the next one.
      if (next !== undefined) await storage.setAlarm(next)
    },
    async getItem(key) {
      const entry = await storage.get<Entry<unknown>>(`${valuePrefix}${key}`)
      if (!entry || expired(entry)) return undefined
      return entry.value
    },
    async removeItem(key) {
      await storage.delete([`${valuePrefix}${key}`, `${expiryPrefix}${key}`])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      await storage.put(`${valuePrefix}${key}`, {
        expiresAt,
        value,
      } satisfies Entry<unknown>)
      if (expiresAt === undefined) {
        await storage.delete([`${expiryPrefix}${key}`])
        return
      }
      await storage.put(`${expiryPrefix}${key}`, expiresAt)
      await schedule(expiresAt)
    },
  }
}

export declare namespace durableObject {
  /** The methods of a Durable Object's `ctx.storage` that the store calls. */
  type Storage = {
    /** Deletes the values at `keys`. */
    delete: (keys: string[]) => Promise<unknown>
    /** Reads the value at `key`. */
    get: <value>(key: string) => Promise<value | undefined>
    /** Returns the alarm's time, in milliseconds, or `null`. */
    getAlarm: () => Promise<number | null>
    /** Lists the values whose keys start with `options.prefix`. */
    list: <value>(options: { prefix: string }) => Promise<Map<string, value>>
    /** Writes `value` at `key`. */
    put: (key: string, value: unknown) => Promise<void>
    /** Sets the alarm, in milliseconds. */
    setAlarm: (scheduledTime: number) => Promise<void>
  }

  type ReturnType = Store & {
    /** Deletes the expired entries, and sets the alarm for the next expiry. */
    alarm: () => Promise<void>
  }
}

/**
 * Returns a store that holds each value in the process's memory. Each write deletes the expired
 * entries. A restart loses every value, so it serves one process in development or tests.
 *
 * @example
 * ```ts
 * const tempoId = Accounts.create({ clientSecret, plugins: [backend({ store: Store.memory() })] })
 * ```
 */
export function memory(): Store {
  const entries = new Map<string, Entry<unknown>>()
  return {
    getItem(key) {
      const entry = entries.get(key)
      if (!entry || expired(entry)) return Promise.resolve(undefined)
      return Promise.resolve(entry.value)
    },
    removeItem(key) {
      entries.delete(key)
      return Promise.resolve()
    },
    setItem(key, value, options = {}) {
      for (const [name, entry] of entries)
        if (expired(entry)) entries.delete(name)
      entries.set(key, { expiresAt: options.expiresAt, value })
      return Promise.resolve()
    },
  }
}

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
export function postgres(
  client: postgres.Client,
  options: postgres.Options = {},
): Store {
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

export declare namespace postgres {
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

/**
 * Returns a store in Redis. Each value is stored as ox's `Json`, so a `bigint` survives, and an
 * entry with an expiry expires in Redis at `expiresAt`. It needs Redis 6.2 or later.
 *
 * `client` is any client with `sendCommand(args)`, such as a `redis` client.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis'
 *
 * const store = Store.redis(await createClient({ url: process.env.REDIS_URL }).connect())
 * ```
 */
export function redis(client: redis.Client): Store {
  return {
    async getItem(key) {
      const value = await client.sendCommand(['GET', key])
      return typeof value === 'string' ? Json.parse(value) : undefined
    },
    async removeItem(key) {
      await client.sendCommand(['DEL', key])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      // Redis refuses an expiry that is not in the future, and the entry would expire at once.
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await client.sendCommand(['DEL', key])
        return
      }
      await client.sendCommand([
        'SET',
        key,
        Json.stringify(value),
        ...(expiresAt === undefined ? [] : ['PXAT', String(expiresAt)]),
      ])
    },
  }
}

export declare namespace redis {
  /**
   * A Redis client, such as a `redis` client. For `ioredis`, pass
   * `{ sendCommand: (args) => client.call(...args) }`.
   */
  type Client = {
    /** Sends one command, such as `['GET', key]`, and resolves with its reply. */
    sendCommand: (args: string[]) => Promise<unknown>
  }
}

/** A value with its expiry, as `durableObject` and `memory` hold it. */
type Entry<value> = {
  /** When the entry expires, in milliseconds. Absent, it never expires. */
  expiresAt: number | undefined
  /** The stored value. */
  value: value
}

/**
 * The key prefixes of each entry's expiry and value in a Durable Object's storage. Every key of the
 * store takes one, so a caller's key never names an expiry.
 */
const expiryPrefix = 'expires:'
const valuePrefix = 'value:'

/** Returns whether `entry` expired. */
function expired(entry: Entry<unknown>) {
  return entry.expiresAt !== undefined && entry.expiresAt <= Date.now()
}
