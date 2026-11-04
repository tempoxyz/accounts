/**
 * The plugin of a backend's sessions: one for each of its users, under a session ID that the
 * browser holds in a cookie. The sessions live in a `Store`, or in one Durable Object for each
 * session ID.
 * @module
 */
import { Base64, Bytes } from 'ox'
import type * as Funding from '../internal/Funding.js'
import * as BackendSessions from '../internal/backendSessions.js'
import * as Rpc from '../internal/rpc.js'
import * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'
import type { Store } from '../Store.js'

/**
 * Returns the plugin of a backend's sessions, which adds `backend.start`, `backend.complete`,
 * `backend.save`, `backend.get`, `backend.fetch`, and `backend.end`. Concurrent reads of one session
 * share one refresh, so one process serves each session: one process for a single server, or one
 * Durable Object for each session ID with `namespace`.
 *
 * A backend without a client secret uses its origin, such as `https://app.example`, as `clientId`.
 * Tempo ID then treats it as a third-party app: the user approves it on the approval page.
 *
 * @example
 * ```ts
 * const tempoId = Accounts.create({
 *   clientId,
 *   clientSecret,
 *   plugins: [email(), backend({ store: Store.redis(redis) })],
 * })
 *
 * const { id, url } = await tempoId.backend.start({ redirectUri })
 * ```
 */
export function backend(options: backend.Options) {
  return Plugin.from({
    actions: (context) => {
      const { config } = context
      const sessions = (() => {
        if ('store' in options)
          return local(BackendSessions.create(config, { store: options.store }))
        return remote(options.namespace, { clientId: config.clientId })
      })()

      return {
        /**
         * Redeems the callback of `start` for the session `id`, and stores the session. Throws
         * `Accounts.PendingNotFoundError` without a redirect in progress.
         */
        complete: (
          parameters: backend.complete.Parameters,
        ): Promise<BackendSessions.BackendSession> =>
          sessions.complete(parameters),
        /**
         * Revokes the session's refresh token at Tempo ID, then deletes the session. Throws
         * `Accounts.RequestError`, and keeps the session, when the revocation fails.
         */
        end: (parameters: { id: string }): Promise<void> =>
          sessions.end(parameters),
        /**
         * Sends a request with the session's access token, as `Actions.fetch` does, after a refresh
         * if necessary. Returns `undefined` without a session.
         */
        async fetch(
          parameters: backend.fetch.Parameters,
        ): Promise<Response | undefined> {
          const { init = {} } = parameters
          const url = new URL(parameters.url)
          const method = (init.method ?? 'GET').toUpperCase()
          // The sessions sign the request with the configuration that redeemed the tokens, such as a
          // Durable Object's, whose DPoP key bound them.
          const tokenHeaders = await sessions.headers({
            id: parameters.id,
            method,
            url: url.href,
          })
          if (!tokenHeaders) return undefined
          const headers = new Headers(init.headers)
          for (const [name, value] of Object.entries(tokenHeaders))
            headers.set(name, value)
          return (config.fetch ?? globalThis.fetch)(url, {
            ...init,
            headers,
            method,
          })
        },
        /**
         * Returns the session, after a refresh if its access token expires within 30 seconds, or
         * `undefined` if it never existed, ended, or its refresh token was refused.
         */
        get: (parameters: {
          id: string
        }): Promise<BackendSessions.BackendSession | undefined> =>
          sessions.get(parameters),
        /**
         * Stores a session from a sign-in without a redirect, such as an emailed code, under a new
         * session ID or `id`, and returns the ID.
         */
        save: (parameters: backend.save.Parameters): Promise<{ id: string }> =>
          sessions.save({
            id: parameters.id ?? newId(),
            session: parameters.session,
          }),
        /**
         * Starts a redirect sign-in, and stores its state for 10 minutes. Returns the session ID,
         * for an `HttpOnly` cookie, and the URL to redirect to.
         */
        start(
          parameters: backend.start.Parameters = {},
        ): Promise<{ id: string; url: string }> {
          const accessKey = SignIn.accessKey(context, parameters.accessKey)
          // A Durable Object builds a configuration of its own, without the instance's chain and
          // redirect URI, so the request names both.
          return sessions.start({
            accessKey: accessKey && {
              ...accessKey,
              chainId: accessKey.chainId ?? config.chainId,
            },
            funding: parameters.funding,
            id: parameters.id ?? newId(),
            redirectUri: parameters.redirectUri ?? config.redirectUri,
          })
        },
      }
    },
    id: 'backend',
  })
}

export declare namespace backend {
  /** A backend's session: the session without its ID token and refresh token, and its `sid`. */
  type Session = BackendSessions.BackendSession

  type Options =
    | {
        /**
         * Where the sessions and the redirects in progress live, unserialized. Each value holds an
         * access key's private key and a refresh token.
         */
        store: Store
      }
    | {
        /**
         * The Durable Object namespace of `DurableObject.sessions`, which holds each session in the
         * object that its ID names.
         */
        namespace: Namespace
      }

  /** The Durable Object namespace of `DurableObject.sessions`, as the plugin calls it. */
  type Namespace = {
    /** Returns the stub of the object that `name` names. */
    getByName: (name: string) => Stub
  }

  /** The RPC methods of a `DurableObject.sessions` object. */
  type Stub = {
    complete: (
      options: complete.Parameters,
    ) => Promise<Rpc.Result<Rpc.Wire<BackendSessions.BackendSession>>>
    end: (options: { id: string }) => Promise<Rpc.Result<void>>
    get: (options: {
      id: string
    }) => Promise<
      Rpc.Result<Rpc.Wire<BackendSessions.BackendSession> | undefined>
    >
    headers: (options: {
      id: string
      method: string
      url: string
    }) => Promise<Rpc.Result<Record<string, string> | undefined>>
    save: (options: {
      id: string
      session: Rpc.Wire<Session.Session>
    }) => Promise<Rpc.Result<{ id: string }>>
    start: (
      options: BackendSessions.start.Options & { id: string },
    ) => Promise<Rpc.Result<{ id: string; url: string }>>
  }

  namespace complete {
    type Parameters = {
      /** The session ID that `start` returned. */
      id: string
      /** The callback URL that Tempo ID redirected to. */
      url: string
    }
  }

  namespace fetch {
    type Parameters = {
      /** The session ID. */
      id: string
      /** The request's other options. Its `Authorization` and `DPoP` headers are replaced. */
      init?: RequestInit | undefined
      /** The request's URL. */
      url: string | URL
    }
  }

  namespace save {
    type Parameters = {
      /** The session ID. Defaults to 32 random bytes in URL-safe Base64. */
      id?: string | undefined
      /** The session that a sign-in returned. */
      session: Session.Session
    }
  }

  namespace start {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /** The amount that the app needs in the user's account, which opens the funding page. */
      funding?: Funding.Funding | undefined
      /** The session ID. Defaults to 32 random bytes in URL-safe Base64. */
      id?: string | undefined
      /** Defaults to the instance's `redirectUri`. */
      redirectUri?: string | undefined
    }
  }
}

/** The operations of the sessions, with the session ID that each takes. */
type Sessions = {
  complete: (
    options: backend.complete.Parameters,
  ) => Promise<BackendSessions.BackendSession>
  end: (options: { id: string }) => Promise<void>
  get: (options: {
    id: string
  }) => Promise<BackendSessions.BackendSession | undefined>
  headers: (options: {
    id: string
    method: string
    url: string
  }) => Promise<Record<string, string> | undefined>
  save: (options: {
    id: string
    session: Session.Session
  }) => Promise<{ id: string }>
  start: (
    options: BackendSessions.start.Options & { id: string },
  ) => Promise<{ id: string; url: string }>
}

/** Returns the sessions of a store in this process. */
function local(sessions: BackendSessions.create.ReturnType): Sessions {
  return {
    complete: sessions.complete,
    end: sessions.end,
    get: sessions.get,
    headers: sessions.headers,
    save: sessions.save,
    start: sessions.start,
  }
}

/**
 * Returns the sessions of a Durable Object namespace, one object for each session ID of the app
 * `clientId`.
 */
function remote(
  namespace: backend.Namespace,
  options: { clientId: string },
): Sessions {
  const stub = (id: string) =>
    namespace.getByName(Rpc.name({ clientId: options.clientId, id }))
  return {
    async complete(options) {
      return Rpc.fromWire(Rpc.unwrap(await stub(options.id).complete(options)))
    },
    async end(options) {
      Rpc.unwrap(await stub(options.id).end(options))
    },
    async get(options) {
      const wire = Rpc.unwrap(await stub(options.id).get(options))
      return wire && Rpc.fromWire(wire)
    },
    async headers(options) {
      return Rpc.unwrap(await stub(options.id).headers(options))
    },
    async save(options) {
      return Rpc.unwrap(
        await stub(options.id).save({
          id: options.id,
          session: Rpc.toWire(options.session),
        }),
      )
    },
    async start(options) {
      return Rpc.unwrap(await stub(options.id).start(options))
    },
  }
}

/** Returns a new session ID: 32 random bytes in unpadded URL-safe Base64. */
function newId() {
  return Base64.fromBytes(Bytes.random(32), { pad: false, url: true })
}
