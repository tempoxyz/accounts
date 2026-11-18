/**
 * Keeps the web test app's DPoP key between page loads. The instance does not store its `dpop`, so
 * an app that binds its tokens keeps the key itself. IndexedDB stores the non-extractable private
 * key as it is.
 * @module
 */
import { Dpop } from 'accounts/internal'

/** The database, and its only object store. */
const name = 'test-app-web'

/** The key of the DPoP key in the object store. */
const key = 'dpop'

/** Returns the page's DPoP key: the stored one, or a new one, which it stores. */
export async function load(): Promise<Dpop.Dpop> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.result.createObjectStore(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  /** Runs one request against the object store, and resolves once its transaction commits. */
  const run = <value>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<value>,
  ) =>
    new Promise<value>((resolve, reject) => {
      const transaction = database.transaction(name, mode)
      const request = fn(transaction.objectStore(name))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })

  const stored = await run<Dpop.Dpop | undefined>('readonly', (store) =>
    store.get(key),
  )
  if (stored) return Dpop.from(stored)

  const created = await Dpop.create()
  await run('readwrite', (store) => store.put(created, key))
  return created
}
