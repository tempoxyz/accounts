import type * as Schema from '../Schema.js'
export type { Encoded, Decoded, Item } from '../Schema.js'
/** Defines a JSON-RPC method schema item. */
export declare function defineItem<const item extends Schema.Item>(item: item): item
/** Creates a {@link Schema}. */
export declare function from<const schema extends Schema.Schema>(schema: schema): schema
//# sourceMappingURL=schema.d.ts.map
