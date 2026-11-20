/**
 * The plugin of a DPoP key (RFC 9449), which binds an instance's tokens, and which a store keeps
 * across page loads, so a restored session refreshes.
 * @module
 */
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Dpop from '../internal/Dpop.js'
import * as Plugin from '../Plugin.js'
import type { Store } from '../Store.js'

/** The marker of a store read that rejected. */
const failed = Symbol('failed')

/** The entry of the store that holds the DPoP key. */
const key = 'tempo-id:dpop'

/**
 * Resolves with the plugin of a DPoP key, which sets the instance's `dpop`, so Tempo ID binds the
 * tokens of each sign-in to the DPoP key. The plugin adds no namespace. The factory is async, since
 * WebCrypto generates a DPoP key asynchronously, and a plugin's `config` returns synchronously.
 *
 * The factory reads the DPoP key from `store`, under `tempo-id:dpop`. If the entry holds none, it
 * creates a DPoP key, whose private key cannot be exported, and writes it there. The tokens refresh
 * only with the DPoP key that bound them, so the DPoP key stays as long as the session. In a
 * browser, `store` defaults to IndexedDB, the instance's default store, which keeps the
 * non-extractable private key as it is. Outside a browser without `store`, each call creates a new
 * DPoP key, which lasts as long as the process.
 *
 * An entry that holds no DPoP key, such as one that a store serialized, is replaced by a new DPoP
 * key, and a session that the old one bound cannot refresh. Outside a browser, a store with
 * `private`, such as `Store.file`, refuses a `CryptoKey`, and keeps the private key as a JWK instead, as
 * it keeps the session's refresh token and access keys. Each later call imports it as
 * non-extractable, so the next run of a CLI refreshes its session. A shared store, such as
 * `Store.postgres` or `Store.redis`, rejects the write and keeps no private key, so each call creates a
 * new DPoP key. In a browser, the factory keeps no private key in a form that a script can read.
 *
 * The factory never rejects for its store or its lock, so an app that awaits it at load still loads.
 * A page that refuses the lock, such as one without site storage, reads the store without it. If the
 * store rejects the read, such as a closed IndexedDB, the factory creates a DPoP key for the page,
 * and writes nothing over the stored one. If the store rejects the write, such as on a full quota,
 * the new DPoP key lasts for the page only.
 *
 * With Web Locks, such as in a browser, concurrent calls read and write the entry under one lock,
 * also in two tabs, so a first load in both returns one DPoP key. Outside a browser, Web Locks span
 * one process, so the calls also hold the store's `lock`, which `Store.file` holds across the
 * processes on the file. So two first runs of a CLI on one `Store.file` return one DPoP key, and
 * each run refreshes the tokens that the other bound. With a store without `lock`, concurrent first
 * calls of two processes can each create a DPoP key, and only the last write stays.
 *
 * The `dpop` that `Accounts.create` receives wins over the plugin's.
 *
 * @throws {TypeError} In a runtime without `crypto.subtle`, such as React Native, before any read or
 *   write of `store`. Create the instance without the plugin there, so Tempo ID issues Bearer tokens.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { dpop } from 'accounts/plugins'
 * import { react } from 'accounts/react'
 *
 * const accounts = Accounts.create({ plugins: [await dpop(), react()] })
 * ```
 */
export async function dpop(options: dpop.Options = {}) {
  Dpop.supported()
  const store = DefaultStore.get(options.store)
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
    ?.locks

  const value = await (async () => {
    if (!store) return await Dpop.create()
    const load = async () => {
      // A refused read, such as of a closed IndexedDB, keeps the stored DPoP key, so the factory
      // writes no new one over it.
      const stored = await store.getItem(key).catch(() => failed)
      if (stored === failed) return await Dpop.create()
      if (await valid(stored)) return Dpop.from(stored as Dpop.Dpop)

      const restored = store.private ? await imported(stored) : undefined
      if (restored) return restored

      const created = await Dpop.create()
      // A refused write, such as on a full quota, leaves a DPoP key for the page only, so the app
      // still loads.
      const saved = await store.setItem(key, created).then(
        () => true,
        () => false,
      )
      // Outside a browser, `Store.file` refuses a `CryptoKey`. Only its user reads the file, so it
      // keeps the private key as a JWK, beside the refresh token, and the next run refreshes the
      // tokens that the DPoP key bound. A shared store, such as a database, keeps no private key,
      // since one read of it would then yield both the token and its proof. A page keeps no private
      // key in a form that a script can read.
      if (saved || !store.private || typeof indexedDB !== 'undefined')
        return created
      return await exported(store)
    }
    // The lock's name is no entry of the store, so a store that locks each entry never waits for
    // the lock that its caller holds. The store's `lock` spans the processes on the store, such as
    // two runs of a CLI on one `Store.file`, whose Web Locks span one process, so they keep one
    // DPoP key. A refused hold, such as of a read-only folder, reads the store without it.
    const held = store.lock
      ? () => store.lock!(`${key}:exclusive`, load).catch(() => load())
      : load
    if (!locks) return await held()
    // A page without site storage, such as an opaque origin, refuses the lock before `load` runs.
    return await locks.request(`${key}:exclusive`, held).catch(() => held())
  })()

  return Plugin.from({ config: () => ({ dpop: value }), id: 'dpop' })
}

export declare namespace dpop {
  type Options = {
    /**
     * Where the DPoP key stays across loads, under `tempo-id:dpop`. Pass the instance's `store` to
     * keep the DPoP key beside the session, such as `Store.file()` for a CLI. Defaults to IndexedDB in
     * a browser. Absent outside a browser, each call creates a new DPoP key.
     */
    store?: Store | undefined
  }
}

/**
 * Returns whether `value` is a DPoP key: a P-256 public JWK with no other members, and the
 * non-extractable private ECDSA P-256 `CryptoKey` of the same key pair. A signature of the private
 * key that the JWK verifies proves the pair, so a proof of the DPoP key verifies against the JWK
 * that it carries.
 */
async function valid(value: unknown): Promise<boolean> {
  if (!record(value) || !record(value.jwk)) return false
  const { jwk, privateKey } = value
  // A stored key holds only the public members of its JWK, beside a key that the page cannot export.
  const shaped =
    Object.keys(jwk).sort().join() === 'crv,kty,x,y' &&
    jwk.crv === 'P-256' &&
    jwk.kty === 'EC' &&
    typeof jwk.x === 'string' &&
    typeof jwk.y === 'string' &&
    typeof CryptoKey !== 'undefined' &&
    privateKey instanceof CryptoKey &&
    privateKey.algorithm.name === 'ECDSA' &&
    (privateKey.algorithm as EcKeyAlgorithm).namedCurve === 'P-256' &&
    privateKey.type === 'private' &&
    !privateKey.extractable &&
    privateKey.usages.includes('sign')
  if (!shaped) return false

  const algorithm = { hash: 'SHA-256', name: 'ECDSA', namedCurve: 'P-256' }
  const publicJwk: JsonWebKey = {
    crv: 'P-256',
    kty: 'EC',
    x: jwk.x as string,
    y: jwk.y as string,
  }
  const data = crypto.getRandomValues(new Uint8Array(32))
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      algorithm,
      false,
      ['verify'],
    )
    const signature = await crypto.subtle.sign(algorithm, privateKey, data)
    return await crypto.subtle.verify(algorithm, publicKey, signature, data)
  } catch {
    // A JWK whose coordinates are no point of the curve fails the import.
    return false
  }
}

/**
 * Creates a DPoP key whose private key the store keeps as a JWK, and resolves with the DPoP key of
 * a non-extractable import of it. If the store refuses the JWK too, the DPoP key lasts for the
 * process only.
 */
async function exported(store: Store): Promise<Dpop.Dpop> {
  const created = await Dpop.create({ extractable: true })
  const { crv, d, kty, x, y } = await crypto.subtle.exportKey(
    'jwk',
    created.privateKey,
  )

  const value = { jwk: created.jwk, privateJwk: { crv, d, kty, x, y } }
  await store.setItem(key, value).catch(() => undefined)

  return (await imported(value))!
}

/**
 * Returns the DPoP key of a stored JWK pair, which {@link exported} writes: the public JWK, and the
 * private JWK of the same key pair, imported as non-extractable. Returns `undefined` for any other
 * value, or for a pair that is no DPoP key.
 */
async function imported(value: unknown): Promise<Dpop.Dpop | undefined> {
  if (!record(value) || !record(value.privateJwk)) return undefined
  const { crv, d, kty, x, y } = value.privateJwk
  if ([crv, d, kty, x, y].some((member) => typeof member !== 'string'))
    return undefined

  const privateKey = await crypto.subtle
    .importKey(
      'jwk',
      { crv, d, kty, x, y } as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    .catch(() => undefined)
  if (!privateKey) return undefined

  const dpop = { jwk: value.jwk, privateKey }
  if (!(await valid(dpop))) return undefined

  return Dpop.from(dpop as Dpop.Dpop)
}

/** Returns whether `value` is an object, whose properties a guard reads. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
