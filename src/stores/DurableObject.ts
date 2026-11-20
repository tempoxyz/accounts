/**
 * A store in a Durable Object's storage, as `Store.durableObject` returns it.
 * @module
 */
import * as Expiry from '../internal/Expiry.js'
import * as Listeners from '../internal/Listeners.js'
import * as Lock from '../internal/Lock.js'
import type * as Store from '../Store.js'

/**
 * Returns a store in a Durable Object's storage, which keeps each value as it is.
 * `DurableObject.sessions` uses it for each session, so an app needs this store only for a Durable
 * Object of its own. An entry with an expiry sets the object's alarm to the earliest expiry, and
 * the object's `alarm` handler calls the returned `alarm`, which deletes the expired entries. A
 * read skips an expired entry before the alarm runs. A Durable Object is the one instance that holds
 * its storage, and workerd has no Web Locks, so the stores of one storage share a `lock` and a
 * `connect` in memory: the instances on them send one refresh, and a sign-out of one empties the
 * session of the others at once.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts/cloudflare'
 * import { DurableObject } from 'cloudflare:workers'
 *
 * export class Cache extends DurableObject<Env> {
 *   store = Store.durableObject(this.ctx.storage)
 *
 *   // An entry with an expiry sets the alarm that deletes it.
 *   alarm() {
 *     return this.store.alarm()
 *   }
 * }
 * ```
 */
export function create(storage: create.Storage): create.ReturnType {
  /** Sets the alarm to `expiresAt`, unless an earlier one is set. */
  async function schedule(expiresAt: number) {
    const alarm = await storage.getAlarm()
    if (alarm === null || expiresAt < alarm) await storage.setAlarm(expiresAt)
  }

  // The stores of one storage, such as one for each request, share its lock and its listeners.
  let shared = coordination.get(storage)
  if (!shared)
    coordination.set(
      storage,
      (shared = { connect: Listeners.create(), lock: Lock.create() }),
    )

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
    // The instances in the object hear each other's saved changes through it.
    connect: shared.connect,
    async getItem(key) {
      const entry = await storage.get<Expiry.Entry<unknown>>(
        `${valuePrefix}${key}`,
      )
      if (!entry || Expiry.expired(entry)) return undefined
      return entry.value
    },
    // The instances in the object order their refreshes and `sid` index writes through it.
    lock: shared.lock,
    async removeItem(key) {
      await storage.delete([`${valuePrefix}${key}`, `${expiryPrefix}${key}`])
    },
    async setItem(key, value, options = {}) {
      const { expiresAt } = options
      await storage.put(`${valuePrefix}${key}`, {
        expiresAt,
        value,
      } satisfies Expiry.Entry<unknown>)
      if (expiresAt === undefined) {
        await storage.delete([`${expiryPrefix}${key}`])
        return
      }
      await storage.put(`${expiryPrefix}${key}`, expiresAt)
      await schedule(expiresAt)
    },
  }
}

export declare namespace create {
  /**
   * The methods of a Durable Object's `ctx.storage` that the store calls. The store keeps each
   * value under a key that starts with `value:`, and each expiry under a key that starts with
   * `expires:`.
   */
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

  /** A {@link Store.Store} with `alarm`. */
  type ReturnType = Store.Store & {
    /**
     * Deletes the expired entries, and sets the alarm for the earliest expiry left. An alarm can
     * fire more than once, so a second call deletes nothing new.
     */
    alarm: () => Promise<void>
  }
}

/** The lock and the listeners of each storage, which its stores share. */
const coordination = new WeakMap<
  create.Storage,
  {
    connect: NonNullable<Store.Store['connect']>
    lock: NonNullable<Store.Store['lock']>
  }
>()

/**
 * The key prefixes of each entry's expiry and value in a Durable Object's storage. Every key of the
 * store takes one, so a caller's key never names an expiry.
 */
const expiryPrefix = 'expires:'
const valuePrefix = 'value:'
