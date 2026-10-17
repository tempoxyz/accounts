import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** Owner entries this process has created and not yet released. */
const owners = new Set<string>()

/** `rename` errors that mean the lock directory already exists. */
const contended = new Set(['EACCES', 'EEXIST', 'ENOTDIR', 'ENOTEMPTY', 'EPERM'])

/**
 * Runs `fn` while holding an exclusive cross-process lock on `path`.
 *
 * The lock is a directory at `<path>.lock` holding one entry named after its
 * owner (`<pid>-<random>`). A writer builds its own directory with its entry
 * inside, then renames it into place. The rename only succeeds while
 * `<path>.lock` is absent or empty, so a held lock, which always holds its
 * owner's entry, can't be taken.
 *
 * A writer that finds the lock held by a process that no longer exists
 * deletes that owner's entry by name, then the empty directory. Entry names
 * are never reused, so this can only ever delete the dead owner's entry, and
 * `rmdir` refuses a directory that another writer has meanwhile filled. No
 * live holder's lock is ever deleted. This relies on every writer sharing one
 * process ID namespace.
 *
 * Waits up to `timeout` for a live holder, then throws {@link TimeoutError}.
 */
export async function lock<value>(
  path: string,
  fn: () => Promise<value>,
  options: lock.Options = {},
): Promise<value> {
  const { timeout = 10_000 } = options
  const path_lock = `${path}.lock`
  const owner = `${process.pid}-${randomBytes(8).toString('hex')}`
  const deadline = Date.now() + timeout

  owners.add(owner)
  try {
    while (!(await acquire(path_lock, owner))) {
      const holders = await reclaim(path_lock)
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
    await unlink(join(path_lock, owner)).catch(() => undefined)
    await rmdir(path_lock).catch(() => undefined)
    owners.delete(owner)
  }
}

export declare namespace lock {
  /** Options for {@link lock}. */
  type Options = {
    /** Milliseconds to wait for a live holder to release the lock. @default 10_000 */
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
 * staged directory only exists for the attempt, so a process killed while it
 * waits leaves nothing behind.
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
 * Deletes the entries of owners that no longer exist from the lock directory,
 * and returns a description of each remaining holder.
 */
async function reclaim(path: string): Promise<readonly string[]> {
  const names = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    return undefined
  })
  if (!names) return ['an unknown owner']
  const holders: string[] = []
  for (const name of names) {
    const pid = Number(name.split('-')[0])
    if (alive(name, pid)) holders.push(Number.isSafeInteger(pid) ? `process ${pid}` : name)
    else await unlink(join(path, name)).catch(() => undefined)
  }
  return holders
}

/** Returns whether the owner of a lock entry may still exist. Unknown entries count as live. */
function alive(name: string, pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  if (pid === process.pid) return owners.has(name)
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
