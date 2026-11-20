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
import { assign, createActor, type SnapshotFrom, setup } from 'xstate'
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

/**
 * Returns the key function of jose's `jwtVerify` over the key set at `/oauth2/jwks` of `auth.url`.
 * Each verifier of `AccessToken`, `LogoutToken`, and `IdToken` holds one for its lifetime.
 *
 * The function verifies with the set in memory, or else the copy of `auth.keySet.cache`, or else
 * waits for a fetch. A set younger than half of `maxAge` verifies as it is. An older one verifies
 * while a fetch in `auth.keySet.defer` replaces it, at most once each 30 seconds after the last
 * fetch started. From `maxAge`, a verification waits for a new set, so a signing key that the issuer
 * removed stops verifying within `maxAge`. A token that names a `kid` that the set lacks, such as
 * after a rotation, first checks a set that another fetch stored meanwhile, and then waits for a
 * fetch, at most once each 30 seconds after the last fetch started and ended. Within those 30
 * seconds, it throws the key set as unavailable while a fetch runs or after one failed. Each verification that waits for a fetch
 * starts its own, since a Worker cancels the subrequests of a request when it ends, and a shared
 * fetch could then never settle. `machines.keySet` holds the lifecycle, and {@link decide} and
 * {@link rotate} choose each step.
 *
 * @throws {errors.JWKSNoMatchingKey} If no signing key of the set matches the token, also after a
 * fetch.
 * @throws {Error} If the fetch fails, answers with a status other than 2xx or a redirect, returns no
 * key set, or ends after `timeout`, as an `AbortError`, or if a fetch runs or failed within the
 * cooldown of a token that names an unknown `kid`.
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
  const actor = createActor(machines.keySet).start()
  // The key function of each set, which jose builds once for it.
  const functions = new WeakMap<Entry, JWTVerifyGetKey>()

  function keysOf(entry: Entry) {
    const existing = functions.get(entry)
    if (existing) return existing
    const keys = createLocalJWKSet(entry.jwks)
    functions.set(entry, keys)
    return keys
  }

  async function read() {
    if (!cache) return
    try {
      const entry = parse(await cache.getItem(url))
      // A copy from a clock ahead of this one is no fresher than a fetch.
      if (!entry || entry.fetchedAt > now()) return
      const age = status({
        fetchedAt: entry.fetchedAt,
        maxAge: maxAge_,
        now: now(),
      })
      if (age !== 'expired') actor.send({ entry, type: 'cache.read' })
    } catch {}
  }

  async function fetchSet() {
    actor.send({ now: now(), type: 'fetch.start' })
    // React Native's `AbortSignal` has no `timeout`, so a timer aborts the controller. The timer
    // covers the body too.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout_)
    try {
      const response = await (auth.fetch ?? fetch)(url, {
        headers: { accept: 'application/json' },
        // A redirect could lead to another origin's key set, so the issuer's own answer counts.
        redirect: 'manual',
        signal: controller.signal,
      })
      // A redirect answers with a 3xx status, or an opaque one with status 0.
      if (!response.ok)
        throw new Error(
          `Key set unavailable: the issuer answered with status ${response.status}. Retry later.`,
        )
      const entry = parse({ fetchedAt: now(), jwks: await response.json() })
      if (!entry)
        throw new Error(
          'Invalid key set: the issuer returned no `keys` array. Retry later.',
        )
      actor.send({ entry, now: now(), type: 'fetch.end' })
      if (cache)
        defer(
          cache
            // A store measures `expiresAt` on the system clock, which `now` may not follow.
            .setItem(url, entry, { expiresAt: Date.now() + maxAge_ })
            .catch(() => {}),
        )
      return entry
    } catch (error) {
      actor.send({ now: now(), type: 'fetch.fail' })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Starts a fetch that replaces a stale set after the response, unless another verification
   * started one within the cooldown while this one selected its key.
   */
  function refresh() {
    const step = decide(actor.getSnapshot(), { maxAge: maxAge_, now: now() })
    if (step === 'refresh') defer(fetchSet().catch(() => {}))
  }

  /** Returns the set to verify with, and whether a background fetch should replace it. */
  async function load() {
    const step = () =>
      decide(actor.getSnapshot(), { maxAge: maxAge_, now: now() })
    if (step() === 'fetch') await read()
    // A copy of the cache can be stale too, so the step follows the set that the read stored.
    const next = step()
    if (next === 'fetch') return { entry: await fetchSet(), stale: false }
    return {
      entry: actor.getSnapshot().context.entry!,
      stale: next === 'refresh',
    }
  }

  return async (header, token) => {
    const { entry, stale } = await load()
    try {
      const key = await keysOf(entry)(header, token)
      // The key is selected first, so a token of an unknown `kid` fetches in the foreground instead.
      if (stale) refresh()
      return key
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
      // Another fetch stored a newer set while this one checked, so the token checks it first.
      const current = actor.getSnapshot().context.entry
      if (current && current !== entry) {
        try {
          return await keysOf(current)(header, token)
        } catch (error) {
          if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
        }
      }
      const next = rotate(actor.getSnapshot(), { now: now() })
      if (next === 'fetch') return await keysOf(await fetchSet())(header, token)
      if (stale) refresh()
      if (next === 'refuse') throw error
      throw new Error(
        'Key set unavailable: a fetch of the key set runs or failed. Retry later.',
        { cause: error },
      )
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
 * Returns the step of a verification from the key set of `snapshot` at `now`: `use` the set,
 * `refresh` it in the background and use it, or wait to `fetch` a set. A stale set refreshes at
 * most once each cooldown after the last fetch started, so a fetch that never settles holds no later
 * refresh. Without a set, each verification fetches one, so none waits on another's fetch.
 *
 * @example
 * ```ts
 * import { KeySet } from 'accounts/internal'
 * import { createActor } from 'xstate'
 *
 * const actor = createActor(KeySet.machines.keySet).start()
 * KeySet.decide(actor.getSnapshot(), { maxAge: 600_000, now: Date.now() })
 * // 'fetch'
 * ```
 */
export function decide(
  snapshot: machines.keySet.Snapshot,
  options: decide.Options,
): 'fetch' | 'refresh' | 'use' {
  const { maxAge, now } = options
  const { entry, started } = snapshot.context
  const age = status({ fetchedAt: entry?.fetchedAt, maxAge, now })
  if (age === 'expired') return 'fetch'
  if (age === 'stale' && !cooling({ at: started, now })) return 'refresh'
  return 'use'
}

export declare namespace decide {
  type Options = {
    /** How long a key set verifies, in milliseconds. */
    maxAge: number
    /** The current time, in milliseconds since the epoch. */
    now: number
  }
}

/**
 * Returns the step for a token that names a `kid` that the set of `snapshot` lacks, at `now`: wait
 * to `fetch` a set, `refuse` the token, or throw the key set as `unavailable`. A fetch follows at
 * most once each cooldown after the last fetch started and after the last fetch ended, so tokens of
 * unknown `kid`s start at most one fetch each cooldown. Within it, the token is refused once the
 * last fetch returned a set, and otherwise throws the key set as unavailable, since a fetch in
 * progress or one that failed leaves the issuer's current set unknown.
 *
 * @example
 * ```ts
 * import { KeySet } from 'accounts/internal'
 * import { createActor } from 'xstate'
 *
 * const actor = createActor(KeySet.machines.keySet).start()
 * actor.send({ now: 0, type: 'fetch.start' })
 * actor.send({ now: 1, type: 'fetch.fail' })
 * KeySet.rotate(actor.getSnapshot(), { now: 2 })
 * // 'unavailable'
 * ```
 */
export function rotate(
  snapshot: machines.keySet.Snapshot,
  options: rotate.Options,
): 'fetch' | 'refuse' | 'unavailable' {
  const { ended, started } = snapshot.context
  const { now } = options
  if (!cooling({ at: started, now }) && !cooling({ at: ended, now }))
    return 'fetch'
  if (snapshot.matches('loaded')) return 'refuse'
  return 'unavailable'
}

export declare namespace rotate {
  type Options = {
    /** The current time, in milliseconds since the epoch. */
    now: number
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

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The key set of one verifier: `empty` before any set, `pending` while a fetch for the first set
   * runs, and `unavailable` after it failed, and with a set, `loaded` after the last fetch returned
   * it, `refreshing` while a fetch runs, and `failing` after the last fetch failed. A set from a
   * fetch or the cache replaces only an older one. The context keeps when the last fetch started
   * and ended, which {@link decide} and {@link rotate} compare with the cooldown.
   */
  export const keySet = setup({
    actions: {
      adopt: assign(({ context, event }) => {
        if (event.type !== 'cache.read' && event.type !== 'fetch.end') return {}
        if (context.entry && context.entry.fetchedAt > event.entry.fetchedAt)
          return {}
        return { entry: event.entry }
      }),
      end: assign(({ event }) =>
        event.type === 'fetch.end' || event.type === 'fetch.fail'
          ? { ended: event.now }
          : {},
      ),
      start: assign(({ event }) =>
        event.type === 'fetch.start' ? { started: event.now } : {},
      ),
    },
    types: {
      context: {} as keySet.Context,
      events: {} as keySet.Event,
    },
  }).createMachine({
    context: { ended: undefined, entry: undefined, started: undefined },
    id: 'keySet',
    initial: 'empty',
    on: {
      'cache.read': { actions: 'adopt' },
      'fetch.end': { actions: ['adopt', 'end'], target: '.loaded' },
    },
    states: {
      empty: {
        on: {
          'cache.read': { actions: 'adopt', target: 'loaded' },
          'fetch.fail': { actions: 'end', target: 'unavailable' },
          'fetch.start': { actions: 'start', target: 'pending' },
        },
      },
      failing: {
        on: {
          'fetch.fail': { actions: 'end' },
          'fetch.start': { actions: 'start', target: 'refreshing' },
        },
      },
      loaded: {
        on: {
          'fetch.fail': { actions: 'end', target: 'failing' },
          'fetch.start': { actions: 'start', target: 'refreshing' },
        },
      },
      pending: {
        on: {
          'cache.read': { actions: 'adopt', target: 'refreshing' },
          'fetch.fail': { actions: 'end', target: 'unavailable' },
          'fetch.start': { actions: 'start' },
        },
      },
      refreshing: {
        on: {
          'fetch.fail': { actions: 'end', target: 'failing' },
          'fetch.start': { actions: 'start' },
        },
      },
      unavailable: {
        on: {
          'cache.read': { actions: 'adopt', target: 'failing' },
          'fetch.fail': { actions: 'end' },
          'fetch.start': { actions: 'start', target: 'pending' },
        },
      },
    },
  })

  export declare namespace keySet {
    type Context = {
      /** When the last fetch ended, with or without a set, in milliseconds since the epoch. */
      ended: number | undefined
      /** The newest set from a fetch or the cache. */
      entry: Entry | undefined
      /** When the last fetch started, in milliseconds since the epoch. */
      started: number | undefined
    }

    type Event =
      | { entry: Entry; type: 'cache.read' }
      | { entry: Entry; now: number; type: 'fetch.end' }
      | { now: number; type: 'fetch.fail' }
      | { now: number; type: 'fetch.start' }

    type Snapshot = SnapshotFrom<typeof keySet>
  }
}

/** Returns whether `at` lies within the cooldown before `now`. Absent, no fetch ran. */
function cooling(options: { at: number | undefined; now: number }) {
  const { at, now } = options
  return at !== undefined && now - at < cooldown
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
