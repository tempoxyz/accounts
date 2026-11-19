/**
 * The issuer's key set, which the verifiers of Tempo ID's tokens use: `create` returns the key
 * function of jose's `jwtVerify`, which keeps the set in memory, and in `keySet.cache` of the
 * configuration if it names one, and fetches a new set so that few verifications wait for it.
 * @module
 */
import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose'
import type { Config } from '../Accounts.js'
import type * as Store from '../Store.js'

/**
 * The least time from the end of one fetch to a fetch for a token that names a `kid` that the set
 * lacks, in milliseconds, as jose's `cooldownDuration`.
 */
export const cooldown = 30_000

/** The default `maxAge`, 10 minutes, in milliseconds. */
export const maxAge = 10 * 60 * 1000

/** The default `timeout`, 5 seconds, in milliseconds. */
export const timeout = 5_000

/**
 * A store that keeps the key set beyond one instance, such as for each process or Worker isolate
 * that starts. Any `Store` of the package is one, such as `Store.redis`. The key of the entry is
 * the URL of the key set, and its value is an {@link Entry}.
 */
export type Cache = Pick<Store.Store, 'getItem' | 'setItem'>

/** The key set that a {@link Cache} keeps, with the time of its fetch. */
export type Entry = {
  /** When the fetch of the set ended, in milliseconds since the epoch. */
  fetchedAt: number
  /** The key set, as the issuer serves it. */
  jwks: JSONWebKeySet
}

/**
 * The platform capabilities of the verifiers' key sets: a cache that instances share, and a
 * function that keeps background work running. `KeySet.cache` of `accounts/cloudflare` returns one
 * for Cloudflare Workers.
 */
export type Runtime = {
  /**
   * Keeps the key set beyond the instance. A verifier without a set in memory reads it before it
   * fetches one, and writes each set that it fetches. A failed read or write only costs a fetch.
   * Absent, each verifier keeps its set only in memory.
   */
  cache?: Cache | undefined
  /**
   * Keeps a promise of background work running after the response, such as the `waitUntil` of a
   * Worker. The promise never rejects. Defaults to a function that leaves the promise to run.
   */
  defer?: ((promise: Promise<unknown>) => void) | undefined
}

/**
 * The age of a key set: `fresh` before half of `maxAge`, which verifies as it is, `stale` until
 * `maxAge`, which verifies while a background fetch replaces it, and `expired` from `maxAge` or
 * without a set, which a verification waits to replace.
 */
export type Status = 'expired' | 'fresh' | 'stale'

/** A key set in memory, and its key function. */
type Loaded = {
  /** When the fetch of the set ended, in milliseconds since the epoch. */
  fetchedAt: number
  /** The key function of the set. */
  keys: JWTVerifyGetKey
}

/**
 * Returns the key function of jose's `jwtVerify` over the key set at `/oauth2/jwks` of `auth.url`.
 * Each verifier of `AccessToken`, `LogoutToken`, and `IdToken` holds one for its lifetime.
 *
 * The function verifies with the set in memory, or else the copy of `auth.keySet.cache`, or else
 * waits for a fetch. A set younger than half of `maxAge` verifies as it is. An older one verifies
 * while a fetch in `auth.keySet.defer` replaces it, at most once each 30 seconds after the last
 * fetch started. From `maxAge`, a verification waits for a new set, so a signing key that the issuer
 * removed stops verifying within `maxAge`. A token that names a `kid` that the set lacks, such as after a
 * rotation, first checks a set that another fetch stored meanwhile, and then waits for a fetch, at
 * most once each 30 seconds after the last fetch ended. Each verification that waits for a fetch
 * starts its own, since a Worker cancels the subrequests of a request when it ends, and a shared
 * fetch could then never settle.
 *
 * @throws {errors.JWKSNoMatchingKey} If no signing key of the set matches the token, also after a
 * fetch.
 * @throws {Error} If the fetch fails, answers with a status other than 2xx, returns no key set, or
 * ends after `timeout`, such as with a `TimeoutError`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { KeySet } from 'accounts/internal'
 * import { jwtVerify } from 'jose'
 *
 * const keys = KeySet.create(Accounts.from({ clientId: 'https://app.example' }))
 * const { payload } = await jwtVerify(token, keys, { algorithms: ['RS256'] })
 * ```
 */
export function create(
  auth: create.Auth,
  options: create.Options = {},
): JWTVerifyGetKey {
  const {
    maxAge: maxAge_ = maxAge,
    now = Date.now,
    timeout: timeout_ = timeout,
  } = options
  const { cache, defer = detach } = auth.keySet ?? {}
  const url = new URL('/oauth2/jwks', auth.url).href

  let current: Loaded | undefined
  // When the last fetch started. A stale set starts a background fetch at most once per cooldown,
  // so a fetch that never settles does not stop later ones.
  let started = -Infinity
  // When the last fetch ended, with or without a set. A token of an unknown `kid` waits a cooldown.
  let ended = -Infinity

  function use(entry: Entry): Loaded {
    if (!current || entry.fetchedAt >= current.fetchedAt)
      current = {
        fetchedAt: entry.fetchedAt,
        keys: createLocalJWKSet(entry.jwks),
      }
    return current
  }

  async function read() {
    if (!cache) return undefined
    try {
      const entry = parse(await cache.getItem(url))
      // A copy from a clock ahead of this one is no fresher than a fetch.
      if (!entry || entry.fetchedAt > now()) return undefined
      const age = status({
        fetchedAt: entry.fetchedAt,
        maxAge: maxAge_,
        now: now(),
      })
      if (age === 'expired') return undefined
      return use(entry)
    } catch {
      return undefined
    }
  }

  async function fetchSet() {
    started = now()
    try {
      const response = await (auth.fetch ?? fetch)(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeout_),
      })
      if (!response.ok)
        throw new Error(
          `Key set unavailable: the issuer answered with status ${response.status}. Retry later.`,
        )
      const entry = parse({ fetchedAt: now(), jwks: await response.json() })
      if (!entry)
        throw new Error(
          'Invalid key set: the issuer returned no `keys` array. Retry later.',
        )
      const loaded = use(entry)
      if (cache)
        defer(
          cache
            // A store measures `expiresAt` on the system clock, which `now` may not follow.
            .setItem(url, entry, { expiresAt: Date.now() + maxAge_ })
            .catch(() => {}),
        )
      return loaded
    } finally {
      ended = now()
    }
  }

  async function load() {
    const loaded = current
    const age = status({
      fetchedAt: loaded?.fetchedAt,
      maxAge: maxAge_,
      now: now(),
    })
    if (!loaded || age === 'expired')
      return (await read()) ?? (await fetchSet())
    if (age === 'stale' && now() - started >= cooldown)
      defer(fetchSet().catch(() => {}))
    return loaded
  }

  return async (header, token) => {
    const loaded = await load()
    try {
      return await loaded.keys(header, token)
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
      // Another fetch stored a newer set while this one checked, so the token checks it first.
      if (current && current !== loaded) {
        try {
          return await current.keys(header, token)
        } catch (error) {
          if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
        }
      }
      // The issuer may have rotated its keys, so a fetch follows, at most once per cooldown.
      if (now() - ended < cooldown) throw error
      const fetched = await fetchSet()
      return await fetched.keys(header, token)
    }
  }
}

export declare namespace create {
  /** The configuration's issuer URL, and its `fetch` and `keySet`. */
  type Auth = Pick<Config, 'url'> & Partial<Pick<Config, 'fetch' | 'keySet'>>

  type Options = {
    /**
     * How long a key set verifies, in milliseconds. After half of it, a verification starts a
     * background fetch. After all of it, a verification waits for a new set. Defaults to 10 minutes.
     */
    maxAge?: number | undefined
    /** Returns the current time, in milliseconds since the epoch. Defaults to `Date.now`. */
    now?: (() => number) | undefined
    /** How long a fetch of the key set may take, in milliseconds. Defaults to 5 seconds. */
    timeout?: number | undefined
  }
}

/**
 * Returns `runtime` as a {@link Runtime}, for the `keySet` of a configuration.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { KeySet } from 'accounts/internal'
 *
 * const accounts = Accounts.create({
 *   clientId: 'https://app.example',
 *   keySet: KeySet.from({ cache: Store.memory() }),
 * })
 * ```
 */
export function from(runtime: Runtime): Runtime {
  return runtime
}

/**
 * Returns the {@link Status} at `now` of a key set that a fetch returned at `fetchedAt`.
 *
 * @example
 * ```ts
 * import { KeySet } from 'accounts/internal'
 *
 * KeySet.status({ fetchedAt: 0, maxAge: 600_000, now: 400_000 })
 * // 'stale'
 * ```
 */
export function status(options: status.Options): Status {
  const { fetchedAt, maxAge, now } = options
  if (fetchedAt === undefined || now - fetchedAt >= maxAge) return 'expired'
  if (now - fetchedAt >= maxAge / 2) return 'stale'
  return 'fresh'
}

export declare namespace status {
  type Options = {
    /** When the fetch of the set ended, in milliseconds since the epoch. Absent without a set. */
    fetchedAt: number | undefined
    /** How long a key set verifies, in milliseconds. */
    maxAge: number
    /** The current time, in milliseconds since the epoch. */
    now: number
  }
}

/** Leaves a promise of background work to run. Each promise that the key set defers never rejects. */
function detach(promise: Promise<unknown>) {
  void promise
}

/** Returns `value` as an {@link Entry}, or `undefined` if it holds no key set and fetch time. */
function parse(value: unknown): Entry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { fetchedAt, jwks } = value as Partial<Record<keyof Entry, unknown>>
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt))
    return undefined
  if (typeof jwks !== 'object' || jwks === null) return undefined
  if (!Array.isArray((jwks as { keys?: unknown }).keys)) return undefined
  return { fetchedAt, jwks: jwks as JSONWebKeySet }
}
