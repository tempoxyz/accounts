import { Json } from 'ox'
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
  /** Disconnects all accounts and clears locally signable access-key material. */
  disconnect: () => void
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
    storage = typeof window !== 'undefined'
      ? Storage.idb({ key: 'tempo' })
      : Storage.memory({ key: 'tempo' }),
  } = options

  const initial = { accessKeys: [], accounts: [], activeAccount: 0, chainId }
  const persisted_initial = {
    state: serialize(initial, {
      keystores,
      maxAccounts,
      persistCredentials,
      structuredClone: canStructuredClone(storage),
    }),
    version: 0,
  }
  const storage_transactional = transactional(storage, persisted_initial)
  const state = createStore(
    subscribeWithSelector(
      persist<State, [], [], Persisted>(() => initial, {
        merge: (persisted, current) => hydrate(persisted, current, { schema }),
        name: 'store',
        partialize: (state) =>
          serialize(state, {
            keystores,
            maxAccounts,
            persistCredentials,
            structuredClone: canStructuredClone(storage),
          }),
        storage: storage_transactional,
        version: 0,
      }),
    ),
  ) as ZustandStore
  const store = state as Store
  store.accessKeys = core_AccessKey.createManager({ keystores, state })
  store.disconnect = () =>
    state.setState({ accessKeys: [], accounts: [], activeAccount: 0, auth: undefined })
  return store
}

type PersistedValue = { state: Persisted; version?: number | undefined }

function transactional(storage: Storage.Storage, initial: PersistedValue): Storage.Storage {
  if (!Storage.supportsUpdate(storage)) return storage
  const previous = new Map<string, unknown>([['store', initial]])
  return {
    async getItem<value>(name: string) {
      const value = await storage.getItem<value>(name)
      if (value !== null) previous.set(name, value)
      return value
    },
    removeItem: (name) => storage.removeItem(name),
    setItem(name, value) {
      const before = previous.get(name)
      previous.set(name, value)
      return Storage.updateItem(storage, name, (current) =>
        mergePersisted(before, value, current, initial),
      )
    },
  }
}

function mergePersisted(
  previous: unknown,
  next: unknown,
  current: unknown,
  initial: PersistedValue,
): unknown {
  if (!isPersistedValue(previous) || !isPersistedValue(next))
    throw new Error('Cannot transactionally update malformed persisted state.')
  const current_ = current === null ? initial : current
  if (!isPersistedValue(current_))
    throw new Error('Cannot transactionally update malformed persisted state.')

  const state = { ...current_.state }
  for (const name of ['accounts', 'activeAccount', 'auth', 'chainId'] as const) {
    if (equal(previous.state[name], next.state[name])) continue
    if (typeof next.state[name] === 'undefined') delete state[name]
    else (state as Record<string, unknown>)[name] = next.state[name]
  }
  state.accessKeys = mergeAccessKeys(
    previous.state.accessKeys,
    next.state.accessKeys,
    current_.state.accessKeys,
  )
  return { ...current_, ...next, state }
}

function mergeAccessKeys(
  previous: Persisted['accessKeys'],
  next: Persisted['accessKeys'],
  current: Persisted['accessKeys'],
): Persisted['accessKeys'] {
  if (equal(previous, next)) return current
  if (!Array.isArray(previous) || !Array.isArray(next) || !Array.isArray(current)) return next
  if (next.length === 0) return []

  const result = [...current]
  for (const before of previous) {
    const index_next = next.findIndex((key) => sameAccessKey(key, before))
    const index_current = result.findIndex((key) => sameAccessKey(key, before))
    if (index_next === -1) {
      if (index_current !== -1) result.splice(index_current, 1)
      continue
    }
    if (index_current === -1) continue
    result[index_current] = patch(result[index_current], before, next[index_next])
  }
  for (const key of next)
    if (!previous.some((before) => sameAccessKey(before, key))) result.unshift(key)
  return result
}

function patch(current: unknown, previous: unknown, next: unknown): unknown {
  if (!isObject(current) || !isObject(previous) || !isObject(next)) return next
  const result = { ...current }
  for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (equal(previous[name], next[name])) continue
    if (typeof next[name] === 'undefined') delete result[name]
    else result[name] = next[name]
  }
  return result
}

function sameAccessKey(a: unknown, b: unknown): boolean {
  if (!isObject(a) || !isObject(b)) return false
  return (
    a.address === b.address &&
    a.access === b.access &&
    a.chainId === b.chainId &&
    a.keyType === b.keyType
  )
}

function equal(a: unknown, b: unknown): boolean {
  return Json.stringify(a) === Json.stringify(b)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPersistedValue(value: unknown): value is PersistedValue {
  return isObject(value) && isObject(value.state)
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
  return accessKeys.filter((key): key is core_AccessKey.AccessKey => {
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
 * Waits for the store to finish hydrating from storage.
 *
 * Returns immediately if the store has already hydrated. Otherwise, waits
 * for the `onFinishHydration` callback with a 100ms safety timeout fallback.
 */
export async function waitForHydration(store: Store): Promise<void> {
  if (store.persist.hasHydrated()) return
  await new Promise<void>((resolve) => {
    store.persist.onFinishHydration(() => resolve())
    setTimeout(() => resolve(), 100)
  })
}
