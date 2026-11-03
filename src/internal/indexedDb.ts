/**
 * The default `store` in a browser. IndexedDB keeps a non-extractable `CryptoKey` as it is.
 * @module
 */
/* istanbul ignore file -- IndexedDB exists only in a browser. */
import type { Store } from '../Store.js'

/** Opens a store in the page's IndexedDB. */
export function create(): Store {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tempo-id')
    request.onupgradeneeded = () => request.result.createObjectStore(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  /**
   * Runs one request against the store, and resolves with its result once its transaction commits.
   * A request's success precedes the commit, which can still abort, such as on a full quota.
   */
  async function run<value>(
    mode: IDBTransactionMode,
    fn: (objectStore: IDBObjectStore) => IDBRequest<value>,
  ) {
    const transaction = (await database).transaction(store, mode)
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
