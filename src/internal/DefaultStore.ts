/**
 * Resolves where an instance keeps state across page loads.
 * @module
 */
/* istanbul ignore file -- IndexedDB exists only in a browser. */
import type { Store } from '../Store.js'
import * as IndexedDb from './IndexedDb.js'

/** The default store, opened on first use. */
let indexedDb: Store | undefined

/**
 * Returns `store`, or else IndexedDB in a browser. Returns `undefined` outside a browser without
 * `store`.
 */
export function get(store: Store | undefined) {
  if (store) return store
  if (typeof indexedDB === 'undefined') return undefined
  return (indexedDb ??= IndexedDb.create())
}
