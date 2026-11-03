/**
 * Runs the API playground on Cloudflare Workers. One Durable Object serves every MPP request, and
 * holds the sessions' channels and the charges' spent transactions in its storage.
 * @module
 */
import * as Workers from 'cloudflare:workers'
import { Hono } from 'hono'
import { Store } from 'mppx/server'
import { app, type Env } from './app.ts'
import * as Mpp from './Mpp.ts'

/** The time between two sweeps of the expired replay markers, in milliseconds. */
const sweepInterval = 60_000

/** The MPP routes, as the Worker mounts them, which the Durable Object serves. */
const routes = new Hono<{ Bindings: Mpp.Env }>().route('/mpp', Mpp.app)

/**
 * The store of every MPP channel and spent transaction. Each request runs the MPP routes with a store
 * over the object's storage. An update reads and writes in one synchronous transaction, so it is atomic.
 * An alarm deletes each replay marker whose window ended, such as a proof's, so repeated proofs that
 * pay nothing keep no storage. A credential of an ended window fails on its expired challenge anyway.
 */
export class MPP_SESSIONS extends Workers.DurableObject<Env> {
  // The object's synchronous storage serves each call, so each returns a settled promise.
  readonly store = Store.cloudflare({
    delete: (key) => {
      this.ctx.storage.kv.delete(key)
      return Promise.resolve()
    },
    get: (key) => Promise.resolve(this.ctx.storage.kv.get<string>(key) ?? null),
    put: (key, value) => {
      this.ctx.storage.kv.put(key, value)
      return Promise.resolve()
    },
    update: (key, fn) =>
      Promise.resolve(
        this.ctx.storage.transactionSync(() => {
          const change = fn(this.ctx.storage.kv.get<string>(key) ?? null)
          if (change.op === 'set') this.ctx.storage.kv.put(key, change.value)
          if (change.op === 'delete') this.ctx.storage.kv.delete(key)
          return change.result
        }),
      ),
  })

  override async fetch(request: Request) {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + sweepInterval)
    return routes.fetch(request, {
      ...this.env,
      MPP_SESSIONS: undefined,
      MPP_STORE: this.store,
    })
  }

  /** Deletes the expired replay markers, and sweeps again while any marker remains. */
  override async alarm() {
    const now = Date.now()
    let remaining = false
    for (const [key, raw] of this.ctx.storage.kv.list<string>()) {
      const expires = replayExpiry(raw)
      if (expires === undefined) continue
      if (expires <= now) this.ctx.storage.kv.delete(key)
      else remaining = true
    }
    if (remaining) await this.ctx.storage.setAlarm(now + sweepInterval)
  }
}

/** Returns the expiry of a stored replay marker of mppx, or `undefined` for any other value. */
function replayExpiry(raw: string) {
  const value = (() => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  })()
  if (typeof value !== 'object' || value === null) return undefined
  const marker = value as { expires?: unknown; type?: unknown }
  if (marker.type !== 'mppx:replay' || typeof marker.expires !== 'number')
    return undefined
  return marker.expires
}

export default app
