import { Json } from 'ox'

/**
 * Minimal key-value store interface used by the SDK's server primitives
 * (e.g. SIWE nonce store, session store).
 *
 * Values are JSON-serialized when stored. TTLs are optional; consumers that
 * need expiry pass `{ ttl }` (in seconds) to `set` and the implementation
 * lazily evicts (memory) or relies on the backing store's native expiry
 * (Cloudflare KV).
 */
export type Kv = {
  /** Read a value by key. Returns `undefined` when missing or expired. */
  get: <value = unknown>(key: string) => Promise<value | undefined>
  /** Write a value. When `ttl` is set, the entry expires after the given duration in seconds. */
  set: (key: string, value: unknown, options?: set.Options | undefined) => Promise<void>
  /** Delete a value by key. */
  delete: (key: string) => Promise<void>
  /**
   * Atomic read-and-delete. Returns the value if present, `undefined` if
   * missing or expired. Across concurrent callers, exactly one observer
   * receives a non-`undefined` return for a given key, and the key is
   * removed exactly once.
   *
   * Optional. Required for one-time-consume semantics (e.g. SIWE
   * challenge nonces). Backends without a linearizable read+delete
   * primitive (e.g. eventually-consistent stores like Cloudflare KV)
   * should leave this undefined; the consuming handler will refuse to
   * accept the store at construction time and fall back to a different
   * backend (e.g. a Durable Object).
   */
  take?: <value = unknown>(key: string) => Promise<value | undefined>
}

export declare namespace set {
  type Options = {
    /** Time-to-live in seconds. After this duration, `get` returns `undefined`. */
    ttl?: number | undefined
  }
}

/** Wrap an existing `Kv`-shaped object so the SDK accepts it as a `Kv`. */
export function from<kv extends Kv>(kv: kv): kv {
  return kv
}

/**
 * Adapt a Cloudflare Workers KV namespace (or compatible binding) into a
 * `Kv`. Uses the underlying store's native `expirationTtl` for TTL.
 *
 * Cloudflare KV's minimum TTL is 60 seconds; the platform enforces its own
 * minimum independent of what's passed here.
 *
 * **Not safe for one-time-consume semantics.** Cloudflare KV is eventually
 * consistent across data centers — concurrent read+delete races can let
 * the same key be "consumed" twice. `take` is intentionally NOT
 * implemented. Use a Durable Object (or another linearizable backend)
 * for the SIWE challenge nonce store.
 */
export function cloudflare(kv: cloudflare.Parameters): Kv {
  return from({
    delete: kv.delete.bind(kv),
    async get(key) {
      return (await kv.get(key, 'json')) ?? undefined
    },
    async set(key, value, options) {
      const expirationTtl = options?.ttl
      await kv.put(key, Json.stringify(value), expirationTtl ? { expirationTtl } : undefined)
    },
  })
}

export declare namespace cloudflare {
  type Parameters = {
    get: <value = unknown>(key: string, format: 'json') => Promise<value | null>
    put: (
      key: string,
      value: string,
      options?: { expirationTtl?: number } | undefined,
    ) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

/**
 * Adapt a Cloudflare Durable Object namespace into a `Kv` with atomic
 * `take`. Unlike `Kv.cloudflare`, a Durable Object's storage is
 * single-actor and linearizable — `take` (read+delete) is guaranteed
 * atomic across concurrent callers, which makes this the recommended
 * backend for SIWE challenge nonce storage on Cloudflare Workers.
 *
 * Pair with `Kv.NonceStorage` (or your own DO class implementing the
 * same fetch protocol).
 *
 * Example:
 *
 * ```ts
 * // wrangler.jsonc
 * // {
 * //   "durable_objects": {
 * //     "bindings": [{ "name": "NONCE_DO", "class_name": "NonceStorage" }]
 * //   },
 * //   "migrations": [{ "tag": "v1", "new_classes": ["NonceStorage"] }]
 * // }
 *
 * // worker.ts
 * export { NonceStorage } from 'accounts/server'
 *
 * export default {
 *   fetch(req, env) {
 *     const handler = Handler.auth({
 *       store: Kv.durableObject(env.NONCE_DO),
 *       origin: 'https://app.example.com',
 *     })
 *     return handler.fetch(req)
 *   }
 * }
 * ```
 */
export function durableObject(
  namespace: durableObject.Namespace,
  options: durableObject.Options = {},
): Kv {
  const instanceName = options.name ?? 'default'
  const stub = () => namespace.get(namespace.idFromName(instanceName))

  async function rpc(op: string, key: string, body?: unknown): Promise<unknown> {
    const url = `https://do.invalid/${op}?key=${encodeURIComponent(key)}`
    const init: RequestInit =
      body !== undefined
        ? {
            method: 'POST',
            body: Json.stringify(body),
            headers: { 'content-type': 'application/json' },
          }
        : { method: 'POST' }
    const res = await stub().fetch(url, init as never)
    if (!res.ok) throw new Error(`Kv.durableObject ${op} failed: ${res.status}`)
    return await res.json()
  }

  return from({
    async get(key) {
      const { value } = (await rpc('get', key)) as { value: unknown }
      return value as never
    },
    async set(key, value, options) {
      await rpc('set', key, { value, ttl: options?.ttl })
    },
    async delete(key) {
      await rpc('delete', key)
    },
    async take(key) {
      const { value } = (await rpc('take', key)) as { value: unknown }
      return value as never
    },
  })
}

export declare namespace durableObject {
  /**
   * Minimal shape of a Cloudflare Durable Object namespace binding.
   * Compatible with `DurableObjectNamespace` from `@cloudflare/workers-types`.
   */
  type Namespace = {
    idFromName: (name: string) => unknown
    get: (id: unknown) => { fetch: (input: string, init?: unknown) => Promise<Response> }
  }
  type Options = {
    /**
     * Durable Object instance name. Defaults to `'default'` (a single
     * shared actor). Use a per-tenant name if you need isolation.
     */
    name?: string | undefined
  }
}

/**
 * Reference Durable Object class implementing the `Kv.durableObject`
 * fetch protocol. Export from your Worker entry and bind it under
 * `class_name: "NonceStorage"` in `wrangler.jsonc`.
 *
 * The class is framework-agnostic — it doesn't import `cloudflare:workers`
 * so it works with both the legacy DO API (`fetch(req)` only) and the
 * newer `extends DurableObject` API.
 */
export class NonceStorage {
  state: NonceStorage.State

  constructor(state: NonceStorage.State, _env?: unknown) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const op = url.pathname.replace(/^\//, '')
    const key = url.searchParams.get('key')
    if (!key) return Response.json({ error: 'missing `key`' }, { status: 400 })

    const isExpired = (entry: { expiresAt?: number } | undefined) =>
      Boolean(entry?.expiresAt && Date.now() >= entry.expiresAt)

    if (op === 'get') {
      const entry = await this.state.storage.get<NonceStorage.Entry>(key)
      if (!entry || isExpired(entry)) return Response.json({ value: undefined })
      return Response.json({ value: entry.value })
    }
    if (op === 'take') {
      const entry = await this.state.storage.get<NonceStorage.Entry>(key)
      if (!entry || isExpired(entry)) {
        if (entry) await this.state.storage.delete(key)
        return Response.json({ value: undefined })
      }
      await this.state.storage.delete(key)
      return Response.json({ value: entry.value })
    }
    if (op === 'set') {
      const body = (await request.json()) as { value: unknown; ttl?: number }
      const entry: NonceStorage.Entry = body.ttl
        ? { value: body.value, expiresAt: Date.now() + body.ttl * 1000 }
        : { value: body.value }
      await this.state.storage.put(key, entry)
      return Response.json({})
    }
    if (op === 'delete') {
      await this.state.storage.delete(key)
      return Response.json({})
    }
    return Response.json({ error: `unknown op: ${op}` }, { status: 400 })
  }
}

export declare namespace NonceStorage {
  /** Subset of `DurableObjectState` actually used by `NonceStorage`. */
  type State = {
    storage: {
      get: <T = unknown>(key: string) => Promise<T | undefined>
      put: (key: string, value: unknown) => Promise<void>
      delete: (key: string) => Promise<void>
    }
  }
  /** Internal storage shape: value plus optional absolute expiry timestamp (ms). */
  type Entry = { value: unknown; expiresAt?: number }
}

/**
 * In-memory `Kv` for tests and single-process deployments. Lazily evicts
 * expired entries on read/write.
 *
 * Pass `now` to control the clock in tests.
 */
export function memory(options: memory.Options = {}): Kv {
  const now = options.now ?? Date.now
  const store = new Map<string, { value: unknown; expiresAt?: number }>()

  function isExpired(entry: { expiresAt?: number }) {
    return entry.expiresAt !== undefined && now() >= entry.expiresAt
  }

  return from({
    async delete(key) {
      store.delete(key)
    },
    async get(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        store.delete(key)
        return undefined
      }
      return entry.value as never
    },
    async set(key, value, options) {
      const expiresAt = options?.ttl ? now() + options.ttl * 1000 : undefined
      store.set(key, expiresAt !== undefined ? { value, expiresAt } : { value })
    },
    // Atomic in-process: the synchronous `Map.get` + `Map.delete` runs
    // in a single microtask, so concurrent `take(key)` callers (within
    // the same Node/Bun/Worker process) cannot both observe the value.
    async take(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      store.delete(key)
      if (isExpired(entry)) return undefined
      return entry.value as never
    },
  })
}

export declare namespace memory {
  type Options = {
    /** Clock function for TTL accounting. Defaults to `Date.now`. */
    now?: (() => number) | undefined
  }
}
