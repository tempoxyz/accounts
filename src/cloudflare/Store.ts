/**
 * The stores of the package's main entry, with `durableObject`, a store in a Durable Object's
 * storage, and `workersKv`, a store in a Workers KV namespace.
 * @module
 */
export * from '../Store.js'
export { create as durableObject } from '../stores/DurableObject.js'
export { create as workersKv } from '../stores/WorkersKv.js'
