/**
 * A store in Redis, as `Store.redis` returns it.
 * @module
 */
import { Json } from 'ox'
import type * as Store from '../Store.js'

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
export function create(client: create.Client): Store.Store {
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

export declare namespace create {
  /**
   * A Redis client, such as a `redis` client. For `ioredis`, pass
   * `{ sendCommand: (args) => client.call(...args) }`.
   */
  type Client = {
    /** Sends one command, such as `['GET', key]`, and resolves with its reply. */
    sendCommand: (args: string[]) => Promise<unknown>
  }
}
