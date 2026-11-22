/**
 * The JSON form of a store's values, as the stores that serialize them write it.
 * @module
 */
/** The suffix of a `bigint`'s string, as ox's `Json` writes it. */
const bigintSuffix = '#__bigint'

/**
 * The escape of a string that ends with `#__bigint`, before that suffix. An earlier version wrote
 * such a string verbatim, and its read failed for any text before the suffix other than an integer,
 * so no readable value of that version ends with `#__string#__bigint`, and each of its strings reads
 * unchanged.
 */
const stringEscape = '#__string'

/** The integer text of a `bigint`, before its suffix. */
const integer = /^-?\d+$/

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
    return decode(text)
  } catch {
    throw new InvalidValueError()
  }
}

/**
 * Returns the value of `text`, as {@link parse} does, and throws the parser's own error. A string
 * that {@link stringify} escaped reads as written. A string of an earlier version reads unchanged,
 * and one that ends with `#__bigint` reads as a `bigint` only if an integer precedes the suffix,
 * and as the string otherwise, so one stored string never fails the read of the entries beside it.
 */
export function decode(text: string): unknown {
  return JSON.parse(text, (_key, entry: unknown) => {
    if (typeof entry !== 'string' || !entry.endsWith(bigintSuffix)) return entry
    const body = entry.slice(0, -bigintSuffix.length)
    if (integer.test(body)) return BigInt(body)
    if (body.endsWith(stringEscape)) return body.slice(0, -stringEscape.length)
    return entry
  }) as unknown
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
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof CryptoKey !== 'undefined' && entry instanceof CryptoKey)
      throw new TypeError(
        'Unserializable value: a non-extractable access key has no JSON form. In a browser, keep the session in the default store.',
      )
    // Each `bigint` takes ox's form, an integer with the suffix `#__bigint`.
    if (typeof entry === 'bigint') return `${entry}${bigintSuffix}`
    // A string that ends with the suffix, such as an app's SIWE statement, takes the escape before
    // it, so its read returns the same string, and never a `bigint`.
    if (typeof entry === 'string' && entry.endsWith(bigintSuffix))
      return `${entry}${stringEscape}${bigintSuffix}`
    return entry
  })
}
