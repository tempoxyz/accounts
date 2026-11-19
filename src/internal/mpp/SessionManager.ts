/**
 * The session manager of mppx that starts at its first call, which `accounts/mpp` and the default
 * MPP plugin of an instance return before their manager exists.
 * @module
 */
import type { tempo } from 'mppx/client'

/** A session manager of mppx. */
export type Manager = ReturnType<typeof tempo.session.manager>

/**
 * Returns a session manager that creates its manager with `start` at its first request, stream, or
 * top-up, and forwards each call to it. Before then, it reads as a manager without a channel, and
 * `close` settles nothing. A failed `start`, such as without a session, rejects that call, and the
 * next call starts again.
 */
export function deferred(start: () => Promise<Manager>): Manager {
  // One value of three cases: no start yet, the start in progress, or the manager that it created.
  // A failed start returns to none, so the next call starts again.
  let current:
    | { manager: Manager; status: 'ready' }
    | { promise: Promise<Manager>; status: 'starting' }
    | undefined
  const manager = () =>
    current?.status === 'ready' ? current.manager : undefined
  const resolve = () => {
    if (current?.status === 'ready') return Promise.resolve(current.manager)
    if (current?.status === 'starting') return current.promise
    const promise = start().then(
      (value) => {
        current = { manager: value, status: 'ready' }
        return value
      },
      (error: unknown) => {
        current = undefined
        throw error
      },
    )
    current = { promise, status: 'starting' }
    return promise
  }
  return {
    get channelId() {
      return manager()?.channelId
    },
    async close() {
      if (!current) return undefined
      const started = await resolve().catch(() => undefined)
      return started?.close()
    },
    get cumulative() {
      return manager()?.cumulative ?? 0n
    },
    async fetch(...args) {
      return (await resolve()).fetch(...args)
    },
    get opened() {
      return manager()?.opened ?? false
    },
    async sse(...args) {
      return (await resolve()).sse(...args)
    },
    get state() {
      return manager()?.state ?? { status: 'idle' }
    },
    async topUp(...args) {
      return (await resolve()).topUp(...args)
    },
    async ws(...args) {
      return (await resolve()).ws(...args)
    },
  }
}
