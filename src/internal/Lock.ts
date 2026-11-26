/**
 * A lock in memory that runs the calls of each name one at a time, for a store in a runtime without
 * Web Locks, such as React Native.
 * @module
 */
import type * as Store from '../Store.js'

/**
 * Returns a lock that runs each call of a name after the earlier calls of that name settle, in the
 * order of the calls. A rejected call releases the lock too. It serves the callers that share the
 * returned function, such as the instances on one store.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts'
 *
 * // `Store.memory` sets its `lock` with `Lock.create`.
 * const store = Store.memory()
 * await store.lock?.('session', async () => 'value')
 * ```
 */
export function create(): NonNullable<Store.Store['lock']> {
  const runs = new Map<string, Promise<unknown>>()
  return (name, fn) => {
    const run = (runs.get(name) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => fn())
    runs.set(name, run)
    const release = () => {
      if (runs.get(name) === run) runs.delete(name)
    }
    // The caller awaits `run`. This handler only removes the settled run of the name.
    void run.then(release, release)
    return run
  }
}
