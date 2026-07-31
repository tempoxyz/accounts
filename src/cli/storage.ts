import * as Koffi from 'koffi'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { Json } from 'ox'

import * as Storage from '../core/Storage.js'

const mode_directory = 0o700
const mode_file = 0o600
const operations = new Map<string, Promise<void>>()
const lock_exclusive = 2
const lock_nonblocking = 4
const lock_unlock = 8
const lock_retry_ms = 10

let flock_: ((fd: number, operation: number) => number) | undefined

/** Returns the default CLI provider storage path. */
export function defaultPath(): string {
  return join(homedir(), '.tempo', 'wallet', 'store.json')
}

/** Creates a filesystem-backed storage adapter for CLI provider state. */
export function filesystem(options: filesystem.Options = {}): Storage.Storage {
  const path = expandPath(options.path ?? defaultPath())

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
    Storage.withUpdate(
      {
        async getItem<value>(name: string): Promise<value | null> {
          return await enqueue(async () => {
            const value = await read(path)
            return (value[name] as value | undefined) ?? null
          })
        },
        async removeItem(name) {
          await enqueue(async () => {
            await withLock(path, async () => {
              const value = await read(path)
              delete value[name]
              await write(path, value)
            })
          })
        },
        async setItem(name, item) {
          await enqueue(async () => {
            await withLock(path, async () => {
              const value = await read(path)
              value[name] = item
              await write(path, value)
            })
          })
        },
      },
      async <value>(name: string, update: (value: value | null) => value) => {
        await enqueue(async () => {
          await withLock(path, async () => {
            const value = await read(path)
            value[name] = update((value[name] as value | undefined) ?? null)
            await write(path, value)
          })
        })
      },
    ),
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
  await mkdir(dir, { mode: mode_directory, recursive: true })
  await chmod(dir, mode_directory)
}

async function withLock<value>(path: string, fn: () => Promise<value>): Promise<value> {
  await ensureDirectory(path)
  const path_lock = `${path}.lock`
  const handle = await open(path_lock, 'a+', mode_file)
  try {
    await chmod(path_lock, mode_file)
    await lock(handle.fd, path_lock)
    try {
      return await fn()
    } finally {
      await unlock(handle.fd, path_lock)
    }
  } finally {
    await handle.close()
  }
}

async function lock(fd: number, path: string): Promise<void> {
  for (;;) {
    const result = flock()(fd, lock_exclusive | lock_nonblocking)
    if (result === 0) return
    const errno = Koffi.errno()
    if (errno !== Koffi.os.errno.EAGAIN && errno !== Koffi.os.errno.EWOULDBLOCK)
      throw new FilesystemStorageError(path, `Failed to acquire CLI storage lock (errno ${errno}).`)
    await setTimeout(lock_retry_ms)
  }
}

async function unlock(fd: number, path: string): Promise<void> {
  if (flock()(fd, lock_unlock) === 0) return
  const errno = Koffi.errno()
  throw new FilesystemStorageError(path, `Failed to release CLI storage lock (errno ${errno}).`)
}

function flock(): (fd: number, operation: number) => number {
  if (flock_) return flock_
  if (process.platform !== 'darwin' && process.platform !== 'linux')
    throw new FilesystemStorageError(
      '',
      `CLI storage locking is not supported on ${process.platform}.`,
    )
  const library = Koffi.load(
    process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
  )
  flock_ = library.func('flock', 'int', ['int', 'int']) as unknown as (
    fd: number,
    operation: number,
  ) => number
  return flock_
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
