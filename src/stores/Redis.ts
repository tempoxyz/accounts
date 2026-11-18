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
 * deletes only that token. So the `backend` plugin's replicas write the logout index of each `sid`
 * one at a time, and a logout token ends every session of the `sid`. The store needs Redis 6.2 or
 * later.
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
  }
}

/**
 * Milliseconds that a `lock` holds, so the lock of a crashed holder expires. An `fn` that runs
 * longer loses the lock to the next replica.
 */
const lease = 30_000

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
