/**
 * The `connect` of each file of `Store.file` in the process, apart from the file store's module, so
 * the default store of a CLI connects before that module loads.
 * @module
 */
import type * as Store from '../Store.js'
import * as Broadcast from './Broadcast.js'

/**
 * Returns the `connect` of the file at the absolute `path`. Each store of the path in the process
 * shares it, also a CLI's default store, so a sign-out empties the sessions of every instance on the
 * file at once.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts'
 *
 * // `Store.file` sets its `connect` with `FileConnection.get`.
 * const store = Store.file()
 * const post = store.connect?.('session', (message) => console.log(message))
 * ```
 */
export function get(path: string): NonNullable<Store.Store['connect']> {
  const connect = connections.get(path) ?? Broadcast.create()
  connections.set(path, connect)
  return connect
}

/**
 * The `connect` of each file of the process, by its absolute path. A file belongs to the whole
 * device, and no instance owns it.
 */
const connections = new Map<string, NonNullable<Store.Store['connect']>>()
