import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { threadId } from 'node:worker_threads'

/**
 * Owner tokens this thread holds or is acquiring. Shared by every copy of this
 * module loaded in the thread, so one copy never mistakes another's entry for
 * a dead owner's.
 */
const owners = ((globalThis as Record<symbol, Set<string> | undefined>)[
  Symbol.for('accounts.storage.lock')
] ??= new Set<string>())

/** Owner token: `<pid>-<threadId>-<random>`. */
const token = /^(\d+)-(\d+)-[0-9a-f]{16}$/

/** `rename` errors that mean the lock directory already exists. */
const contended = new Set(['EACCES', 'EEXIST', 'ENOTDIR', 'ENOTEMPTY', 'EPERM'])

/**
 * Runs `fn` while holding an exclusive cross-process lock on `path`. Keep `fn`
 * short: another writer may take over a lock held for over 30 seconds
 * (`stale`).
 *
 * The lock is a directory at `<path>.lock` holding one entry named after its
 * owner token (`<pid>-<threadId>-<random>`). A writer builds its own directory
 * with its entry inside, then renames it into place. The rename only succeeds
 * while `<path>.lock` is absent or empty, so a held lock, which always holds
 * its owner's entry, can't be taken.
 *
 * A waiting writer takes over an entry whose process no longer exists, or that
 * is older than 30 seconds (its process ID was reused, or its holder hung or
 * was suspended). It renames the entry out to a tombstone, deletes that, then
 * removes the empty directory. Owner tokens are never reused, so the rename can
 * only move the entry it inspected, and `rmdir` refuses a directory that
 * another writer has meanwhile filled. A holder suspended mid-write for over
 * 30 seconds can lose its write. That is the trade-off for never leaving every
 * later write failing until someone deletes the lock by hand.
 *
 * Waits up to `timeout`, by default 5 seconds past `stale` so that any
 * abandoned entry is taken over first, then throws {@link TimeoutError}.
 *
 * Only this user (or root) may be able to create entries next to `path`, or
 * another user could plant `<path>.lock`. The lock throws
 * {@link UnusableError} instead of waiting when the directory is writable by
 * every user or owned by another user, or when `<path>.lock` is not a
 * directory of this user's that holds only owner entries.
 */
export async function lock<value>(
  path: string,
  fn: () => Promise<value>,
  options: lock.Options = {},
): Promise<value> {
  // A waiter outlasts the stale bound, so an abandoned entry it cannot attribute to an exited
  // process (another thread's, or a reused process ID's) is taken over before the wait ends.
  const { stale = 30_000, timeout = stale + 5_000 } = options
  const path_lock = `${path}.lock`
  const owner = `${process.pid}-${threadId}-${randomBytes(8).toString('hex')}`
  const deadline = Date.now() + timeout

  owners.add(owner)
  try {
    await assertPrivate(dirname(path), path_lock)
    await prune(path_lock, stale)
    while (!(await acquire(path_lock, owner))) {
      const holders = await reclaim(path_lock, stale)
      if (holders.length === 0) await rmdir(path_lock).catch(() => undefined)
      if (Date.now() >= deadline) throw new TimeoutError(path_lock, holders, timeout)
      await sleep(10)
    }
  } catch (error) {
    owners.delete(owner)
    throw error
  }

  try {
    return await fn()
  } finally {
    await rm(join(path_lock, owner), { force: true }).catch(() => undefined)
    await rmdir(path_lock).catch(() => undefined)
    owners.delete(owner)
  }
}

export declare namespace lock {
  /** Options for {@link lock}. */
  type Options = {
    /**
     * Age in milliseconds past which an entry of a running process, or of
     * another thread of this one, is taken over. Holders keep the lock for one
     * read, merge, and write: milliseconds. @default 30_000
     */
    stale?: number | undefined
    /** Milliseconds to wait for the lock. @default stale + 5_000 */
    timeout?: number | undefined
  }
}

/** Thrown when a live process holds a lock for longer than the wait allows. */
export class TimeoutError extends Error {
  /** Lock directory. */
  path: string

  constructor(path: string, holders: readonly string[], timeout: number) {
    const held = holders.length > 0 ? `, held by ${holders.join(', ')}` : ''
    super(
      `Timed out after ${timeout}ms waiting for the lock at ${path}${held}. If no other process is using it, remove ${path}.`,
    )
    this.name = 'Lock.TimeoutError'
    this.path = path
  }
}

/** Thrown when a lock can't be used safely, so waiting for it would not help. */
export class UnusableError extends Error {
  /** Lock directory. */
  path: string

  constructor(path: string, reason: string) {
    super(`Cannot use the lock at ${path}: ${reason}.`)
    this.name = 'Lock.UnusableError'
    this.path = path
  }
}

/** Throws unless only this user (or root) can create entries in `directory`. */
async function assertPrivate(directory: string, path: string) {
  if (typeof process.getuid !== 'function') return
  const info = await stat(directory)
  if (info.mode & 0o002) throw new UnusableError(path, `${directory} is writable by every user`)
  if (info.uid !== process.getuid() && info.uid !== 0)
    throw new UnusableError(path, `${directory} is owned by another user`)
}

/**
 * Tries to install a lock directory holding `owner`'s entry at `path`. The
 * staged directory (`<path>.<owner>`) only exists during the attempt; one left
 * by a process killed mid-attempt is removed by {@link prune}.
 */
async function acquire(path: string, owner: string): Promise<boolean> {
  const staging = `${path}.${owner}`
  await mkdir(staging, { mode: 0o700 })
  try {
    await writeFile(join(staging, owner), '', { flag: 'wx', mode: 0o600 })
    await rename(staging, path)
    return true
  } catch (error) {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined)
    if (contended.has((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

/**
 * Takes over the stale entries of the lock directory at `path`, and returns a
 * description of each remaining holder. Throws {@link UnusableError} unless
 * `path` is a real directory of this user's holding only owner entries, so a
 * planted directory or symbolic link is never read or emptied.
 */
async function reclaim(path: string, stale: number): Promise<readonly string[]> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw new UnusableError(path, 'it cannot be inspected')
  })
  if (!info) return []
  if (!info.isDirectory()) throw new UnusableError(path, 'it is not a directory')
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new UnusableError(path, 'it is owned by another user')
  const names = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw new UnusableError(path, 'it cannot be read')
  })
  const holders: string[] = []
  for (const name of names) {
    if (!token.test(name)) throw new UnusableError(path, `it holds an unexpected entry, ${name}`)
    if (!(await isStale(join(path, name), stale))) {
      holders.push(`process ${name.split('-')[0]}`)
      continue
    }
    const tombstone = `${path}.${name}.${randomBytes(4).toString('hex')}.stale`
    await rename(join(path, name), tombstone)
      .then(() => rm(tombstone, { force: true }))
      .catch(() => undefined)
  }
  return holders
}

/**
 * Removes what stale owners left next to the lock directory at `path`: staged
 * directories (`<path>.<owner>`) and tombstones (`<path>.<owner>.<random>.stale`).
 */
async function prune(path: string, stale: number) {
  const prefix = `${basename(path)}.`
  const names = await readdir(dirname(path)).catch(() => [])
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const leftover = join(dirname(path), name)
    if (await isStale(leftover, stale, name.slice(prefix.length)))
      await rm(leftover, { force: true, recursive: true }).catch(() => undefined)
  }
}

/**
 * Returns whether the entry at `path`, named after an owner token, can be
 * taken over: its process no longer exists, or the entry is older than
 * `stale` milliseconds. Entries of other threads of this process, and names
 * that are not owner tokens, only go stale by age.
 */
async function isStale(path: string, stale: number, name = basename(path)): Promise<boolean> {
  const match = token.exec(name)
  if (match) {
    const pid = Number(match[1])
    if (pid === process.pid && Number(match[2]) === threadId) return !owners.has(name)
    if (pid !== process.pid && !running(pid)) return true
  }
  const info = await lstat(path).catch(() => undefined)
  return !!info && Date.now() - info.mtimeMs > stale
}

/** Returns whether a process with this ID exists. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
