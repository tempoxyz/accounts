import type * as Schema from '../Schema.js'

export type { Encoded, Decoded, Item } from '../Schema.js'

/** Defines a JSON-RPC method schema item. */
export function defineItem<const item extends Schema.Item>(item: item): item {
  return item
}

/** Creates a {@link Schema}. */
export function from<const schema extends Schema.Schema>(schema: schema): schema {
  return schema
}
