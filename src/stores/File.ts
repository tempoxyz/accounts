/**
 * A store in one JSON file of the user's, such as a CLI's session, as `Store.file` returns it.
 * @module
 */
import * as Broadcast from '../internal/Broadcast.js'
import * as Expiry from '../internal/Expiry.js'
import * as Node from '../internal/Node.js'
import * as StoreValue from '../internal/StoreValue.js'
import type * as Store from '../Store.js'

/**
 * Thrown by a read or a write of `Store.file` for a file that holds no valid JSON or no JSON
 * object, such as after a hand edit. Its message names the path and the fix, and quotes none of the
 * file, since the file holds tokens. The parser's own error quotes the text around the fault, which
 * can hold a token, so this error has no `cause`. Remove the file, and sign in again.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts'
 *
 * await accounts.signOut().catch((error: unknown) => {
 *   if (error instanceof Store.InvalidFileError) console.error(error.message)
 * })
 * ```
 */
export class InvalidFileError extends Error {
  override readonly name = 'Store.InvalidFileError'

  constructor(options: { path: string }) {
    super(
      `Invalid file: ${options.path} holds no valid JSON. Remove the file, and sign in again.`,
    )
  }
}

/** Thrown inside `Store.file` when another process took over a write's lock, which then runs again. */
class LockLostError extends Error {
  override readonly name = 'Store.LockLostError'
}

/**
 * Thrown by `Store.file` at creation in a runtime without Node's built-in modules, which is one
 * without `process.getBuiltinModule`, such as a browser or React Native, and in a Cloudflare
 * Worker, whose `node:fs` keeps each file in the memory of one isolate. Run the program in Node,
 * Bun, or Deno, or use another store, such as `Store.workersKv` or a Durable Object in a Worker.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts'
 *
 * try {
 *   Store.file('~/.config/my-cli/session.json')
 * } catch (error) {
 *   if (error instanceof Store.NodeRequiredError) console.error(error.message)
 * }
 * ```
 */
export class NodeRequiredError extends Error {
  override readonly name = 'Store.NodeRequiredError'

  constructor() {
    super(
      'Invalid runtime: the runtime has no file system that persists. Run the program in Node, or use another store.',
    )
  }
}

/**
 * Returns a store in one JSON file of the user's, such as a CLI's session.
 *
 * Without `path`, the file is the one that every CLI of the user shares: `id/store.json` in the
 * folder that the `TEMPO_HOME` environment variable names, or else `~/.tempo/id/store.json`. Each
 * instance saves its session under its own deployment, client ID, and chain, so the file holds the
 * sessions of several CLIs. An instance with a `cli:` client ID and no `store` uses that file with
 * no option. A CLI with a registered client ID passes `Store.file()` to `Accounts.create`, since
 * outside a browser, any other instance holds a session only with a store.
 *
 * Each write replaces the file atomically with mode `0600`, in a folder with mode `0700`, so a
 * crash leaves the earlier file and no other user reads it. Writes run in order. Each write reads
 * and replaces the file while it holds a lock file beside it, `<path>.lock`, so the writes of
 * several processes, such as two runs of a CLI, never overwrite each other. A lock older than 10
 * seconds belongs to a process that ended without releasing it, and the next write removes it. Each
 * write renames a temporary file beside the file, `<path>.<uuid>.tmp`, over it, and a failed write
 * removes that file. If a process ends before its rename, such as at a crash, the next write removes
 * its temporary file once it is older than 10 seconds, since it holds the tokens. Each value is
 * stored as ox's `Json`, so a `bigint` survives. A read skips an expired entry, and a
 * write deletes the expired entries. A removal of an absent entry, and a write of the value and
 * expiry that an entry holds, such as a second sign-out's, write nothing, and create no file or
 * folder. `takeItem` reads and deletes an entry under the lock, so of several processes on
 * the file, one takes each value. `lock` holds a lock file of its key beside the file,
 * `<path>.<SHA-256 of the key>.lock`, so the instances of several processes on the file send one
 * refresh. The hold renews the lock file for at most 30 seconds, so a slow refresh keeps it. The
 * lock of a crashed or stalled process goes to the next process 10 seconds after its last renewal.
 * `connect` delivers each saved change to the other instances of the process on the file, also
 * through another store of its path, so a sign-out empties their sessions at once. Another process
 * reads the sign-out only from the file.
 *
 * A path that starts with `~/` starts in the user's home directory. The first write creates the
 * file and its folders. Keep the file in the user's own folder, since it holds a refresh token and
 * an access key's private key.
 *
 * The Node modules load through `process.getBuiltinModule`, with no import, so each bundler builds a
 * browser bundle without them. In a runtime without them, such as a browser, the call throws, so the
 * instance never runs without its store. In a Cloudflare Worker, `node:fs` writes to the memory of
 * one isolate, which other isolates never read and an eviction drops, so the call throws there too.
 *
 * @throws {InvalidFileError} When a read or a write finds a file that holds no valid JSON object.
 * @throws {NodeRequiredError} When the runtime has no file system that persists, such as a browser
 *   or a Cloudflare Worker.
 * @throws {TypeError} From `setItem`, for a value that holds a `CryptoKey`, which JSON keeps as `{}`. The
 *   write takes no lock and leaves the file as it was.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { device } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   clientId: 'tempo-cli',
 *   plugins: [device({ onCode })],
 *   store: Store.file(),
 * })
 * ```
 */
export function create(path?: string): Store.Store {
  // An instance reads a failed store read as no session. A page with this store thus restores no
  // session, and its sign-in fails only at the save, after Tempo ID spent the code.
  const { Os, Path } = node()
  // Tempo's own CLIs resolve their folder the same way, so one variable moves each file of theirs.
  const file =
    path ??
    Path.join(
      Node.env('TEMPO_HOME') ?? Path.join(Os.homedir(), '.tempo'),
      'id',
      'store.json',
    )

  // Writes run in order, so a later write never lands before an earlier one.
  let pending: Promise<unknown> = Promise.resolve()

  /** Reads the file's entries, or none for a file that does not exist. */
  async function read(): Promise<Record<string, Expiry.Entry<unknown>>> {
    const { Fs } = node()
    const target = resolve()
    const text = await Fs.readFile(target, 'utf8').catch((error: unknown) => {
      if ((error as { code?: unknown }).code === 'ENOENT') return undefined
      throw error
    })
    if (text === undefined) return {}

    const entries = (() => {
      try {
        return StoreValue.decode(text)
      } catch {
        return undefined
      }
    })()
    // A value that parses but is no object, such as `null` or `[]`, would lose each write.
    if (
      typeof entries !== 'object' ||
      entries === null ||
      Array.isArray(entries)
    )
      throw new InvalidFileError({ path: target })
    return entries as Record<string, Expiry.Entry<unknown>>
  }

  /** Returns the path, with `~/` in place of the user's home directory. */
  function resolve() {
    if (!file.startsWith('~/')) return file
    const { Os, Path } = node()
    return Path.join(Os.homedir(), file.slice(2))
  }

  /**
   * Applies `fn` to the entries after every earlier write, and writes the file. The read and the
   * write hold the file's lock, so a write of another process, such as a second run of a CLI, never
   * lands between them and is never lost. A write that `options.skip` finds without effect on the
   * entries before the lock takes no lock, writes no file, and returns `undefined`. It still removes
   * the temporary files older than the stale lock, which can hold tokens. Returns the
   * result of `fn`, or `undefined` if another process took the lock over before the rename.
   */
  function update<value>(
    fn: (entries: Record<string, Expiry.Entry<unknown>>) => value,
    options: update.Options = {},
  ): Promise<value | undefined> {
    const next = pending
      .catch(() => undefined)
      .then(async () => {
        if (options.skip?.(await read())) {
          // A temporary file of a process that ended before its rename can hold a new refresh
          // token, so a skipped write, such as a second sign-out, removes it as a write does.
          await sweep(resolve())
          return undefined
        }
        const { Fs, Path } = node()
        const target = resolve()
        await Fs.mkdir(Path.dirname(target), { mode: 0o700, recursive: true })
        return await locked(target, async (check) => {
          const [entries] = await Promise.all([read(), sweep(target)])
          const result = fn(entries)
          for (const [key, entry] of Object.entries(entries))
            if (Expiry.expired(entry)) delete entries[key]
          // A rename replaces the file in one step, so a reader sees the earlier file or the new one.
          const temporary = `${target}.${crypto.randomUUID()}.tmp`
          const text = StoreValue.stringify(entries)
          // A failed write or rename removes the temporary file, which holds the tokens. A process
          // that paused past the stale lock can find its file removed by the new owner's sweep, so
          // a failure after a lost lock runs the write again, as a failed check does.
          await (async () => {
            await Fs.writeFile(temporary, text, { mode: 0o600 })
            await check()
            await Fs.rename(temporary, target)
          })().catch(async (error: unknown) => {
            await Fs.rm(temporary, { force: true }).catch(() => undefined)
            await check()
            throw error
          })
          // A process that took the lock over between the check and the rename read the earlier
          // file, and can return the same value, so this process returns `undefined` instead.
          return await check().then(
            () => result,
            () => undefined,
          )
        })
      })
    pending = next
    return next
  }

  return {
    // The instances of the process on the file hear each saved change of each other, also through
    // another store of its path, so a sign-out empties their sessions at once.
    connect(key, listener) {
      const { Path } = node()
      const target = Path.resolve(resolve())
      const connect = connections.get(target) ?? Broadcast.create()
      connections.set(target, connect)
      return connect(key, listener)
    },
    async getItem(key) {
      await pending.catch(() => undefined)
      const entry = (await read())[key]
      if (!entry || Expiry.expired(entry)) return undefined
      return entry.value
    },
    json: true,
    // Each process holds its own Web Locks, so the processes on the file, such as two runs of a CLI,
    // order their refreshes through a lock file of the key, and rotate a refresh token once.
    async lock(key, fn) {
      const { Fs, Path } = node()
      // The hold awaits `fn`, which can change the working directory, so the lock file of a
      // relative path is resolved once, and its release removes the same file.
      const target = Path.resolve(resolve())
      await Fs.mkdir(Path.dirname(target), { mode: 0o700, recursive: true })
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
      )
      const hash = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      return await locked(`${target}.${hash}`, () => fn(), { renew: true })
    },
    removeItem: (key) =>
      update(
        (entries) => {
          delete entries[key]
        },
        // A removal of an absent entry changes nothing, such as a sign-in's removal of the
        // signed-out mark, which a first run of a CLI never wrote.
        { skip: (entries) => !(key in entries) },
      ),
    // The file has mode `0600` in a folder with mode `0700`, so only its user reads a private key in it.
    private: true,
    async setItem(key, value, options = {}) {
      // JSON keeps a non-extractable `CryptoKey` as `{}`, which signs nothing after a restore, so such a
      // value rejects before the lock, and the file keeps its entries.
      StoreValue.stringify(value)
      await update(
        (entries) => {
          entries[key] = { expiresAt: options.expiresAt, value }
        },
        // A write of the value and expiry that a live entry holds changes nothing, such as the
        // signed-out mark and the empty session of a second sign-out. The comparison reads the value
        // when the queued write runs, as the write does, so a change after the call persists.
        {
          skip: (entries) => {
            const entry = entries[key]
            return (
              !!entry &&
              !Expiry.expired(entry) &&
              entry.expiresAt === options.expiresAt &&
              StoreValue.stringify(entry.value) === StoreValue.stringify(value)
            )
          },
        },
      )
    },
    // A write that another process overtakes runs `fn` again on the new entries. A write whose lock
    // another process took over before the rename returns `undefined`. So at most one process
    // receives the value.
    takeItem: (key) =>
      update(
        (entries) => {
          const entry = entries[key]
          delete entries[key]
          if (!entry || Expiry.expired(entry)) return undefined
          return entry.value
        },
        { skip: (entries) => !(key in entries) },
      ),
  }
}

declare namespace update {
  type Options = {
    /**
     * Returns `true` for entries that the write leaves unchanged, such as a removal of an absent
     * entry, so the write takes no lock and writes no file. Absent, every write replaces the file.
     */
    skip?:
      | ((entries: Record<string, Expiry.Entry<unknown>>) => boolean)
      | undefined
  }
}

/**
 * Returns the Node modules that `Store.file` uses, or throws {@link NodeRequiredError} in a runtime
 * without them.
 */
function node() {
  const modules = Node.modules()
  if (!modules) throw new NodeRequiredError()
  return modules
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
  options: locked.Options = {},
): Promise<value> {
  const { Fs } = node()
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
      // A hold that renews its lock, such as a refresh, can outlast `staleLock`. Its lock's age
      // restarts while the hold runs, for at most `lease`, so no other process takes over a live
      // hold, and a stalled or crashed hold releases the lock to the next process.
      const acquiredAt = Date.now()
      const renewal = options.renew
        ? setInterval(() => {
            if (Date.now() - acquiredAt > lease) return
            void owned()
              .then(async (held) => {
                if (!held) return
                const now = new Date()
                await Fs.utimes(lock, now, now)
              })
              // A failed renewal leaves the lock, which goes stale after `staleLock`.
              .catch(() => undefined)
          }, staleLock / 4)
        : undefined
      try {
        return await fn(async () => {
          if (!(await owned())) throw new LockLostError()
        })
      } catch (error) {
        if (error instanceof LockLostError) continue
        throw error
      } finally {
        clearInterval(renewal)
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
    // A renewed lock goes stale at most `staleLock` after its `lease`, so its waiter waits longer.
    if (Date.now() - started > (options.renew ? lease : 0) + 2 * staleLock)
      throw new Error(
        `Timed out on the lock of ${target}. Remove ${lock} if no other process uses the file.`,
      )
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

declare namespace locked {
  type Options = {
    /**
     * Whether the hold restarts the lock's age while it runs, for at most `lease`, so a hold
     * longer than `staleLock` keeps the lock. A waiting process waits `lease` longer. Defaults
     * to `false`.
     */
    renew?: boolean | undefined
  }
}

/**
 * Removes the stale lock whose token is `options.token`. The rename moves one file in one step, so
 * of two processes that found the lock stale, only one moves it. A lock that another process created
 * since holds another token, so it goes back in place.
 */
async function takeOver(lock: string, options: takeOver.Options) {
  const { Fs } = node()
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

/**
 * Removes each temporary file of `target` older than {@link staleLock}, which a write that ended
 * before its rename left, such as at a crash. Each holds the tokens and private keys of the file. The
 * caller holds the lock, so a newer file belongs to a process that lost its lock, and stays. A process
 * that paused past the stale lock runs its write again once its file is gone. A file that the sweep
 * cannot remove stays, and fails no write.
 */
async function sweep(target: string) {
  const { Fs, Path } = node()
  const folder = Path.dirname(target)
  const names = await Fs.readdir(folder).catch(() => [])
  const prefix = `${Path.basename(target)}.`
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith(prefix) &&
          temporaryName.test(name.slice(prefix.length)),
      )
      .map(async (name) => {
        const file = Path.join(folder, name)
        const stat = await Fs.stat(file).catch(() => undefined)
        if (stat && Date.now() - stat.mtimeMs > staleLock)
          // A file that stays, such as one that another program holds open, fails no write.
          await Fs.rm(file, { force: true }).catch(() => undefined)
      }),
  )
}

/** The suffix of a temporary file of `Store.file` after the file's name: a UUID and `.tmp`. */
const temporaryName =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.tmp$/

/**
 * The `connect` of each file of the process, by its absolute path, so the stores of one path share
 * it. A file belongs to the whole device, and no instance owns it.
 */
const connections = new Map<string, NonNullable<Store.Store['connect']>>()

/**
 * Milliseconds that a hold of `lock` renews its lock file, as the lease of `Store.redis`. A hold
 * that runs longer loses the lock `staleLock` later, so a stalled refresh blocks no process forever.
 */
const lease = 30_000

/** The age in milliseconds after which a lock of `Store.file` is stale. A write holds it for less. */
const staleLock = 10_000
