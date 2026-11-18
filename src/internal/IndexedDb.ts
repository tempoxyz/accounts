/**
 * The default `store` in a browser. IndexedDB keeps a non-extractable `CryptoKey` as it is.
 * @module
 */
/* istanbul ignore file -- IndexedDB exists only in a browser. */
import type { Store } from '../Store.js'

/** Opens a store in the page's IndexedDB. */
export function create(): Store {
  // The browser can close the connection, such as when it deletes the site's data, and a closed
  // connection refuses every transaction. A closed or failed connection opens again at the next
  // request.
  let database: Promise<IDBDatabase> | undefined

  /** Returns the open connection, or opens one. */
  function open() {
    if (database) return database
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tempo-id')
      request.onupgradeneeded = () => request.result.createObjectStore(store)
      request.onsuccess = () => {
        request.result.onclose = () => {
          if (database === opened) database = undefined
        }
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
    })
    database = opened
    opened.catch(() => {
      if (database === opened) database = undefined
    })
    return opened
  }

  /**
   * Runs one request against the store, and resolves with its result once its transaction commits.
   * A request's success precedes the commit, which can still abort, such as on a full quota.
   */
  async function run<value>(
    mode: IDBTransactionMode,
    fn: (objectStore: IDBObjectStore) => IDBRequest<value>,
  ) {
    const transaction = await (async () => {
      const opened = open()
      try {
        return (await opened).transaction(store, mode)
      } catch (error) {
        // A connection that the browser closes refuses transactions before its `close` event, such
        // as for a write that the abort of an earlier one starts. The refused request never ran.
        if (
          !(error instanceof DOMException) ||
          error.name !== 'InvalidStateError'
        )
          throw error
        if (database === opened) database = undefined
        return (await open()).transaction(store, mode)
      }
    })()
    return new Promise<value>((resolve, reject) => {
      const request = fn(transaction.objectStore(store))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error)
      transaction.onerror = () => reject(transaction.error ?? request.error)
    })
  }

  return {
    getItem: (key) => run('readonly', (objectStore) => objectStore.get(key)),
    async removeItem(key) {
      await run('readwrite', (objectStore) => objectStore.delete(key))
    },
    async setItem(key, value) {
      await run('readwrite', (objectStore) => objectStore.put(value, key))
    },
  }
}

/** The object store that holds every value. */
const store = 'store'
