/**
 * The store of a CLI's instance that receives none: the file that every CLI of the user shares. It
 * loads `Store.file` from its own chunk, so a browser bundle holds none of the file store's code.
 * @module
 */
import type { Store } from '../Store.js'
import * as ClientId from './ClientId.js'
import * as FileConnection from './FileConnection.js'
import * as Node from './Node.js'

/**
 * Returns the store of `Store.file()` for a `cli:` client ID, whose module loads on the first read
 * or write. Its `connect` is the file's, so it needs no load. Returns `undefined` for another client ID, since only a `cli:` one names a program of
 * one user. A registered client ID can also name a backend, which serves many users and holds no
 * session. Returns `undefined` too in a browser, which keeps IndexedDB, and in a runtime without
 * Node's file system modules, where `Store.file` throws.
 */
export function get(clientId: string | undefined): Store | undefined {
  if (!clientId || !ClientId.cli(clientId)) return undefined
  if (typeof indexedDB !== 'undefined') return undefined
  const node = Node.modules()
  if (!node) return undefined
  // An instance connects when it is created, before the file store's module loads, so the store
  // connects through the registry that `Store.file` shares, by the file's absolute path. A home
  // directory that cannot be read connects nothing, and the first read of the file store fails.
  const path = (() => {
    try {
      return Node.resolve(Node.file(node), node)
    } catch {
      return undefined
    }
  })()

  let loading: Promise<Store> | undefined

  /** Loads the file store once. A failed load lets the next call try again. */
  function load() {
    loading ??= import('../stores/File.js')
      .then((module) => module.create())
      .catch((error: unknown) => {
        loading = undefined
        throw error
      })
    return loading
  }

  // Each call waits for the one load, so the calls reach the file store in their order. The flags
  // and `update` are the file store's, which a guest session needs: a JSON key pair, and a
  // compare-and-set of its first key pair and its revision.
  return {
    // The instances of the process on the file, also on `Store.file()`, hear each saved change of
    // each other, so a sign-out empties their sessions at once.
    ...(path ? { connect: FileConnection.get(path) } : {}),
    getItem: async (key) => (await load()).getItem(key),
    json: true,
    // The CLIs of the user share the file, so their refreshes order through its lock.
    lock: async (key, fn) => (await load()).lock!(key, fn),
    private: true,
    removeItem: async (key) => (await load()).removeItem(key),
    setItem: async (key, value, options) =>
      (await load()).setItem(key, value, options),
    takeItem: async (key) => (await load()).takeItem?.(key),
    update: async (key, fn) => (await load()).update!(key, fn),
  }
}
