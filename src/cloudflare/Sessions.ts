/**
 * A backend's sessions that live outside the process: `durableObject`, in the Durable Objects of
 * a namespace.
 * @module
 */
import { PendingNotFoundError } from '../Accounts.js'
import * as BackendSessions from '../internal/BackendSessions.js'
import type { backend } from '../plugins/backend.js'
import type { sessions } from './DurableObject.js'
import * as Rpc from './Rpc.js'

/**
 * The longest name of a Durable Object that the object reads as `ctx.id.name`, in UTF-8 bytes. An
 * object of a longer name reads no name, so it throws at each call and never holds a session.
 */
const maxNameSize = 1024

/**
 * Returns the `sessions` of the `backend` plugin, which reaches each session in the Durable Object of
 * `namespace` that its session ID names, whose class `DurableObject.sessions` returns. An object's
 * name holds the app's client ID beside the session ID, so one namespace serves several apps.
 *
 * The plugin calls the returned function once with the instance's `clientId`. It returns the
 * operations of the sessions, each of which calls the RPC method of the same name on the object of
 * its session ID. `close`, `link`, and `unlink` call the object of the session's `sid`, which holds the
 * index of its session IDs. `end` with `sid` calls `endSid`, and `end` with `revoke: false` calls
 * `discard`. Its `store` keeps each entry in the object that the entry's key names, so every
 * request's instance shares the `viem` plugin's marks of registered access keys. An object of an
 * earlier release lacks `close`, `discard`, `endSid`, `issue`, `link`, `take`, `unlink`, and the
 * methods of `store`, so those calls throw. Its `start` drops `loginHint` and `prompt` without an
 * error, so during a rollout such a sign-in reuses the browser's Tempo ID session.
 *
 * A session ID whose object name exceeds 1024 bytes, such as the value of a crafted cookie, names
 * no session. `get`, `headers`, `end`, and `take` then return without a call, and `complete`
 * throws `Accounts.PendingNotFoundError`, as for any other unknown ID.
 *
 * @throws {Accounts.PendingNotFoundError} From a returned operation, when an object returns it.
 * @throws {Accounts.RedirectUriRequiredError} From `start`, when neither the call nor the instance
 * names a `redirectUri`.
 * @throws {Accounts.RequestError} From a returned operation, for a refusal that an object returns.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { DurableObject, Sessions } from 'accounts/cloudflare'
 * import { backend } from 'accounts/plugins'
 *
 * type Env = {
 *   CLIENT_ID: string
 *   CLIENT_SECRET: string
 *   SESSIONS: Sessions.durableObject.Namespace
 * }
 *
 * export const SESSIONS = DurableObject.sessions((env: Env) => ({
 *   clientSecret: env.CLIENT_SECRET,
 * }))
 *
 * // In each request of the Worker:
 * const accounts = Accounts.create({
 *   clientId: env.CLIENT_ID,
 *   clientSecret: env.CLIENT_SECRET,
 *   plugins: [backend({ sessions: Sessions.durableObject(env.SESSIONS) })],
 * })
 * ```
 */
export function durableObject(
  namespace: durableObject.Namespace,
): backend.Sessions.Adapter {
  return (app) => {
    // Each object that holds a session uses the instance's Tempo ID, unless its `config` names one.
    const { url: tempoIdUrl } = app
    const stub = (id: string) =>
      namespace.getByName(Rpc.name({ clientId: app.clientId, id }))
    const index = (sid: string) =>
      namespace.getByName(Rpc.indexName({ clientId: app.clientId, sid }))
    /** Returns whether the object of the session `id` can read its name, and so hold a session. */
    const named = (id: string) =>
      new TextEncoder().encode(Rpc.name({ clientId: app.clientId, id }))
        .byteLength <= maxNameSize
    return {
      async complete(options) {
        if (!named(options.id)) throw new PendingNotFoundError()
        return current(
          Rpc.fromWire(
            Rpc.unwrap(
              await stub(options.id).complete({ ...options, tempoIdUrl }),
            ),
          ),
          options.id,
        )
      },
      async end(options) {
        const { id, issuedAt, revoke, sid } = options
        if (!named(id)) return
        // An object of an earlier release reads only `id` from `end` and `discard`, and would end a
        // session of another `sid`. It has no `endSid`, so a call with `sid` throws there instead,
        // and a logout token's retry ends the session.
        if (sid !== undefined)
          Rpc.unwrap(
            await stub(id).endSid({ id, issuedAt, revoke, sid, tempoIdUrl }),
          )
        // An object of an earlier release reads only `id` from `end`, and would revoke. It has no
        // `discard`, so the call throws instead.
        else if (revoke === false)
          Rpc.unwrap(await stub(id).discard({ id, tempoIdUrl }))
        else Rpc.unwrap(await stub(id).end({ id, tempoIdUrl }))
      },
      async get(options) {
        if (!named(options.id)) return undefined
        const wire = Rpc.unwrap(
          await stub(options.id).get({ ...options, tempoIdUrl }),
        )
        return wire && current(Rpc.fromWire(wire), options.id)
      },
      async headers(options) {
        if (!named(options.id)) return undefined
        return Rpc.unwrap(
          await stub(options.id).headers({ ...options, tempoIdUrl }),
        )
      },
      async issue(options) {
        Rpc.unwrap(await stub(options.id).issue({ ...options, tempoIdUrl }))
      },
      async close(options) {
        return Rpc.unwrap(
          await index(options.sid).close({ ...options, tempoIdUrl }),
        )
      },
      async link(options) {
        return Rpc.unwrap(
          await index(options.sid).link({ ...options, tempoIdUrl }),
        )
      },
      async save(options) {
        const { session } = options
        const saved = Rpc.unwrap(
          await stub(options.id).save({
            id: options.id,
            session: Rpc.toWire(session),
            tempoIdUrl,
          }),
        )
        // An object of an earlier release returns only `id`, while a deployment runs both releases.
        const sid =
          saved.sid ??
          ('idToken' in session
            ? BackendSessions.sessionId(session.idToken)
            : undefined)
        return { ...saved, ...(sid ? { sid } : {}) }
      },
      async start(options) {
        return Rpc.unwrap(
          await stub(options.id).start({ ...options, tempoIdUrl }),
        )
      },
      // Each entry, such as a mark of a registered access key, lives in the object that its key
      // names. Each key starts with `tempo-id:`, which no session ID of the plugin holds, so no entry
      // shares a session's object.
      store: {
        async getItem(key) {
          return Rpc.unwrap(await stub(key).getItem({ key }))
        },
        async removeItem(key) {
          Rpc.unwrap(await stub(key).removeItem({ key }))
        },
        async setItem(key, value, options = {}) {
          Rpc.unwrap(await stub(key).setItem({ ...options, key, value }))
        },
      },
      async take(options) {
        if (!named(options.id)) return undefined
        return Rpc.unwrap(
          await stub(options.id).take({ ...options, tempoIdUrl }),
        )
      },
      async unlink(options) {
        Rpc.unwrap(await index(options.sid).unlink({ ...options, tempoIdUrl }))
      },
    }
  }
}

export declare namespace durableObject {
  /**
   * The Durable Object namespace of the class that `DurableObject.sessions` returns, as the plugin
   * calls it: the Worker's binding. The function calls only `getByName` on it.
   */
  type Namespace = {
    /** Returns the stub of the object that `name` names. */
    getByName: (name: string) => Stub
  }

  /** The RPC methods of an object that the plugin calls. */
  type Stub = Omit<sessions.Instance, 'alarm'>
}

/**
 * Returns `session` with `id` and `method`. An object of an earlier release returns a Tempo ID
 * session without both, while a deployment runs both releases.
 */
function current<session extends backend.Session.Cookie>(
  session: session,
  id: string,
): session {
  if ((session as { method?: string | undefined }).method) return session
  return { ...session, id, method: 'tempo-id' }
}
