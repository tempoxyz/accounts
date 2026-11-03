/**
 * The member of `cloudflare:workers` that `DurableObject.sessions` extends. A Worker's own types, from
 * `@cloudflare/workers-types` or `wrangler types`, declare the full module.
 * @module
 */
declare module 'cloudflare:workers' {
  /** The base class of a Durable Object that serves RPC. */
  export abstract class DurableObject<env = unknown> {
    /** The object's state, with its ID and its storage. */
    protected ctx: {
      /** The object's ID, whose `name` is the name that reached the object. */
      id: { name?: string | undefined }
      /** The object's storage. */
      storage: import('../Store.js').durableObject.Storage
    }
    /** The Worker's bindings. */
    protected env: env
    constructor(ctx: unknown, env: env)
  }
}
