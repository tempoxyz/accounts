/**
 * The members of `cloudflare:workers` that the entry uses: the class that `DurableObject.sessions`
 * extends, and the `waitUntil` of `KeySet.cacheApi`. A Worker's own types, from
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
      storage: import('../stores/DurableObject.js').create.Storage
    }
    /** The Worker's bindings. */
    protected env: env
    constructor(ctx: unknown, env: env)
  }

  /** Keeps the Worker running until `promise` settles, also after the response. */
  export function waitUntil(promise: Promise<unknown>): void
}
