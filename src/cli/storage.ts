import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Json } from 'ox'

import * as Storage from '../core/Storage.js'

const mode_directory = 0o700
const mode_file = 0o600
const retryMs_lock = 25
const timeoutMs_lock = 10_000
const operations = new Map<string, Promise<void>>()

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
    {
      async getItem<value>(name: string): Promise<value | null> {
        return await enqueue(async () => {
          return await withLock(path, async () => {
            const value = await read(path)
            return (value[name] as value | undefined) ?? null
          })
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

async function withLock<value>(path: string, fn: () => Promise<value>): Promise<value> {
  const lock = await acquireLock(path)
  try {
    return await fn()
  } finally {
    await lock.close().catch(() => undefined)
    await unlink(lockPath(path)).catch(() => undefined)
  }
}

async function acquireLock(path: string): ReturnType<typeof open> {
  await ensureDirectory(path)
  const path_lock = lockPath(path)
  const started = Date.now()

  while (Date.now() - started < timeoutMs_lock) {
    try {
      const handle = await open(path_lock, 'wx', mode_file)
      await chmod(path_lock, mode_file)
      return handle
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      await sleep(retryMs_lock)
    }
  }

  throw new FilesystemStorageError(path, `Timed out waiting for CLI storage lock at ${path_lock}.`)
}

async function ensureDirectory(path: string) {
  const dir = dirname(path)
  await mkdir(dir, { mode: mode_directory, recursive: true })
  await chmod(dir, mode_directory)
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

function lockPath(path: string) {
  return `${path}.lock`
}

function tempPath(path: string) {
  return `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}
