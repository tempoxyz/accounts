import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Json } from 'ox'

import * as Storage from '../core/Storage.js'

/** Returns the default CLI provider storage path. */
export function defaultPath(): string {
  return join(homedir(), '.tempo', 'wallet', 'store.json')
}

/** Creates a filesystem-backed storage adapter for CLI provider state. */
export function filesystem(options: filesystem.Options = {}): Storage.Storage {
  const path = expandPath(options.path ?? defaultPath())
  let pending = Promise.resolve()
  return Storage.from(
    {
      async getItem<value>(name: string): Promise<value | null> {
        await pending
        const value = await read(path)
        return (value[name] as value | undefined) ?? null
      },
      async removeItem(name) {
        await update(async (value) => {
          delete value[name]
        })
      },
      async setItem(name, item) {
        await update(async (value) => {
          value[name] = item
        })
      },
    },
    { key: options.key ?? 'tempo-cli' },
  )

  async function update(fn: (value: Record<string, unknown>) => Promise<void> | void) {
    const next = pending.then(async () => {
      const value = await read(path)
      await fn(value)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Json.stringify(value), 'utf8')
    })
    pending = next.catch(() => {})
    await next
  }
}

export declare namespace filesystem {
  type Options = {
    /** Storage key prefix. @default "tempo-cli" */
    key?: string | undefined
    /** JSON file path. @default "~/.tempo/wallet/store.json" */
    path?: string | undefined
  }
}

async function read(path: string): Promise<Record<string, unknown>> {
  try {
    return Json.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

function expandPath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
