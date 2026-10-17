import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
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

/** Runs `fn` under the lock, failing if another holder is inside at the same time. */
function exclusive(path: string, fn: () => Promise<void>) {
  const marker = `${path}.holder`
  return lock(path, async () => {
    await writeFile(marker, '', { flag: 'wx' })
    await fn()
    await unlink(marker)
  })
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

  test('behavior: reclaims an entry this process ID did not create', async () => {
    const path = await createPath()
    await mkdir(`${path}.lock`)
    await writeFile(join(`${path}.lock`, `${process.pid}-stale`), '')

    await expect(lock(path, async () => 'locked')).resolves.toMatchInlineSnapshot(`"locked"`)
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

  test('behavior: leaves nothing behind when killed while waiting', async () => {
    const path = await createPath()
    const live = run(holder(path))
    await live.waitFor('locked')

    try {
      const waiter = run(`
        import { lock } from ${JSON.stringify(moduleUrl('src/cli/internal/lock.ts'))}
        process.stdout.write('waiting\\n')
        await lock(${JSON.stringify(path)}, async () => {})
      `)
      await waiter.waitFor('waiting')
      await sleep(100)
      await waiter.kill()

      expect(await readdir(dirname(path))).toMatchInlineSnapshot(`
        [
          "store.json.lock",
        ]
      `)
    } finally {
      await live.kill()
    }
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

  test('error: never reclaims an entry it cannot attribute to a process', async () => {
    const path = await createPath()
    await mkdir(`${path}.lock`)
    await writeFile(join(`${path}.lock`, 'unknown'), '')

    await expect(
      lock(path, async () => undefined, { timeout: 50 }).catch((error: Error) =>
        error.message.replaceAll(path, '<path>'),
      ),
    ).resolves.toMatchInlineSnapshot(
      `"Timed out after 50ms waiting for the lock at <path>.lock, held by unknown. If no other process is using it, remove <path>.lock."`,
    )
  })
})
