import * as z from 'zod/mini'
import type { Mutate, StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

import * as core_AccessKey from './AccessKey.js'
import type { Store as Account } from './Account.js'
import * as core_Keystore from './Keystore.js'
import * as Storage from './Storage.js'

const supportsStructuredClone = Symbol.for('accounts.storage.supportsStructuredClone')
const hydration_key = Symbol.for('accounts.store.hydration')
/**
 * Key of the merge hints attached to each persisted state as a non-enumerable
 * property. Storage shared between processes (`Storage.filesystem` in
 * `accounts/cli`) reads them to merge a write with what other processes
 * stored. Storages never serialize them.
 */
const hints_key = Symbol.for('accounts.store.merge')

export type { Account }

/** Reactive state for the provider. */
export type State = {
  /** Stored access keys. */
  accessKeys: readonly core_AccessKey.AccessKey[]
  /** Connected accounts. */
  accounts: readonly Account[]
  /** Index of the active account. */
  activeAccount: number
  /**
   * Absolutized Server Authentication endpoints from the most recent
   * `wallet_connect` (or the Provider's `auth` option). Persisted so
   * `wallet_disconnect` can call `logout` even after a page reload, even
   * when the URL was passed per-call rather than at Provider creation.
   */
  auth?:
    | {
        challenge?: string | undefined
        verify?: string | undefined
        logout?: string | undefined
        returnToken?: boolean | undefined
      }
    | undefined
  /** Active chain ID. */
  chainId: number
}

/** Provider state persisted as a refresh snapshot. */
type Persisted = {
  /** Stored access keys. */
  accessKeys?: readonly unknown[] | undefined
  /** Connected accounts. */
  accounts?: readonly Account[] | undefined
  /** Index of the active account. */
  activeAccount?: number | undefined
  /**
   * Absolutized Server Authentication endpoints from the most recent
   * `wallet_connect` (or the Provider's `auth` option).
   */
  auth?: State['auth'] | undefined
  /** Active chain ID. */
  chainId?: number | undefined
}

/** Zustand vanilla store with `subscribeWithSelector` and `persist` middleware. */
type ZustandStore = Mutate<
  StoreApi<State>,
  [['zustand/subscribeWithSelector', never], ['zustand/persist', Persisted]]
>

/** Provider store facade. */
export type Store = ZustandStore & {
  /** Store-bound access-key operations. */
  accessKeys: ReturnType<typeof core_AccessKey.createManager>
  /**
   * Sets `state` for a connect of `accounts`. Storage shared between processes
   * stores those accounts, the selection, and `auth` as given, even over a
   * logout another process saved meanwhile.
   */
  connect: (state: Partial<State>, accounts: readonly { address: string }[]) => void
  /**
   * Disconnects all accounts and clears locally signable access-key material.
   * Resolves once storage has saved the cleared state, and rejects if it can't.
   */
  disconnect: () => Promise<void>
}

/** Progress of a store loading its persisted state from storage. */
type Hydration = {
  /** Error the latest load failed with. */
  error?: HydrationError | undefined
  /** Settles when the latest load finishes. */
  promise: Promise<void>
  /** Load status. Stays `'success'` once persisted state has loaded. */
  status: 'pending' | 'success' | 'error'
}

/** Thrown when a store has not loaded, or failed to load, its persisted state from storage. */
export class HydrationError extends Error {
  constructor(message: string, options?: { cause?: unknown | undefined }) {
    super(message, options)
    this.name = 'Store.HydrationError'
  }
}

/** Options for {@link create}. */
export type Options = {
  /**
   * Minimum account schema required for hydration.
   *
   * This is a perimeter check for persisted state, not the full account schema.
   */
  schema?: z.ZodMiniType | undefined
  /** Initial chain ID. */
  chainId: number
  /** Keystores backing access-key records that carry an opaque `handle`. */
  keystores?: core_Keystore.Keystores | undefined
  /** Maximum number of accounts to persist. Oldest accounts are evicted when exceeded (LRU). */
  maxAccounts?: number | undefined
  /** Whether to persist credentials and access keys to storage. When `false`, only account addresses are persisted. @default true */
  persistCredentials?: boolean | undefined
  /** Storage adapter for persistence. */
  storage?: Storage.Storage | undefined
}

/**
 * Creates a Zustand vanilla store with `subscribeWithSelector` and `persist` middleware.
 */
export function create(options: Options): Store {
  const {
    chainId,
    keystores = core_Keystore.defaults,
    maxAccounts,
    persistCredentials = true,
    schema,
    // Matches the `Provider.create` default.
    storage = typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
      ? Storage.combine(Storage.idb({ key: 'tempo' }), Storage.memory({ key: 'tempo' }))
      : Storage.memory({ key: 'tempo' }),
  } = options

  // Intent of the write in progress (a connect or a reset), for storage shared between processes.
  let intent: { connect?: readonly string[]; replace?: readonly string[] } | undefined
  // The load in progress. Only it can settle `hydration`.
  let load: ReturnType<typeof deferred> | undefined = deferred()
  const hydration: Hydration = { promise: load.promise, status: 'pending' }
  const state = createStore(
    subscribeWithSelector(
      persist<State, [], [], Persisted>(
        () => ({
          accessKeys: [],
          accounts: [],
          activeAccount: 0,
          chainId,
        }),
        {
          merge: (persisted, current) => hydrate(persisted, current, { schema }),
          name: 'store',
          // Runs as each load starts. Unlike `onFinishHydration`, it also reports failed loads.
          onRehydrateStorage() {
            // Later loads (e.g. `persist.rehydrate()`) refresh state the store already holds.
            if (hydration.status === 'success') return
            // Each load gets its own promise. Waiters on a load this one replaces follow
            // it, and a load after a failed one retries it.
            const next = deferred()
            load?.resolve(next.promise)
            load = next
            Object.assign(hydration, { error: undefined, promise: next.promise, status: 'pending' })
            return (state, cause) => {
              // Only the newest load settles hydration, and only once.
              if (load !== next) return
              load = undefined
              // zustand passes the state only when the load succeeds.
              if (state) {
                hydration.status = 'success'
                return next.resolve()
              }
              const error = new HydrationError('Failed to load persisted state from storage.', {
                cause,
              })
              Object.assign(hydration, { error, status: 'error' })
              next.reject(error)
            }
          },
          partialize: (state) =>
            Object.defineProperty(
              serialize(state, {
                keystores,
                maxAccounts,
                persistCredentials,
                structuredClone: canStructuredClone(storage),
              }),
              hints_key,
              { value: { maxAccounts, ...intent } },
            ),
          storage,
          version: 0,
        },
      ),
    ),
  ) as ZustandStore
  const store = state as Store
  /**
   * Sets `next`, persisting it with `intent_next` as its merge hint. Resolves
   * once storage has saved it (the `persist` middleware returns that write).
   */
  async function setStateWith(next: Partial<State>, intent_next: NonNullable<typeof intent>) {
    intent = intent_next
    let written: unknown
    try {
      written = state.setState(next)
    } finally {
      intent = undefined
    }
    await written
  }
  /** Sets `reset` and persists its fields as replacements, so they win over any merge. */
  const reset = (next: Partial<State>) => setStateWith(next, { replace: Object.keys(next) })
  store.accessKeys = {
    ...core_AccessKey.createManager({ keystores, state }),
    clear: () => reset({ accessKeys: [] }),
  }
  store.connect = (next, accounts) =>
    setStateWith(next, { connect: accounts.map((account) => account.address) })
  store.disconnect = () =>
    reset({ accessKeys: [], accounts: [], activeAccount: 0, auth: undefined })
  Object.assign(store, { [hydration_key]: hydration })
  return store
}

function deferred() {
  let resolve: (value: void | Promise<void>) => void = () => {}
  let reject: (error: HydrationError) => void = () => {}
  const promise = new Promise<void>((resolve_, reject_) => {
    resolve = resolve_
    reject = reject_
  })
  // Waiters observe failures; a failed load nobody waits on is not an unhandled rejection.
  promise.catch(() => {})
  return { promise, reject, resolve }
}

function getHydration(store: Store): Hydration {
  return (store as Store & { [hydration_key]: Hydration })[hydration_key]
}

/** Converts runtime provider state into the persisted refresh snapshot. */
function serialize(state: State, options: serialize.Options = {}): Persisted {
  const { keystores, maxAccounts, persistCredentials = true, structuredClone = false } = options
  const accounts =
    maxAccounts && state.accounts.length > maxAccounts
      ? state.accounts.slice(0, maxAccounts)
      : state.accounts
  return {
    accounts,
    activeAccount: state.activeAccount,
    ...(persistCredentials
      ? {
          accessKeys: state.accessKeys.map((accessKey) =>
            serializeAccessKey(accessKey, { keystores, structuredClone }),
          ),
        }
      : {}),
    ...(state.auth ? { auth: state.auth } : {}),
    chainId: state.chainId,
  }
}

declare namespace serialize {
  /** Options for {@link serialize}. */
  type Options = {
    /** Keystores backing access-key records that carry an opaque `handle`. */
    keystores?: core_Keystore.Keystores | undefined
    /** Maximum number of accounts to persist. Oldest accounts are evicted when exceeded. */
    maxAccounts?: number | undefined
    /** Whether to persist credentials and access keys to storage. @default true */
    persistCredentials?: boolean | undefined
    /** Whether provider state can persist structured-clone values like WebCrypto key pairs. @default false */
    structuredClone?: boolean | undefined
  }
}

/** Restores runtime provider state from a persisted refresh snapshot. */
function hydrate(persisted: unknown, current: State, options: hydrate.Options = {}): State {
  const state = persisted && typeof persisted === 'object' ? (persisted as Partial<Persisted>) : {}
  const accounts_persisted = Array.isArray(state.accounts)
    ? state.accounts.filter(isStoredAccount)
    : undefined
  const accounts =
    accounts_persisted?.map((persisted) => {
      const account = current.accounts.find(
        (a) => a.address.toLowerCase() === persisted.address.toLowerCase(),
      )
      return account ?? persisted
    }) ?? current.accounts
  const accounts_valid = options.schema
    ? accounts.filter((account) => z.safeParse(options.schema!, account).success)
    : accounts
  return {
    ...state,
    ...current,
    accounts: accounts_valid,
    activeAccount:
      accounts_valid.length === 0
        ? 0
        : Math.min(state.activeAccount ?? current.activeAccount, accounts_valid.length - 1),
    accessKeys: normalizeAccessKeys(state.accessKeys) ?? current.accessKeys,
    chainId: state.chainId ?? current.chainId,
  }
}

declare namespace hydrate {
  /** Options for {@link hydrate}. */
  type Options = {
    /**
     * Minimum account schema required for hydration.
     *
     * This is a perimeter check for persisted state, not the full account schema.
     */
    schema?: z.ZodMiniType | undefined
  }
}

function normalizeAccessKeys(accessKeys: Persisted['accessKeys']) {
  if (!accessKeys) return undefined
  return accessKeys
    .filter((key): key is core_AccessKey.AccessKey => {
      if (!key || typeof key !== 'object') return false
      const value = key as {
        access?: unknown
        address?: unknown
        chainId?: unknown
        keyType?: unknown
      }
      return (
        typeof value.access === 'string' &&
        typeof value.address === 'string' &&
        typeof value.chainId === 'number' &&
        (value.keyType === 'secp256k1' ||
          value.keyType === 'p256' ||
          value.keyType === 'webAuthn' ||
          value.keyType === 'webCrypto')
      )
    })
    .map((key) => ({
      ...key,
      expiry: key.expiry === 0 ? undefined : key.expiry,
      ...(key.keyAuthorization?.expiry === 0
        ? { keyAuthorization: { ...key.keyAuthorization, expiry: undefined } }
        : {}),
    }))
}

function isStoredAccount(account: unknown): account is Account {
  if (!account || typeof account !== 'object') return false
  return typeof (account as { address?: unknown }).address === 'string'
}

function serializeAccessKey(
  accessKey: core_AccessKey.AccessKey,
  options: { keystores?: core_Keystore.Keystores | undefined; structuredClone: boolean },
): core_AccessKey.AccessKey {
  // Live key material (e.g. WebCrypto key pairs) survives structured-clone
  // stores inline; everywhere else it is stripped so the key is session-only.
  if (options.structuredClone) return accessKey
  const { keyPair: _keyPair, ...metadata } = accessKey as core_AccessKey.AccessKey & {
    keyPair?: unknown
  }
  if ('handle' in metadata && requiresStructuredClone(options.keystores, metadata.keyType)) {
    const { handle: _handle, ...rest } = metadata
    return rest as core_AccessKey.AccessKey
  }
  return metadata as core_AccessKey.AccessKey
}

/** Returns whether the keystore for `keyType` writes structured-clone-only handles. */
function requiresStructuredClone(
  keystores: core_Keystore.Keystores | undefined,
  keyType: core_AccessKey.AccessKey['keyType'],
): boolean {
  if (keyType !== 'p256' && keyType !== 'secp256k1') return false
  return keystores?.[keyType]?.requiresStructuredClone === true
}

function canStructuredClone(storage: Storage.Storage): boolean {
  return (
    (storage as Storage.Storage & { [supportsStructuredClone]?: true })[supportsStructuredClone] ===
    true
  )
}

/**
 * Throws {@link HydrationError} unless the store has loaded its persisted state
 * from storage. Use before reading persisted state synchronously.
 */
export function assertHydrated(store: Store): void {
  const { error, status } = getHydration(store)
  if (status === 'success') return
  throw (
    error ??
    new HydrationError(
      'Persisted state is still loading from storage. Await `provider.ready()` first.',
    )
  )
}

/**
 * Waits for the store to load its persisted state from storage.
 *
 * Resolves once the store has loaded. Rejects with {@link HydrationError} when
 * the load fails or does not finish within `timeout`. Never starts a load.
 */
export async function waitForHydration(
  store: Store,
  options: waitForHydration.Options = {},
): Promise<void> {
  const { timeout = 10_000 } = options
  const { promise, status } = getHydration(store)
  if (status !== 'pending') return await promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new HydrationError(`Persisted state did not load from storage within ${timeout}ms.`),
            ),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export declare namespace waitForHydration {
  /** Options for {@link waitForHydration}. */
  type Options = {
    /** Milliseconds to wait for persisted state to load. @default 10_000 */
    timeout?: number | undefined
  }
}
