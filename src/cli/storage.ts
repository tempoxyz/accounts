import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Json } from 'ox'

import * as Storage from '../core/Storage.js'
import { lock } from './internal/lock.js'

const mode_directory = 0o700
const mode_file = 0o600
const operations = new Map<string, Promise<void>>()

/**
 * Merge hints the provider store attaches to each persisted state under this
 * symbol (see `Store.create`). Like any symbol key, it is never written.
 */
const hints_key = Symbol.for('accounts.store.merge')

/** Identity of each record in the provider store's collections. */
const identities = {
  accessKeys: (key: unknown) =>
    [field(key, 'access'), field(key, 'address'), field(key, 'chainId')].join(':'),
  accounts: (account: unknown) => field(account, 'address'),
}

/** Returns the default CLI provider storage path. */
export function defaultPath(): string {
  return join(homedir(), '.tempo', 'wallet', 'store.json')
}

/**
 * Creates a filesystem-backed storage adapter for CLI provider state.
 *
 * Several processes can share the file. Each write takes an exclusive lock on
 * the file, re-reads it, and merges in only what this adapter changed since it
 * last read or wrote the item, so a write never undoes another process's
 * change made in the meantime. A provider store item merges per state field,
 * and its `accounts` and `accessKeys` merge per record. A disconnect replaces
 * what it clears instead, so accounts and keys another process added are
 * cleared too, and the store's `maxAccounts` still holds. When no other
 * process has written the file, a write stores exactly the given value, and a
 * write from an adapter that has not read or written the item replaces it.
 *
 * The lock is a `<path>.lock` directory, held only for the read, merge, and
 * write. A writer takes it over from a process that has exited, or once it is
 * 30 seconds old, and gives up after 35 seconds.
 */
export function filesystem(options: filesystem.Options = {}): Storage.Storage {
  const path = expandPath(options.path ?? defaultPath())
  // Each item as this adapter last read or wrote it: the base a write merges against.
  const bases = new Map<string, unknown>()

  function enqueue<value>(fn: () => Promise<value>): Promise<value> {
    const operation = operations.get(path) ?? Promise.resolve()
    const next = operation.then(fn, fn)
    const done = next.then(
      () => undefined,
      () => undefined,
    )
    operations.set(path, done)
    void done.then(() => {
      if (operations.get(path) === done) operations.delete(path)
    })
    return next
  }

  return Storage.from(
    {
      async getItem<value>(name: string): Promise<value | null> {
        return await enqueue(async () => {
          const value = (await read(path))[name] ?? null
          bases.set(name, structuredClone(value))
          return value as value | null
        })
      },
      async removeItem(name) {
        await enqueue(async () => {
          await update(path, (value) => {
            delete value[name]
          })
          bases.set(name, null)
        })
      },
      async setItem(name, item) {
        const hints = isItem(item)
          ? ((item.state as Record<symbol, unknown>)[hints_key] as merge.Hints | undefined)
          : undefined
        // The value as it reads back from the file, so it compares equal to what other writes leave.
        const next = typeof item === 'undefined' ? item : Json.parse(Json.stringify(item))
        await enqueue(async () => {
          await update(path, (value) => {
            // An item this adapter never read or wrote has no base to merge against: replace it.
            value[name] = bases.has(name)
              ? merge(bases.get(name), value[name] ?? null, next, hints)
              : next
          })
          bases.set(name, next)
        })
      },
    },
    { key: options.key ?? 'tempo-cli' },
  )
}

export declare namespace filesystem {
  /** Options for {@link filesystem}. */
  type Options = {
    /** Storage key prefix. @default "tempo-cli" */
    key?: string | undefined
    /** JSON file path. @default "~/.tempo/wallet/store.json" */
    path?: string | undefined
  }
}

class FilesystemStorageError extends Error {
  override cause?: unknown | undefined
  path: string

  constructor(path: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'FilesystemStorageError'
    this.cause = cause
    this.path = path
  }
}

async function ensureDirectory(path: string) {
  const dir = dirname(path)
  const created = await mkdir(dir, { mode: mode_directory, recursive: true })
  if (created) await chmod(dir, mode_directory)
}

async function read(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new FilesystemStorageError(path, `Failed to read CLI storage file at ${path}.`, error)
  }

  const value = (() => {
    try {
      return Json.parse(text)
    } catch (error) {
      throw new FilesystemStorageError(
        path,
        `Failed to parse CLI storage file at ${path}. The file is not valid JSON.`,
        error,
      )
    }
  })()

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FilesystemStorageError(
      path,
      `Failed to parse CLI storage file at ${path}. The file is not a JSON object.`,
    )

  try {
    await chmod(path, mode_file)
  } catch (error) {
    throw new FilesystemStorageError(path, `Failed to secure CLI storage file at ${path}.`, error)
  }

  return value as Record<string, unknown>
}

/** Re-reads the file, applies `fn`, and writes the result, all under the file's lock. */
async function update(path: string, fn: (value: Record<string, unknown>) => void) {
  await ensureDirectory(path)
  await lock(path, async () => {
    const value = await read(path)
    fn(value)
    await write(path, value)
  })
}

/**
 * Applies the changes `next` makes to `base` onto `current`, the item as the
 * file holds it now. `base` is the item as this adapter last read or wrote it.
 *
 * If `current` still equals `base`, or the item is not a provider store item
 * (`{ state, version }`) of the same version, `next` is stored as given.
 * Otherwise state fields merge by these rules, so the latest explicit intent
 * wins and ordinary writes only apply what they changed:
 *
 * 1. Resets win. Fields a disconnect or `accessKeys.clear()` resets
 *    (`hints.replace`) are stored as `next` has them, clearing records any
 *    other process added.
 * 2. Scalars merge three-way. A field `next` left as `base` had it keeps
 *    `current`'s value, including `current` having removed it (a missing field
 *    is a removed field). A field `next` changed or removed takes `next`'s, so
 *    when both changed it, the later write wins.
 * 3. `accounts` and `accessKeys` merge per record by identity. A record `next`
 *    added (absent from `base`) is stored, first. A record `next` changed takes
 *    `next`'s version in place, and one it removed is removed. A record that
 *    was in `base` but that another process removed stays removed, even if
 *    `next` changed it.
 * 4. A connect asserts its accounts (`hints.connect`): they are stored, first,
 *    even if another process removed them or logged out meanwhile.
 * 5. The active account is resolved by address. When `next` changed the
 *    selection or is a connect, its selected account stays selected if
 *    stored; otherwise `current`'s selection stays if stored, else `next`'s.
 *    The index is `0` only when neither account is stored.
 * 6. `auth` belongs to the selected login: when `next`'s selection is kept
 *    because `next` changed it or connected, `next`'s `auth` is stored.
 * 7. Past `hints.maxAccounts`, the oldest (last) accounts are evicted, never
 *    the active one.
 */
function merge(base: unknown, current: unknown, next: unknown, hints: merge.Hints = {}): unknown {
  if (isDeepStrictEqual(current, base) || !isItem(next)) return next
  if (current !== null && (!isItem(current) || current.version !== next.version)) return next
  const { connect, maxAccounts, replace = [] } = hints
  const state_base = isItem(base) ? base.state : {}
  const state_current = isItem(current) ? current.state : {}
  const state: Record<string, unknown> = {}
  const keys = new Set([
    ...Object.keys(next.state),
    ...Object.keys(state_current),
    ...Object.keys(state_base),
  ])
  for (const key of keys) {
    const value = replace.includes(key)
      ? next.state[key]
      : mergeField(key, state_base[key], state_current[key], next.state[key])
    if (typeof value !== 'undefined') state[key] = value
  }
  if (typeof next.state.activeAccount !== 'number' || replace.includes('activeAccount'))
    return { ...next, state }

  const ids_connect = new Set((connect ?? []).map((address) => address.toLowerCase()))
  const ids_merged = new Set(list(state.accounts).map(identities.accounts))
  const asserted = list(next.state.accounts).filter((account) => {
    const id = identities.accounts(account)
    return ids_connect.has(id) && !ids_merged.has(id)
  })
  const accounts = [...asserted, ...list(state.accounts)]

  const selected = activeAddress(next.state)
  const ours = !!connect || selected !== activeAddress(state_base)
  const indexOf = (address: string | undefined) =>
    accounts.findIndex((account) => identities.accounts(account) === address)
  const candidates = ours
    ? [selected, activeAddress(state_current)]
    : [activeAddress(state_current), selected]
  const active = candidates.find((address) => indexOf(address) !== -1)
  const activeAccount = Math.max(indexOf(active), 0)

  if (ours && active === selected && !replace.includes('auth')) {
    delete state.auth
    if (typeof next.state.auth !== 'undefined') state.auth = next.state.auth
  }
  if (maxAccounts && accounts.length > maxAccounts) {
    const kept = activeAccount < maxAccounts ? maxAccounts : maxAccounts - 1
    state.accounts = accounts.filter((_, i) => i === activeAccount || i < kept)
    state.activeAccount = Math.min(activeAccount, kept)
  } else Object.assign(state, { accounts, activeAccount })
  return { ...next, state }
}

declare namespace merge {
  /** Hints from the provider store on how to merge its persisted state. */
  type Hints = {
    /** Addresses of the accounts this write connects. */
    connect?: readonly string[] | undefined
    /** Maximum number of accounts to store. */
    maxAccounts?: number | undefined
    /** State fields this write resets (e.g. a disconnect): stored as given, never merged. */
    replace?: readonly string[] | undefined
  }
}

function mergeField(key: string, base: unknown, current: unknown, next: unknown): unknown {
  if (isDeepStrictEqual(next, base)) return current
  if (isDeepStrictEqual(current, base)) return next
  if (!Array.isArray(next) || !Object.hasOwn(identities, key)) return next
  const identity = identities[key as keyof typeof identities]
  return mergeRecords(list(base), list(current), next, identity)
}

/**
 * Applies the records `next` adds, changes, and removes relative to `base` to
 * `current`. Changed records keep their place in `current`, and added records
 * come first, as the store adds new records. A record another process removed
 * stays removed, even if this process changed it.
 */
function mergeRecords(
  base: readonly unknown[],
  current: readonly unknown[],
  next: readonly unknown[],
  identity: (record: unknown) => string,
): unknown[] {
  const records_base = new Map(base.map((record) => [identity(record), record]))
  const records_next = new Map(next.map((record) => [identity(record), record]))
  const ids_current = new Set(current.map(identity))
  const changed = (id: string) =>
    records_next.has(id) && !isDeepStrictEqual(records_next.get(id), records_base.get(id))
  const added = next.filter(
    (record) => !records_base.has(identity(record)) && !ids_current.has(identity(record)),
  )
  const kept = current.flatMap((record) => {
    const id = identity(record)
    if (changed(id)) return [records_next.get(id)]
    if (records_base.has(id) && !records_next.has(id)) return []
    return [record]
  })
  return [...added, ...kept]
}

function activeAddress(state: Record<string, unknown>): string | undefined {
  const account = list(state.accounts)[state.activeAccount as number]
  if (typeof account === 'undefined') return undefined
  return identities.accounts(account)
}

function isItem(value: unknown): value is { state: Record<string, unknown>; version?: unknown } {
  if (!value || typeof value !== 'object') return false
  const { state } = value as { state?: unknown }
  return !!state && typeof state === 'object' && !Array.isArray(state)
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function field(record: unknown, key: string): string {
  if (!record || typeof record !== 'object') return ''
  return String((record as Record<string, unknown>)[key]).toLowerCase()
}

async function write(path: string, value: Record<string, unknown>) {
  await ensureDirectory(path)
  const path_temp = tempPath(path)
  const handle = await open(path_temp, 'wx', mode_file)

  try {
    await handle.writeFile(Json.stringify(value), 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(path_temp).catch(() => undefined)
    throw error
  }

  await handle.close()
  try {
    await chmod(path_temp, mode_file)
    await rename(path_temp, path)
    await chmod(path, mode_file)
  } catch (error) {
    await unlink(path_temp).catch(() => undefined)
    throw error
  }
}

function expandPath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function tempPath(path: string) {
  return `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}
