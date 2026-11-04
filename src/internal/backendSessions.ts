/**
 * The sessions of a backend's users, in a `Store`: each redirect in progress, and each session with
 * its tokens and access key. Concurrent reads of one session share one refresh. `backend` and
 * `DurableObject.sessions` run it.
 * @module
 */
import { Base64, Bytes } from 'ox'
import * as Actions from './Actions.js'
import type * as Funding from './Funding.js'
import { type Config, PendingNotFoundError, RequestError } from '../Accounts.js'
import type * as Pending from './Pending.js'
import type { Permissions } from '../Permissions.js'
import type * as Session from '../Session.js'
import type { Store } from '../Store.js'
import * as TempoAccount from './TempoAccount.js'
import * as Api from './api.js'
import * as Callback from './callback.js'

/** A session of a backend's user, as `get` returns it. The refresh token stays in the store. */
export type BackendSession = Omit<
  Session.Session,
  'idToken' | 'refreshToken'
> & {
  /**
   * The Tempo ID session that signed the user in, as the ID token's `sid`. A logout token names it as
   * `sessionId`. Absent when the ID token holds no `sid`.
   */
  sid?: string | undefined
}

/**
 * Creates the sessions of one backend. Concurrent `get` calls of one session share one refresh. The
 * instance holds the refreshes in progress, so one instance serves every request of a session: one
 * for a single process, or one per Durable Object on Cloudflare Workers. Several processes or
 * replicas that share `store` need session affinity, so each session reaches one process.
 *
 * @example
 * ```ts
 * const sessions = BackendSessions.create(tempoId.config, { store })
 * ```
 */
export function create(
  auth: Config,
  options: create.Options,
): create.ReturnType {
  const { store } = options

  // The `complete` call in progress for each session ID, so a second callback redeems no code, and
  // `end` awaits it before it deletes the session.
  const completing = new Map<string, Promise<BackendSession>>()
  // The `end` call in progress for each session ID, which concurrent calls share, and for which no
  // refresh starts. `end` awaits a refresh that started before it, and revokes the token it stored.
  const ending = new Map<string, Promise<void>>()
  // The last save in progress for each session ID. Each save of an ID waits for the one before it,
  // and `end` and `get` wait for the last.
  const saving = new Map<string, Promise<unknown>>()
  // One refresh for each session ID, which concurrent reads of that session await.
  const refreshes = new Map<string, Promise<Stored | undefined>>()
  // Refresh tokens sent without a known outcome. Tempo ID may have rotated each, so a second send
  // can be a reuse, which revokes every refresh token of the app for the user.
  const unknown = new Set<string>()
  // Refresh tokens that `end` revoked but whose session the store kept, as during an outage. A retry
  // of `end` or a refresh sends none of them again, and a later deletion releases each.
  const revoked = new Set<string>()

  /**
   * Refreshes the session's access token unless it is still valid. It reads the session again, since
   * a read before this refresh started can hold a refresh token that an earlier refresh rotated.
   */
  async function refresh(id: string) {
    const stored = (await store.getItem(sessionKey(id))) as Stored | undefined
    if (!stored || fresh(stored)) return stored
    const { refreshToken } = stored
    // Without a refresh token, the session lasts until its access token expires.
    if (!refreshToken && stored.expiresAt > Date.now()) return stored
    if (
      !refreshToken ||
      unknown.has(refreshToken) ||
      revoked.has(refreshToken)
    ) {
      await store.removeItem(sessionKey(id))
      if (refreshToken) revoked.delete(refreshToken)
      return undefined
    }

    /**
     * Writes the refresh's result, or deletes the session when `next` is absent, only while the store
     * still holds the refresh token that the refresh read. Otherwise a save or another sign-in
     * replaced the session, which stays.
     */
    async function settle(next: Stored | undefined) {
      const current = (await store.getItem(sessionKey(id))) as
        | Stored
        | undefined
      if (current?.refreshToken !== refreshToken) return current
      if (next) await store.setItem(sessionKey(id), next)
      else await store.removeItem(sessionKey(id))
      return next
    }

    unknown.add(refreshToken)
    const tokens = await (async () => {
      try {
        return await Actions.refresh(auth, { refreshToken })
      } catch (error) {
        // A refused refresh token is revoked or expired, so the session ends.
        if (error instanceof RequestError && error.code === 'invalid_grant') {
          unknown.delete(refreshToken)
          return undefined
        }
        // Any other refusal returns before a rotation, so the session stays for the next request.
        if (
          error instanceof RequestError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          unknown.delete(refreshToken)
          throw error
        }
        // Without a response, or after a server error, Tempo ID may have rotated the token, so the
        // session ends without a second send.
        await settle(undefined)
        unknown.delete(refreshToken)
        throw error
      }
    })()
    if (!tokens) return settle(undefined)

    const { idToken: _, ...rest } = tokens
    // If the write fails, store still holds the rotated token, which `unknown` keeps unsent.
    const next = await settle({ ...stored, ...rest })
    unknown.delete(refreshToken)
    return next
  }

  async function get(options: get.Options): Promise<get.ReturnType> {
    const { id } = options
    // A save in progress replaces the session, so the read waits for it.
    await saving.get(id)?.catch(() => undefined)
    const inProgress = refreshes.get(id)
    const stored = inProgress
      ? await inProgress
      : ((await store.getItem(sessionKey(id))) as Stored | undefined)
    if (!stored || ending.has(id)) return undefined
    if (fresh(stored)) return view(stored)

    // The map entry is set before the refresh's first await, so every later read shares it.
    const refreshing =
      refreshes.get(id) ?? refresh(id).finally(() => refreshes.delete(id))
    refreshes.set(id, refreshing)
    const next = await refreshing
    return next && view(next)
  }

  return {
    complete(options) {
      const { id, url } = options
      // A sign-out in progress deletes the session, so a callback during it stores none.
      if (ending.has(id)) return Promise.reject(new PendingNotFoundError())

      // A stale callback must not reject a valid callback that arrives while its state is checked.
      const previous = completing.get(id)
      // A save of the ID that started earlier writes first, and the callback's session replaces it.
      // The save's promise is taken before the first await, as `save` takes this one.
      const saved = saving.get(id)
      const completed = (async () => {
        await previous?.catch(() => undefined)
        const pending = (await store.getItem(pendingKey(id))) as
          | StoredPending
          | undefined
        if (
          !pending ||
          pending.createdAt + (pending.lifetime ?? pendingLifetime) <=
            Date.now()
        ) {
          await store.removeItem(pendingKey(id))
          throw new PendingNotFoundError()
        }

        const callback = new URL(url)
        Callback.checkState(callback, { state: pending.pending.state })
        // Consume before any token exchange, including one whose outcome may be unknown.
        await store.removeItem(pendingKey(id))
        const authorization = await Actions.redirect.handleCallback(auth, {
          pending: pending.pending,
          url: callback,
        })
        // The ID token holds the user's personal data, so only its `sid` stays, for a logout token.
        // The access key rebuilds from `key`.
        const stored = toStored(authorization)
        await saved?.catch(() => undefined)
        await store.setItem(sessionKey(id), stored)
        return view(stored)
      })().finally(() => {
        if (completing.get(id) === completed) completing.delete(id)
      })
      completing.set(id, completed)
      return completed
    },
    end(options) {
      const { id } = options
      // Concurrent calls share one revocation, since a second revocation of a refresh token revokes
      // every refresh token of the app for the user.
      const inProgress = ending.get(id)
      if (inProgress) return inProgress

      // No refresh or callback starts from here, and one in progress finishes first. The map entry
      // is set before the first await, so every later call shares it.
      const saved = saving.get(id)
      const ended = (async () => {
        await completing.get(id)?.catch(() => undefined)
        await refreshes.get(id)?.catch(() => undefined)
        await saved?.catch(() => undefined)
        const stored = (await store.getItem(sessionKey(id))) as
          | Stored
          | undefined
        const refreshToken = stored?.refreshToken
        if (refreshToken && !revoked.has(refreshToken))
          await Api.revoke(auth, { refreshToken })
        // A second revocation of the token counts as a reuse. A failed deletion therefore writes an
        // ended marker in place of the session: no tokens, no access key, already expired, and dropped by
        // the store within `pendingLifetime`. A read or a retry finds nothing to send. Only when the
        // store refuses that write too does the token stay in `revoked`, so no call sends it again.
        await store.removeItem(sessionKey(id)).catch(async (error: unknown) => {
          if (refreshToken) {
            const written = await store
              .setItem(
                sessionKey(id),
                { expiresAt: 0 },
                { expiresAt: Date.now() + pendingLifetime },
              )
              .then(
                () => true,
                () => false,
              )
            if (!written) revoked.add(refreshToken)
          }
          throw error
        })
        if (refreshToken) revoked.delete(refreshToken)
      })().finally(() => ending.delete(id))
      ending.set(id, ended)
      return ended
    },
    async fetch(options) {
      const session = await get({ id: options.id })
      if (!session) return undefined
      return Actions.fetch(auth, {
        accessToken: session.accessToken,
        init: options.init,
        url: options.url,
      })
    },
    get,
    async headers(options) {
      const session = await get({ id: options.id })
      if (!session) return undefined
      return Api.tokenHeaders(auth, {
        accessToken: session.accessToken,
        method: options.method,
        url: options.url,
      })
    },
    async save(options) {
      const id = options.id ?? Base64.fromBytes(Bytes.random(32), base64url)
      // An end that started earlier finishes first. Each takes the other's promise before its first
      // await, so a save and an end never wait for each other.
      const completed = completing.get(id)
      const ended = ending.get(id)
      const previous = saving.get(id)
      const refreshing = refreshes.get(id)
      const saved = (async () => {
        // A callback, a refresh, an end, or an earlier save in progress writes or deletes the session
        // that it read, so the save waits for it, and then replaces that session. A callback that
        // starts after this save waits for it instead.
        await previous?.catch(() => undefined)
        await completed?.catch(() => undefined)
        await refreshing?.catch(() => undefined)
        await ended?.catch(() => undefined)
        // The save revokes no replaced refresh token. Nothing holds that token any more, and Tempo ID
        // reads a second revocation of a token as reuse, which revokes the user's other sessions.
        await store.setItem(sessionKey(id), toStored(options.session))
      })().finally(() => {
        // A later save of the ID holds the entry, and `end` waits for that one.
        if (saving.get(id) === saved) saving.delete(id)
      })
      saving.set(id, saved)
      await saved
      return { id }
    },
    async start(options = {}) {
      const id = options.id ?? Base64.fromBytes(Bytes.random(32), base64url)
      const { pending, url } = await Actions.redirect.createUrl(auth, {
        accessKey: options.accessKey,
        funding: options.funding,
        redirectUri: options.redirectUri,
      })
      const createdAt = Date.now()
      // A funding page can hold the code for 10 minutes after the approval, so the redirect waits
      // that much longer.
      const lifetime = options.funding
        ? pendingLifetime + fundingLifetime
        : pendingLifetime
      const stored: StoredPending = { createdAt, lifetime, pending }
      // A redirect that never returns leaves this entry, so a store that expires entries deletes it.
      await store.setItem(pendingKey(id), stored, {
        expiresAt: createdAt + lifetime,
      })
      return { id, url }
    },
  }
}

export declare namespace create {
  type Options = {
    /**
     * Where the sessions and the redirects in progress live, unserialized, such as a Durable
     * Object's storage. Each value holds an access key's private key and a refresh token.
     */
    store: Store
  }

  type ReturnType = {
    /**
     * Redeems the callback of `start` for the session `id`, and stores its tokens and access key. Throws
     * {@link PendingNotFoundError} without a redirect in progress, and `Accounts.RequestError` for a
     * forged `state` or a refused code.
     */
    complete: (options: complete.Options) => Promise<BackendSession>
    /**
     * Revokes the session's refresh token at Tempo ID, then deletes the session. Throws
     * `Accounts.RequestError` and keeps the session if the revocation fails.
     */
    end: (options: { id: string }) => Promise<void>
    /**
     * Sends a request with the session's access token, as `Actions.fetch` does, after a refresh if
     * necessary. Returns `undefined` without a session.
     */
    fetch: (options: fetch.Options) => Promise<Response | undefined>
    /**
     * Returns the session, after a refresh if its access token expires within 30 seconds. A refresh
     * without a response, or with a server error, ends the session and throws, since Tempo ID may
     * have rotated the refresh token and a second send would revoke the app's refresh tokens.
     */
    get: (options: get.Options) => Promise<get.ReturnType>
    /**
     * Returns the headers that send the session's access token to `url` with `method`, after a
     * refresh if necessary: a `DPoP` proof with the key that bound the token, or a Bearer token.
     * Returns `undefined` without a session.
     */
    headers: (options: {
      id: string
      method: string
      url: string
    }) => Promise<Record<string, string> | undefined>
    /**
     * Stores a session from a sign-in without a redirect, such as an emailed code on the backend,
     * under `id` or a new session ID, and returns the ID.
     */
    save: (options: save.Options) => Promise<save.ReturnType>
    /**
     * Starts a redirect sign-in, and stores its pending state with an `expiresAt` 10 minutes later,
     * which `complete` also checks. Returns the session ID to set in the browser's cookie, and the
     * URL to redirect to.
     */
    start: (options?: start.Options) => Promise<start.ReturnType>
  }
}

export declare namespace complete {
  type Options = {
    /** The session ID that `start` returned. */
    id: string
    /** The callback URL that Tempo ID redirected to. */
    url: string | URL
  }
}

export declare namespace fetch {
  type Options = {
    /** The session ID. */
    id: string
    /** The request's other options, such as `method` and `body`. Its `Authorization` and `DPoP` headers are replaced. */
    init?: RequestInit | undefined
    /** The request's URL. */
    url: string | URL
  }
}

export declare namespace get {
  type Options = {
    /** The session ID. */
    id: string
  }

  /** The session, or `undefined` if it never existed, ended, or its refresh token was refused. */
  type ReturnType = BackendSession | undefined
}

export declare namespace save {
  type Options = {
    /** The session ID. Defaults to 32 random bytes in URL-safe Base64. */
    id?: string | undefined
    /** The session that a sign-in returned. */
    session: Session.Session
  }

  type ReturnType = {
    /** The session ID, for an `HttpOnly` cookie. */
    id: string
  }
}

export declare namespace start {
  type Options = {
    /** What the access key may do, which requests the key. Without it, the sign-in authorizes no key. */
    accessKey?: Permissions | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /** The session ID. Defaults to 32 random bytes in URL-safe Base64. */
    id?: string | undefined
    /** Defaults to the instance's `redirectUri`. */
    redirectUri?: string | undefined
  }

  type ReturnType = {
    /** The session ID, for an `HttpOnly` cookie. */
    id: string
    /** Where to send the browser. */
    url: string
  }
}

/** Unpadded URL-safe Base64 for session IDs. */
const base64url = { pad: false, url: true } as const

/** How long before its expiry an access token refreshes, in milliseconds. */
const margin = 30_000

/** How long a redirect in progress waits for its callback, in milliseconds. */
const pendingLifetime = 10 * 60 * 1000

/** How long a funding page holds the code after the approval, in milliseconds. */
const fundingLifetime = 10 * 60 * 1000

/**
 * A session as `store` holds it: with its refresh token, without its ID token, which holds the
 * user's personal data, and with its account as `TempoAccount.serialize` writes it, since a store
 * such as a Durable Object's clones each value.
 */
type Stored = Omit<BackendSession, 'account'> & {
  /** The user's Tempo Account, serialized. */
  account?: TempoAccount.Serialized | undefined
  /** Exchanges for new tokens, and rotates on each refresh. Absent without `offline_access`. */
  refreshToken?: string | undefined
}

/** Returns the stored form of a session or a redirect's authorization. */
function toStored(session: Session.Session & { accessKey?: unknown }): Stored {
  const { accessKey: _, account, idToken, ...rest } = session
  const sid = sessionId(idToken)
  return {
    ...rest,
    ...(account ? { account: TempoAccount.serialize(account) } : {}),
    ...(sid ? { sid } : {}),
  }
}

/** A redirect in progress, as `store` holds it. */
type StoredPending = {
  /** When `start` stored it, in milliseconds. */
  createdAt: number
  /**
   * How long the callback may arrive after `createdAt`, in milliseconds. Absent in an entry of an
   * earlier release, which waits `pendingLifetime`.
   */
  lifetime?: number | undefined
  /** The state, the PKCE verifier, and any access key's material. */
  pending: Pending.Pending | Pending.WithoutKey
}

/** Returns whether the session's access token stays valid for more than the margin. */
function fresh(stored: Stored) {
  return stored.expiresAt - margin > Date.now()
}

/** Reads the `sid` claim of an ID token, or `undefined`. */
function sessionId(idToken: string | undefined) {
  try {
    const claims = JSON.parse(
      Base64.toString(idToken?.split('.')[1] ?? ''),
    ) as { sid?: unknown }
    return typeof claims.sid === 'string' ? claims.sid : undefined
  } catch {
    return undefined
  }
}

/** Returns the session without its refresh token. */
function view(stored: Stored): BackendSession {
  const { account, refreshToken: _, ...session } = stored
  return account
    ? { ...session, account: TempoAccount.deserialize(account) }
    : session
}

/** The key of a session in the store. */
function sessionKey(id: string) {
  return `tempo-id:session:${id}`
}

/** The key of a redirect in progress in the store. */
function pendingKey(id: string) {
  return `tempo-id:pending:${id}`
}
