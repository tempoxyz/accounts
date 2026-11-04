/**
 * The expiry of a store's entries, which `Store.durableObject`, `Store.file`, and `Store.memory` hold
 * beside each value.
 * @module
 */
/** A value with its expiry, as a store holds it. */
export type Entry<value> = {
  /** When the entry expires, in milliseconds. Absent, it never expires. */
  expiresAt: number | undefined
  /** The stored value. */
  value: value
}

/** Returns whether `entry` expired. */
export function expired(entry: Entry<unknown>) {
  return entry.expiresAt !== undefined && entry.expiresAt <= Date.now()
}
