/**
 * The sessions of a backend's users, in a `Store`: each redirect in progress, each session with its
 * tokens and access key, each session of a SIWE sign-in, and each challenge in progress. Concurrent
 * reads of one session share one refresh. `backend` and `DurableObject.sessions` run it.
 * @module
 */
import { Base64, Bytes } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import * as AccessKey from './AccessKey.js'
import * as RedirectActions from '../actions/redirect.js'
import * as Actions from './Actions.js'
import type * as Funding from './Funding.js'
import { type Config, PendingNotFoundError, RequestError } from '../Accounts.js'
import type * as Pending from './Pending.js'
import type { Permissions } from '../Permissions.js'
import type * as Session from '../Session.js'
import type { Store } from '../Store.js'
import * as TempoAccount from './TempoAccount.js'
import * as Api from './Api.js'
import * as Callback from './Callback.js'
import { authorizeUrl } from './Request.js'

/**
 * A session of a backend's user from a Tempo ID sign-in, as `get` returns it. The `backend`
 * plugin's `complete`, `get`, and `session` return it as `backend.Session.TempoId`. The refresh
 * token stays in the store.
 */
export type BackendSession = Omit<
  Session.TempoIdSession,
  'idToken' | 'refreshToken'
> & {
  /**
   * The session ID, which the browser holds in the `__Host-tempo-id.sid` cookie. Keep it as secret
   * as a session.
   */
  id: string
  /** How the user signed in: through Tempo ID. */
  method: 'tempo-id'
  /**
   * The Tempo ID session that signed the user in, as the ID token's `sid`. A
   * [logout token](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#back-channel-logout)
   * names it as `sessionId`. Absent when the ID token holds no `sid`, as for an app without a
   * back-channel logout URI.
   */
  sid?: string | undefined
}

/**
 * A session of a backend's user from a Sign-In with Ethereum message (EIP-4361), as `get` returns
 * it. The `siwe` plugin's `complete`, and the `backend` plugin's `get` and `session`, return it as
 * `backend.Session.Siwe`. It holds no tokens, so it never refreshes, and ends at `expiresAt`.
 */
export type SiweSession = {
  /** The account that signed the message, checksummed. */
  address: `0x${string}`
  /** The chain of the message, whose view of the account verified the signature. */
  chainId: number
  /** When the session ends, in milliseconds. */
  expiresAt: number
  /**
   * The session ID, which the browser holds in the `__Host-tempo-id.sid` cookie. Keep it as secret
   * as a session.
   */
  id: string
  /** When the account signed in, in milliseconds. */
  issuedAt: number
  /** The message that the account signed. */
  message: string
  /** How the user signed in: with a signed message. */
  method: 'siwe'
}

/** A challenge in progress, as `issue` stores it and `take` returns it. */
export type Challenge = {
  /** When the challenge expires, in milliseconds. */
  expiresAt: number
  /** The message to sign. */
  message: string
  /** The resources of an approval's message, as the app named them. Absent for a sign-in. */
  resources?: readonly string[] | undefined
  /** The statement of an approval's message, as the app named it. Absent for a sign-in. */
  statement?: string | undefined
}

/**
 * Creates the sessions of one backend. Concurrent `get` calls of one session share one refresh. The
 * instance holds the refreshes in progress, so one instance serves every request of a session: one
 * for a single process, or one per Durable Object on Cloudflare Workers. Several processes or
 * replicas that share `store` need session affinity, so each session reaches one process, since
 * `end` orders itself only against the refreshes of its own instance. If `store` has `lock`, as
 * `Store.file`, `Store.memory`, and `Store.redis` do, the instances on `store` refresh a session one
 * at a time, so they send one refresh, and writes to the index of a `sid` wait for each other. If it has `update`, as `Store.postgres` does, each write
 * lands only over the index it read, so no session drops out either. Without either, instances that
 * share `store` can lose a `link` that runs at the same time as another write to the same index.
 *
 * @example
 * ```ts
 * const sessions = BackendSessions.create(accounts.config, { store })
 * ```
 */
export function create(
  auth: Config,
  options: create.Options,
): create.ReturnType {
  const { shared = false, store } = options

  // The `complete` call in progress for each session ID, so a second callback redeems no code, and
  // `end` awaits it before it deletes the session.
  const completing = new Map<string, Promise<BackendSession>>()
  // The `end` call in progress for each session ID, which concurrent calls share, and for which no
  // refresh starts. `end` awaits a refresh that started before it, and revokes the token it stored.
  const ending = new Map<string, Promise<void>>()
  // The `sid` guard of each `end` in progress. A call with another guard reads the session again
  // once that call settles, since its own guard can decide otherwise.
  const endingSid = new Map<string, string | undefined>()
  // The logout token's issue of each `end` in progress. A call with another cutoff reads the
  // session again once that call settles, since its own cutoff can decide otherwise.
  const endingIssuedAt = new Map<string, number | undefined>()
  // The session IDs whose `end` in progress sends no revocation, since a call with `revoke: false`
  // started or joined it. A call that joins after the revocation started cannot stop it.
  const unrevoked = new Set<string>()
  // The `sid` and issue of each logout token that met an `end` in progress without a guard or of
  // its `sid`, for each session ID. That end sends no revocation if the session it reads names one
  // of them, with tokens that Tempo ID issued no later than that token.
  const unrevokedSids = new Map<
    string,
    readonly { issuedAt?: number | undefined; sid: string }[]
  >()
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
  // The `take` call in progress for each challenge's key, so a concurrent `take` finds it spent.
  const taking = new Map<string, Promise<Challenge | undefined>>()
  // The last write in progress to the index of each `sid`: a `link`, `close`, or `unlink`. Each
  // rewrites the index, so each waits for the one before it. The store's `lock` also orders the
  // writes of other instances on `store`.
  const indexing = new Map<string, Promise<unknown>>()

  /** Runs `fn` on the index of `sid` after the call before it, and returns its result. */
  function queue<result>(sid: string, fn: () => Promise<result>) {
    const previous = indexing.get(sid)
    const updated = (async () => {
      await previous?.catch(() => undefined)
      // `update` orders writes across processes alone, and a store may build it on its own
      // `lock`, which does not reenter. So `lock` holds the index only for a store without `update`.
      return store.lock && !store.update ? store.lock(indexKey(sid), fn) : fn()
    })().finally(() => {
      if (indexing.get(sid) === updated) indexing.delete(sid)
    })
    indexing.set(sid, updated)
    return updated
  }

  /** Returns the `stored` index, without its entries that expired by `now`. */
  function parseIndex(value: unknown, now: number): Index {
    const stored = (value as Index | null | undefined) ?? { entries: [] }
    // A kept session holds the index past its close, so the close ends at `closedUntil`.
    const { closed, closedAt, closedUntil, ...read } = stored
    const open = closedUntil !== undefined && closedUntil <= now
    return {
      ...read,
      ...(open
        ? {}
        : {
            ...(closed === undefined ? {} : { closed }),
            ...(closedAt === undefined ? {} : { closedAt }),
            ...(closedUntil === undefined ? {} : { closedUntil }),
          }),
      entries: read.entries.filter(
        (entry) => entry.expiresAt === undefined || entry.expiresAt > now,
      ),
    }
  }

  /** Runs `write` on the index of `sid` after the call before it, and returns its result. */
  function updateIndex<result>(
    sid: string,
    write: (index: Index) => { index: Index; result: result },
  ): Promise<result> {
    return queue(sid, () => rewriteIndex(sid, write))
  }

  /** Runs `write` on the index of `sid`, and returns its result. The caller holds the queue of `sid`. */
  async function rewriteIndex<result>(
    sid: string,
    write: (index: Index) => { index: Index; result: result },
  ): Promise<result> {
    const key = indexKey(sid)
    const plan = (value: unknown) => {
      const now = Date.now()
      const next = write(parseIndex(value, now))
      const { closed, closedUntil, entries } = next.index
      if (!closed && entries.length === 0)
        return { expiresAt: undefined, result: next.result, value: undefined }
      // The index lasts as long as its longest session, and has no expiry beside a session
      // without one. A closed index outlasts a sign-in in progress, whose `link` then finds it
      // closed.
      const lasting = entries.some((entry) => entry.expiresAt === undefined)
      const expiresAt = Math.max(
        ...entries.map((entry) => entry.expiresAt ?? 0),
        closed ? (closedUntil ?? now + pendingLifetime * 2) : 0,
      )
      return {
        ...(lasting ? {} : { expiresAt }),
        result: next.result,
        value: next.index,
      }
    }
    // A store with `update` writes the index only over the value it read, so a write of another
    // process between the two makes it read again, and no session drops out.
    if (store.update) return store.update(key, plan)
    const { expiresAt, result, value } = plan(await store.getItem(key))
    if (value === undefined) await store.removeItem(key)
    else
      await store.setItem(
        key,
        value,
        expiresAt === undefined ? {} : { expiresAt },
      )
    return result
  }

  /**
   * Reads the stored session of `id`. A session that an earlier release stored names `accessKey`
   * as `key`, and `accessKeys` as `keys`. Under a value that is no session ID, only a session
   * counts, which an earlier release stored under a custom ID. Any other entry reads as absent,
   * such as the session of an instance that shares the store.
   */
  async function read(id: string): Promise<Stored | undefined> {
    const value = await store.getItem(sessionKey(id))
    if (!sessionIdPattern.test(id) && !holdsSession(value)) return undefined

    const stored = value as
      | (Stored & {
          key?: StoredTempoId['accessKey']
          keys?: StoredTempoId['accessKeys']
        })
      | undefined
    if (!stored || stored.method === 'siwe') return stored

    const { key: earlier, keys: earlier_keys, ...rest } = stored
    const accessKey = rest.accessKey ?? earlier
    const accessKeys = rest.accessKeys ?? earlier_keys
    return {
      ...rest,
      ...(accessKey ? { accessKey } : {}),
      ...(accessKeys ? { accessKeys } : {}),
    }
  }

  /**
   * Refreshes the session under the store's `lock`, so instances on the store, such as processes on
   * one `Store.file`, send one refresh: the later reads the tokens of the first, and sends none. If
   * the lock rejects before the refresh, such as a folder that refuses the lock file, the refresh
   * runs without it.
   */
  async function exclusive(id: string) {
    if (!store.lock) return refresh(id)
    let started = false
    return await store
      .lock(refreshKey(id), () => {
        started = true
        return refresh(id)
      })
      .catch((error: unknown) => {
        if (started) throw error
        return refresh(id)
      })
  }

  /**
   * Refreshes the session's access token unless it is still valid. It reads the session again, since
   * a read before this refresh started can hold a refresh token that an earlier refresh rotated.
   */
  async function refresh(id: string) {
    const stored = await read(id)
    if (!stored) return stored
    // A SIWE session holds no tokens, so it ends at its expiry.
    if (stored.method === 'siwe') {
      if (stored.expiresAt > Date.now()) return stored
      await store.removeItem(sessionKey(id))
      return undefined
    }
    if (stored.accessKey && AccessKey.expired(stored.accessKey)) {
      // The session can no longer act, so it ends without a refresh. The deletion comes first, so no
      // later read sends the refresh token again, and the revocation replaces the refresh's request.
      // A failed revocation leaves a token that nothing holds, which rejects nothing. A token that
      // `end` revoked or a refresh may have rotated is never sent, since a second send is a reuse.
      const { refreshToken } = stored
      await store.removeItem(sessionKey(id))
      if (!refreshToken) return undefined
      const sent = unknown.has(refreshToken) || revoked.has(refreshToken)
      revoked.delete(refreshToken)
      if (!sent) await Api.revoke(auth, { refreshToken }).catch(() => undefined)
      return undefined
    }
    if (fresh(stored)) return stored
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
      const current = await read(id)
      if (refreshTokenOf(current) !== refreshToken) return current
      if (next) await store.setItem(sessionKey(id), next, lifetime(next))
      else await store.removeItem(sessionKey(id))
      return next
    }

    // Tokens that another DPoP key binds, such as a key that the backend created at an earlier start,
    // never refresh with this instance, so the refresh sends no request. The session stays, as for
    // any other refusal before a rotation.
    Api.checkBound(auth, { accessToken: stored.accessToken })

    unknown.add(refreshToken)
    const tokens = await (async () => {
      try {
        // Another process that shares the store can refresh the same token at once. Tempo ID refuses
        // the overlap, and replays the other's tokens to a retry, which `Actions.refresh` sends.
        // Otherwise `refreshes` shares the only refresh of the session, so a refusal is final.
        if (shared) return await Actions.refresh(auth, { refreshToken })
        return await Api.refresh(auth, { refreshToken })
      } catch (error) {
        // A refused refresh token is revoked or expired, so the session ends.
        if (error instanceof RequestError && error.code === 'invalid_grant') {
          unknown.delete(refreshToken)
          return undefined
        }
        // Any other refusal returns before a rotation, so the session stays for the next request. A
        // refused redirect sent no refresh token on, so it rotated nothing either.
        if (
          error instanceof RequestError &&
          (Api.redirectRefused(error) ||
            (error.status >= 400 && error.status < 500))
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
    // An end with a `sid` guard can keep the session, so the read waits for it and reads again,
    // also for one that starts during the read.
    const guarded = () => endingSid.get(id) !== undefined && ending.get(id)
    const before = guarded()
    if (before) {
      await before.catch(() => undefined)
      return get(options)
    }
    const inProgress = refreshes.get(id)
    const stored = inProgress ? await inProgress : await read(id)
    const after = guarded()
    if (after) {
      await after.catch(() => undefined)
      return get(options)
    }
    if (!stored || ending.has(id)) return undefined
    if (usable(stored)) return view(stored, id)

    // The map entry is set before the refresh's first await, so every later read shares it.
    const refreshing =
      refreshes.get(id) ?? exclusive(id).finally(() => refreshes.delete(id))
    refreshes.set(id, refreshing)
    const next = await refreshing
    return next && view(next, id)
  }

  return {
    close(options) {
      const { sid } = options
      // A `link` of another process rewrites the index, so the close writes a key of its own, which
      // outlasts a sign-in in progress. It reads the index after that write, and `link` reads the
      // key after its own write, so one of them always finds the other. The index is closed too,
      // since a process of an earlier release reads only the index.
      // A second key and the index hold when Tempo ID issued the logout token, so a later sign-in
      // of the `sid`, such as after the app's disconnection, which keeps the Tempo ID session,
      // stays. The logout key stays `true`, which a process of an earlier release reads.
      const { issuedAt } = options
      return queue(sid, async () => {
        const expiresAt = Date.now() + pendingLifetime * 2
        // A delayed delivery of an earlier token keeps the latest issue, as the index does. A close
        // without `issuedAt` removes it, so every session of the `sid` ends.
        const latest = await (async () => {
          if (issuedAt === undefined) return undefined
          const stored = await store.getItem(logoutIssuedAtKey(sid))
          return typeof stored === 'number'
            ? Math.max(stored, issuedAt)
            : issuedAt
        })()
        // The cutoff lands before the marker, so a `link` of another process that reads the marker
        // reads its cutoff too, and keeps a sign-in that Tempo ID issued after the token.
        await (latest === undefined
          ? store.removeItem(logoutIssuedAtKey(sid))
          : store.setItem(logoutIssuedAtKey(sid), latest, { expiresAt }))
        await store.setItem(logoutKey(sid), true, { expiresAt })
        return rewriteIndex(sid, (index) => {
          // A close without `issuedAt`, also of an earlier release, ends every session of the `sid`.
          const closedAt =
            issuedAt === undefined || (index.closed && !index.closedAt)
              ? undefined
              : Math.max(index.closedAt ?? 0, issuedAt)
          return {
            index: {
              closed: true,
              ...(closedAt === undefined ? {} : { closedAt }),
              closedUntil: expiresAt,
              entries: index.entries,
            },
            // Every entry returns, also one issued after the token, since saves of one ID can store
            // an earlier session than the entry's latest issue. `end` reads the stored session's own
            // issue, and keeps one that Tempo ID issued after the token.
            result: index.entries,
          }
        })
      })
    },
    complete(options) {
      const { id, url } = options
      // No redirect starts under a value that is no session ID, so its callback stores no session.
      if (!sessionIdPattern.test(id))
        return Promise.reject(new PendingNotFoundError())
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

        const callback = Callback.url(url)
        Callback.checkState(callback, { state: pending.pending.state })
        // Consume before any token exchange, including one whose outcome may be unknown. A store
        // with `takeItem` spends it in one step, so of processes that share the store, only one
        // redeems the code.
        const taken = (
          store.takeItem
            ? await store.takeItem(pendingKey(id))
            : await store.removeItem(pendingKey(id)).then(() => pending)
        ) as StoredPending | null | undefined
        // A custom store can resolve `null` for a key that another process took.
        if (!taken) throw new PendingNotFoundError()
        // A start under the same ID can replace the entry after the read, so the take spent the new
        // redirect, and the code of the old one redeems nothing. A write back could replace a newer
        // start, so the spent redirect stays spent, as a removal after the read spends it.
        if (taken.pending.state !== pending.pending.state)
          throw new PendingNotFoundError()
        const authorization = await RedirectActions.handleCallback(auth, {
          pending: pending.pending,
          url: callback,
        })
        // The ID token holds the user's personal data, so only its `sid` stays, for a logout token.
        // The access key rebuilds from `accessKey`.
        const stored = toStored(authorization)
        await saved?.catch(() => undefined)
        // A refresh in progress can delete the session that it read, such as one whose access key
        // expired, so the callback's session waits for it. A later refresh reads this session.
        await refreshes.get(id)?.catch(() => undefined)
        await store.setItem(sessionKey(id), stored, lifetime(stored))
        return viewTempoId(stored, id)
      })().finally(() => {
        if (completing.get(id) === completed) completing.delete(id)
      })
      completing.set(id, completed)
      return completed
    },
    end(options) {
      const { id } = options
      const run = (): Promise<void> => {
        // Concurrent calls share one revocation, since a second revocation of a refresh token revokes
        // every refresh token of the app for the user. Only a call of the same `sid` guard shares it,
        // and stops its revocation.
        const inProgress = ending.get(id)
        if (
          inProgress &&
          (endingSid.get(id) !== options.sid ||
            endingIssuedAt.get(id) !== options.issuedAt)
        ) {
          // A logout token stops the revocation of an end without a guard, or of its `sid`, only if
          // the session that the end reads names its `sid` with tokens issued no later than the
          // token, since Tempo ID revoked that refresh token already. A stale token's `sid` names no
          // stored session, so it stops nothing.
          const guard = endingSid.get(id)
          if (
            options.revoke === false &&
            options.sid !== undefined &&
            (guard === undefined || guard === options.sid)
          )
            unrevokedSids.set(id, [
              ...(unrevokedSids.get(id) ?? []),
              { issuedAt: options.issuedAt, sid: options.sid },
            ])
          return inProgress.catch(() => undefined).then(run)
        }
        if (options.revoke === false) unrevoked.add(id)
        if (inProgress) return inProgress

        // No refresh or callback starts from here, and one in progress finishes first. The map entry
        // is set before the first await, so every later call shares it.
        const saved = saving.get(id)
        const ended = (async () => {
          await completing.get(id)?.catch(() => undefined)
          await refreshes.get(id)?.catch(() => undefined)
          await saved?.catch(() => undefined)
          const stored = await read(id)
          // Under a value that is no session ID, an entry that is no session belongs to another owner,
          // so the store keeps it.
          if (!stored && !sessionIdPattern.test(id)) return
          // A session that names another `sid`, such as one that replaced the ended one under its ID,
          // stays.
          if (
            options.sid !== undefined &&
            (!stored || !('sid' in stored) || stored.sid !== options.sid)
          )
            return
          // A session whose tokens Tempo ID issued after the logout token, such as one that replaced
          // the ended one under its ID and `sid`, stays.
          if (
            stored &&
            'accessToken' in stored &&
            issuedAfter(issuedAt(stored.accessToken), options.issuedAt)
          )
            return
          const refreshToken = refreshTokenOf(stored)
          // A session that Tempo ID ended holds a revoked refresh token, whose revocation reads as reuse.
          const storedIssuedAt =
            stored && 'accessToken' in stored
              ? issuedAt(stored.accessToken)
              : undefined
          const loggedOut =
            !!stored &&
            'sid' in stored &&
            !!unrevokedSids
              .get(id)
              ?.some(
                (entry) =>
                  entry.sid === stored.sid &&
                  !issuedAfter(storedIssuedAt, entry.issuedAt),
              )
          if (
            refreshToken &&
            !unrevoked.has(id) &&
            !loggedOut &&
            !revoked.has(refreshToken)
          )
            await Api.revoke(auth, { refreshToken })
          // A second revocation of the token counts as a reuse. A failed deletion therefore writes an
          // ended marker in place of the session: no tokens, no access key, already expired, and dropped by
          // the store within `pendingLifetime`. A read or a retry finds nothing to send. Only when the
          // store refuses that write too does the token stay in `revoked`, so no call sends it again.
          await store
            .removeItem(sessionKey(id))
            .catch(async (error: unknown) => {
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
        })().finally(() => {
          ending.delete(id)
          endingIssuedAt.delete(id)
          endingSid.delete(id)
          unrevoked.delete(id)
          unrevokedSids.delete(id)
        })
        ending.set(id, ended)
        endingIssuedAt.set(id, options.issuedAt)
        endingSid.set(id, options.sid)
        return ended
      }
      return run()
    },
    async fetch(options) {
      const session = await get({ id: options.id })
      if (!session || session.method === 'siwe') return undefined
      Api.checkBound(auth, { accessToken: session.accessToken })
      return Actions.fetch(auth, {
        accessToken: session.accessToken,
        init: options.init,
        url: options.url,
      })
    },
    get,
    async headers(options) {
      const session = await get({ id: options.id })
      if (!session || session.method === 'siwe') return undefined
      // Every API refuses a token that another DPoP key binds, so the request goes unsent.
      Api.checkBound(auth, { accessToken: session.accessToken })
      return Api.tokenHeaders(auth, {
        accessToken: session.accessToken,
        method: options.method,
        url: options.url,
      })
    },
    async issue(options) {
      const { expiresAt } = options.challenge
      // A challenge that no one takes stays until its expiry, so a store that expires entries deletes it.
      await store.setItem(challengeKey(options), options.challenge, {
        expiresAt,
      })
    },
    async link(options) {
      const { id, sid } = options
      const linked = await updateIndex<link.ReturnType>(sid, (index) => {
        // Saves of one ID can link out of order, so the entry keeps the later expiry, and none
        // beside a session without one.
        const previous = index.entries.find((entry) => entry.id === id)
        const expiresAt =
          options.expiresAt === undefined ||
          (previous && previous.expiresAt === undefined)
            ? undefined
            : Math.max(previous?.expiresAt ?? 0, options.expiresAt)
        // The entry keeps the later issue too. A link without one drops it, so any logout token of
        // the `sid` ends the session.
        const issued =
          options.issuedAt === undefined
            ? undefined
            : Math.max(previous?.issuedAt ?? 0, options.issuedAt)
        // A closed index keeps the ID too, so a retry of the logout token finds it until its end
        // succeeds and `unlink` removes it.
        return {
          index: {
            ...index,
            entries: [
              ...index.entries.filter((entry) => entry.id !== id),
              {
                expiresAt,
                id,
                ...(issued === undefined ? {} : { issuedAt: issued }),
              },
            ],
          },
          result: {
            closed:
              !!index.closed && !issuedAfter(options.issuedAt, index.closedAt),
          },
        }
      })
      if (linked.closed) return linked
      // The read follows the write of the entry, so a `close` of another process that missed the
      // entry wrote its key first. An earlier release writes no issue of the token.
      const [logout, closedAt] = await Promise.all([
        store.getItem(logoutKey(sid)),
        store.getItem(logoutIssuedAtKey(sid)),
      ])
      return {
        closed:
          logout === true &&
          !issuedAfter(
            options.issuedAt,
            typeof closedAt === 'number' ? closedAt : undefined,
          ),
      }
    },
    async save(options) {
      const id = options.id ?? Base64.fromBytes(Bytes.random(32), base64url)
      checkId(id)

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
        const { session } = options
        const stored = siwe(session) ? session : toStored(session)
        await store.setItem(sessionKey(id), stored, lifetime(stored))
        return 'sid' in stored ? stored.sid : undefined
      })().finally(() => {
        // A later save of the ID holds the entry, and `end` waits for that one.
        if (saving.get(id) === saved) saving.delete(id)
      })
      saving.set(id, saved)
      const sid = await saved
      return { id, ...(sid ? { sid } : {}) }
    },
    unlink(options) {
      const ids = new Set(options.ids)
      // An entry that a sign-in linked again under its ID after the logout token stays.
      return updateIndex(options.sid, (index) => ({
        index: {
          ...index,
          entries: index.entries.filter(
            (entry) =>
              !ids.has(entry.id) ||
              issuedAfter(entry.issuedAt, options.issuedAt),
          ),
        },
        result: undefined,
      }))
    },
    take(options) {
      const key = challengeKey(options)
      // Only the first of concurrent calls reads the challenge, so each challenge verifies once.
      if (taking.has(key))
        return taking
          .get(key)!
          .catch(() => undefined)
          .then(() => undefined)
      const taken = (async () => {
        // The challenge is spent before any check, so a failed check spends it too. A store with
        // `takeItem` spends it in one step, so processes that share the store take it once.
        const challenge = (await (async () => {
          if (store.takeItem) return store.takeItem(key)
          const value = await store.getItem(key)
          if (value !== undefined) await store.removeItem(key)
          return value
        })()) as Challenge | undefined
        if (!challenge) return undefined
        return challenge.expiresAt > Date.now() ? challenge : undefined
      })().finally(() => taking.delete(key))
      taking.set(key, taken)
      return taken
    },
    async start(options = {}) {
      const id = options.id ?? Base64.fromBytes(Bytes.random(32), base64url)
      checkId(id)

      const { pending, url } = await authorizeUrl(auth, {
        accessKey: options.accessKey,
        display: options.display,
        funding: options.funding,
        loginHint: options.loginHint,
        par: options.par,
        prompt: options.prompt,
        redirectUri: options.redirectUri,
        resource: options.resource,
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
     * Whether other processes can share `store` and refresh a session at the same time. If so, a
     * refresh that Tempo ID refuses with `invalid_grant` goes once more after one second, which
     * receives the other refresh's tokens. An overlapping refresh that takes longer still ends the
     * session, so replicas keep session affinity. Defaults to `false`, as in a Durable Object.
     */
    shared?: boolean | undefined
    /**
     * Where the sessions and the redirects in progress live, unserialized, such as a Durable
     * Object's storage. Each value holds an access key's private key and a refresh token. Each
     * session expires one day after its access key's expiry, and each redirect after 10 minutes,
     * or 20 with `funding`.
     */
    store: Store
  }

  type ReturnType = {
    /**
     * Closes the index of the Tempo ID session `sid` at its logout token, and returns the session
     * IDs that `link` added to it, each with its expiry. The index keeps them until `unlink`
     * removes each that ended, so a retry of the token finds the rest, and a later `link` of the
     * `sid` finds it closed. With `issuedAt`, a later `link` of a session whose tokens Tempo ID
     * issued after the token, such as a sign-in after the app's disconnection, which keeps the Tempo
     * ID session, finds the index open. The caller passes `issuedAt` to `end`, which keeps such a session. Returns none for a `sid` without an index. The close also writes a key
     * of its own for 20 minutes, which no `link` rewrites, so a `link` of another process that
     * shares the store never reopens it.
     */
    close: (options: close.Options) => Promise<readonly Entry[]>
    /**
     * Redeems the callback of `start` for the session `id`, and stores its tokens and access key. Throws
     * {@link PendingNotFoundError} without a redirect in progress, and `Accounts.RequestError` for a
     * forged `state` or a refused code.
     */
    complete: (options: complete.Options) => Promise<BackendSession>
    /**
     * Revokes the session's refresh token at Tempo ID, then deletes the session. Throws
     * `Accounts.RequestError` and keeps the session if the revocation fails. With `revoke: false`,
     * deletes the session without a request.
     */
    end: (options: end.Options) => Promise<void>
    /**
     * Sends a request with the session's access token, as `Actions.fetch` does, after a refresh if
     * necessary. Returns `undefined` without a session.
     */
    fetch: (options: fetch.Options) => Promise<Response | undefined>
    /**
     * Returns the session, after a refresh if its access token expires within 30 seconds. A SIWE
     * session returns until its expiry, without a refresh. Instances on a store with `lock` refresh
     * one at a time through it, so they send one refresh. With
     * `shared`, a refresh that Tempo ID refuses with `invalid_grant` goes once more after one second,
     * since another process can refresh the same token at once. A session whose access key
     * expired ends without a refresh, and returns `undefined`. A refresh
     * without a response, or with a server error, ends the session and throws, since Tempo ID may
     * have rotated the refresh token and a second send would revoke the app's refresh tokens.
     */
    get: (options: get.Options) => Promise<get.ReturnType>
    /**
     * Returns the headers that send the session's access token to `url` with `method`, after a
     * refresh if necessary: a `DPoP` proof with the key that bound the token, or a Bearer token.
     * Returns `undefined` without a session, and for a SIWE session, which holds no access token.
     */
    headers: (options: {
      id: string
      method: string
      url: string
    }) => Promise<Record<string, string> | undefined>
    /**
     * Stores a challenge of the session `id`, with an `expiresAt` of the challenge's expiry: the
     * challenge of a SIWE sign-in, or with `name`, an approval of the session.
     */
    issue: (options: issue.Options) => Promise<void>
    /**
     * Adds the session `id` to the index of the Tempo ID session `sid`, which `close` reads at a
     * logout token. Returns `closed: true` when a logout token already closed the index, also
     * through another process that shares the store, unless Tempo ID issued the session's tokens,
     * `issuedAt`, after that token. The caller then ends the session, and then
     * removes it with `unlink`. The index expires with its longest session. Writes to one index run
     * in turn in this process. If the store has `lock` or `update`, writes of processes that share
     * it keep each entry. Without either, processes that link one index at once can lose an entry.
     * That session then ends at its next refresh, since Tempo ID revoked its refresh token.
     */
    link: (options: link.Options) => Promise<link.ReturnType>
    /**
     * Stores a session from a sign-in without a redirect, such as an emailed code on the backend, or
     * a SIWE sign-in, under `id` or a new session ID, and returns the ID. Throws
     * `Accounts.RequestError` with `invalid_request` and the `field` `id`, and stores nothing, for an
     * `id` that is no session ID.
     */
    save: (options: save.Options) => Promise<save.ReturnType>
    /**
     * Starts a redirect sign-in, and stores its pending state with an `expiresAt` 10 minutes later,
     * which `complete` also checks. Returns the session ID to set in the browser's cookie, and the
     * URL to redirect to. Throws `Accounts.RequestError` with `invalid_request` and the `field` `id`,
     * before any request, for an `id` that is no session ID.
     */
    start: (options?: start.Options) => Promise<start.ReturnType>
    /**
     * Deletes the challenge that `issue` stored, and returns it. Returns `undefined` if the challenge
     * never existed, expired, or another call took it, also a concurrent one.
     */
    take: (options: take.Options) => Promise<Challenge | undefined>
    /**
     * Removes the session IDs `ids` from the index of the Tempo ID session `sid`, once each ended. A
     * closed index stays closed.
     */
    unlink: (options: unlink.Options) => Promise<void>
  }
}

/** A session ID of the index of a `sid`, with the expiry that `link` received. */
export type Entry = {
  /** When the session expires, in milliseconds. Absent, it never expires. */
  expiresAt?: number | undefined
  /** The session ID. */
  id: string
  /**
   * When Tempo ID issued the session's tokens, in milliseconds, as {@link issuedAt} returns it.
   * Absent, a logout token of the `sid` ends the session whenever Tempo ID issued it.
   */
  issuedAt?: number | undefined
}

export declare namespace close {
  type Options = {
    /**
     * When Tempo ID issued the logout token, in milliseconds, as `LogoutToken` returns it. A
     * session whose tokens Tempo ID issued later stays. Absent, every session of the `sid` ends.
     */
    issuedAt?: number | undefined
    /** The ended Tempo ID session, which a logout token names as `sid`. */
    sid: string
  }
}

export declare namespace link {
  type ReturnType = {
    /** Whether a logout token closed the index of the `sid`, so the session must end. */
    closed: boolean
  }

  type Options = {
    /**
     * When the session expires, in milliseconds, as {@link expiresAt} returns it. Absent, it never
     * expires.
     */
    expiresAt?: number | undefined
    /** The session ID. */
    id: string
    /**
     * When Tempo ID issued the session's tokens, in milliseconds, as {@link issuedAt} returns it. A
     * logout token that Tempo ID issued earlier leaves the session. Absent, any logout token of the
     * `sid` in the last 20 minutes closes it.
     */
    issuedAt?: number | undefined
    /** The Tempo ID session that signed the user in, as the ID token's `sid`. */
    sid: string
  }
}

export declare namespace unlink {
  type Options = {
    /** The session IDs that ended. */
    ids: readonly string[]
    /**
     * When Tempo ID issued the logout token that ended the sessions, in milliseconds. An entry
     * whose tokens Tempo ID issued later stays. Absent, every entry of `ids` goes.
     */
    issuedAt?: number | undefined
    /** The ended Tempo ID session, which a logout token names as `sid`. */
    sid: string
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

export declare namespace end {
  type Options = {
    /** The session ID. */
    id: string
    /**
     * When Tempo ID issued the logout token that ends the session, in milliseconds. A session whose
     * tokens Tempo ID issued later stays. Absent, `end` ends the session whenever Tempo ID issued it.
     */
    issuedAt?: number | undefined
    /**
     * Whether `end` revokes the session's refresh token. `false` for a session that Tempo ID ended,
     * such as one that a logout token names: Tempo ID revoked its refresh token, and reads a second
     * revocation as reuse, which revokes the user's other sessions of the app. Defaults to `true`.
     */
    revoke?: boolean | undefined
    /**
     * The Tempo ID session that the session must name, as a logout token's `sid`. A session of
     * another `sid`, or none, stays. Absent, `end` ends the session of any `sid`.
     */
    sid?: string | undefined
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

  /**
   * The session, or `undefined` if it never existed, ended, its refresh token was refused, its
   * access key expired, or, for a SIWE session, it expired. Under a value that is no session ID,
   * such as a crafted cookie's, only a session that an earlier release stored reads, and the store
   * keeps any other entry of its key.
   */
  type ReturnType = BackendSession | SiweSession | undefined
}

export declare namespace issue {
  type Options = take.Options & {
    /** The challenge. */
    challenge: Challenge
  }
}

export declare namespace save {
  type Options = {
    /**
     * The session ID: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. Defaults to 32
     * random bytes in URL-safe Base64.
     */
    id?: string | undefined
    /** The session that a sign-in returned, or a SIWE session without its ID. */
    session: Session.TempoIdSession | Omit<SiweSession, 'id'>
  }

  type ReturnType = {
    /** The session ID, for an `HttpOnly` cookie. */
    id: string
    /**
     * The Tempo ID session that signed the user in, as the ID token's `sid`, which a logout token
     * names as `sessionId`. Absent for a SIWE session, and when the ID token holds no `sid`.
     */
    sid?: string | undefined
  }
}

export declare namespace take {
  type Options = {
    /** The session ID: of the session that a sign-in starts, or of the session that approves. */
    id: string
    /** The ID of an approval of the session. Absent for the challenge of a sign-in. */
    name?: string | undefined
  }
}

export declare namespace start {
  type Options = {
    /** What the access key may do, which requests it. Without it, the sign-in authorizes none. */
    accessKey?: Permissions | undefined
    /** `popup` requests the compact screens of a popup, for a sign-in in the dialog. */
    display?: 'popup' | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /**
     * The session ID: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. Defaults to 32
     * random bytes in URL-safe Base64.
     */
    id?: string | undefined
    /** The address that Tempo ID's sign-in page fills in its email field, as `login_hint`. */
    loginHint?: string | undefined
    /** Whether the request goes to `/oauth2/par` first. Defaults to the instance's `par`. */
    par?: boolean | undefined
    /** `login` requests a new sign-in of a user whom the browser holds signed in. */
    prompt?: 'login' | undefined
    /** Defaults to the instance's `redirectUri`. */
    redirectUri?: string | undefined
    /** The registered resources that the tokens are for. Defaults to the instance's `resource`. */
    resource?: Config['resource']
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

/**
 * A session ID: 1 to 128 characters of URL-safe Base64's alphabet. The name of an instance's own
 * session follows the prefix of {@link sessionKey} too, and starts with `[`. No session ID
 * therefore names an entry of an instance that shares the store. An earlier release stored a
 * session under any `id`, so a read under another value returns only what {@link holdsSession}
 * accepts, and `save` and `start` store nothing under it.
 */
const sessionIdPattern = /^[\w-]{1,128}$/

/** How long before its expiry an access token refreshes, in milliseconds. */
const margin = 30_000

/** How long a redirect in progress waits for its callback, in milliseconds. */
const pendingLifetime = 10 * 60 * 1000

/**
 * How long a session stays in the store after its access key's expiry, in milliseconds, so a read
 * in that time revokes its refresh token.
 */
const revocationGrace = 24 * 60 * 60 * 1000

/** How long a funding page holds the code after the approval, in milliseconds. */
const fundingLifetime = 10 * 60 * 1000

/** A session as `store` holds it: a Tempo ID sign-in's, or a SIWE sign-in's. */
type Stored = StoredTempoId | Omit<SiweSession, 'id'>

/**
 * A Tempo ID session as `store` holds it: with its refresh token, without its ID token, which holds
 * the user's personal data, and with its account as `TempoAccount.serialize` writes it, since a store
 * such as a Durable Object's clones each value. An entry of an earlier release holds no `method`.
 */
type StoredTempoId = Omit<BackendSession, 'account' | 'id' | 'method'> & {
  /** The user's Tempo Account, serialized. */
  account?: TempoAccount.Serialized | undefined
  /** Absent: the entry holds a Tempo ID session. */
  method?: undefined
  /** Exchanges for new tokens, and rotates on each refresh. Absent without `offline_access`. */
  refreshToken?: string | undefined
}

/** Returns whether `session` is a SIWE session, whose stored form is itself. */
function siwe(
  session: save.Options['session'],
): session is Omit<SiweSession, 'id'> {
  return (session as { method?: unknown }).method === 'siwe'
}

/**
 * Returns the stored form of a session or a redirect's authorization. A session that `get` returned
 * leaves its `id` and `method`, which the read derives.
 */
function toStored(
  session: Session.TempoIdSession & {
    id?: unknown
    method?: unknown
    signer?: unknown
  },
): StoredTempoId {
  const { account, id: _, idToken, method: __, signer: ___, ...rest } = session
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
  pending: Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey
}

/**
 * Returns the write options of a session: an `expiresAt` one {@link revocationGrace} after its
 * access key's expiry. A `get` within the grace still finds the session, ends it, and revokes its
 * refresh token. After the grace, a store that expires entries deletes an abandoned session with
 * its access key and refresh token. A session without an access key, or with one that never
 * expires, has no expiry.
 */
function lifetime(stored: Stored): Parameters<Store['setItem']>[2] {
  const at = expiresAt(stored)
  return at === undefined ? {} : { expiresAt: at }
}

/**
 * Returns when the store deletes a session, in milliseconds: a SIWE session's expiry, or one
 * {@link revocationGrace} after its access key's expiry. Returns `undefined` for a session without an
 * access key, or with one that never expires, which the store keeps.
 *
 * @example
 * ```ts
 * const expiresAt = BackendSessions.expiresAt(session)
 * ```
 */
export function expiresAt(session: expiresAt.Session): number | undefined {
  // A SIWE session holds nothing to revoke, so the store deletes it at its expiry.
  if (session.method === 'siwe') return session.expiresAt
  if (!session.accessKey) return undefined
  const { expiry } = KeyAuthorization.fromRpc(
    session.accessKey.keyAuthorization,
  )
  return expiry ? expiry * 1000 + revocationGrace : undefined
}

export declare namespace expiresAt {
  /** The parts of a session that its expiry reads: a SIWE session's expiry, or the access key. */
  type Session =
    | Pick<SiweSession, 'expiresAt' | 'method'>
    | {
        /** The session's access key. Absent for a session without one. */
        accessKey?: BackendSession['accessKey'] | undefined
        /** How the user signed in. Absent for a sign-in's session that no store holds yet. */
        method?: 'tempo-id' | undefined
      }
}

/** Returns whether the session's access token stays valid for more than the margin. */
function fresh(stored: StoredTempoId) {
  return stored.expiresAt - margin > Date.now()
}

/**
 * Returns whether the session serves without a refresh: a SIWE session before its expiry, or a
 * session whose access key holds and whose access token is fresh. A session without a refresh token
 * never refreshes, so it serves until its access token expires, without the store's `lock`.
 */
function usable(stored: Stored) {
  if (stored.method === 'siwe') return stored.expiresAt > Date.now()
  if (stored.accessKey && AccessKey.expired(stored.accessKey)) return false
  if (!stored.refreshToken) return stored.expiresAt > Date.now()
  return fresh(stored)
}

/**
 * Returns whether a stored value is a session: a SIWE session, or one with an access token. No
 * entry of an instance is one: its session sits in an envelope of `state` and `version`, and its
 * other entries hold a number, a boolean, a string, or a list.
 */
function holdsSession(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as { accessToken?: unknown; method?: unknown }
  return entry.method === 'siwe' || typeof entry.accessToken === 'string'
}

/** Returns the refresh token of a stored session, or `undefined` for a SIWE session or none. */
function refreshTokenOf(stored: Stored | undefined) {
  return stored?.method === 'siwe' ? undefined : stored?.refreshToken
}

/**
 * Reads the `sid` claim of an ID token, or `undefined`.
 *
 * @example
 * ```ts
 * const sid = BackendSessions.sessionId(session.idToken)
 * ```
 */
export function sessionId(idToken: string | undefined) {
  try {
    const claims = JSON.parse(
      Base64.toString(idToken?.split('.')[1] ?? ''),
    ) as { sid?: unknown }
    return typeof claims.sid === 'string' ? claims.sid : undefined
  } catch {
    return undefined
  }
}

/**
 * Returns when Tempo ID issued an access token, in milliseconds, from its `iat` claim, or
 * `undefined` for a token without one.
 *
 * @example
 * ```ts
 * const issuedAt = BackendSessions.issuedAt(session.accessToken)
 * ```
 */
export function issuedAt(accessToken: string | undefined) {
  try {
    const claims = JSON.parse(
      Base64.toString(accessToken?.split('.')[1] ?? ''),
    ) as { iat?: unknown }
    return typeof claims.iat === 'number' ? claims.iat * 1000 : undefined
  } catch {
    return undefined
  }
}

/** Returns the session `id` without its refresh token. */
function view(stored: Stored, id: string): BackendSession | SiweSession {
  if (stored.method === 'siwe') return { ...stored, id }
  return viewTempoId(stored, id)
}

/** Returns the Tempo ID session `id` without its refresh token. */
function viewTempoId(stored: StoredTempoId, id: string): BackendSession {
  const { account, method: _, refreshToken: __, ...session } = stored
  return {
    ...session,
    ...(account ? { account: TempoAccount.deserialize(account) } : {}),
    id,
    method: 'tempo-id',
  }
}

/**
 * Throws for a value that is no session ID, as {@link sessionIdPattern} holds one, so `save` and
 * `start` store nothing under it.
 */
function checkId(id: string) {
  if (sessionIdPattern.test(id)) return
  // The message quotes no ID, since a session ID is as secret as a session.
  throw new RequestError({
    code: 'invalid_request',
    field: 'id',
    message:
      'Invalid session ID: it is not 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`. Leave out `id`, or pass an ID of those characters.',
    status: 400,
  })
}

/** The key of the session `id` in the store. */
function sessionKey(id: string) {
  return `tempo-id:session:${id}`
}

/** The key of the index of the Tempo ID session `sid` in the store, which lists its session IDs. */
function indexKey(sid: string) {
  return `tempo-id:sid:${sid}`
}

/** The key of the store's `lock` that orders the refreshes of the session `id`. */
function refreshKey(id: string) {
  return `tempo-id:refresh:${id}`
}

/**
 * The key of the logout of the Tempo ID session `sid` in the store, which `close` writes and `link`
 * reads.
 */
function logoutKey(sid: string) {
  return `tempo-id:logout:${sid}`
}

/**
 * The key of when Tempo ID issued the logout token of the Tempo ID session `sid`, in milliseconds,
 * which `close` writes beside {@link logoutKey} and `link` reads.
 */
function logoutIssuedAtKey(sid: string) {
  return `tempo-id:logout-issued-at:${sid}`
}

/**
 * The index of a Tempo ID session: each session ID that it signed in, with its expiry, and whether
 * a logout token closed it, as an earlier release stored it.
 */
type Index = {
  closed?: true | undefined
  /**
   * When Tempo ID issued the latest logout token that closed the index, in milliseconds. Absent for
   * a closed index, every session of the `sid` ends, as an earlier release stored it.
   */
  closedAt?: number | undefined
  /**
   * When the close ends, in milliseconds, 20 minutes after the latest logout token. A later
   * `link` finds the index open. Absent, as an earlier release stored it, the close ends with the index.
   */
  closedUntil?: number | undefined
  entries: readonly Entry[]
}

/**
 * Returns whether Tempo ID issued a session's tokens at `issuedAt` after the logout token of
 * `closedAt`, both in milliseconds. Each counts seconds, so tokens of the same second count as
 * earlier. Either absent, the session counts as earlier.
 */
function issuedAfter(
  issuedAt: number | undefined,
  closedAt: number | undefined,
) {
  return issuedAt !== undefined && closedAt !== undefined && issuedAt > closedAt
}

/** The key of a redirect in progress in the store. */
function pendingKey(id: string) {
  return `tempo-id:pending:${id}`
}

/**
 * The key of a challenge in progress in the store: a SIWE sign-in's, or a session's approval. The
 * prefixes differ, so no session ID that a cookie names reaches an approval as a sign-in.
 */
function challengeKey(options: take.Options) {
  const { id, name } = options
  return name === undefined
    ? `tempo-id:challenge:${id}`
    : `tempo-id:approval:${id}:${name}`
}
