/**
 * Where a redirect keeps its state until Tempo ID redirects back, and where a backend keeps its
 * sessions. `memory`, `postgres`, and `redis` return a store for a backend.
 * @module
 */
/**
 * Keeps an instance's session and a redirect's state, or a backend's sessions, as structured-clone
 * storage such as IndexedDB or a Durable Object's storage does. `Store.file` returns one for a CLI.
 * `Store.memory`, `Store.postgres`, and `Store.redis` return one for a backend. Of
 * `accounts/cloudflare`, `Store.durableObject` returns one in a Durable Object, and
 * `Store.workersKv` one in a Workers KV namespace. {@link from} instantiates any other, such as a
 * device's secure store.
 */
export type Store = {
  /**
   * Adds `listener` for the messages that other instances on the store post at `key`, and returns
   * the function that posts a message to them. Each listener receives each message in a later
   * microtask. The store holds no listener of an instance that the app dropped. An instance's
   * session posts each saved change through it where no page's `BroadcastChannel` exists, such as in
   * React Native or Node, so another instance's sign-out empties its session at once.
   * `Store.memory` sets it. Absent, an instance outside a page reads another's sign-out only from
   * the store.
   */
  connect?:
    | ((
        key: string,
        listener: (message: unknown) => void,
      ) => (message: unknown) => void)
    | undefined
  /** Reads the value at `key`, or `undefined`. */
  getItem: (key: string) => Promise<unknown>
  /**
   * Whether the store keeps each value as JSON, as `Store.file`, `Store.postgres`, `Store.redis`,
   * and `Store.workersKv` do. JSON has no form of a browser's non-extractable access key, so in a browser a
   * sign-in that generates its access key throws a `TypeError` before any request. Defaults to
   * `false`.
   */
  json?: boolean | undefined
  /**
   * Whether only the process that created the store holds its values, as `Store.memory` does.
   * In a browser, a page load empties such a store, so `redirect.signIn` without `open` refuses
   * it before any request. An instance's `session.refresh` with such a store reads a refusal of its refresh token as final where a
   * lock spans the process, Web Locks or the store's `lock`, since no other process can rotate the token. Defaults to `false`.
   */
  local?: boolean | undefined
  /**
   * Runs `fn` after each earlier call of `key` settles, also of other instances on the store, and
   * resolves with its result. The `backend` plugin writes the logout index of each `sid` with it,
   * so concurrent sign-ins of one `sid` keep each session. Every instance on the store refreshes
   * its session through it, so two instances send one refresh: without Web Locks, such as in React
   * Native, and for a store that is not `local`, such as `Store.redis` that processes share, whose
   * Web Locks span one process only. `Store.file`, `Store.memory`, `Store.postgres`, `Store.redis`, and the store of `accounts/expo` set it. Absent, each instance
   * orders only its own writes and refreshes.
   */
  lock?:
    | (<result>(key: string, fn: () => Promise<result>) => Promise<result>)
    | undefined
  /**
   * Whether only the user who runs the program reads the store, as with the `0600` file of
   * `Store.file`. Outside a browser, the `dpop` plugin then keeps its private key there as a JWK.
   * A shared store, such as a database, keeps no private key. Defaults to `false`.
   */
  private?: boolean | undefined
  /** Deletes the value at `key`. */
  removeItem: (key: string) => Promise<void>
  /**
   * Writes `value` at `key`, without serializing it. A store that expires entries deletes it after
   * `options.expiresAt`, such as with a Durable Object's alarm.
   */
  setItem: (
    key: string,
    value: unknown,
    options?: setItem.Options,
  ) => Promise<void>
  /**
   * Reads the value at `key` and deletes it in one atomic step, and resolves with it, or
   * `undefined`. Of concurrent calls, also from processes that share the store, only one receives
   * the value. The `siwe` plugin spends each challenge with it, the `backend` plugin each
   * redirect in progress, and the `redirect` plugin each redirect that the returning tab started.
   * Absent, a caller reads and deletes in two calls, so each process takes a value once, but two
   * processes can both read it.
   * `Store.file`, `Store.memory`, `Store.postgres`, and `Store.redis` set it.
   */
  takeItem?: ((key: string) => Promise<unknown>) | undefined
  /**
   * Reads the value at `key`, or `undefined`, passes it to `fn`, writes the `value` that `fn`
   * returns, and resolves with its `result`. The write lands only if the value at `key` is still
   * the one that `fn` read, also across processes that share the store. Otherwise `update` reads
   * again and runs `fn` again, so `fn` must have no side effects. A `value` of `undefined`
   * deletes the entry. The `backend` plugin writes the logout index of each `sid` with it, so
   * concurrent sign-ins of one `sid` on different processes keep each session, in the round trips
   * of a read and a write. `Store.postgres` and `Store.redis` set it.
   */
  update?:
    | (<result>(
        key: string,
        fn: (value: unknown) => update.Return<result>,
      ) => Promise<result>)
    | undefined
}

export declare namespace setItem {
  type Options = {
    /**
     * When the entry may be deleted, in milliseconds. The `backend` plugin sets it for a redirect
     * in progress. Absent, the entry stays until a deletion.
     */
    expiresAt?: number | undefined
  }
}

export declare namespace update {
  type Return<result> = {
    /** When the written entry may be deleted, in milliseconds, as `setItem`'s `expiresAt`. */
    expiresAt?: number | undefined
    /** What `update` resolves with. */
    result: result
    /** The value to write at `key`, or `undefined` to delete it. */
    value: unknown
  }
}

/**
 * Instantiates a {@link Store}.
 *
 * @example
 * ```ts
 * const store = Store.from({
 *   getItem: (key) => idb.get(key),
 *   removeItem: (key) => idb.del(key),
 *   setItem: (key, value) => idb.set(key, value),
 * })
 * ```
 */
export function from(value: Store): Store {
  return value
}

export {
  create as file,
  InvalidFileError,
  NodeRequiredError,
} from './stores/File.js'
export { InvalidValueError } from './internal/StoreValue.js'
export { create as memory } from './stores/Memory.js'
export { create as postgres } from './stores/Postgres.js'
export { create as redis } from './stores/Redis.js'
