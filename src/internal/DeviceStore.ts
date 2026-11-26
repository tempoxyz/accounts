/**
 * The store of the `expo` preset in `accounts/expo`: the device's secure store, which every
 * preset in the app shares.
 * @module
 */
import * as Store from '../Store.js'
import * as Broadcast from './Broadcast.js'
import * as Lock from './Lock.js'
import * as StoreValue from './StoreValue.js'

/**
 * The lock of every preset's store. React Native has no Web Locks, and every preset reads the one
 * secure store of the device, which no instance owns, so the lock lives in module scope. Two
 * instances on one `url`, `clientId`, and chain hold one session, such as a config that Fast
 * Refresh runs again while the old instance lives, and refresh it one at a time. A lock for each
 * preset let them send the same refresh token, which Tempo ID refuses as a reuse.
 */
const lock = Lock.create()

/**
 * The `connect` of every preset's store. React Native has no page's `BroadcastChannel`, and every
 * preset reads the one secure store of the device, which no instance owns, so the `connect` lives
 * in module scope. A sign-out of one instance empties the session of every other instance on an
 * `expo` preset at once, also of another preset, such as a config that Fast Refresh runs again.
 */
const connect = Broadcast.create()

/**
 * Returns a store on the device's secure store, with its keys encoded to the characters that it
 * accepts, and each value as ox's `Json`, which keeps a `bigint`. The store is `json` and `private`,
 * since only the app reads the secure store, so it keeps private keys as JSON. Every store that this function
 * returns shares the device's secure store, so its `lock` serializes their session refreshes, and its
 * `connect` carries a sign-out of one instance to the others at once, as `Store.memory` does. It
 * sets `local`, since only the app's process reads the secure store, so a refused refresh token
 * signs out after one request.
 *
 * @throws {Store.InvalidValueError} From a read, for a stored value that holds no valid JSON.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { expo } from 'accounts/expo'
 *
 * // `expo` sets the instance's `store` with `DeviceStore.create`.
 * const accounts = Accounts.create({
 *   clientId: 'client_…',
 *   plugins: [expo({ redirectUri: 'com.example.app:/callback' })],
 * })
 * ```
 */
export function create(secureStore: create.SecureStore): Store.Store {
  // The secure store holds strings under keys of letters, digits, `.`, `-`, and `_`, so the store
  // encodes both. The key's encoding escapes `_` too, so two keys never share one.
  const encode = (key: string) =>
    key.replace(
      /[^A-Za-z0-9.-]/g,
      (character) =>
        `_${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )
  return Store.from({
    // An engine without `WeakRef`, such as JavaScriptCore on Android, holds no listener, so its
    // instances read sign-outs from the store instead.
    ...(typeof WeakRef === 'function' ? { connect } : {}),
    async getItem(key) {
      const text = await secureStore.getItemAsync(encode(key))
      return text === null ? undefined : StoreValue.parse(text)
    },
    // Each value goes through ox's `Json`, which has no form of a `CryptoKey`, so the store keeps
    // JSON. Only the app reads the device's secure store, so it keeps private keys, such as the
    // guest account's P256 private key.
    json: true,
    local: true,
    lock,
    private: true,
    removeItem: (key) => secureStore.deleteItemAsync(encode(key)),
    setItem: (key, value) =>
      secureStore.setItemAsync(encode(key), StoreValue.stringify(value)),
  })
}

export declare namespace create {
  /** The functions of `expo-secure-store` that the store calls. */
  type SecureStore = {
    /** Deletes the value at a key. */
    deleteItemAsync: (key: string) => Promise<void>
    /** Reads the value at a key, or `null`. */
    getItemAsync: (key: string) => Promise<string | null>
    /** Writes the value at a key. */
    setItemAsync: (key: string, value: string) => Promise<void>
  }
}
