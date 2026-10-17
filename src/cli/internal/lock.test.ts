import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { threadId, Worker } from 'node:worker_threads'
import { describe, expect, test } from 'vp/test'

import { moduleUrl, run } from '../../../test/process.js'
import { lock } from './lock.js'

async function createPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-lock-')), 'store.json')
}

/** Script for a process that takes the lock on `path` and holds it until killed. */
function holder(path: string) {
  return `
    import { lock } from ${JSON.stringify(moduleUrl('src/cli/internal/lock.ts'))}
    await lock(${JSON.stringify(path)}, () => {
      process.stdout.write('locked\\n')
      return new Promise(() => setInterval(() => {}, 60_000))
    })
  `
}

/**
 * Module source that takes the lock on `path` `count` times through each of
 * `imports` at once, and throws if it ever finds another holder inside.
 */
function contender(path: string, imports: readonly string[], count = 5) {
  return `
    import { unlink, writeFile } from 'node:fs/promises'
    import { setTimeout } from 'node:timers/promises'
    ${imports.map((url, i) => `import { lock as lock_${i} } from ${JSON.stringify(url)}`).join('\n')}
    await Promise.all([${imports.map((_, i) => `lock_${i}`).join(', ')}].map(async (lock) => {
      for (let i = 0; i < ${count}; i++)
        await lock(${JSON.stringify(path)}, async () => {
          await writeFile(${JSON.stringify(`${path}.holder`)}, '', { flag: 'wx' })
          await setTimeout(5)
          await unlink(${JSON.stringify(`${path}.holder`)})
        })
    }))
  `
}

/** Runs `fn` under the lock, failing if another holder is inside at the same time. */
function exclusive(path: string, fn: () => Promise<void>) {
  const marker = `${path}.holder`
  return lock(path, async () => {
    await writeFile(marker, '', { flag: 'wx' })
    await fn()
    await unlink(marker)
  })
}

/** Returns the ID of a process that has exited. */
async function deadPid() {
  const exited = run('')
  await exited.exited
  return exited.pid
}

describe('lock', () => {
  test('behavior: runs holders one at a time', async () => {
    const path = await createPath()

    const order: number[] = []
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        exclusive(path, async () => {
          order.push(i)
          await sleep(5)
        }),
      ),
    )

    expect({ holders: order.length, locked: existsSync(`${path}.lock`) }).toMatchInlineSnapshot(`
      {
        "holders": 8,
        "locked": false,
      }
    `)
  })

  test('behavior: releases the lock when fn throws', async () => {
    const path = await createPath()

    await expect(
      lock(path, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: boom]`)
    await expect(lock(path, async () => 'next')).resolves.toMatchInlineSnapshot(`"next"`)
    expect(existsSync(`${path}.lock`)).toMatchInlineSnapshot(`false`)
  })

  test('behavior: takes over stale entries and waits for live ones', async () => {
    const dead = await deadPid()
    const rows = [
      {
        name: 'this thread, not held',
        entry: `${process.pid}-${threadId}-0badc0de0badc0de`,
        age: 0,
      },
      { name: 'exited process', entry: `${dead}-0-0badc0de0badc0de`, age: 0 },
      { name: 'running process', entry: `${process.ppid}-0-0badc0de0badc0de`, age: 0 },
      { name: 'running process, reused ID', entry: `${process.ppid}-0-0badc0de0badc0de`, age: 31 },
      { name: 'other thread', entry: `${process.pid}-${threadId + 1}-0badc0de0badc0de`, age: 0 },
      {
        name: 'other thread, hung',
        entry: `${process.pid}-${threadId + 1}-0badc0de0badc0de`,
        age: 31,
      },
    ]

    const results: Record<string, string> = {}
    for (const { age, entry, name } of rows) {
      const path = await createPath()
      await mkdir(`${path}.lock`)
      await writeFile(join(`${path}.lock`, entry), '')
      const time = new Date(Date.now() - age * 1000)
      await utimes(join(`${path}.lock`, entry), time, time)

      results[name] = await lock(path, async () => 'locked', { timeout: 50 }).catch(
        (error: Error) =>
          error.message
            .replaceAll(path, '<path>')
            .replace(`process ${process.ppid}`, 'process <ppid>')
            .replace(`process ${process.pid}`, 'process <pid>'),
      )
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "exited process": "locked",
        "other thread": "Timed out after 50ms waiting for the lock at <path>.lock, held by process <pid>. If no other process is using it, remove <path>.lock.",
        "other thread, hung": "locked",
        "running process": "Timed out after 50ms waiting for the lock at <path>.lock, held by process <ppid>. If no other process is using it, remove <path>.lock.",
        "running process, reused ID": "locked",
        "this thread, not held": "locked",
      }
    `)
  })

  test('behavior: reclaims the lock of a killed holder, one contender at a time', async () => {
    const path = await createPath()
    const killed = run(holder(path))
    await killed.waitFor('locked')

    // Contenders queue up behind the holder, then race to reclaim its lock once it dies. Each
    // fails if it ever finds another holder inside the lock.
    const contenders = Array.from({ length: 8 }, () =>
      run(`
        import { unlink, writeFile } from 'node:fs/promises'
        import { setTimeout } from 'node:timers/promises'
        import { lock } from ${JSON.stringify(moduleUrl('src/cli/internal/lock.ts'))}
        process.stdout.write('waiting\\n')
        await lock(${JSON.stringify(path)}, async () => {
          await writeFile(${JSON.stringify(`${path}.holder`)}, '', { flag: 'wx' })
          await setTimeout(20)
          await unlink(${JSON.stringify(`${path}.holder`)})
        })
      `),
    )
    await Promise.all(contenders.map((x) => x.waitFor('waiting')))
    await sleep(100)
    await killed.kill()
    const results = await Promise.all(contenders.map((x) => x.exited))

    expect({
      locked: existsSync(`${path}.lock`),
      results: results.map(({ code }) => code),
    }).toMatchInlineSnapshot(`
      {
        "locked": false,
        "results": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ],
      }
    `)
  })

  test('behavior: holds the lock once across copies of the module in one process', async () => {
    const path = await createPath()
    const url = moduleUrl('src/cli/internal/lock.ts')
    const copies = run(contender(path, [url, `${url}?copy=1`, `${url}?copy=2`]))

    expect(await copies.exited).toMatchInlineSnapshot(`
      {
        "code": 0,
        "signal": null,
      }
    `)
  })

  test('behavior: holds the lock once across worker threads', async () => {
    const path = await createPath()
    const script = join(dirname(path), 'worker.mjs')
    await writeFile(script, contender(path, [moduleUrl('src/cli/internal/lock.ts')]))

    const codes = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<number>((resolve, reject) => {
            const worker = new Worker(script, { execArgv: ['--import', 'tsx'] })
            worker.once('error', reject)
            worker.once('exit', resolve)
          }),
      ),
    )

    expect(codes).toMatchInlineSnapshot(`
      [
        0,
        0,
        0,
        0,
      ]
    `)
  })

  test('behavior: takes over the entry of a terminated thread before the wait ends', async () => {
    const path = await createPath()
    const script = join(dirname(path), 'holder.mjs')
    await writeFile(
      script,
      `
        import { parentPort } from 'node:worker_threads'
        import { lock } from ${JSON.stringify(moduleUrl('src/cli/internal/lock.ts'))}
        await lock(${JSON.stringify(path)}, () => {
          parentPort.postMessage('locked')
          return new Promise(() => setInterval(() => {}, 60_000))
        })
      `,
    )
    const worker = new Worker(script, { execArgv: ['--import', 'tsx'] })
    await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    await worker.terminate()

    // The wait defaults to outlast `stale`, so the abandoned entry is taken over.
    await expect(lock(path, async () => 'locked', { stale: 200 })).resolves.toMatchInlineSnapshot(
      `"locked"`,
    )
  })

  test('behavior: removes directories left by owners that exited', async () => {
    const path = await createPath()
    const dead = await deadPid()
    await mkdir(`${path}.lock.${dead}-0-0badc0de0badc0de`)
    await writeFile(
      join(`${path}.lock.${dead}-0-0badc0de0badc0de`, `${dead}-0-0badc0de0badc0de`),
      '',
    )
    await mkdir(`${path}.lock.${process.ppid}-0-0badc0de0badc0de`)

    await lock(path, async () => {})

    expect((await readdir(dirname(path))).map((x) => x.replace(`${process.ppid}`, '<ppid>')))
      .toMatchInlineSnapshot(`
      [
        "store.json.lock.<ppid>-0-0badc0de0badc0de",
      ]
    `)
  })

  test('behavior: cleans up after processes killed holding or waiting for the lock', async () => {
    const path = await createPath()
    const killed = run(holder(path))
    await killed.waitFor('locked')

    const waiters = Array.from({ length: 4 }, () =>
      run(`
        import { lock } from ${JSON.stringify(moduleUrl('src/cli/internal/lock.ts'))}
        process.stdout.write('waiting\\n')
        await lock(${JSON.stringify(path)}, async () => {})
      `),
    )
    await Promise.all(waiters.map((x) => x.waitFor('waiting')))
    await sleep(100)
    await Promise.all([killed, ...waiters].map((x) => x.kill()))

    await lock(path, async () => {})
    expect(await readdir(dirname(path))).toMatchInlineSnapshot(`[]`)
  })

  test('error: refuses a lock that another user could plant', async () => {
    const rows: { name: string; setup: (path: string) => Promise<void> }[] = [
      {
        name: 'directory writable by every user',
        setup: (path) => chmod(dirname(path), 0o777),
      },
      {
        name: 'sticky directory writable by every user',
        setup: (path) => chmod(dirname(path), 0o1777),
      },
      {
        name: 'lock that is a symbolic link',
        setup: async (path) => {
          const target = await mkdtemp(join(tmpdir(), 'accounts-lock-target-'))
          await symlink(target, `${path}.lock`)
        },
      },
      {
        name: 'lock that is a file',
        setup: (path) => writeFile(`${path}.lock`, ''),
      },
      {
        name: 'lock holding an unexpected entry',
        setup: async (path) => {
          await mkdir(`${path}.lock`)
          await writeFile(join(`${path}.lock`, 'unknown'), '')
          const time = new Date(Date.now() - 31_000)
          await utimes(join(`${path}.lock`, 'unknown'), time, time)
        },
      },
    ]

    const results: Record<string, unknown> = {}
    for (const { name, setup } of rows) {
      const path = await createPath()
      await setup(path)
      const start = Date.now()
      results[name] = await lock(path, async () => 'locked', { timeout: 2_000 }).catch(
        (error: Error) => ({
          fast: Date.now() - start < 1_000,
          message: error.message.replaceAll(dirname(path), '<dir>'),
          name: error.name,
        }),
      )
      await chmod(dirname(path), 0o700)
      await chmod(`${path}.lock`, 0o700).catch(() => undefined)
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "directory writable by every user": {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: <dir> is writable by every user.",
          "name": "Lock.UnusableError",
        },
        "lock holding an unexpected entry": {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: it holds an unexpected entry, unknown.",
          "name": "Lock.UnusableError",
        },
        "lock that is a file": {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: it is not a directory.",
          "name": "Lock.UnusableError",
        },
        "lock that is a symbolic link": {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: it is not a directory.",
          "name": "Lock.UnusableError",
        },
        "sticky directory writable by every user": {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: <dir> is writable by every user.",
          "name": "Lock.UnusableError",
        },
      }
    `)
  })

  // Root reads any directory, so the lock below would be readable.
  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'error: refuses a lock directory it cannot read instead of waiting',
    async () => {
      const path = await createPath()
      await mkdir(`${path}.lock`)
      await writeFile(join(`${path}.lock`, `${process.ppid}-0-0badc0de0badc0de`), '')
      await chmod(`${path}.lock`, 0o000)

      const start = Date.now()
      const result = await lock(path, async () => 'locked', { timeout: 2_000 }).catch(
        (error: Error) => ({
          fast: Date.now() - start < 1_000,
          message: error.message.replaceAll(dirname(path), '<dir>'),
          name: error.name,
        }),
      )
      await chmod(`${path}.lock`, 0o700)

      expect(result).toMatchInlineSnapshot(`
        {
          "fast": true,
          "message": "Cannot use the lock at <dir>/store.json.lock: it cannot be read.",
          "name": "Lock.UnusableError",
        }
      `)
    },
  )

  test('behavior: never touches the target of a planted symbolic link', async () => {
    const path = await createPath()
    const target = await mkdtemp(join(tmpdir(), 'accounts-lock-target-'))
    const dead = await deadPid()
    const files = [`${dead}-0-0badc0de0badc0de`, 'old']
    for (const file of files) await writeFile(join(target, file), 'secret')
    const time = new Date(Date.now() - 31_000)
    await utimes(join(target, 'old'), time, time)
    await symlink(target, `${path}.lock`)

    await lock(path, async () => undefined, { timeout: 200 }).catch(() => undefined)

    expect((await readdir(target)).map((x) => x.replace(`${dead}`, '<dead>')))
      .toMatchInlineSnapshot(`
      [
        "<dead>-0-0badc0de0badc0de",
        "old",
      ]
    `)
  })

  test('error: times out while a live process holds the lock', async () => {
    const path = await createPath()
    const live = run(holder(path))
    await live.waitFor('locked')

    try {
      await expect(
        lock(path, async () => undefined, { timeout: 100 }).catch((error: Error) => ({
          message: error.message.replaceAll(path, '<path>').replace(`${live.pid}`, '<pid>'),
          name: error.name,
        })),
      ).resolves.toMatchInlineSnapshot(`
        {
          "message": "Timed out after 100ms waiting for the lock at <path>.lock, held by process <pid>. If no other process is using it, remove <path>.lock.",
          "name": "Lock.TimeoutError",
        }
      `)
      expect(existsSync(`${path}.lock`)).toMatchInlineSnapshot(`true`)
    } finally {
      await live.kill()
    }
  })
})
