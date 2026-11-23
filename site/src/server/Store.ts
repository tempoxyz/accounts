/** The stores of the demos' routes, in the Worker's KV namespace or in a Durable Object. @module */
import { Store } from 'accounts/cloudflare'
import { DurableObject, env } from 'cloudflare:workers'
import { Json } from 'ox'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /** The Durable Objects that hold each value that a route takes once, one for each prefix. */
      DURABLE_STORE: DurableObjectNamespace<DurableStore>
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
 * The store thus fits a demo, and not an app's sessions. It has no `takeItem`, so a route whose
 * values are taken once, such as a challenge, uses {@link durableObject} instead.
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

/**
 * Returns a store whose values live in the Durable Objects of `DURABLE_STORE`, one object for each
 * key, such as for the challenges of the `siwe` plugin. One object serves all calls of a key, and
 * its `takeItem` reads and deletes the value in one call, so of concurrent calls, only one
 * receives it. No object serves the calls of other keys, so a burst of challenges loads no shared
 * object.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { backend } from 'accounts/plugins'
 * import * as Store from './Store.ts'
 *
 * const accounts = Accounts.create({
 *   chain: 'testnet',
 *   plugins: [backend({ store: Store.durableObject({ prefix: 'siwe:' }) })],
 * })
 * ```
 */
export function durableObject(
  options: durableObject.Options,
): durableObject.ReturnType {
  const { prefix } = options
  const stub = (key: string) => env.DURABLE_STORE.getByName(`${prefix}${key}`)

  return {
    getItem: (key) => stub(key).getItem(key),
    removeItem: (key) => stub(key).removeItem(key),
    setItem: (key, value, options) => stub(key).setItem(key, value, options),
    takeItem: (key) => stub(key).takeItem(key),
  }
}

export declare namespace durableObject {
  type Options = {
    /** Prefix of the name of each key's object, such as `siwe:`. */
    prefix: string
  }

  /** A {@link Store.Store} with `takeItem`. */
  type ReturnType = Store.Store & {
    takeItem: (key: string) => Promise<unknown>
  }
}

/** The Durable Object that holds the store of {@link durableObject}, and deletes expired entries. */
export class DurableStore extends DurableObject {
  #store = Store.durableObject(this.ctx.storage)

  alarm() {
    return this.#store.alarm()
  }

  getItem(key: string): Promise<unknown> {
    return this.#store.getItem(key)
  }

  removeItem(key: string) {
    return this.#store.removeItem(key)
  }

  setItem(key: string, value: unknown, options?: Store.setItem.Options) {
    return this.#store.setItem(key, value, options)
  }

  takeItem(key: string): Promise<unknown> {
    return this.#store.takeItem(key)
  }
}
