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
import {
  assign,
  createActor,
  fromPromise,
  type ActorRefFrom,
  type SnapshotFrom,
  setup,
  waitFor,
} from 'xstate'
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
 * The key of the property of an instance's configuration that holds its key functions, by
 * `maxAge` and `timeout`, which the instance's verifiers share. The instance owns them.
 */
const sets = Symbol('keySet.sets')

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
 * Each verifier of `AccessToken`, `LogoutToken`, and `IdToken` holds one for its lifetime. The calls with
 * the same `auth` object, `maxAge`, and `timeout`, and without `now`, return the same function, so the
 * verifiers of one instance share its set and its fetches.
 *
 * The function verifies with the set in memory, or else the copy of `auth.keySet.cache`, or else
 * waits for a fetch. A set younger than half of `maxAge` verifies as it is. An older one verifies
 * while a fetch in `auth.keySet.defer` replaces it, at most once each 30 seconds after the last
 * fetch started. From `maxAge`, a verification waits for a new set, so a signing key that the issuer
 * removed stops verifying within `maxAge`. A token that names a `kid` that the set lacks, such as
 * after a rotation, first checks a set that another fetch stored meanwhile, and then waits for a
 * fetch, at most once each 30 seconds after the last fetch started and ended. Within those 30
 * seconds, it waits for a fetch that runs, at most `timeout`, and checks the set that the fetch
 * returned. A verification that waits for a new set joins a fetch that another one started within
 * `timeout`, and starts its own fetch if that fetch fails or returns no set within `timeout`. A wait
 * for the fetch of another verification ends within `timeout`, since a Worker cancels the
 * subrequests of a request when it ends, and a shared fetch could then never settle. `machines.keySet` holds
 * the lifecycle, `machines.fetch` runs each fetch and ends it at `timeout`, and {@link decide}
 * and {@link rotate} choose each step.
 *
 * @throws {errors.JWKSNoMatchingKey} If no signing key of the set matches the token, also after a
 * fetch.
 * @throws {Error} If the fetch fails, answers with a status other than 2xx or a redirect, or returns
 * no key set, as a `TimeoutError` if it ends after `timeout`, or within the cooldown of a token that
 * names an unknown `kid`, if the last fetch failed, or the fetch that runs does not return a set
 * within `timeout`.
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
  // The verifiers of one configuration, such as the access token and ID token verifiers of the
  // `tokens` plugin, share its set, so the instance fetches it once. A clock of its own keeps its own set.
  if (options.now === undefined) {
    const owner = auth as { [sets]?: Map<string, JWTVerifyGetKey> }
    if (!owner[sets] && Object.isExtensible(auth))
      Object.defineProperty(auth, sets, { value: new Map() })
    const registry = owner[sets]
    if (!registry)
      return create(auth, { maxAge: maxAge_, now, timeout: timeout_ })
    const id = `${maxAge_}:${timeout_}`
    const existing = registry.get(id)
    if (existing) return existing
    const keys = create(auth, { maxAge: maxAge_, now, timeout: timeout_ })
    registry.set(id, keys)
    return keys
  }
  const { cache, defer = detach } = auth.keySet ?? {}
  const url = new URL('/oauth2/jwks', auth.url).href
  const actor = createActor(machines.keySet).start()
  // Each fetch runs in its own actor, which aborts its request at `timeout`.
  const fetcher = machines.fetch.provide({
    actors: {
      request: fromPromise<Entry>(async ({ signal }) => {
        const response = await (auth.fetch ?? fetch)(url, {
          headers: { accept: 'application/json' },
          // A redirect could lead to another origin's key set, so the issuer's own answer counts.
          redirect: 'manual',
          signal,
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
        return entry
      }),
    },
    delays: { timeout: timeout_ },
  })
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
    // The machine ends the fetch at `timeout`, also during the body, so the wait ends.
    const snapshot = await waitFor(
      createActor(fetcher).start(),
      (state) => state.status === 'done',
    )
    try {
      const entry = machines.entry(snapshot)
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
    }
  }

  /**
   * Waits for the fetch that runs to end, at most `timeout`, and returns the set that it returned.
   * Returns `undefined` if it failed or runs on, such as the fetch of a Worker request that ended.
   */
  async function settle() {
    const snapshot = await waitFor(
      actor,
      (state) => !machines.fetching(state),
      { timeout: timeout_ },
    ).catch(() => undefined)
    if (!snapshot?.matches('loaded')) return undefined
    return snapshot.context.entry
  }

  /**
   * Starts a fetch that replaces a stale set after the response, unless another verification
   * started one within the cooldown while this one selected its key.
   */
  function refresh() {
    const step = decide(actor.getSnapshot(), { maxAge: maxAge_, now: now() })
    if (step === 'refresh') defer(fetchSet().catch(() => {}))
  }

  /**
   * Returns a wait for a fetch that another verification started within `timeout`, or `undefined` at
   * once without one, so the verification that starts a fetch starts it in the same tick. The wait
   * resolves with the set of that fetch, or `undefined` if that fetch fails, ends at its `timeout`,
   * or runs on, such as the fetch of a Worker request that ended. The verification then starts its
   * own fetch, so one failed fetch does not fail each verification that joined it.
   */
  function join() {
    const { started } = actor.getSnapshot().context
    if (!machines.fetching(actor.getSnapshot()) || started === undefined) return
    const left = started + timeout_ - now()
    if (left <= 0) return
    return wait(left)
  }

  /** Waits at most `left` for the fetch that runs, as `join` describes. */
  async function wait(left: number) {
    const snapshot = await waitFor(
      actor,
      (state) => !machines.fetching(state),
      { timeout: left },
    ).catch(() => undefined)
    if (!snapshot?.matches('loaded')) return undefined
    return snapshot.context.entry
  }

  /** Returns the set to verify with, and whether a background fetch should replace it. */
  async function load() {
    const step = () =>
      decide(actor.getSnapshot(), { maxAge: maxAge_, now: now() })
    if (step() === 'fetch') await read()
    // A copy of the cache can be stale too, so the step follows the set that the read stored.
    const next = step()
    if (next === 'fetch') {
      const joined = join()
      return {
        entry: (joined && (await joined)) ?? (await fetchSet()),
        stale: false,
      }
    }
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
      // A token of a new `kid` that arrives during the fetch checks the set that the fetch returns.
      const settled = next === 'wait' ? await settle() : undefined
      if (settled) return await keysOf(settled)(header, token)
      throw new Error(
        'Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.',
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
 * Returns the step for a token that names a `kid` that the set of `snapshot` lacks, at `now`: start
 * a `fetch` of a set and wait for it, `wait` for the fetch that runs, `refuse` the token, or throw
 * the key set as `unavailable`. A fetch follows at most once each cooldown after the last fetch
 * started and after the last fetch ended, so tokens of unknown `kid`s start at most one fetch each
 * cooldown. Within it, the token is refused once the last fetch returned a set, waits while a fetch
 * runs, and otherwise throws the key set as unavailable, since a fetch that failed leaves the
 * issuer's current set unknown.
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
): 'fetch' | 'refuse' | 'unavailable' | 'wait' {
  const { ended, started } = snapshot.context
  const { now } = options
  if (!cooling({ at: started, now }) && !cooling({ at: ended, now }))
    return 'fetch'
  if (snapshot.matches('loaded')) return 'refuse'
  if (machines.fetching(snapshot)) return 'wait'
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
   * and ended, which {@link decide} and {@link rotate} compare with the cooldown. `pending` and
   * `refreshing` hold the `fetching` tag, which {@link fetching} reads.
   *
   * | State         | Meaning                                                  |
   * | ------------- | -------------------------------------------------------- |
   * | `empty`       | No set, and no fetch ran.                                |
   * | `pending`     | No set, and a fetch runs.                                |
   * | `unavailable` | No set, and the last fetch failed.                       |
   * | `loaded`      | A set, which the last fetch that ended returned.         |
   * | `refreshing`  | A set, and a fetch runs.                                 |
   * | `failing`     | A set, and the last fetch that ended failed.             |
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
        tags: ['fetching'],
      },
      refreshing: {
        on: {
          'fetch.fail': { actions: 'end', target: 'failing' },
          'fetch.start': { actions: 'start' },
        },
        tags: ['fetching'],
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

  /** Returns whether a fetch runs in `snapshot`, which a token of an unknown `kid` waits for. */
  export function fetching(snapshot: keySet.Snapshot) {
    return snapshot.hasTag('fetching')
  }

  /**
   * One fetch of the key set: `fetching` while its request runs, then `fetched` with the set that
   * the request returned, `failed` with its error, or `timedOut` at `timeout`, which stops the
   * request and aborts it through its signal. Every end is final, so the actor stops with it.
   *
   * | State      | Meaning                                         |
   * | ---------- | ----------------------------------------------- |
   * | `fetching` | The request runs.                               |
   * | `fetched`  | The request returned a set.                     |
   * | `failed`   | The request failed.                             |
   * | `timedOut` | The request ran for `timeout`, and was aborted. |
   */
  export const fetch = setup({
    actions: {
      /** Holds the error of the failed request. */
      fail: assign((_args, params: { error: unknown }) => ({
        error: params.error,
      })),
      /** Holds the set that the request returned. */
      hold: assign((_args, params: { entry: Entry }) => ({
        entry: params.entry,
      })),
    },
    actors: {
      /**
       * Fetches the key set, and aborts the request at the abort of its signal. `create` provides
       * it.
       */
      request: fromPromise<Entry>(() =>
        Promise.reject(
          new Error(
            'Missing `request`: the fetch of the key set has no request. Provide one.',
          ),
        ),
      ),
    },
    delays: {
      /** How long the request may run, in milliseconds. `create` provides its `timeout`. */
      timeout,
    },
    // The machine receives only the events of its request and its timer, so it types no others.
    types: { context: {} as fetch.Context },
  }).createMachine({
    context: { entry: undefined, error: undefined },
    id: 'fetch',
    initial: 'fetching',
    states: {
      failed: { type: 'final' },
      fetched: { type: 'final' },
      fetching: {
        // Leaving `fetching` stops the request, which aborts it, so the timer covers the body too.
        after: { timeout: 'timedOut' },
        invoke: {
          id: 'request',
          onDone: {
            actions: {
              params: (args) => ({ entry: args.event.output }),
              type: 'hold',
            },
            target: 'fetched',
          },
          onError: {
            actions: {
              params: (args) => ({ error: args.event.error }),
              type: 'fail',
            },
            target: 'failed',
          },
          src: 'request',
        },
      },
      timedOut: { type: 'final' },
    },
  })

  export declare namespace fetch {
    type Context = {
      /** The set that the request returned. Absent until it returns one. */
      entry: Entry | undefined
      /** The error of the failed request. Absent until it fails. */
      error: unknown
    }

    type Actor = ActorRefFrom<typeof fetch>

    type Snapshot = SnapshotFrom<typeof fetch>
  }

  /**
   * Returns the set of a fetch that ended.
   * @throws {Error} The request's error for a failed fetch, or a `TimeoutError` for one that ran for
   * `timeout`.
   */
  export function entry(snapshot: fetch.Snapshot) {
    if (snapshot.matches('fetched') && snapshot.context.entry)
      return snapshot.context.entry
    if (snapshot.matches('failed')) throw snapshot.context.error
    // React Native has no `DOMException`, so the error is an `Error` with the name.
    throw Object.assign(
      new Error(
        'Key set unavailable: the fetch of the key set did not end within `timeout`. Retry later.',
      ),
      { name: 'TimeoutError' },
    )
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
  // jose refuses a malformed set, such as one whose keys are not objects, so none is adopted or cached.
  try {
    createLocalJWKSet(jwks as JSONWebKeySet)
  } catch {
    return undefined
  }
  return { fetchedAt, jwks: jwks as JSONWebKeySet }
}
