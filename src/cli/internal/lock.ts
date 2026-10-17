import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
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
 * description of each remaining holder.
 */
async function reclaim(path: string, stale: number): Promise<readonly string[]> {
  const names = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    return undefined
  })
  if (!names) return ['an unknown owner']
  const holders: string[] = []
  for (const name of names) {
    if (!(await isStale(join(path, name), stale))) {
      holders.push(/^\d+-/.test(name) ? `process ${name.split('-')[0]}` : name)
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
 * `stale` milliseconds. Entries of other threads of this process, and names that are
 * not owner tokens, only go stale by age.
 */
async function isStale(path: string, stale: number, name = basename(path)): Promise<boolean> {
  const match = /^(\d+)-(\d+)-[0-9a-f]+$/.exec(name)
  if (match) {
    const pid = Number(match[1])
    if (pid === process.pid && Number(match[2]) === threadId) return !owners.has(name)
    if (pid !== process.pid && !running(pid)) return true
  }
  const info = await stat(path).catch(() => undefined)
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
