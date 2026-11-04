/**
 * A store in one JSON file of the user's, such as a CLI's session, as `Store.file` returns it.
 * @module
 */
import { Json } from 'ox'
import * as Expiry from '../internal/Expiry.js'
import type * as Store from '../Store.js'

/** Thrown inside `Store.file` when another process took over a write's lock, which then runs again. */
class LockLostError extends Error {
  override readonly name = 'Store.LockLostError'
}

/**
 * Returns a store in one JSON file of the user's, such as a CLI's session. Each write replaces the
 * file atomically with mode `0600`, so a crash leaves the earlier file and no other user reads it.
 * Each write holds a lock file beside it, `<path>.lock`, so the writes of several processes, such
 * as two runs of a CLI, never overwrite each other. Each value is stored as ox's `Json`, so a `bigint` survives. A path that starts with `~/` starts in
 * the user's home directory. A read skips an expired entry, and a write deletes the expired entries.
 *
 * @example
 * ```ts
 * const store = Store.file('~/.config/my-cli/session.json')
 * ```
 */
export function create(path: string): Store.Store {
  // Writes run in order, so a later write never lands before an earlier one.
  let pending: Promise<void> = Promise.resolve()

  /** Reads the file's entries, or none for a file that does not exist. */
  async function read(): Promise<Record<string, Expiry.Entry<unknown>>> {
    // The Node modules load on first use, so a browser bundle holds none of them.
    const Fs = await import('node:fs/promises')
    try {
      return Json.parse(await Fs.readFile(await resolve(), 'utf8')) as Record<
        string,
        Expiry.Entry<unknown>
      >
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return {}
      throw error
    }
  }

  /** Returns the path, with `~/` in place of the user's home directory. */
  async function resolve() {
    if (!path.startsWith('~/')) return path
    const Os = await import('node:os')
    const Path = await import('node:path')
    return Path.join(Os.homedir(), path.slice(2))
  }

  /**
   * Applies `fn` to the entries after every earlier write, and writes the file. The read and the
   * write hold the file's lock, so a write of another process, such as a second run of a CLI, never
   * lands between them and is never lost.
   */
  function update(
    fn: (entries: Record<string, Expiry.Entry<unknown>>) => void,
  ) {
    const next = pending
      .catch(() => undefined)
      .then(async () => {
        const Fs = await import('node:fs/promises')
        const Path = await import('node:path')
        const target = await resolve()
        await Fs.mkdir(Path.dirname(target), { mode: 0o700, recursive: true })
        await locked(target, async (check) => {
          const entries = await read()
          fn(entries)
          for (const [key, entry] of Object.entries(entries))
            if (Expiry.expired(entry)) delete entries[key]
          // A rename replaces the file in one step, so a reader sees the earlier file or the new one.
          const temporary = `${target}.${crypto.randomUUID()}.tmp`
          await Fs.writeFile(temporary, Json.stringify(entries), {
            mode: 0o600,
          })
          await check().catch(async (error: unknown) => {
            await Fs.rm(temporary, { force: true })
            throw error
          })
          await Fs.rename(temporary, target)
        })
      })
    pending = next
    return next
  }

  return {
    async getItem(key) {
      await pending.catch(() => undefined)
      const entry = (await read())[key]
      if (!entry || Expiry.expired(entry)) return undefined
      return entry.value
    },
    removeItem: (key) =>
      update((entries) => {
        delete entries[key]
      }),
    setItem: (key, value, options = {}) =>
      update((entries) => {
        entries[key] = { expiresAt: options.expiresAt, value }
      }),
  }
}

/**
 * Runs `fn` while this process holds the lock of the file at `target`: a file beside it, which an
 * exclusive create makes in one step, and which holds a token of its owner. `fn` calls `check`
 * before it replaces the file, which throws {@link LockLostError} when another process took the
 * lock over, and the write then runs again. A lock older than {@link staleLock} belongs to a process
 * that ended before it released it, so another process takes it over.
 */
async function locked<value>(
  target: string,
  fn: (check: () => Promise<void>) => Promise<value>,
): Promise<value> {
  const Fs = await import('node:fs/promises')
  const lock = `${target}.lock`
  const started = Date.now()

  while (true) {
    const token = crypto.randomUUID()
    const acquired = await Fs.writeFile(lock, token, {
      flag: 'wx',
      mode: 0o600,
    }).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 'EEXIST') return false
        throw error
      },
    )

    if (acquired) {
      const owned = async () =>
        (await Fs.readFile(lock, 'utf8').catch(() => undefined)) === token
      try {
        return await fn(async () => {
          if (!(await owned())) throw new LockLostError()
        })
      } catch (error) {
        if (error instanceof LockLostError) continue
        throw error
      } finally {
        // A lock that another process took over is that process's own.
        if (await owned()) await Fs.rm(lock, { force: true })
      }
    }

    // One handle reads the lock's age and its token, so both belong to one file, also when another
    // process replaces the lock between the two reads.
    const stale = await (async () => {
      const handle = await Fs.open(lock, 'r').catch(() => undefined)
      if (!handle) return undefined
      try {
        const stat = await handle.stat()
        if (Date.now() - stat.mtimeMs <= staleLock) return undefined
        return await handle.readFile('utf8')
      } catch {
        return undefined
      } finally {
        await handle.close()
      }
    })()
    if (stale !== undefined) {
      await takeOver(lock, { token: stale })
      continue
    }
    if (Date.now() - started > 2 * staleLock)
      throw new Error(
        `Timed out on the lock of ${target}. Remove ${lock} if no other process uses the file.`,
      )
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * Removes the stale lock whose token is `options.token`. The rename moves one file in one step, so
 * of two processes that found the lock stale, only one moves it. A lock that another process created
 * since holds another token, so it goes back in place.
 */
async function takeOver(lock: string, options: takeOver.Options) {
  const Fs = await import('node:fs/promises')
  const moved = `${lock}.${crypto.randomUUID()}`
  const renamed = await Fs.rename(lock, moved).then(
    () => true,
    () => false,
  )
  if (!renamed) return
  if (
    (await Fs.readFile(moved, 'utf8').catch(() => undefined)) !== options.token
  )
    // A link fails when a third process holds the lock already. Its owner's check then fails.
    await Fs.link(moved, lock).catch(() => undefined)
  await Fs.rm(moved, { force: true })
}

declare namespace takeOver {
  type Options = {
    /** The token that the stale lock held when the process found it stale. */
    token: string
  }
}

/** The age in milliseconds after which a lock of `Store.file` is stale. A write holds it for less. */
const staleLock = 10_000
