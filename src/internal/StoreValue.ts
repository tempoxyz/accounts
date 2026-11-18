/**
 * The JSON form of a store's values, as the stores that serialize them write it.
 * @module
 */
import { Json } from 'ox'

/**
 * Thrown by a read of `Store.postgres`, `Store.redis`, `Store.workersKv`, or the secure store of `expo` for a stored
 * value that holds no valid JSON, such as after a hand edit. The parser's own error quotes the text
 * around the fault, which can hold a token, so this error has no `cause`. Its message names neither
 * the key nor the value, since a backend's keys hold session IDs and the value holds tokens. Remove
 * the entry, and sign in again.
 *
 * @example
 * ```ts
 * import { Store } from 'accounts'
 *
 * const value = await store.getItem(key).catch(async (error: unknown) => {
 *   if (!(error instanceof Store.InvalidValueError)) throw error
 *   await store.removeItem(key)
 * })
 * ```
 */
export class InvalidValueError extends Error {
  override readonly name = 'Store.InvalidValueError'

  constructor() {
    super(
      'Invalid value: the stored entry holds no valid JSON. Remove the entry, and sign in again.',
    )
  }
}

/**
 * Returns the value of `text`, ox's `Json`. Throws {@link InvalidValueError}, which quotes none of
 * `text`, for text that holds no valid JSON.
 *
 * @example
 * ```ts
 * const value = StoreValue.parse('{"amount":"1#__bigint"}')
 * ```
 */
export function parse(text: string): unknown {
  try {
    return Json.parse(text) as unknown
  } catch {
    throw new InvalidValueError()
  }
}

/**
 * Returns `value` as ox's `Json`, so a `bigint` survives. Throws a `TypeError` for a value that
 * holds a `CryptoKey`, such as a browser's non-extractable access key, which JSON keeps as `{}`, so
 * a store never holds an access key that signs nothing.
 *
 * @example
 * ```ts
 * const text = StoreValue.stringify({ amount: 1n })
 * ```
 */
export function stringify(value: unknown): string {
  return Json.stringify(value, (_key, entry: unknown) => {
    if (typeof CryptoKey !== 'undefined' && entry instanceof CryptoKey)
      throw new TypeError(
        'Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.',
      )
    // A replacer turns off ox's own form of a `bigint`, so each `bigint` takes that form here.
    return typeof entry === 'bigint' ? JSON.parse(Json.stringify(entry)) : entry
  })
}
