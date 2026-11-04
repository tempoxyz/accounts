/**
 * Runs a backend's sessions on Cloudflare Workers, in one Durable Object for each session ID.
 * @module
 */
/* istanbul ignore file -- The class runs only in workerd, which the suite reaches through a test Worker. */
import * as Workers from 'cloudflare:workers'
import * as Accounts from '../Accounts.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import * as Rpc from '../internal/Rpc.js'
import type * as Session from '../Session.js'
import * as Store from '../Store.js'

/**
 * Returns a Durable Object class that holds the session of the session ID that names each object,
 * for `backend({ namespace })`. Every request of a session reaches one object, so concurrent
 * requests share one refresh, and the object's storage holds the session. The object's `alarm`
 * deletes expired entries, such as an abandoned redirect.
 *
 * An object's name holds the app's client ID beside the session ID, so one class serves several
 * apps. `config` returns the configuration of the app `clientId` from the Worker's bindings, in each
 * object and never at module scope, and throws for an app that the Worker does not serve.
 *
 * @example
 * ```ts
 * export const SESSIONS = DurableObject.sessions((env: Env) => ({
 *   clientSecret: env.CLIENT_SECRET,
 * }))
 * ```
 */
export function sessions<env>(
  config: (env: env, options: { clientId: string }) => sessions.Config,
): sessions.Class<env> {
  return class Sessions extends Workers.DurableObject<env> {
    /** The object's storage, which holds its session and its redirect in progress. */
    #store = Store.durableObject(this.ctx.storage)
    /** The sessions in the object's storage, which the first call creates. An alarm needs none. */
    #instance: ReturnType<typeof BackendSessions.create> | undefined

    /** Deletes the expired entries. An alarm can fire more than once, which changes nothing. */
    alarm() {
      return this.#store.alarm()
    }

    complete(options: { id: string; url: string }) {
      return Rpc.wrap(async () =>
        Rpc.toWire(await this.#sessions().complete(options)),
      )
    }

    end(options: { id: string }) {
      return Rpc.wrap(() => this.#sessions().end(options))
    }

    get(options: { id: string }) {
      return Rpc.wrap(async () => {
        const session = await this.#sessions().get(options)
        return session && Rpc.toWire(session)
      })
    }

    headers(options: { id: string; method: string; url: string }) {
      return Rpc.wrap(() => this.#sessions().headers(options))
    }

    save(options: { id: string; session: Rpc.Wire<Session.Session> }) {
      return Rpc.wrap(() =>
        this.#sessions().save({
          id: options.id,
          session: Rpc.fromWire(options.session),
        }),
      )
    }

    start(options: BackendSessions.start.Options & { id: string }) {
      return Rpc.wrap(() => this.#sessions().start(options))
    }

    /** Returns the sessions of the app that the object's name holds. */
    #sessions() {
      if (this.#instance) return this.#instance
      const { clientId } = Rpc.parseName(this.ctx.id.name)
      this.#instance = BackendSessions.create(
        Accounts.create({
          ...config(this.env, { clientId }),
          clientId,
        }).config,
        { store: this.#store },
      )
      return this.#instance
    }
  }
}

export declare namespace sessions {
  /** The Durable Object class, whose instances serve the RPC methods of {@link Instance}. */
  type Class<env> = new (
    ctx: never,
    env: env,
  ) => Workers.DurableObject<env> & Instance

  /** The RPC methods of an object, which `backend({ namespace })` calls. */
  type Instance = {
    /** Deletes the expired entries. */
    alarm: () => Promise<void>
    /** Redeems the callback of the session's redirect, and stores the session. */
    complete: (options: {
      id: string
      url: string
    }) => Promise<Rpc.Result<Rpc.Wire<BackendSessions.BackendSession>>>
    /** Revokes the session's refresh token, then deletes the session. */
    end: (options: { id: string }) => Promise<Rpc.Result<void>>
    /** Returns the session, after a refresh if necessary. */
    get: (options: {
      id: string
    }) => Promise<
      Rpc.Result<Rpc.Wire<BackendSessions.BackendSession> | undefined>
    >
    /** Returns the headers that send the session's access token, signed with the object's key. */
    headers: (options: {
      id: string
      method: string
      url: string
    }) => Promise<Rpc.Result<Record<string, string> | undefined>>
    /** Stores a session from a sign-in without a redirect. */
    save: (options: {
      id: string
      session: Rpc.Wire<Session.Session>
    }) => Promise<Rpc.Result<{ id: string }>>
    /** Starts the session's redirect sign-in. */
    start: (
      options: BackendSessions.start.Options & { id: string },
    ) => Promise<Rpc.Result<{ id: string; url: string }>>
  }

  /** The app's configuration: the client authentication that only a backend holds, and its URLs. */
  type Config = Pick<
    Accounts.create.Options,
    'clientAssertion' | 'clientSecret' | 'dpop' | 'fetch' | 'scope' | 'url'
  >
}
