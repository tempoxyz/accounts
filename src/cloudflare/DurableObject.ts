/**
 * Runs a backend's sessions on Cloudflare Workers, in one Durable Object for each session ID, and an
 * API's connections, in one Durable Object for each connection.
 * @module
 */
/* istanbul ignore file -- The class runs only in workerd, which the suite reaches through a test Worker. */
import * as Workers from 'cloudflare:workers'
import type { TransactionReceipt } from 'viem'
import * as Accounts from '../Accounts.js'
import * as InternalConnections from '../internal/Connections.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as Rpc from './Rpc.js'
import * as Store from './Store.js'

/**
 * Returns a Durable Object class that holds an API's connections on Cloudflare Workers, which
 * `Connections.durableObject` reaches. Each object holds one user's connection of an app, so
 * concurrent requests of a connection redeem its allowance once, or one app's prepared access keys
 * from the access key endpoint, since an access key request names the app but no user. The prepared
 * access keys stay in the app's object until a redemption claims them. The object's storage holds
 * the access keys' private keys through `Store.durableObject`, and its `alarm` deletes expired
 * entries.
 *
 * An object's name holds the API's client ID and resource beside the app's client ID and the
 * user's ID, so one class serves several APIs. `config` returns the configuration of the API's
 * OAuth app `clientId` from the Worker's bindings, in each object and never at module scope, and
 * throws for an API that the Worker does not serve. The object passes `clientId` itself.
 *
 * The Worker verifies each token before it calls an object. The object connects and revokes at
 * Tempo ID.
 *
 * The Worker's Wrangler configuration binds the class with a SQLite migration:
 *
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "class_name": "CONNECTIONS", "name": "CONNECTIONS" }],
 *   },
 *   "migrations": [{ "new_sqlite_classes": ["CONNECTIONS"], "tag": "v1" }],
 * }
 * ```
 *
 * @throws {Accounts.RequestError} In an object, for a refusal of `accounts.connections`. The
 * refusal reaches the Worker's call.
 * @throws {AccessToken.InvalidError} In the Worker, before a call reaches an object.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { Connections, DurableObject } from 'accounts/cloudflare'
 * import { viem } from 'accounts/plugins'
 *
 * type Env = {
 *   API_CLIENT_ID: string
 *   API_CLIENT_SECRET: string
 *   CONNECTIONS: Connections.durableObject.Namespace
 * }
 *
 * export const CONNECTIONS = DurableObject.connections(
 *   (env: Env, options: { clientId: string }) => {
 *     if (options.clientId !== env.API_CLIENT_ID) throw new Error('Unknown API.')
 *     return { clientSecret: env.API_CLIENT_SECRET }
 *   },
 * )
 *
 * // In each request of the Worker:
 * const accounts = Accounts.create({
 *   clientId: env.API_CLIENT_ID,
 *   clientSecret: env.API_CLIENT_SECRET,
 *   connections: Connections.durableObject(env.CONNECTIONS, {
 *     resource: 'https://api.example/mcp',
 *   }),
 *   plugins: [viem()],
 * })
 * const { connection } = await accounts.connections.connect({ accessToken })
 * ```
 */
export function connections<env>(
  config: (env: env, options: { clientId: string }) => connections.Config,
): connections.Class<env> {
  return class Connections extends Workers.DurableObject<env> {
    /** The object's storage, which holds its connection or its app's prepared access keys. */
    #store = Store.durableObject(this.ctx.storage)
    /** The connections in the object's storage, which the first call creates. An alarm needs none. */
    #instance: InternalConnections.create.ReturnType | undefined
    /** The prepared access keys in the object's storage, one instance so its claims run in turn. */
    #prepared: InternalConnections.pending.ReturnType | undefined

    /** Deletes the expired entries. An alarm can fire more than once, which changes nothing. */
    alarm() {
      return this.#store.alarm()
    }

    get(options: InternalConnections.create.get.Options) {
      return Rpc.wrap(() => this.#connections().get(options))
    }

    prepare(options: InternalConnections.pending.prepare.Options) {
      return Rpc.wrap(() => this.#pending().prepare(options))
    }

    read(options: InternalConnections.pending.read.Options) {
      return Rpc.wrap(() => this.#pending().read(options))
    }

    remove(options: InternalConnections.pending.read.Options) {
      return Rpc.wrap(() => this.#pending().remove(options))
    }

    // A stub's own `connect` opens a TCP socket, so the RPC method that connects has another name.
    resolve(options: InternalConnections.create.connect.Options) {
      return Rpc.wrap(() => this.#connections().connect(options))
    }

    revoke(options: InternalConnections.create.get.Options) {
      return Rpc.wrap(() => this.#connections().revoke(options))
    }

    revokeAccessKey(
      options: InternalConnections.create.revokeAccessKey.Options,
    ) {
      return Rpc.wrap(() => this.#connections().revokeAccessKey(options))
    }

    /** Returns the connections of the API that the object's name holds. */
    #connections() {
      if (this.#instance) return this.#instance
      const { apiClientId, resource } = Rpc.parseConnectionName(
        this.ctx.id.name,
      )
      this.#instance = InternalConnections.create(
        Accounts.create({
          ...config(this.env, { clientId: apiClientId }),
          clientId: apiClientId,
        }).config,
        { resource, store: this.#store },
      )
      return this.#instance
    }

    /** Returns the prepared access keys of the app that the object's name holds. */
    #pending() {
      if (this.#prepared) return this.#prepared
      const { resource } = Rpc.parseConnectionName(this.ctx.id.name)
      this.#prepared = InternalConnections.pending(this.#store, { resource })
      return this.#prepared
    }
  }
}

export declare namespace connections {
  /**
   * The Durable Object class, whose instances serve the RPC methods of {@link Instance}. The
   * object of a connection serves `resolve`, `get`, `revoke`, and `revokeAccessKey`. The object of
   * an app serves `prepare`, `read`, and `remove`. The Worker's entry exports the class under the
   * name of its binding.
   */
  type Class<env> = new (
    ctx: never,
    env: env,
  ) => Workers.DurableObject<env> & Instance

  /** The RPC methods of an object, which `Connections.durableObject` calls. */
  type Instance = {
    /** Deletes the expired entries. */
    alarm: () => Promise<void>
    /** Returns the stored connection, or `undefined` without a live access key. */
    get: (
      options: InternalConnections.create.get.Options,
    ) => Promise<Rpc.Result<InternalConnections.Connection | undefined>>
    /** Generates an access key for a verified access key request of the object's app. */
    prepare: (
      options: InternalConnections.pending.prepare.Options,
    ) => Promise<Rpc.Result<InternalConnections.pending.prepare.ReturnType>>
    /** Returns the unexpired prepared access keys of the object's app. */
    read: (
      options: InternalConnections.pending.read.Options,
    ) => Promise<Rpc.Result<readonly InternalConnections.Pending[]>>
    /** Discards prepared access keys of the object's app. */
    remove: (
      options: InternalConnections.pending.read.Options,
    ) => Promise<Rpc.Result<void>>
    /** Returns the connection of a verified token. A stub's own `connect` opens a TCP socket. */
    resolve: (
      options: InternalConnections.create.connect.Options,
    ) => Promise<
      Rpc.Result<
        | InternalConnections.create.connect.ReturnType
        | InternalConnections.create.connect.Unclaimed
      >
    >
    /** Revokes every access key of the connection, then deletes the connection. */
    revoke: (
      options: InternalConnections.create.get.Options,
    ) => Promise<Rpc.Result<readonly TransactionReceipt[]>>
    /** Revokes one access key of the connection. */
    revokeAccessKey: (
      options: InternalConnections.create.revokeAccessKey.Options,
    ) => Promise<Rpc.Result<TransactionReceipt | null>>
  }

  /** The API's configuration: the client authentication of its OAuth app, and its URLs. */
  type Config = Pick<
    Accounts.create.Options,
    'clientAssertion' | 'clientSecret' | 'fetch' | 'url'
  >
}

/**
 * Returns a Durable Object class that holds a backend's sessions on Cloudflare Workers: each
 * object holds the session of the session ID that names it. The `backend` plugin reaches the
 * objects through `Sessions.durableObject`. Every request of a session reaches one object, so
 * concurrent requests share one refresh. The object's storage holds the session, its pending
 * redirect, and its challenges through `Store.durableObject`. An object whose name holds an entry's
 * key in place of a session ID holds that entry of the plugin's `store`, such as a mark of a
 * registered access key. The object of each Tempo ID session's `sid` holds the index of its session
 * IDs, which a logout token reads. The object's `alarm` deletes expired entries, such as an abandoned
 * redirect. The object refreshes and revokes at Tempo ID.
 *
 * An object's name holds the app's client ID beside the session ID, so one class serves several
 * apps. `config` returns the configuration of the app `clientId` from the Worker's bindings, or a
 * promise of it, once in each object and never at module scope, and throws for an app that the
 * Worker does not serve. The object passes `clientId` itself. The object's first call awaits a
 * promise, and concurrent calls share it. A rejected promise leaves no configuration, so the next
 * call reads it again.
 *
 * A DPoP key binds the session's tokens only if the object holds the same DPoP key at each
 * refresh. The object can lose its memory at any time, so `config` imports a stored DPoP key,
 * which `crypto.subtle.importKey` does asynchronously.
 *
 * The Worker's Wrangler configuration binds the class with a SQLite migration:
 *
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "class_name": "SESSIONS", "name": "SESSIONS" }],
 *   },
 *   "migrations": [{ "new_sqlite_classes": ["SESSIONS"], "tag": "v1" }],
 * }
 * ```
 *
 * @throws {Accounts.PendingNotFoundError} In an object, as the `backend` plugin's actions throw it.
 * The error reaches the Worker's call.
 * @throws {Accounts.RedirectUriRequiredError} In an object, from `start` without a `redirectUri`.
 * The error reaches the Worker's call.
 * @throws {Accounts.RequestError} In an object, as the `backend` plugin's actions throw it. The
 * refusal reaches the Worker's call.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { DurableObject, Sessions } from 'accounts/cloudflare'
 * import { Dpop } from 'accounts/internal'
 * import { backend } from 'accounts/plugins'
 *
 * type Env = {
 *   CLIENT_ID: string
 *   CLIENT_SECRET: string
 *   DPOP_KEY: string
 *   SESSIONS: Sessions.durableObject.Namespace
 * }
 *
 * export const SESSIONS = DurableObject.sessions(
 *   async (env: Env, options: { clientId: string }) => {
 *     if (options.clientId !== env.CLIENT_ID) throw new Error('Unknown app.')
 *
 *     const jwk = JSON.parse(env.DPOP_KEY) as JsonWebKey
 *     const privateKey = await crypto.subtle.importKey(
 *       'jwk',
 *       jwk,
 *       { name: 'ECDSA', namedCurve: 'P-256' },
 *       false,
 *       ['sign'],
 *     )
 *     return {
 *       clientSecret: env.CLIENT_SECRET,
 *       dpop: Dpop.from({
 *         jwk: { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! },
 *         privateKey,
 *       }),
 *     }
 *   },
 * )
 *
 * // In each request of the Worker:
 * const accounts = Accounts.create({
 *   clientId: env.CLIENT_ID,
 *   clientSecret: env.CLIENT_SECRET,
 *   plugins: [backend({ sessions: Sessions.durableObject(env.SESSIONS) })],
 * })
 * ```
 */
export function sessions<env>(
  config: (
    env: env,
    options: { clientId: string },
  ) => sessions.Config | Promise<sessions.Config>,
): sessions.Class<env> {
  return class Sessions extends Workers.DurableObject<env> {
    /** The object's storage, which holds its session and its redirect in progress. */
    #store = Store.durableObject(this.ctx.storage)
    /**
     * The sessions in the object's storage, which the first call creates and concurrent calls share.
     * An alarm needs none.
     */
    #instance: Promise<BackendSessions.create.ReturnType> | undefined

    /** Deletes the expired entries. An alarm can fire more than once, which changes nothing. */
    alarm() {
      return this.#store.alarm()
    }

    complete(options: sessions.Call<{ id: string; url: string }>) {
      return Rpc.wrap(async () =>
        Rpc.toWire(await (await this.#sessions(options)).complete(options)),
      )
    }

    discard(options: sessions.Call<{ id: string }>) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).end({
          id: options.id,
          revoke: false,
        }),
      )
    }

    end(options: sessions.Call<{ id: string }>) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).end({ id: options.id }),
      )
    }

    endSid(
      options: sessions.Call<{
        id: string
        issuedAt?: number | undefined
        revoke?: boolean | undefined
        sid: string
      }>,
    ) {
      return Rpc.wrap(async () => (await this.#sessions(options)).end(options))
    }

    get(options: sessions.Call<{ id: string }>) {
      return Rpc.wrap(async () => {
        const session = await (await this.#sessions(options)).get(options)
        return session && Rpc.toWire(session)
      })
    }

    getItem(options: { key: string }) {
      return Rpc.wrap(() => this.#store.getItem(options.key))
    }

    headers(
      options: sessions.Call<{ id: string; method: string; url: string }>,
    ) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).headers(options),
      )
    }

    issue(options: sessions.Call<BackendSessions.issue.Options>) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).issue(options),
      )
    }

    close(options: sessions.Call<BackendSessions.close.Options>) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).close(options),
      )
    }

    link(options: sessions.Call<BackendSessions.link.Options>) {
      return Rpc.wrap(async () => (await this.#sessions(options)).link(options))
    }

    removeItem(options: { key: string }) {
      return Rpc.wrap(() => this.#store.removeItem(options.key))
    }

    save(
      options: sessions.Call<{
        id: string
        session: Rpc.Wire<BackendSessions.save.Options['session']>
      }>,
    ) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).save({
          id: options.id,
          session: Rpc.fromWire(options.session),
        }),
      )
    }

    setItem(options: {
      expiresAt?: number | undefined
      key: string
      value: unknown
    }) {
      const { expiresAt, key, value } = options
      return Rpc.wrap(() =>
        this.#store.setItem(
          key,
          value,
          expiresAt === undefined ? {} : { expiresAt },
        ),
      )
    }

    start(
      options: sessions.Call<BackendSessions.start.Options & { id: string }>,
    ) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).start(options),
      )
    }

    take(options: sessions.Call<BackendSessions.take.Options>) {
      return Rpc.wrap(async () => (await this.#sessions(options)).take(options))
    }

    unlink(options: sessions.Call<BackendSessions.unlink.Options>) {
      return Rpc.wrap(async () =>
        (await this.#sessions(options)).unlink(options),
      )
    }

    /**
     * Returns the sessions of the app that the object's name holds. Without a `url` of `config`,
     * the sessions use `tempoIdUrl`, the Tempo ID of the Worker's instance, and without a `scope`
     * of `config`, the `scope` of the Worker's instance. A configuration that rejects leaves no
     * instance, so the next call reads it again.
     */
    #sessions(call: sessions.Call<object>) {
      if (this.#instance) return this.#instance
      const { scope, tempoIdUrl } = call
      const instance = (async () => {
        const { clientId } = Rpc.parseName(this.ctx.id.name)
        return BackendSessions.create(
          Accounts.create({
            ...(scope ? { scope } : {}),
            ...(tempoIdUrl ? { url: tempoIdUrl } : {}),
            ...(await config(this.env, { clientId })),
            clientId,
          }).config,
          { store: this.#store },
        )
      })().catch((error: unknown) => {
        this.#instance = undefined
        throw error
      })
      this.#instance = instance
      return instance
    }
  }
}

export declare namespace sessions {
  /**
   * The Durable Object class, whose instances serve the RPC methods of {@link Instance}. The
   * Worker's entry exports the class under the name of its binding. The Worker deploys the class
   * with the package, since an object of an earlier release lacks `discard`, `getItem`, `issue`,
   * `removeItem`, `setItem`, and `take`.
   */
  type Class<env> = new (
    ctx: never,
    env: env,
  ) => Workers.DurableObject<env> & Instance

  /** The RPC methods of an object, which `Sessions.durableObject` calls. */
  type Instance = {
    /** Deletes the expired entries. */
    alarm: () => Promise<void>
    /** Redeems the callback of the session's redirect, and stores the session. */
    complete: (
      options: Call<{
        id: string
        url: string
      }>,
    ) => Promise<Rpc.Result<Rpc.Wire<BackendSessions.BackendSession>>>
    /** Deletes the session without a revocation, for a session that Tempo ID ended. */
    discard: (options: Call<{ id: string }>) => Promise<Rpc.Result<void>>
    /** Revokes the session's refresh token, then deletes the session. */
    end: (options: Call<{ id: string }>) => Promise<Rpc.Result<void>>
    /**
     * Ends the session as `end`, or as `discard` with `revoke: false`, only while it names `sid`,
     * so a session of another `sid` stays. An object of an earlier release lacks it, and reads only
     * `id` from `end` and `discard`, so a call with `sid` throws there rather than end such a
     * session.
     */
    endSid: (
      options: Call<{
        id: string
        issuedAt?: number | undefined
        revoke?: boolean | undefined
        sid: string
      }>,
    ) => Promise<Rpc.Result<void>>
    /** Returns the session, after a refresh if necessary: a Tempo ID session, or a SIWE session. */
    get: (
      options: Call<{
        id: string
      }>,
    ) => Promise<
      Rpc.Result<
        | Rpc.Wire<BackendSessions.BackendSession | BackendSessions.SiweSession>
        | undefined
      >
    >
    /** Returns the value of the object's entry at `key`, or `undefined`. */
    getItem: (options: { key: string }) => Promise<Rpc.Result<unknown>>
    /** Returns the headers that send the session's access token, signed with the object's key. */
    headers: (
      options: Call<{
        id: string
        method: string
        url: string
      }>,
    ) => Promise<Rpc.Result<Record<string, string> | undefined>>
    /**
     * Stores a challenge of the session: its SIWE sign-in's, or an approval's. The `siwe` plugin
     * stores each challenge with `issue` and spends it with `take`, in the object of its session
     * ID, so each challenge verifies once.
     */
    issue: (
      options: Call<BackendSessions.issue.Options>,
    ) => Promise<Rpc.Result<void>>
    /**
     * Closes the index of a `sid` at its logout token, in the object of the `sid`, and returns its
     * session IDs, which it keeps until `unlink` removes each.
     */
    close: (
      options: Call<BackendSessions.close.Options>,
    ) => Promise<Rpc.Result<readonly BackendSessions.Entry[]>>
    /**
     * Adds a session ID to the index of its `sid`. The object of the `sid`, which
     * `Rpc.indexName` names, holds the index.
     */
    link: (
      options: Call<BackendSessions.link.Options>,
    ) => Promise<Rpc.Result<BackendSessions.link.ReturnType>>
    /** Deletes the object's entry at `key`. */
    removeItem: (options: { key: string }) => Promise<Rpc.Result<void>>
    /** Stores a session from a sign-in without a redirect, such as a SIWE session. */
    save: (
      options: Call<{
        id: string
        session: Rpc.Wire<BackendSessions.save.Options['session']>
      }>,
    ) => Promise<Rpc.Result<BackendSessions.save.ReturnType>>
    /**
     * Writes `value` at `key` in the object's storage, such as a mark of a registered access key.
     * An entry with `expiresAt`, in milliseconds, sets the alarm that deletes it.
     */
    setItem: (options: {
      expiresAt?: number | undefined
      key: string
      value: unknown
    }) => Promise<Rpc.Result<void>>
    /** Starts the session's redirect sign-in. */
    start: (
      options: Call<BackendSessions.start.Options & { id: string }>,
    ) => Promise<Rpc.Result<{ id: string; url: string }>>
    /** Deletes a challenge of the session, and returns it, once. */
    take: (
      options: Call<BackendSessions.take.Options>,
    ) => Promise<Rpc.Result<BackendSessions.Challenge | undefined>>
    /** Removes the session IDs that ended from the index of a `sid`, in the object of the `sid`. */
    unlink: (
      options: Call<BackendSessions.unlink.Options>,
    ) => Promise<Rpc.Result<void>>
  }

  /**
   * The options of a session's RPC method, with the Tempo ID and the scopes of the Worker's
   * instance, which `Sessions.durableObject` sends with each call.
   */
  type Call<options> = options & {
    /**
     * The `scope` of the Worker's instance. The object's sessions use it without a `scope` of
     * `config`, so a sign-in requests the scopes of the Worker's instance. Absent from a Worker of
     * an earlier release.
     */
    scope?: string | undefined
    /**
     * The `url` of the Worker's instance. The object's sessions use it without a `url` of
     * `config`. Absent from a Worker of an earlier release.
     */
    tempoIdUrl?: string | undefined
  }

  /**
   * The app's configuration: the client authentication that only a backend holds, and its URLs.
   * Without `url` or `scope`, the object uses the `url` or the `scope` of the Worker's instance.
   */
  type Config = Pick<
    Accounts.create.Options,
    'clientAssertion' | 'clientSecret' | 'dpop' | 'fetch' | 'scope' | 'url'
  >
}
