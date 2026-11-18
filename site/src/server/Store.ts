/** The store of the demos' routes, in the Worker's KV namespace. @module */
import { Store } from 'accounts'
import { env } from 'cloudflare:workers'
import { Json } from 'ox'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The KV namespace that holds each value of the demos' routes. */
      STORE: KVNamespace
    }
  }
}

/** Least time before a KV entry expires, in seconds. KV refuses a shorter one. */
const leastTtl = 60

/**
 * Returns a store in the Worker's KV namespace, such as for the sessions of the `backend` plugin.
 * Each value is stored as ox's `Json`, so a `bigint` survives. Each key starts with `prefix`, so
 * the routes of one topic read no value of another.
 *
 * KV is eventually consistent: a read in another location can miss a write of the last minute.
 * The store thus fits a demo, and not an app's sessions.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { backend } from 'accounts/plugins'
 * import * as Store from './Store.ts'
 *
 * const accounts = Accounts.create({
 *   chain: 'testnet',
 *   plugins: [backend({ store: Store.create({ prefix: 'backend:' }) })],
 * })
 * ```
 */
export function create(options: create.Options): Store.Store {
  const { prefix } = options

  return Store.from({
    async getItem(key) {
      const text = await env.STORE.get(prefix + key)
      return text === null ? undefined : Json.parse(text)
    },
    async removeItem(key) {
      await env.STORE.delete(prefix + key)
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options

      const text = Json.stringify(value)
      if (expiresAt === undefined) return env.STORE.put(prefix + key, text)
      const expiration = Math.max(
        Math.ceil(expiresAt / 1000),
        Math.ceil(Date.now() / 1000) + leastTtl,
      )
      await env.STORE.put(prefix + key, text, { expiration })
    },
  })
}

export declare namespace create {
  type Options = {
    /** Text that each key of the store starts with, such as `backend:`. */
    prefix: string
  }
}
