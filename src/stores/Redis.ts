/**
 * A store in Redis, as `Store.redis` returns it.
 * @module
 */
import * as StoreValue from '../internal/StoreValue.js'
import type * as Store from '../Store.js'

/**
 * Returns a store in Redis. Each value is stored as ox's `Json`, so a `bigint` survives. An entry
 * with an expiry expires in Redis at `expiresAt`, through `SET` with `PXAT`, which takes whole
 * milliseconds, so a fraction rounds up. The store sends `GET`, `SET`, and `DEL` with each key as it
 * is, such as `tempo-id:session:<id>`. `takeItem` reads and deletes with one `GETDEL`, so replicas
 * that share the database take each value once. `lock` holds the key `<key>:lock` for at most 30
 * seconds, set to a token of the hold with `SET` and `NX`, and releases it with an `EVAL` that
 * deletes only that token. `update` reads with `GET` and writes with an `EVAL` that sets the key
 * only if it still holds the value read and no `lock` holds the key, and reads again otherwise. So the `backend` plugin's
 * replicas write the logout index of each `sid` in a read and a write, without the lock, and a
 * logout token ends every session of the `sid`. The store needs Redis 6.2 or later.
 *
 * `client` is any client with `sendCommand(args)`, such as a `redis` client.
 *
 * Use a Redis server with TLS and authentication. Each value holds a refresh token, and an access
 * key's private key.
 *
 * @throws {Error} When the client rejects a command, such as a refusal of a read-only replica. The
 * message holds only the command's name and the leading error code of the refusal, such as
 * `SET failed with READONLY.`, since a client such as `ioredis` attaches the command to its error,
 * and a refusal such as `ERR unknown command` quotes the key and the value.
 *
 * @throws {StoreValue.InvalidValueError} When a read finds a value that holds no valid JSON, such
 * as after a hand edit. The error quotes none of the value.
 * @throws {TypeError} When `setItem` receives a value that has no JSON form, such as a value with a
 * cycle, a `CryptoKey`, or a top-level `undefined`. It rejects before any command, also for an
 * `expiresAt` that passed, so the stored entry stays. In a browser, a session's access key is a
 * non-extractable `CryptoKey`, so a sign-in that generates its access key rejects with this error
 * before any request, and the emailed code stays valid. Keep a browser's session in the default
 * store.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { backend } from 'accounts/plugins'
 * import { createClient } from 'redis'
 *
 * const redis = await createClient({ url: process.env.REDIS_URL }).connect()
 * const accounts = Accounts.create({
 *   clientId: process.env.CLIENT_ID!,
 *   clientSecret: process.env.CLIENT_SECRET!,
 *   plugins: [backend({ store: Store.redis(redis) })],
 * })
 * ```
 */
export function create(client: create.Client): Store.Store {
  // A command holds a session's ID in its key, and a refresh token in its value. The client's error
  // can attach the command, and some refusals quote it, so a rejection keeps only the error code.
  async function send(args: string[]) {
    try {
      return await client.sendCommand(args)
    } catch (error) {
      const code =
        error instanceof Error
          ? /^[A-Z][A-Z0-9_]*\b/.exec(error.message)?.[0]
          : undefined
      throw new Error(
        code ? `${args[0]} failed with ${code}.` : `${args[0]} failed.`,
      )
    }
  }

  return {
    async getItem(key) {
      const value = await send(['GET', key])
      return typeof value === 'string' ? StoreValue.parse(value) : undefined
    },
    json: true,
    // Each replica holds its own client, so a lock in memory orders no other replica's writes, such
    // as two sign-ins of one `sid` that rewrite its logout index at once.
    async lock(key, fn) {
      const name = `${key}:lock`
      // Each hold sets a token of its own, so a holder whose lease expired deletes no lock that
      // another replica took since.
      const token = crypto.randomUUID()
      while (
        (await send(['SET', name, token, 'NX', 'PX', String(lease)])) !== 'OK'
      )
        await new Promise((resolve) => setTimeout(resolve, 10))
      try {
        return await fn()
      } finally {
        // A failed release leaves the lease, which expires within `lease`.
        await send(['EVAL', release, '1', name, token]).catch(() => undefined)
      }
    },
    async removeItem(key) {
      await send(['DEL', key])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      // Serialization throws before any command, also for a write that only deletes.
      const text = StoreValue.stringify(value)
      // JSON has no form of a top-level `undefined`, function, or symbol, so its text is `undefined`.
      if (text === undefined)
        throw new TypeError(
          'Unserializable value: the value has no JSON form, such as `undefined` or a function. Call `removeItem` to delete the entry.',
        )
      // Redis refuses an expiry that is not in the future, and the entry would expire at once.
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await send(['DEL', key])
        return
      }
      await send([
        'SET',
        key,
        text,
        // `PXAT` takes whole milliseconds, so a fraction rounds up, and the entry never expires early.
        ...(expiresAt === undefined
          ? []
          : ['PXAT', String(Math.ceil(expiresAt))]),
      ])
    },
    async takeItem(key) {
      const value = await send(['GETDEL', key])
      return typeof value === 'string' ? StoreValue.parse(value) : undefined
    },
    async update(key, fn) {
      while (true) {
        const previous = await send(['GET', key])
        const { expiresAt, result, value } = fn(
          typeof previous === 'string' ? StoreValue.parse(previous) : undefined,
        )
        // Serialization throws before the write, so a value without a JSON form never deletes the
        // entry.
        const next =
          value === undefined
            ? undefined
            : (StoreValue.stringify(value) as string | undefined)
        if (value !== undefined && next === undefined)
          throw new TypeError(
            'Unserializable value: the value has no JSON form. Write a value that JSON holds.',
          )
        // An absent entry that stays absent is already written.
        if (typeof previous !== 'string' && next === undefined) return result
        // An expiry that passed deletes the entry, as `setItem` does.
        const expired = expiresAt !== undefined && expiresAt <= Date.now()
        const written = await send([
          'EVAL',
          swap,
          '2',
          key,
          `${key}:lock`,
          typeof previous === 'string' ? previous : '',
          typeof previous === 'string' ? '1' : '0',
          next === undefined || expired ? '' : next,
          expiresAt === undefined ? '' : String(Math.ceil(expiresAt)),
        ])
        if (written === 1) return result
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
  }
}

/**
 * Milliseconds that a `lock` holds, so the lock of a crashed holder expires. An `fn` that runs
 * longer loses the lock to the next replica.
 */
const lease = 30_000

/**
 * Writes `ARGV[3]` to the key `KEYS[1]`, with the expiry `ARGV[4]` if any, or deletes it for an empty
 * `ARGV[3]`, only if the key still holds `ARGV[1]`, or is absent for an `ARGV[2]` of `0`. A
 * `lock` of the key, at `KEYS[2]`, also refuses the write, so a replica that writes the key under
 * `lock` with `setItem`, such as a replica of an earlier version, overwrites no update. Returns
 * `1` for a write, and `0` otherwise.
 */
const swap = [
  "if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end",
  "local current = redis.call('GET', KEYS[1])",
  "if ARGV[2] == '0' then if current then return 0 end elseif current ~= ARGV[1] then return 0 end",
  "if ARGV[3] == '' then redis.call('DEL', KEYS[1])",
  "elseif ARGV[4] == '' then redis.call('SET', KEYS[1], ARGV[3])",
  "else redis.call('SET', KEYS[1], ARGV[3], 'PXAT', ARGV[4]) end",
  'return 1',
].join(' ')

/** Deletes the lock only if it still holds the token of the hold that releases it. */
const release =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"

export declare namespace create {
  /**
   * A Redis client that sends a raw command, such as a `redis` client. For `ioredis`, pass
   * `{ sendCommand: (args) => client.call(...args) }`.
   */
  type Client = {
    /** Sends one command, such as `['GET', key]`, and resolves with its reply. */
    sendCommand: (args: string[]) => Promise<unknown>
  }
}
