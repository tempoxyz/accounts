/**
 * A store in a Workers KV namespace, as `Store.workersKv` returns it.
 * @module
 */
import * as StoreValue from '../internal/StoreValue.js'
import type * as Store from '../Store.js'

/**
 * Returns a store in a Workers KV namespace. Each value is stored as ox's `Json`, so a `bigint`
 * survives. The store writes each key as it is, such as `tempo-id:session:<id>`. An entry with an
 * expiry keeps `expiresAt` in its metadata, and a read skips it after `expiresAt`. KV deletes the
 * entry at `expiresAt`, in whole seconds, or 60 seconds after the write, whichever is later, since
 * KV refuses an earlier expiration.
 *
 * KV is eventually consistent, and has no atomic read and delete or lock. So the store sets neither
 * `takeItem` nor `lock`. Another location can read a value for up to 60 seconds after a write or a
 * deletion, such as a session after its sign-out. Two Workers can both take one redirect in
 * progress, or both spend one SIWE challenge. KV also accepts at most one write of a key each
 * second. If an app needs single use or ordered writes, use `Sessions.durableObject` or
 * `Store.durableObject`.
 *
 * Each value holds a refresh token, and an access key's private key. Bind the namespace only to the
 * Workers of the app.
 *
 * @throws {StoreValue.InvalidValueError} When a read finds a value that holds no valid JSON, such
 * as after a hand edit. The error quotes none of the value.
 * @throws {TypeError} When `setItem` receives a value that has no JSON form, such as a value with a
 * cycle, a `CryptoKey`, or a top-level `undefined`. It rejects before any write, also for an
 * `expiresAt` that passed, so the stored entry stays.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { Store } from 'accounts/cloudflare'
 * import { backend } from 'accounts/plugins'
 *
 * type Env = {
 *   CLIENT_ID: string
 *   CLIENT_SECRET: string
 *   STORE: KVNamespace
 * }
 *
 * export default {
 *   fetch(request: Request, env: Env) {
 *     const accounts = Accounts.create({
 *       clientId: env.CLIENT_ID,
 *       clientSecret: env.CLIENT_SECRET,
 *       plugins: [backend({ store: Store.workersKv(env.STORE) })],
 *     })
 *     return accounts.handler.fetch(request)
 *   },
 * }
 * ```
 */
export function create(namespace: create.Namespace): Store.Store {
  return {
    async getItem(key) {
      const entry = await namespace.getWithMetadata<create.Metadata>(
        key,
        'text',
      )
      if (entry.value === null) return undefined
      // KV deletes the entry up to 60 seconds after `expiresAt`, so a read skips it until then.
      const expiresAt = entry.metadata?.expiresAt
      if (expiresAt !== undefined && expiresAt <= Date.now()) return undefined
      return StoreValue.parse(entry.value)
    },
    json: true,
    async removeItem(key) {
      await namespace.delete(key)
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      // Serialization throws before any write, also for a write that only deletes.
      const text = StoreValue.stringify(value)
      // JSON has no form of a top-level `undefined`, function, or symbol, so its text is `undefined`.
      if (text === undefined)
        throw new TypeError(
          'Unserializable value: the value has no JSON form, such as `undefined` or a function. Call `removeItem` to delete the entry.',
        )
      if (expiresAt === undefined) {
        await namespace.put(key, text)
        return
      }
      const now = Date.now()
      if (expiresAt <= now) {
        await namespace.delete(key)
        return
      }
      await namespace.put(key, text, {
        // KV takes whole seconds, at least 60 seconds after the write, so the entry never expires
        // early.
        expiration: Math.max(
          Math.ceil(expiresAt / 1000),
          Math.ceil(now / 1000) + minExpiration,
        ),
        metadata: { expiresAt } satisfies create.Metadata,
      })
    },
  }
}

/** The fewest seconds after a write that KV accepts as an expiration. */
const minExpiration = 60

export declare namespace create {
  /** The metadata of an entry with an expiry. */
  type Metadata = {
    /** When the entry expires, in milliseconds. */
    expiresAt: number
  }

  /** The methods of a `KVNamespace` binding that the store calls. */
  type Namespace = {
    /** Deletes the value at `key`. */
    delete: (key: string) => Promise<void>
    /** Reads the text and the metadata at `key`. Each is `null` if absent. */
    getWithMetadata: <metadata>(
      key: string,
      type: 'text',
    ) => Promise<{ metadata: metadata | null; value: string | null }>
    /**
     * Writes `value` at `key`. `options.expiration` is in seconds since the epoch, at least 60
     * seconds after the write.
     */
    put: (
      key: string,
      value: string,
      options?: { expiration?: number; metadata?: unknown },
    ) => Promise<void>
  }
}
