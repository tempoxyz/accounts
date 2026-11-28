/**
 * The session of an instance: an XState actor of `machines.session` that holds the session, its
 * status, and the race guard of its changes, and saves the session to the instance's `Store` in the
 * order of its writes.
 * @module
 */
import { Bytes, Hash } from 'ox'
import {
  type Actor as XStateActor,
  assertEvent,
  assign,
  createActor,
  setup,
  waitFor,
} from 'xstate'
import { RequestError, SupersededError } from '../Accounts.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'
import * as Lock from './Lock.js'
import * as StoreValue from './StoreValue.js'
import * as TempoAccount from './TempoAccount.js'

/** How a change yields to others. A sign-out overtakes every change that started before it. */
export type ChangeOptions = {
  /**
   * The chain that the change's request names, such as a prepared passkey sign-in's. Defaults to the
   * instance's chain when the change starts.
   */
  chainId?: number | undefined
  /**
   * The read of the stored chain selection that the request waits for. Once it settles, the change
   * starts on the instance's chain then, not at the call.
   */
  loading?: Promise<unknown> | undefined
  /**
   * Whether the change restores the session of the browser's Tempo ID session, such as
   * `authorize`, which a sign-in that completes first overtakes too.
   */
  restore?: boolean | undefined
  /**
   * The read of the store's refresh token rotations, which the session's `rotations` started beside
   * the read of `sent`. Absent, a change with `sent` starts the read itself.
   */
  rotations?: Promise<readonly Rotation[] | undefined> | undefined
  /**
   * The refresh token that the change sent, which Tempo ID rotates. When a sign-out overtakes the
   * change, the sign-out revokes the change's new tokens, and never this token again.
   */
  sent?: string | undefined
  /**
   * Whether the store holds the session that an update commits, such as tokens that a refresh read
   * from the store. The commit of an update then writes nothing, and posts no message. A change
   * without `update`, such as a sign-in, always writes. After a failed write, the commit writes too.
   * Defaults to `false`.
   */
  stored?: boolean | undefined
  /**
   * Whether the change updates the current session's tokens, such as a refresh, which any other
   * change overtakes, so an update never writes an earlier user's tokens.
   */
  update?: boolean | undefined
}

/** One refresh token rotation that the store records. */
export type Rotation = {
  /** When the refresh saved the new refresh token, in milliseconds since the epoch. */
  at: number
  /**
   * When the access token of the new refresh token expires, in milliseconds since the epoch. Absent
   * without `to`, and in entries of earlier versions.
   */
  expiresAt?: number | undefined
  /** The SHA-256 digest of the refresh token that the refresh sent. */
  from: string
  /**
   * The refresh token that replaced it. Absent while the refresh waits for its answer, after a
   * refresh without one, and for a token that a sign-in revoked or a sign-in overtook the refresh of,
   * so no context revokes it again.
   */
  to?: string | undefined
  /** Whether earlier rotations can be missing, since the read before the write failed. */
  truncated?: boolean | undefined
}

/** The message that a tab posts to the instance's other tabs after it saves the session. */
type Message = {
  /**
   * When the tab posted the message, after its save, in milliseconds since the epoch. A sign-in
   * after it in another tab follows the sign-out. Absent from a message that states no time.
   */
  at?: number | undefined
  /** Whether the sign-out ends the Tempo ID session, whose logout revokes every tab's restore. */
  everywhere?: boolean | undefined
  /** Whether a sign-out saved the session, which other tabs count as a sign-out. */
  signOut: boolean
}

/** How a change failed. */
export type FailOptions = {
  /**
   * Whether an earlier attempt of the change went unanswered, so Tempo ID may have rotated the
   * refresh token that it sent, whatever the last attempt's error.
   */
  unanswered?: boolean | undefined
}

/**
 * The error of a change that empties the session, such as a refresh that Tempo ID refused after an
 * unanswered attempt. An overtaken change records it as a failure does.
 */
export type Failure = FailOptions & {
  /** The error that ended the change. */
  error: unknown
}

/**
 * A change to the session. A sign-out overtakes every change that started before it. Any other
 * change overtakes an update, such as a refresh, so an update never writes an earlier user's tokens.
 * Of two sign-ins, the one that commits last wins, as the server's session cookie does.
 */
export type Change = {
  /** Throws {@link SupersededError} if a change that overtakes this one completed, and changes nothing. */
  check: () => Promise<void>
  /**
   * Sets the session, or empties it for `undefined`, and saves it. Throws {@link SupersededError}
   * for a session that a newer change overtook.
   */
  commit: (session: Session.Any | undefined, failure?: Failure) => Promise<void>
  /**
   * Rethrows a sign-in's error. A refusal marked `signedIn` empties the session, and revokes its
   * refresh token beside the rejection. An arrow function, which `catch` takes unbound.
   */
  fail: (error: unknown, options?: FailOptions) => Promise<never>
  /** Returns whether a change that overtakes this one completed, without a side effect. */
  overtaken: () => boolean
  /**
   * Returns whether a refusal marked `signedIn` in this instance emptied the session since the change
   * started, without a side effect.
   */
  refused: () => boolean
  /**
   * Records the pending rotation of the refresh token that a change with `sent` sends, before its
   * request. Rejects when the store cannot record it, so the change sends no request.
   */
  prepare: () => Promise<void>
}

/**
 * Creates the session of an instance. Without `enabled`, the session holds nothing, and each change
 * only runs its checks. With a `store`, the session saves to it, under `name`.
 */
export function create(options: create.Options): create.ReturnType {
  const {
    chainId,
    enabled,
    loadChain,
    name,
    onMoved,
    onSignIn,
    onSignOut,
    signOut,
    store,
  } = options

  const writes = store
    ? queue(store, { getFn: options.getFn, guest: options.guest === true })
    : undefined
  // The lock of `exclusive` without Web Locks, for a store without a `lock` of its own.
  // The store's `lock` runs with the store as its receiver, as its other members do.
  const lock: NonNullable<Store['lock']> = store?.lock
    ? (name, fn) => store.lock!(name, fn)
    : Lock.create()
  // The lock in memory of `exclusive` without Web Locks, for a store with a `lock` of its own. It
  // orders the runs of the instance first, and holds a run alone if the store's lock rejects.
  const fallback = store?.lock ? Lock.create() : undefined
  // A browser's tabs share the store, so each saved change tells the instance's other tabs, which
  // read the store again. Another tab's sign-out then empties this one's session at once, and its
  // access key stops signing.
  const channel =
    enabled &&
    writes &&
    typeof document !== 'undefined' &&
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(`${name}:session`)
      : undefined
  // A sign-out applies at once, since the tab that signs out holds the lock through its logout
  // request, unless this instance runs a refresh. The refresh then saves its new tokens first, and
  // the sign-out revokes them. Any other change waits for the lock, so it follows a sign-out that
  // asked for the lock first, which empties the tokens that another tab's refresh saved after it.
  const receive = (data: unknown, connected?: boolean) => {
    const message = data as Message | undefined
    const options = {
      at: message?.at,
      connected,
      everywhere: message?.everywhere === true,
      signOut: message?.signOut === true,
    }
    // Another tab's logout revokes the tokens of this tab's restore, as this tab's own does.
    if (message?.everywhere) actor?.send({ type: 'logout.remote' })
    // The plugins' hooks run after the lock releases, since a hook that takes the lock, such as
    // through `exclusive`, would otherwise wait for itself.
    void (async () => {
      const hooks = await (options.signOut && exclusives === 0
        ? adopt(options)
        : exclusive(() => adopt(options)))
      await hooks?.()
    })().catch(() => undefined)
  }
  if (channel)
    channel.onmessage = (event: MessageEvent<Message>) => receive(event.data)
  // Without a page's channel, other instances in the process on the same store hear each saved
  // change directly, so one instance's sign-out empties the others' sessions at once, as across tabs.
  // The store holds `receive` weakly, and the `post` that it returns holds `receive` while the
  // instance lives.
  const post =
    enabled && !channel
      ? store?.connect?.(name, (data) => receive(data, true))
      : undefined
  const actor = enabled
    ? createActor(
        machines.session.provide({
          actions: {
            // The write enqueues during the event, so a `flush` right after it awaits the write.
            // The message names a sign-out, which other tabs count as one. Another empty write,
            // such as a renewal of an expired session, empties their session as `set` does.
            save: (args) => {
              const signOut = args.event.type.startsWith('signOut')
              // Only a sign-out's save names its logout. Another save during it, such as a sign-in's,
              // ends no Tempo ID session.
              const everywhere = signOut && args.context.signingOut?.everywhere
              writes
                ?.save(name, args.context.session)
                .then(() => {
                  const message = {
                    at: Date.now(),
                    everywhere,
                    signOut,
                  } satisfies Message
                  channel?.postMessage(message)
                  post?.(message)
                })
                .catch(() => undefined)
            },
          },
          delays: {
            // `signedIn` holds a session, so the fallback never applies.
            expiry: (args) =>
              args.context.session
                ? Math.max(
                    machines.expiresAt(args.context.session) - Date.now(),
                    0,
                  )
                : Infinity,
          },
        }),
        { clock },
      ).start()
    : undefined

  // When the instance's session last changed, such as at a read of the store, in milliseconds since
  // the epoch. A sign-in's revocation of the session that it replaces reads it.
  let obtained = 0
  // When a sign-in last committed a session, in milliseconds since the epoch. A refresh and a restore
  // keep it, since another tab's logout that starts after either still revokes their tokens.
  let signedIn = 0
  // The count of other tabs' logouts when the instance's session last changed. A later logout ended
  // the Tempo ID session of that session, and revoked its tokens.
  let obtainedLogouts = 0
  let held = actor?.getSnapshot().context.session
  actor?.subscribe((snapshot) => {
    if (snapshot.context.session === held) return
    held = snapshot.context.session
    obtained = Date.now()
    obtainedLogouts = snapshot.context.logouts.remote
  })

  /** Returns the machine's context. */
  const context = () => actor!.getSnapshot().context

  // The read of `replaceLapsed` in progress, and the version it started at, which a load at the same
  // version shares.
  let lapsed: { run: Promise<void>; version: number } | undefined
  // The read of `signedOut` in progress for a marked instance, which overlapping calls share.
  let marking: Promise<void> | undefined
  /**
   * Reads the store while the instance holds no session and keeps an expired session for the next
   * authorization. A valid stored session becomes the session. An expired one that another context
   * saved since replaces the kept session, and its refresh token is revoked in the background. The
   * read takes no lock, so a renewal waits for no revocation, and a change during the read stays.
   * A load that a read in progress at the same version, or an authorization that read the store
   * already, covers reads nothing more, as {`link machines.checked} decides.
   */
  async function replaceLapsed() {
    if (!actor) return
    const started = context().version
    if (lapsed?.version === started) return await lapsed.run
    if (machines.checked(context())) return
    const run = replace(started).finally(() => {
      if (lapsed?.run === run) lapsed = undefined
    })
    lapsed = { run, version: started }
    return await run
  }

  /** Runs the read of {`link replaceLapsed} that started at version `started`. */
  async function replace(started: number) {
    const stored = await read()
    // Another user's session, valid or expired, is a sign-in, which overtakes a restore that started
    // before it, as in another tab's message.
    const signIn = machines.switches({ current: context().renewing, stored })
    if (context().version !== started) return
    // The authorizations in progress read the store, so their later loads read it no more.
    actor!.send({ type: 'lapsed.checked' })
    if (!writes || !stored) return
    // A valid stored session becomes the session from this read, as `reload` adopts one, with no
    // second read of the store.
    if (!Session.expired(stored)) {
      // After a failed write, the store can hold this instance's earlier copy, so only a session
      // newer than the kept one becomes the session, as `reload` decides.
      const failed = writes.failed()
      if (
        machines.replaces({
          current: failed ? context().renewing : undefined,
          failed,
          stored,
        })
      ) {
        actor!.send({
          session: stored,
          signIn,
          type: 'adopt',
        })
        // The plugins' hooks run for a session that the instance adopts in place of none, as for
        // another tab's message. They run beside the load, since a caller of the load can hold the
        // lock that a hook takes.
        void (async () => onSignIn?.(stored))().catch(() => undefined)
      }
      return
    }
    // After a failed write, the store can hold this instance's earlier copy, whose refresh token
    // rotated since, so only a newer session than the kept one replaces it, as `reload` decides.
    if (
      stored.accessToken === context().renewing?.accessToken ||
      !machines.replaces({
        current: context().renewing,
        failed: writes.failed(),
        stored,
      })
    )
      return
    // The store already holds it, so the instance adopts it without a write.
    actor!.send({
      renewing: stored,
      session: undefined,
      signIn,
      type: 'adopt',
    })
    actor!.send({ type: 'lapsed.checked' })
    // The revocation reads the store under the lock, and skips a token that another context rotated.
    void revokeExpired(stored)
  }

  /** Sets the session, and counts the change. */
  function set(
    session: Session.Any | undefined,
    options: {
      renewing?: Session.Any | undefined
      saved?: boolean | undefined
      signIn?: boolean
    } = {},
  ) {
    actor?.send({
      renewing: options.renewing,
      saved: options.saved,
      session,
      signIn: options.signIn,
      type: 'set',
    })
  }

  // The read of the stored session, which every `load` shares, until one succeeds. `'read'` once one
  // succeeded.
  let hydrating: Promise<Session.Any | undefined> | 'read' | undefined
  // The failed read of a `preload` that no `hydrate` took, such as after a restore hook threw. The
  // next `preload` reads again in its place.
  let unclaimed: Promise<Session.Any | undefined> | undefined
  // The number of runs of `exclusive` in this instance that hold the lock or wait for it.
  let exclusives = 0
  // The run of the latest sign-out, which a call that joins it returns, and the next one follows.
  // The machine's `signingOut` decides whether a sign-out runs. This holds only its promise.
  let latest: Promise<void> | undefined
  // The signed-out mark of an instance without a session, which runs no machine and holds no store.
  // An instance with a session holds the mark in the machine's `marked`.
  let markedLocal = false

  /** Returns whether this instance holds the signed-out mark, in its machine or without one. */
  function holdsMark() {
    return actor ? context().marked : markedLocal
  }

  /**
   * Resolves whether the stored chain selection loaded, which a selection of the session's access
   * key needs. Once it loaded, the shared read sends nothing more. A failed read resolves `false`.
   */
  function chainLoaded() {
    return (loadChain?.() ?? Promise.resolve()).then(
      () => true,
      () => false,
    )
  }

  /**
   * Starts the read of {@link hydrate}, or returns the one in progress. A failed read stays until a
   * `hydrate` or the next `preload` takes it, so a `preload` beside a restore makes the restore's
   * `load` read nothing more, and a later read tries again. Resolves with the stored session, before
   * the selection of the instance's chain.
   */
  function startHydrate(
    actor: machines.session.Actor,
    writes: ReturnType<typeof queue>,
  ): Promise<Session.Any | undefined> {
    if (hydrating === 'read') return Promise.resolve(undefined)
    // After a change, such as a sign-in, `hydrate` keeps the instance's newer session, so a read
    // that starts then sets nothing, and none runs.
    if (!hydrating && actor.getSnapshot().context.version > 0) {
      hydrating = 'read'
      return Promise.resolve(undefined)
    }
    hydrating ??= (async () => {
      // The stored chain selection loads beside the session, so the session selects the access
      // key of the instance's chain. After a failed read of the selection, the chain can still
      // change, so the session stays as the store holds it.
      const [read, loaded] = await Promise.all([
        writes.storage.read(name).then(
          (value) => ({ value }),
          (error: unknown) => {
            // An entry without valid JSON, such as after a partial write, fails at each read, and
            // only the next save replaces it.
            if (error instanceof StoreValue.InvalidValueError) return undefined
            throw error
          },
        ),
        chainLoaded(),
      ])
      // Only a failed read of the store rejects. A record that the library cannot decode holds no
      // session, as before any save, and the next read tries again.
      const stored = (() => {
        if (!read) return 'undecodable' as const
        try {
          return writes.storage.decode(read.value)
        } catch {
          return 'undecodable' as const
        }
      })()
      if (stored === 'undecodable') {
        hydrating = undefined
        return undefined
      }
      const session = loaded
        ? selected(stored?.session, { chainId: chainId() })
        : stored?.session
      const expired = session !== undefined && Session.expired(session)
      actor.send({ expired, session, type: 'hydrate' })
      hydrating = 'read'
      return stored?.session
    })()
    return hydrating
  }

  /**
   * Reads the stored session once. Every read of the session before a change awaits it. A failed
   * read leaves the session unread, so the next read of the session tries again. It rejects with
   * the store's error before any change sets a session, and resolves `undefined` after one. Returns
   * the stored session when the call awaited the read, which then holds the store's latest copy, or
   * `undefined` otherwise.
   */
  async function hydrate(): Promise<
    { stored: Session.Any | undefined } | undefined
  > {
    if (!actor) return undefined
    if (!writes) return undefined
    if (hydrating === 'read') return undefined
    const attempt = startHydrate(actor, writes)
    return await attempt.then(
      (stored) => ({ stored }),
      (error: unknown) => {
        if (hydrating === attempt) hydrating = undefined
        if (unclaimed === attempt) unclaimed = undefined
        // A change since the start, such as a sign-in, set the session that the read would set.
        if (context().version > 0) return undefined
        throw error
      },
    )
  }

  /**
   * Runs `fn` while no other run of the session's `exclusive` does. A browser's tabs share the
   * session through its store, so their Web Lock spans them. A shared store with a `lock` of its
   * own, such as `Store.redis`, spans other processes too, so the run also holds that lock. A run
   * without `counted` saves no session, so another tab's sign-out applies at once beside it.
   */
  function exclusive<value>(
    fn: () => Promise<value>,
    options: { counted?: boolean | undefined } = {},
  ): Promise<value> {
    const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
      ?.locks
    const counts = options.counted !== false
    const counted = async () => {
      if (!counts) return await fn()
      exclusives += 1
      try {
        return await fn()
      } finally {
        exclusives -= 1
      }
    }
    // The store's lock takes a name apart from the Web Lock's, so a store that locks with Web Locks
    // never waits for the lock that its caller holds.
    const key = `${name}:store`
    // Without Web Locks, such as in React Native, the store's lock serializes the runs of every
    // instance on the store, so two instances rotate its refresh token once. If the store's lock
    // rejects before the run, such as a folder that refuses the lock file, the run holds the lock
    // in memory alone, so a sign-out still revokes its tokens. An error of `fn` rejects.
    if (!locks && fallback)
      return fallback(key, async () => {
        let started = false
        const run = () => {
          started = true
          return counted()
        }
        return await lock(key, run).catch((error: unknown) => {
          if (started) throw error
          return counted()
        })
      })
    if (!locks) return lock(key, counted)
    if (!store?.lock || store.local)
      return locks.request(`${name}:exclusive`, counted)
    // Web Locks span one browser or one Node process only, so a shared store's own lock, such as
    // `Store.redis`'s, also serializes the runs of other processes, which then rotate its refresh
    // token once. The Web Lock orders the runs within the process first, so they wait in order.
    // If the store's lock rejects before the run, such as a Redis that refuses writes, the run
    // holds the Web Lock alone, so a sign-out still revokes its tokens. An error of `fn` rejects.
    return locks.request(`${name}:exclusive`, async () => {
      let started = false
      const run = () => {
        started = true
        return counted()
      }
      return await lock(key, run).catch((error: unknown) => {
        if (started) throw error
        return counted()
      })
    })
  }

  /**
   * Reads the stored session again, and sets it when it is newer than the instance's: another tab's
   * sign-out, another user's sign-in, or the same user's later tokens. An earlier copy, such as one
   * that a failed save left behind, never replaces the session. It writes nothing to the store.
   * With `options.hooks`, an adoption that `machines.signsIn` counts runs the plugins' hooks. An
   * adoption revokes the refresh token that it drops, as {@link revokeDropped} describes.
   */
  async function reload(options: { hooks?: boolean | undefined } = {}) {
    if (!actor) return undefined
    // The first read of the store, such as a page's preload beside its restore, holds the store's
    // latest copy, so the reload reads nothing more. A change before it keeps the second read.
    if ((await hydrate().catch(() => undefined)) && context().version === 0)
      return context().session
    if (!writes) return context().session
    // A failed write fails only its own change. The store then holds an earlier copy, or a newer
    // one that another tab saved since, so only the same user's later tokens replace the session.
    // A sign-out here during the wait empties the session before its empty write reaches the store,
    // so the reload waits for that write too. The read then never returns the ended session.
    const started = await flushed()
    const [read, loaded] = await Promise.all([
      writes.storage.getItem(name),
      chainLoaded(),
    ])
    const stored = read?.session
    const current = context().session
    // A change in this instance during the read, such as a sign-in, is newer than what it read. A
    // sign-out in progress here reads the store again under the lock, and ends a session that
    // another context saved after it, such as another tab's refresh of the session that ends.
    if (!machines.reloadable({ current: context(), version: started }))
      return current
    const adopt = (() => {
      // The store keeps a session that a refusal ended until the end takes the lock, so a reload
      // before it never sets the session again.
      if (machines.refusing({ context: context(), stored })) return false
      // A stored session whose access key expired never replaces a session whose access key holds,
      // or none, such as after a read that failed first. `load` adopts one only in place of an
      // expired session, and empties it.
      if (
        stored &&
        Session.expired(stored) &&
        !(current && Session.expired(current))
      )
        return false
      return machines.replaces({
        current,
        failed: writes.failed(),
        stored,
      })
    })()
    // Another context's sign-in of another user overtakes a restore, as a sign-in here does. A
    // session where this instance holds none can be another tab's restore of the same user. The
    // store holds the session already, so the instance writes nothing, which would overwrite a later
    // refresh in another tab with its rotated token.
    if (!adopt) return current
    const since = obtained
    actor.send({
      renewing: machines.renews({
        current,
        expired: !!current && Session.expired(current),
        stored,
      }),
      session: machines.arranged({
        chainId: loaded ? chainId() : undefined,
        current,
        stored,
      }),
      signIn: machines.switches({ current, stored }),
      type: 'adopt',
    })
    revokeDropped(current, since)
    // The plugins' hooks run as for another tab's message, only for a caller that commits no session
    // after the reload, since a commit runs them too. They run beside the reload, since a caller of
    // the reload can hold the lock that a hook takes.
    const session = context().session
    if (options.hooks && machines.signsIn({ current, session }))
      void (async () => onSignIn?.(session!))().catch(() => undefined)
    return session
  }

  /**
   * Sets the session that another tab saved, without a write, since the store already holds it. A
   * failed read, an expired copy, or a change in this instance during the read changes nothing.
   * Another tab's sign-out overtakes every change that started before it, as a sign-out here does,
   * also a restore that holds no session yet. The plugins' hooks run for another tab's sign-out, and
   * for its sign-in where this instance held no session or another user's. Returns the run of those
   * hooks, which the caller starts once it holds no lock. An adoption revokes the refresh token that
   * it drops, as {@link revokeDropped} describes.
   */
  async function adopt(options: {
    /** When the other tab posted its message, in milliseconds since the epoch. */
    at?: number | undefined
    /**
     * Whether the message came through the store's `connect`, from an instance on the same store. The
     * store then holds that instance's values too, so it counts as shared, not local.
     */
    connected?: boolean | undefined
    /**
     * Whether another tab's sign-out ends the Tempo ID session too. Without it, the sign-out marks
     * the store signed out, so this instance holds the mark too.
     */
    everywhere?: boolean | undefined
    /**
     * Whether a stored signed-out mark, or the mark of a logout in progress, keeps the stored
     * session out, as for a read of `signedOut`. Another context's sign-out sets its mark before it
     * empties the session.
     */
    marked?: boolean | undefined
    signOut: boolean
  }): Promise<(() => Promise<void>) | undefined> {
    // A sign-out in progress here reads the store again under the lock, and handles later saves.
    if (!actor || !writes || context().signingOut) return undefined
    await hydrate().catch(() => undefined)
    await writes.flush().catch(() => undefined)
    const started = context().version
    const [read, loaded, marked] = await Promise.all([
      (async () => writes.storage.getItem(name))().then(
        (value) => ({ stored: value?.session }),
        () => undefined,
      ),
      chainLoaded(),
      options.marked
        ? Promise.all(
            [`${name}:signed-out`, `${name}:signed-out:logout`].map((key) =>
              (async () => store?.getItem(key))().then(
                (value) => value === true || typeof value === 'string',
                () => true,
              ),
            ),
          ).then((marks) => marks.includes(true))
        : undefined,
    ])
    const current = context().session
    if (!machines.adoptable({ current: context(), version: started }))
      return undefined
    if (marked) return undefined
    // Another tab's sign-out ends this session also when the store cannot show it, after a failed
    // read or a failed write here. A sign-in that followed it holds the store, and its own message
    // then sets its session.
    // A renewal of an expired session still shows its user, so its end is a sign-out too.
    if (
      machines.signsOut({
        at: options.at,
        everywhere: options.everywhere,
        connected: options.connected,
        local: store?.local,
        signedIn,
        signOut: options.signOut,
        stored: read?.stored,
      })
    ) {
      const { session: shown } = machines.status(actor.getSnapshot())
      actor.send({ marked: !options.everywhere, type: 'signOut.remote' })
      // A local store still holds the session that the logout revoked, so the write empties it, and
      // no later read of the store sets it again.
      if (read?.stored) actor.send({ type: 'save' })
      return current || shown ? async () => onSignOut?.() : undefined
    }
    if (!read) return undefined
    const { stored } = read
    // A message that waited for the lock before a refusal reads the session that the refusal ended,
    // which the store keeps until the end of the refusal takes the lock after it.
    if (machines.refusing({ context: context(), stored })) return undefined
    // Before a load, the session that the first read of the store set shows no status, so another
    // context's save of a session is a sign-in here, as where the instance holds none. An empty
    // store still replaces that read copy, as on a loaded instance.
    const held = context().loaded || !stored ? current : undefined
    // After a failed write, the store can hold this instance's earlier copy, such as the session
    // that a sign-out here failed to empty, so only the same user's later tokens replace it.
    // Without a session, the kept expired session stands for it, so the same user's later session
    // replaces it, as in a read of the store for it.
    const failed = writes.failed()
    const adopted = machines.replaces({
      current: held ?? (failed ? context().renewing : undefined),
      failed,
      stored,
    })
    if (!adopted) return undefined
    if (stored && Session.expired(stored)) return undefined
    const signIn = machines.switches({ current, stored })
    // The hooks receive the session that the instance holds, with its own chain's access key.
    const session = machines.arranged({
      chainId: loaded ? chainId() : undefined,
      current: held,
      stored,
    })
    const since = obtained
    actor.send({
      renewing: machines.renews({
        current: held,
        expired: !!held && Session.expired(held),
        stored,
      }),
      session,
      signIn,
      type: 'adopt',
    })
    // A session that the first read set came from the store too, so its drop revokes it as before.
    revokeDropped(current, since)
    return machines.signsIn({ current: held, session })
      ? async () => onSignIn?.(session!)
      : undefined
  }

  /**
   * The refresh tokens of sign-outs whose revocation received no answer, such as on a device that was
   * offline. The sign-out empties the saved session, so only this entry holds them until the next
   * sign-out revokes them. Reads and writes run under the lock. A read returns `undefined` when it
   * fails, so the sign-out never replaces an entry that it could not read. A failed write keeps
   * nothing, so the instance retains the tokens that no store holds then.
   */
  const unanswered = {
    async read(): Promise<readonly string[] | undefined> {
      const result = await (async () => ({
        value: await store?.getItem(`${name}:unanswered`),
      }))().catch(() => undefined)
      if (!result) return undefined
      return Array.isArray(result.value)
        ? result.value.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []
    },
    /**
     * Returns the tokens that the entry holds once the store took the write, at most the latest 16,
     * or `undefined` when the store refused it.
     */
    async write(
      tokens: readonly string[],
    ): Promise<readonly string[] | undefined> {
      const key = `${name}:unanswered`
      const held = tokens.slice(-16)
      return (async () => {
        await (held.length === 0
          ? store?.removeItem(key)
          : store?.setItem(key, held))
        return held
      })().catch(() => undefined)
    },
  }

  /**
   * The refresh tokens that a context revoked, such as another tab, as SHA-256 digests. A second
   * revocation counts as a reuse, which revokes the app's tokens on the user's other devices. Reads
   * and writes run under the lock, so a run of the lock reads the digests once, and writes them once.
   * A failed read returns none. A failed write marks nothing.
   */
  const revoked = {
    /** Returns whether `digests` hold the refresh token of `session`. */
    has(
      digests: readonly string[],
      session: Pick<Session.Any, 'refreshToken'> | undefined,
    ) {
      if (!session?.refreshToken) return false
      return digests.includes(digest(session.refreshToken))
    },
    /** Reads the digests, or none when the read fails. */
    async read(): Promise<readonly string[]> {
      const value = await (async () =>
        store?.getItem(`${name}:revoked`))().catch(() => undefined)
      return Array.isArray(value) ? value : []
    },
    // ponytail: the 32 latest digests, enough for a sign-out's own token, the 16 pending tokens of
    // the unanswered entry, and the sessions that one store's contexts hold. A digest that the list
    // holds moves to its end.
    /** Writes `digests` with the digest of each token of `tokens` at the end, in order. */
    async write(digests: readonly string[], tokens: readonly string[]) {
      if (!store || tokens.length === 0) return
      const added = tokens.map((token): string => digest(token))
      const next = [
        ...digests.filter((entry) => !added.includes(entry)),
        ...added.filter((entry, index) => added.lastIndexOf(entry) === index),
      ].slice(-32)
      await (async () => store.setItem(`${name}:revoked`, next))().catch(
        () => undefined,
      )
    },
  }

  /**
   * The latest refresh token rotations of the store's contexts, such as another tab's refresh, as
   * the SHA-256 digest of the sent token and the refresh token that replaced it. A sign-in in a
   * context that still holds a rotated token revokes its successor instead, since a revocation of a
   * rotated token counts as a reuse. A failed read returns `undefined`. A failed write records
   * nothing.
   */
  const rotations = {
    /** Reads the rotations, or `undefined` when the read fails. */
    async read(): Promise<readonly Rotation[] | undefined> {
      const result = await (async () => ({
        value: await store?.getItem(`${name}:rotated`),
      }))().catch(() => undefined)
      if (!result) return undefined
      return Array.isArray(result.value) ? result.value : []
    },
    /**
     * Returns the latest refresh token of the lineage of `refreshToken`, which `entries` follow from
     * it, or `refreshToken` itself. Returns `undefined` for a lineage whose last rotation is unknown.
     */
    successor(entries: readonly Rotation[], refreshToken: string) {
      let token: string | undefined = refreshToken
      for (const _ of entries) {
        const entry = entries.find((entry) => entry.from === digest(token!))
        if (!entry) break
        token = entry.to
        if (token === undefined) break
      }
      return token
    },
    /**
     * Writes `entries` with the rotation of `from` to `to` at the end, in place of an earlier entry
     * of `from`, and returns them. Without `entries`, after a failed read, the rotation starts a list
     * that marks earlier rotations as unknown. Without `to`, the rotation is pending or ended.
     * Rejects when the write fails.
     */
    async write(
      entries: readonly Rotation[] | undefined,
      options: {
        expiresAt?: number | undefined
        from: string
        to?: string | undefined
      },
    ): Promise<readonly Rotation[]> {
      const { expiresAt, from, to } = options
      const key = digest(from)
      const [first, ...rest] = [
        ...(entries ?? []).filter((entry) => entry.from !== key),
        {
          at: Date.now(),
          ...(to && expiresAt ? { expiresAt } : {}),
          from: key,
          ...(to ? { to } : {}),
        },
      ].slice(-rotationLimit)
      // A list that lacks earlier rotations keeps its mark on its first entry, also after the entry
      // that carried it moves or leaves, until the list fills.
      const truncated = !entries || entries.some((entry) => entry.truncated)
      const next = [
        { ...first!, ...(truncated ? { truncated: true } : {}) },
        ...rest,
      ]
      await store?.setItem(`${name}:rotated`, next)
      return next
    },
  }

  /**
   * Revokes the refresh token of `session`, whose access key expired, under the lock, unless another
   * context revoked it or rotated it. It ends no Tempo ID session. A revocation without an answer
   * enters the unanswered entry, or the instance's retained tokens when the store refuses the entry,
   * so the next sign-out sends it again.
   */
  async function revokeExpired(
    session: Session.Any,
    options: { unsaved?: boolean | undefined } = {},
  ) {
    const { refreshToken } = session
    if (!refreshToken) return
    await exclusive(async () => {
      // A refresh that took the lock after the empty write rotated the token, and saved its
      // successor. A revocation of a rotated token counts as a reuse, which revokes the app's tokens
      // on the user's other devices, so a later `load` ends the successor instead. No store ever held
      // an unsaved session, so no refresh rotated its token.
      const [stored, digests] = await Promise.all([read(), revoked.read()])
      if (
        !options.unsaved &&
        stored?.refreshToken &&
        stored.refreshToken !== refreshToken
      )
        return
      if (revoked.has(digests, session)) return
      // The store no longer holds the session, so only the unanswered entry keeps a token whose
      // revocation received no answer, such as on a device that is offline. The next sign-out sends it again.
      const failed = await signOut(session, {
        logout: false,
        onRevoked: () => revoked.write(digests, [refreshToken]),
      }).then(
        () => false,
        () => true,
      )
      if (failed) await retain(refreshToken, { logouts: obtainedLogouts })
    }).catch(() => undefined)
  }

  /**
   * Keeps `refreshToken`, which no store holds and whose revocation received no answer, for the next
   * sign-out to send again: in the unanswered entry, or in the instance's retained tokens when the
   * store refuses the entry. Runs under the lock. Rejects nothing.
   */
  async function retain(
    refreshToken: string,
    options: {
      /**
       * The count of other tabs' logouts when the token was last known live. A later logout ended
       * the Tempo ID session that issued it, so the next sign-out then sends no revocation.
       */
      logouts: number
    },
  ) {
    // The entry is read after the revocation, so a token that another context added during the
    // request stays.
    const current = await unanswered.read()
    const persisted = current
      ? await unanswered.write([
          ...current.filter((token) => token !== refreshToken),
          refreshToken,
        ])
      : undefined
    // A store that refuses the entry leaves the token in this instance, so its next sign-out sends it.
    const kept = machines.retains({
      live: [refreshToken],
      logouts: options.logouts,
      persisted,
      retained,
      unsaved: [refreshToken],
    })
    for (const [token, remote] of kept) retained.set(token, remote)
  }

  /**
   * Ends the session that a refusal marked `signedIn` emptied in this instance, under the lock. It
   * empties the store, and revokes the refresh token that the store holds then, such as another tab's
   * successor of the ended session. A refresh that took the lock first marks the token that it
   * rotated in the revoked digests, so the revocation skips it. It ends no Tempo ID session, and
   * rejects nothing. A failed revocation leaves the token live.
   */
  async function endRefused(
    ended: Session.Any,
    refused: machines.session.Context,
  ) {
    // Only the end tracks the user, so a refusal without an end, such as a failed save's, keeps no
    // user out of a later reload.
    actor?.send({ type: 'refusal.start', userId: Session.subject(ended) })
    await exclusive(async () => {
      const [stored, digests] = await Promise.all([read(), revoked.read()])
      const { empty, session: ending } = machines.refusal({
        current: context(),
        ended,
        refused,
        stored,
      })
      if (empty) {
        set(undefined)
        await writes?.flush()
      }

      const { refreshToken } = ending
      if (!refreshToken) return
      if (revoked.has(digests, ending)) return
      await signOut(ending, {
        logout: false,
        onRevoked: () => revoked.write(digests, [refreshToken]),
      })
    })
      .catch(() => undefined)
      .finally(() => {
        actor?.send({ type: 'refusal.end', userId: Session.subject(ended) })
      })
  }

  /**
   * Revokes the refresh token of `current`, which an adoption of another context's session dropped,
   * in the background. Two contexts that sign in at once can each save before the other's read, so
   * the later save overwrites a session that no sign-in revokes, and no store holds it. The
   * revocation skips a token that another context rotated into the stored session, or still keeps.
   * An adopted sign-out drops no token: that sign-out revoked the stored tokens under the lock.
   * `since` is when the instance obtained `current`.
   */
  function revokeDropped(current: Session.Any | undefined, since: number) {
    if (!current?.refreshToken) return
    // Without a stored session, `machines.adopts` keeps every token, so the revocation would only
    // take the lock and read the store.
    const session = context().session
    if (!session) return
    if (current.refreshToken === session.refreshToken) return
    void revokeReplaced(current, since)
  }

  /**
   * Revokes the refresh token of `session`, which a sign-in replaced, under the lock, unless a
   * refresh rotated it or a context revoked it. It ends no Tempo ID session. A failed revocation
   * leaves the token live.
   */
  async function revokeReplaced(session: Session.Any, since: number) {
    const { refreshToken } = session
    if (!refreshToken) return
    await exclusive(
      async () => {
        if (rotated.has(refreshToken)) return
        const [digests, entries, stored, earlier] = await Promise.all([
          revoked.read(),
          rotations.read(),
          read(),
          unanswered.read(),
        ])
        // A refresh in another context, such as another tab, can have rotated the token before the
        // sign-in, so the revocation ends the token that replaced it, unless the store holds it.
        // Without the rotations, another context's rotation of the token is unknown.
        if (!entries) return
        const live = rotations.successor(entries, refreshToken)
        if (live === undefined) return
        // A rotation of the token follows the instance's read of it. A full or truncated list that starts
        // after that read can lack the rotation, so the token stays live, as a reuse is worse.
        if (live === refreshToken && machines.lacks({ entries, since })) return
        if (live === stored?.refreshToken) return
        if (revoked.has(digests, { refreshToken: live })) return
        // Another context can still hold the token, or the successor that it rotated the token to. It
        // adopts the stored session only as `newer` decides. Otherwise it keeps the token, and a
        // revocation of it counts as a reuse at its next refresh.
        if (
          !machines.adopts({
            entries,
            held: session,
            refreshToken: live,
            stored,
          })
        )
          return
        // The list marks the token before its revocation, so another context that still holds it, such
        // as a tab that never read the sign-in, never revokes it again, also after the revoked digests
        // drop it. A failed write leaves the token live.
        const marked = await rotations.write(entries, { from: live }).then(
          () => true,
          () => false,
        )
        if (!marked) return
        // Only a revocation without an answer enters the unanswered entry, so the next sign-out sends
        // it again. A revocation that an unload aborts can have reached Tempo ID, so it stays out, as
        // a second revocation counts as a reuse.
        let answered = false
        const failed = await signOut(
          { ...session, refreshToken: live },
          {
            logout: false,
            onRevoked: () => {
              answered = true
              return Promise.resolve()
            },
          },
        ).then(
          () => false,
          () => true,
        )
        if (answered) {
          await revoked.write(digests, [live])
          return
        }
        if (failed && earlier)
          await unanswered.write([
            ...earlier.filter((token) => token !== live),
            live,
          ])
      },
      { counted: false },
    ).catch(() => undefined)
  }

  /**
   * Saves `overwritten`, the session of another context's sign-in that this instance's sign-in of
   * `kept` replaced in the store, and holds it, and then revokes the refresh token of `kept`. The
   * other context keeps `overwritten`, as `machines.yields` decides, so both hold one session, and
   * no live token stays out of the store. Under the lock, a change since the save of `kept`, here
   * or in the store, keeps everything as it is. If a context rotated the refresh token of
   * `overwritten` since `since`, or the rotations are unknown, {@link revokeReplaced} decides in
   * place of the yield. The session takes the instance's chain, as a sign-in's commit does. A failed
   * save revokes nothing. Rejects nothing.
   */
  async function yieldTo(
    overwritten: Session.Any,
    options: {
      /** The session that the sign-in saved. */
      kept: Session.Any
      /** The session that the instance held before the sign-in. */
      replaced: Session.Any | undefined
      /** When the sign-in read the store, in milliseconds since the epoch. */
      since: number
    },
  ) {
    const { kept, replaced, since } = options
    const refreshToken = overwritten.refreshToken!
    // A session without a refresh token matches an emptied store, so only a session with one yields.
    if (!kept.refreshToken) return await revokeReplaced(overwritten, since)
    const result = await exclusive(async () => {
      if (rotated.has(refreshToken)) return 'rotated' as const
      const [digests, earlier, entries, loaded, stored] = await Promise.all([
        revoked.read(),
        unanswered.read(),
        rotations.read(),
        chainLoaded(),
        read(),
      ])
      const decision = machines.handoff({
        held: context().session?.refreshToken === kept.refreshToken,
        kept: {
          ended: rotated.has(kept.refreshToken!) || revoked.has(digests, kept),
          successor: entries
            ? rotations.successor(entries, kept.refreshToken!)
            : undefined,
          token: kept.refreshToken!,
        },
        lacks: !entries || machines.lacks({ entries, since }),
        overwritten: {
          ended:
            revoked.has(digests, overwritten) ||
            !!earlier?.includes(refreshToken),
          successor: entries
            ? rotations.successor(entries, refreshToken)
            : undefined,
          token: refreshToken,
        },
        refreshed:
          !!entries &&
          !!replaced?.refreshToken &&
          rotations.successor(entries, replaced.refreshToken) === refreshToken,
        stored: stored?.refreshToken === kept.refreshToken,
      })
      if (decision !== 'yield') return decision
      const next = loaded
        ? selected(overwritten, { chainId: chainId() })
        : overwritten
      // A session whose access key expired cannot act, so a usable `kept` stays.
      if (!next || Session.expired(next)) return 'kept' as const
      set(next)
      // A failed save rejects its change, so the instance holds `kept` again, as the store does.
      const saved = await (writes?.flush() ?? Promise.resolve()).then(
        () => true,
        () => false,
      )
      // A failed save rejects its change, unless a later sign-in replaced it.
      if (!saved) {
        if (context().session === next) set(kept)
        return 'kept' as const
      }
      // The list marks the token before its revocation, so a context that still holds it never
      // revokes it again, also if the revoked digests fail. A failed write leaves the token live.
      const marked = await rotations
        .write(entries, { from: kept.refreshToken! })
        .then(
          () => true,
          () => false,
        )
      if (!marked) return 'yielded' as const
      // The revocation runs in the same lock as the save, so no other yield restores `kept` between
      // them. A failed revocation keeps the token for the next sign-out.
      const failed = await signOut(kept, {
        logout: false,
        onRevoked: () => revoked.write(digests, [kept.refreshToken!]),
      }).then(
        () => false,
        () => true,
      )
      if (failed) await retain(kept.refreshToken!, { logouts: obtainedLogouts })
      return 'yielded' as const
    }).catch(() => 'kept' as const)
    if (result === 'rotated' || result === 'declined')
      await revokeReplaced(overwritten, since)
  }

  /**
   * Revokes the refresh token of `session`, a sign-in's whose save the store refused, under the
   * lock, unless a logout since `started`, the commit that received it, can have revoked it, or a
   * context revoked it. It ends no Tempo ID session. A revocation without an answer enters the
   * unanswered entry, or the instance's retained tokens when the store refuses the entry, so the
   * next sign-out sends it again.
   */
  async function revokeUnsaved(
    session: Session.Any,
    started: machines.session.Context,
  ) {
    const { refreshToken } = session
    if (!actor || !refreshToken) return
    while (true) {
      // A revocation beside a logout in progress can arrive after it, and count as a reuse, so the
      // revocation waits for the outcome. The sign-out counts as in progress before it takes the
      // lock, so the wait runs outside the lock.
      await waitFor(
        actor,
        (snapshot) =>
          machines.restored({ current: snapshot.context, started }) !==
          undefined,
      )
      const settled = await exclusive(
        async () => {
          const current = context()
          const restored = machines.restored({ current, started })
          // A sign-out with `everywhere` that started since waits for the lock, so the revocation
          // frees it, and waits for that logout's outcome.
          if (restored === undefined) return false
          // A logout ended the Tempo ID session that issued the token, and a second revocation of
          // the token counts as a reuse.
          if (restored) return true
          const digests = await revoked.read()
          if (revoked.has(digests, session)) return true
          // No store holds the token, so a revocation without an answer keeps it for the next
          // sign-out.
          await signOut(session, {
            logout: false,
            onRevoked: () => revoked.write(digests, [refreshToken]),
          }).catch(() =>
            retain(refreshToken, { logouts: current.logouts.remote }),
          )
          return true
        },
        { counted: false },
      ).catch(() => true)
      if (settled) return
    }
  }

  /**
   * Revokes the refresh token of `session`, a restore's that a sign-out overtook, under the lock,
   * unless a logout since `started` can have revoked it, a later change followed the sign-out, or a
   * context revoked it. It ends no Tempo ID session. A revocation without an answer rejects, and
   * enters the unanswered entry, or the instance's retained tokens when the store refuses the entry,
   * so the next sign-out sends it again.
   */
  async function revokeRestored(
    session: Session.Any,
    started: machines.session.Context,
  ) {
    const { refreshToken } = session
    if (!actor || !refreshToken) return
    while (true) {
      // A revocation beside a logout in progress can arrive after it, and count as a reuse, so the
      // restore waits for the outcome. The sign-out counts as in progress before it takes the lock,
      // so the wait runs outside the lock.
      await waitFor(
        actor,
        (snapshot) =>
          machines.restored({ current: snapshot.context, started }) !==
          undefined,
      )
      // The lock holds a later sign-out's logout until the revocation's answer.
      const settled = await exclusive(
        async () => {
          const current = context()
          const restored = machines.restored({ current, started })
          // A sign-out with `everywhere` that started since waits for the lock, so the restore
          // frees it, and waits for that logout's outcome.
          if (restored === undefined) return false
          if (current.signedOut !== current.version) return true
          // The mark keeps a caller that discards the session after a later sign-in, such as a
          // retry's renewal, from a second revocation.
          const digests = await revoked.read()
          if (revoked.has(digests, session)) return true
          // No store holds the restore's token, so a revocation without an answer keeps it for the
          // next sign-out.
          await signOut(session, {
            logout: false,
            onRevoked: () => revoked.write(digests, [refreshToken]),
            restored,
          }).catch(async (error: unknown) => {
            // The instance never held the restore's session, so the count of its last change is
            // an earlier one. No logout started since the restore did, as `restored` tells.
            await retain(refreshToken, { logouts: current.logouts.remote })
            throw error
          })
          return true
        },
        { counted: false },
      )
      if (settled) return
    }
  }

  /** Returns the SHA-256 digest of `token`. React Native has no `crypto.subtle`, so ox hashes it. */
  function digest(token: string) {
    return Hash.sha256(Bytes.fromString(token), { as: 'Hex' })
  }

  /**
   * Writes the signed-out mark to the store, or deletes it with the mark of any logout in progress,
   * such as at a sign-in. The caller sets the instance's own copy at once, before the write. A
   * failed write fails nothing.
   */
  async function mark(value: boolean) {
    const key = `${name}:signed-out`
    await Promise.all([
      (async () =>
        value ? store?.setItem(key, true) : store?.removeItem(key))().catch(
        () => undefined,
      ),
      value ? undefined : unmark(),
    ])
  }

  /**
   * Writes the mark of the logout `id` in progress, under a key of its own, so its end deletes no
   * signed-out mark that another context writes meanwhile. The same write deletes the signed-out
   * mark, since the logout ends the Tempo ID session. A failed write fails nothing.
   */
  async function markLogout(id: string) {
    await Promise.all([
      (async () => store?.setItem(`${name}:signed-out:logout`, id))().catch(
        () => undefined,
      ),
      (async () => store?.removeItem(`${name}:signed-out`))().catch(
        () => undefined,
      ),
    ])
  }

  /**
   * Deletes the mark of the logout `id`, unless another logout replaced it, or the mark of any
   * logout without `id`. A failed read or write fails nothing.
   */
  async function unmark(id?: string) {
    const key = `${name}:signed-out:logout`
    await (async () => {
      if (id !== undefined && (await store?.getItem(key)) !== id) return
      await store?.removeItem(key)
    })().catch(() => undefined)
  }

  /** Reads the stored session, or `undefined` when the read fails. */
  async function read(options: { onError?: () => void } = {}) {
    if (!writes) return undefined
    const { storage } = writes
    const stored = await (async () => storage.getItem(name))().catch(() => {
      options.onError?.()
      return undefined
    })
    return stored?.session
  }

  /**
   * Resolves once every write of the session completed, also one that a change in this instance
   * enqueued during the wait, such as a sign-out's empty write. Returns the `version` then, or `0`
   * without a context.
   */
  async function flushed(): Promise<number> {
    const started = actor ? context().version : 0
    await writes?.flush().catch(() => undefined)
    if (actor && context().version !== started) return flushed()
    return started
  }

  // The last status that `status` returned, which an unchanged status returns again, so a render
  // that reads it does not repeat.
  let shown: Session.Status<Session.Any> = signedOut_status

  /** Returns the status, or the last one that it returned while the status is unchanged. */
  function getStatus() {
    if (!actor) return signedOut_status
    const next = machines.status(actor.getSnapshot())
    if (next.status !== shown.status || next.session !== shown.session)
      shown = next
    return shown
  }

  /** Calls `listener` with each new status and the one before it. Returns the unsubscribe. */
  function subscribeStatus(
    listener: (
      status: Session.Status<Session.Any>,
      previous: Session.Status<Session.Any>,
    ) => void,
  ) {
    if (!actor) return () => {}
    let previous = getStatus()
    const subscription = actor.subscribe(() => {
      const status = getStatus()
      if (status === previous) return
      const before = previous
      previous = status
      listener(status, before)
    })
    return () => subscription.unsubscribe()
  }

  // The refresh tokens that an update, such as a refresh, sent before a sign-out overtook it. The
  // update ends its own new session, and a revocation of a rotated token counts as a reuse. An
  // unanswered update holds its error, since its new session, if any, stays unrevoked.
  const rotated = new Map<string, { error: unknown } | undefined>()
  // The refresh tokens whose revocation received no answer, while the store refuses the unanswered
  // entry: those of unsaved sessions, and a sign-out's own, whose session the store holds no more.
  // No store holds them, so only this instance can revoke them, and its next sign-out sends them
  // again.
  // Each token maps to the count of other tabs' logouts when it entered, since a later logout ends
  // it, and a second revocation counts as a reuse.
  const retained = new Map<string, number>()

  // The authorizations that run now, each settled to `undefined`, which `settled` waits for.
  const authorizations = new Set<Promise<void>>()

  /**
   * Runs `fn`, an authorization, while no authorization of another instance on the store runs, such
   * as another tab's restore of the same Tempo ID session. An authorization that waited reads the
   * store first, so a session that the other one saved returns with no request, and runs the plugins'
   * `afterSignIn` hooks. An instance whose saved session holds waits for no lock, and a wait ends
   * after `authorizeWait`, so a passkey prompt in another tab holds no restore. An uncontended
   * authorization reads nothing more. Without Web Locks, `fn` runs as it is.
   */
  function serialized<value>(fn: () => Promise<value>): Promise<value> {
    const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
      ?.locks
    if (!locks || !writes) return fn()
    const key = `${name}:authorize`
    return locks.request(key, { ifAvailable: true }, async (held) => {
      if (held) return await fn()
      // A saved session that holds needs no authorization, so its read waits for no other one. The
      // read is the store's first, which `fn` reads anyway.
      await hydrate().catch(() => undefined)
      const current = context().session
      if (current && !Session.expired(current)) return await fn()
      // The other authorization can wait for the user, such as at a passkey prompt, so the wait
      // ends after `authorizeWait`, and `fn` then runs beside it. The signal ends only the wait:
      // the request rejects with its reason only before the lock is granted.
      const signal = AbortSignal.timeout(authorizeWait)
      return await locks
        .request(key, { signal }, async () => {
          // The other authorization's session commits nothing here, so its adoption runs the
          // plugins' `afterSignIn` hooks. A failed read leaves the session that `fn` loads.
          await reload({ hooks: true }).catch(() => undefined)
          return await fn()
        })
        .catch((error: unknown) => {
          if (error !== signal.reason) throw error
          return fn()
        })
    })
  }

  return {
    actor,
    async authorize(fn) {
      if (!actor) return await fn()
      // Only the first authorization of the instance takes the lock. A nested one, or one beside
      // another, runs as it is, since the one that holds the lock can wait for it.
      const first = authorizations.size === 0 && context().delegations === 0
      actor.send({ type: 'authorize.start' })
      const promise = first ? serialized(fn) : fn()
      const entry = promise.then(
        () => undefined,
        () => undefined,
      )
      authorizations.add(entry)
      try {
        return await promise
      } finally {
        authorizations.delete(entry)
        actor.send({ type: 'authorize.end' })
      }
    },
    change(options = {}) {
      // An instance without a session, such as a backend's, serves many users at once, so no
      // change of one user's overtakes another's.
      if (!actor)
        return {
          async check() {},
          async commit(session) {
            if (!session) return
            // A sign-in clears the signed-out mark, as `change.commit` clears the machine's.
            if (!options.update) markedLocal = false
            await onSignIn?.(session)
          },
          fail: (error) => Promise.reject(error),
          overtaken: () => false,
          refused: () => false,
          async prepare() {},
        }

      // The context when the change starts, such as whether a sign-out runs, which a restore reads.
      const started = context()
      // The instance's chain when the change starts, which a sign-in requests its access key on. A
      // change that waits for the stored selection starts on the loaded chain. The handler runs
      // before the request's own wait for the same read ends.
      let startedChain = options.chainId ?? chainId()
      void options.loading?.then(() => {
        startedChain = options.chainId ?? chainId()
      })
      // A refresh records its pending rotation before its request, and its new token at the commit.
      let history = options.sent
        ? (options.rotations?.catch(() => undefined) ?? rotations.read())
        : undefined
      // A refresh whose record of the pending rotation fails sends no request, so it rotated nothing.
      let sending: 'possible' | 'refused' = 'possible'
      /** Returns whether a change that overtakes this one completed since it started. */
      const overtaken = () =>
        machines.overtaken({
          current: context(),
          restore: options.restore,
          started,
          update: options.update,
        })
      // A sign-in that finishes after sign-out can set a new server session, so it ends that
      // session again, unless a newer change already followed the sign-out.
      const superseded = async (
        session?: Session.Any,
        error?: unknown,
        failure: FailOptions = {},
      ) => {
        // An update that sent no refresh token, such as the account of a session without an access key,
        // holds the tokens that the sign-out ended already.
        if (options.update && !options.sent) return new SupersededError()
        // A refresh that a sign-out or a refusal overtook rotated the token that the sign-out or the
        // refusal holds, so it skips that token, and the refresh revokes its own new one. A refresh sets no
        // Tempo ID session, so it sends no logout, which would end another tab's later sign-in.
        if (options.sent && machines.ended({ current: context(), started })) {
          // Only a refresh that sent no request, or that Tempo ID refused at each attempt, rotated
          // nothing, so the sign-out revokes the token it sent. A refused redirect sent no token on. An unanswered attempt may have rotated it, so the sign-out
          // skips that token.
          const refused =
            sending === 'refused' ||
            (!failure.unanswered &&
              error instanceof RequestError &&
              (Api.redirectRefused(error) ||
                (error.status >= 400 && error.status < 500)))
          if (session) rotated.set(options.sent, undefined)
          else if (!refused) rotated.set(options.sent, { error })
          const marks = (() => {
            // Tempo ID answered with new tokens, so the sent token is rotated. Another tab's
            // sign-out that waits for the lock holds that token, and reads no `rotated` of this
            // instance, so it finds the token in the store's revoked digests.
            if (session) return true
            // A sign-out clears `rotated` before it takes the lock, so the end of a refusal, which
            // waits for the lock, finds the token in the digests too, also after an attempt
            // without an answer.
            return !refused && machines.refused({ current: context(), started })
          })()
          const { sent } = options
          // Only this instance holds the new token, and the sign-out skips the sent one. A
          // revocation without an answer keeps the new token for the next sign-out, and rejects.
          const received = session?.refreshToken
          // The revocation reads no digest, so it runs beside their write. The write completes
          // before the lock releases, also after a revocation without an answer.
          const [, unrevoked] = await Promise.all([
            marks
              ? revoked.read().then((digests) => revoked.write(digests, [sent]))
              : undefined,
            session
              ? settle(
                  signOut(session, { logout: false }).catch(
                    async (error: unknown) => {
                      if (received)
                        await retain(received, {
                          logouts: obtainedLogouts,
                        })
                      throw error
                    },
                  ),
                )
              : undefined,
          ])
          if (unrevoked) throw unrevoked.error
          return new SupersededError()
        }
        // For 30 seconds after a rotation, Tempo ID returns the same tokens for the rotated token. A
        // context that holds no shared lock, such as another process on the same store, can save
        // those tokens first, and the instance adopts them. They are the live session, so the refresh
        // revokes nothing.
        // The refresh still records its rotation, so a context that holds the sent token skips it.
        if (
          session?.refreshToken &&
          session.refreshToken === context().session?.refreshToken
        ) {
          // The other context can have recorded later rotations since this refresh read the list, so
          // the write starts from a new read. A failed read marks earlier rotations as unknown.
          if (options.sent && history)
            await rotations
              .write(await rotations.read(), {
                expiresAt: session.expiresAt,
                from: options.sent,
                to: session.refreshToken,
              })
              .catch(() => undefined)
          return new SupersededError()
        }
        // A refresh that a sign-in overtook rotated the token of the session that the sign-in
        // replaced. The refresh revokes its own new token, and marks both tokens revoked under the
        // lock, so the sign-in's revocation of the rotated token, which counts as a reuse, never runs.
        // A refresh whose session a read of the store emptied, such as after another context's
        // sign-out, revokes its new token the same way, since no store holds it.
        // An empty session follows the sign-out below.
        if (options.sent && session) {
          const sent = options.sent
          rotated.set(sent, undefined)
          // The sent token is marked as revoked and ended before the revocation, which can receive no
          // answer. Only this instance holds the new token, so a sign-in in another context that holds
          // the sent token skips it, also after a failed write of the revoked digests.
          // The rotations are read again, since a context without a shared lock, such as another
          // process, can have recorded rotations since the refresh read them.
          const [digests, entries] = await Promise.all([
            revoked.read(),
            rotations.read(),
          ])
          // Such a context can receive the same new token through the rotation grace period, and
          // hold it or send it. A revocation of that token counts as a reuse, so it stays live. Its
          // record of the rotation also stays.
          const received = session.refreshToken!
          const known = entries?.find((entry) => entry.from === digest(sent))
          const shared = machines.shares({
            digest: digest(received),
            digests,
            entries,
            received,
          })
          await Promise.all([
            revoked.write(digests, [sent]),
            known?.to
              ? undefined
              : rotations.write(entries, { from: sent }).catch(() => undefined),
          ])
          if (shared) return new SupersededError()
          // Only a revocation without an answer enters the unanswered entry, so the next sign-out
          // sends it again.
          const failed = await signOut(session, {
            logout: false,
            onRevoked: () =>
              revoked.write(digests, [sent, session.refreshToken!]),
          }).then(
            () => false,
            () => true,
          )
          // No store holds the new token, so a failed write of the entry keeps it in the instance.
          if (failed) await retain(received, { logouts: obtainedLogouts })
          return new SupersededError()
        }
        // A refresh that a sign-in overtook, and that received no answer, may have rotated the
        // replaced token, so the sign-in's revocation skips that token. Only a refresh that sent no
        // request, or that Tempo ID refused at each attempt, rotated nothing.
        if (options.sent && !session && context().session) {
          const refused =
            sending === 'refused' ||
            (!failure.unanswered &&
              error instanceof RequestError &&
              (Api.redirectRefused(error) ||
                (error.status >= 400 && error.status < 500)))
          if (!refused) rotated.set(options.sent, { error })
        }
        // A restore, such as `authorize`, reads a Tempo ID session and sets none, so it sends no
        // logout, which would end a Tempo ID session that another tab started since. Only a sign-out
        // with `everywhere` logs out. A logout that succeeds revokes the restore's tokens, so the
        // restore revokes them only after a logout that Tempo ID refused.
        if (options.restore) {
          if (session) await revokeRestored(session, started)
          return new SupersededError()
        }
        const current = context()
        if (current.signedOut === current.version) {
          const logout = machines.loggedOut({ current, started })
          // The logout of an overtaken sign-in revokes the tokens of a restore in progress too, and
          // no restore waits for it, so it counts from its start as one of unknown outcome.
          if (logout) actor.send({ type: 'logout.unknown' })
          await signOut(session, { logout })
        }
        return new SupersededError()
      }
      return {
        async check() {
          if (overtaken()) throw await superseded()
        },
        async commit(session, failure) {
          if (overtaken()) {
            if (session) throw await superseded(session)
            // A refusal after an unanswered attempt leaves the rotation of the sent token unknown, so
            // the sign-out skips that token, as for a failed change.
            if (failure?.unanswered)
              throw await superseded(undefined, failure.error, failure)
            return
          }
          // An empty result, such as an `authorize` that found no Tempo ID session, never empties a
          // session that a newer change set.
          if (!session && context().version !== started.version) return
          if (
            !session &&
            !machines.empties({
              current: context().session,
              failed: writes?.failed() ?? false,
            })
          ) {
            actor.send({ type: 'load' })
            return
          }
          // A sign-in replaces the session that the instance holds, whose refresh token no later
          // sign-out reads.
          const signIn = !!session && !options.update && !options.restore
          const replaced = signIn ? context().session : undefined
          // Another context, such as a second run of a CLI's login, can have saved a session that this
          // instance never read. The sign-in's save replaces it, so the read starts before the save,
          // and the sign-in never waits for it.
          const overwriting = signIn ? read() : undefined
          const readAt = Date.now()
          const since = obtained
          const kept = moved(session, {
            chainId: chainId(),
            startedChain,
            update: !!options.update,
          })
          // A sign-in that a switch overtook holds no access key or account on the instance's chain, so
          // the instance reads the account there.
          const unread =
            !!kept && kept !== session && !kept.account && !kept.accessKey
          // A restore, such as `authorize`, reads the same Tempo ID session, so it overtakes none.
          // An update of the session that the store holds writes nothing, so the other instances on
          // the store read no message, and take no lock to read the store again.
          set(kept, {
            saved: !!options.update && !!options.stored && !writes?.failed(),
            signIn,
          })
          if (signIn) signedIn = Date.now()
          // Tempo ID issued the tokens before the commit, so only a logout from now on ends them.
          const issued = context()
          // The mark clears beside the save, and before any later sign-out sets it, so a sign-out
          // that starts during the save keeps its mark. The instance holds the session already.
          const clears =
            !!session &&
            !options.update &&
            machines.clears({ current: context(), started })
          if (clears) actor.send({ type: 'change.commit' })
          // A failed write leaves the rotation pending, so no context revokes the sent token.
          const rotation =
            options.sent && session?.refreshToken && history
              ? (async () =>
                  rotations.write(await history, {
                    expiresAt: session.expiresAt,
                    from: options.sent!,
                    to: session.refreshToken,
                  }))().catch(() => undefined)
              : undefined
          const committed = context().version
          const [saved] = await Promise.all([
            writes?.flush().then(
              () => undefined,
              (error: unknown) => ({ error }),
            ),
            clears ? mark(false) : undefined,
            rotation,
          ])
          if (saved) {
            // A failed save rejects the sign-in, so the instance holds none of its session, unless a
            // later change replaced it. No store holds its refresh token, which ends beside the
            // rejection. A revocation without an answer keeps the token for the next sign-out.
            if (signIn && kept && context().version === committed) {
              actor.send({ type: 'change.refuse' })
              void revokeUnsaved(kept, issued)
            }
            throw saved.error
          }
          // The revocation runs beside the sign-in, so the sign-in waits for no round trip, and it
          // rejects nothing.
          if (
            replaced?.refreshToken &&
            replaced.refreshToken !== session?.refreshToken
          )
            void revokeReplaced(replaced, since)
          if (overwriting)
            void overwriting.then(async (stored) => {
              const overwritten = machines.overwrites({
                held: replaced,
                stored,
              })
              if (!overwritten) return
              // Another context's sign-in that ran beside this one, such as a second run of a CLI's
              // login, keeps its session when this one ranks no newer, so this instance takes that
              // session back and revokes its own token, which only it holds.
              if (kept && machines.yields({ kept, overwritten }))
                await yieldTo(overwritten, { kept, replaced, since: readAt })
              else await revokeReplaced(overwritten, readAt)
            })
          if (kept) await onSignIn?.(kept)
          if (kept && unread) onMoved?.(kept)
        },
        fail: async (error, failure = {}) => {
          if (overtaken()) throw await superseded(undefined, error, failure)
          // A refusal empties only the session that this change started from, not a newer sign-in's.
          if (
            error instanceof RequestError &&
            error.signedIn &&
            context().version === started.version
          ) {
            const ended = context().session
            actor?.send({ type: 'change.refuse' })
            // The store empties under the lock, beside the revocation, after any refresh that holds the
            // lock, so the rejection waits for no round trip. It rejects nothing.
            if (ended) void endRefused(ended, context())
            else if (
              machines.empties({
                current: ended,
                failed: writes?.failed() ?? false,
              })
            ) {
              actor?.send({ type: 'save' })
              await writes?.flush()
            }
          }
          throw error
        },
        overtaken,
        refused: () => machines.refused({ current: context(), started }),
        async prepare() {
          if (!options.sent || !store || !history) return
          const sent = options.sent
          const known = await history
          // A context without a shared lock, such as another process, can have rotated the token
          // already. Its record of the successor stays, and the refresh writes none.
          if (known?.some((entry) => entry.from === digest(sent) && entry.to))
            return
          const entries = await rotations
            .write(known, { from: sent })
            .catch((error) => {
              sending = 'refused'
              throw error
            })
          history = Promise.resolve(entries)
        },
      }
    },
    async delegate(fn) {
      if (!actor) return await fn()
      actor.send({ type: 'delegate.start' })
      try {
        return await fn()
      } finally {
        actor.send({ type: 'delegate.end' })
      }
    },
    discard(session) {
      void revokeExpired(session, { unsaved: true })
    },
    async ended() {
      if (!actor || !context().signingOut) return false
      await waitFor(actor, (snapshot) => !snapshot.context.signingOut)
      return true
    },
    exclusive,
    get: () => actor?.getSnapshot().context.session,
    async idle() {
      if (!actor || machines.idle(actor.getSnapshot())) return false
      await waitFor(actor, machines.idle)
      return true
    },
    async load(options = {}) {
      if (!actor) return undefined
      // A failed read rejects, so the status stays `pending`. A device's secure store fails while
      // the device is locked, and a returning user never shows as signed out.
      await hydrate()
      const session = context().session
      // Another context can save the user's newer session after `load` emptied an expired one here,
      // and that session can expire too. It then replaces the session that the next authorization renews.
      if (!session && context().renewing) {
        await replaceLapsed()
        actor.send({ type: 'load' })
        return context().session
      }
      if (!session || !Session.expired(session)) {
        actor.send({ type: 'load' })
        return session
      }
      if (options.expired === 'keep') return undefined
      // The read and the empty write run under the lock, so a refresh in another tab never saves a
      // successor between them, which the write would erase.
      const empty = async () => {
        // Another tab can hold a newer session than this instance's expired copy, which stays.
        const latest = await reload()
        if (!latest || !Session.expired(latest)) {
          actor.send({ type: 'load' })
          return { latest }
        }
        // The next authorization renews the expired session, and the status shows it while one runs.
        set(undefined, { renewing: latest })
        // The read covers the authorizations in progress, so their later loads read the store no more.
        actor.send({ type: 'lapsed.checked' })
        await writes?.flush()
        return { expired: latest }
      }
      const result = await (options.locked ? empty() : exclusive(empty))
      if (!result.expired) return result.latest
      // The store no longer holds the refresh token, so no sign-out revokes it. The revocation runs
      // beside a renewal, so the renewal waits for no round trip, and it rejects nothing.
      void revokeExpired(result.expired)
      return undefined
    },
    move(chainId) {
      actor?.send({ chainId, type: 'renewing.move' })
    },
    async preload() {
      if (!actor || !writes) return
      if (hydrating === unclaimed) hydrating = undefined
      const attempt = startHydrate(actor, writes)
      await attempt.catch(() => {
        unclaimed = attempt
      })
    },
    reload,
    renewing: () => actor?.getSnapshot().context.renewing,
    rotations: () => rotations.read(),
    async settled() {
      if (authorizations.size === 0) return false
      await Promise.all(authorizations)
      return true
    },
    async signedOut() {
      if (!actor && markedLocal) return true
      // Another context on the store can sign in after the sign-out here, and its message can come
      // late, or never outside a page. An adopted session clears the instance's copy of the mark.
      if (actor && context().marked) {
        // A sign-out here ends the stored session, and its end can need the lock that the caller
        // holds, so the call waits for no sign-out.
        if (context().signingOut) return true
        // Overlapping calls share one read, so the hooks run once for the session that it adopts.
        marking ??= (async () => {
          // The read adopts the stored session as another tab's message does. A sign-out that starts
          // during the read overtakes it, and a failed read keeps the mark, so the call never rejects.
          const hooks = await adopt({ marked: true, signOut: false }).catch(
            () => undefined,
          )
          // The plugins' hooks run beside the call, since a caller can hold the lock that a hook takes.
          void (async () => hooks?.())().catch(() => undefined)
        })().finally(() => {
          marking = undefined
        })
        await marking
        return context().marked
      }
      const [stored, logout] = await Promise.all(
        [`${name}:signed-out`, `${name}:signed-out:logout`].map((key) =>
          (async () => store?.getItem(key))().catch(() => undefined),
        ),
      )
      // A logout in progress marks the store with its ID.
      return stored === true || typeof logout === 'string'
    },
    signOut(options = {}) {
      // A sign-out in progress ends the session that this call ends too, unless a change followed
      // it, such as a sign-in. That session then ends in a sign-out of its own, after the first.
      // A shared sign-out still overtakes the changes in progress, such as a sign-in that started
      // after the first sign-out emptied the session. A call that ends the Tempo ID session never
      // shares one that keeps it.
      // The machine's `joins` guard decides whether the call joins.
      const everywhere = options.everywhere === true
      if (actor?.getSnapshot().can({ everywhere, type: 'signOut.join' })) {
        actor.send({ everywhere, type: 'signOut.join' })
        // A sign-out runs, so `latest` holds its run, as `signOut.start` and `signOut.finish` show.
        return latest!
      }
      const previous = latest
      // The mark applies at once, so no `reauthorize` signs the user in while the sign-out runs.
      if (actor) actor.send({ everywhere, type: 'signOut.start' })
      else markedLocal = !everywhere
      // The store holds a mark during a logout too, since the Tempo ID session lasts until the
      // logout's answer. A reload before it, such as of the page, then authorizes nothing. The
      // logout's mark holds its ID under a key of its own, so its answer deletes no mark that
      // another context wrote since. React Native's shim provides `getRandomValues` only, which
      // `Bytes.random` needs.
      const logout = everywhere ? Bytes.toHex(Bytes.random(16)) : undefined
      const marked = logout ? markLogout(logout) : mark(true)
      const run: Promise<void> = (async () => {
        await previous?.catch(() => undefined)
        await Promise.all([
          end({ everywhere, revoked: options.revoked }),
          marked,
        ]).catch(async (error: unknown) => {
          // A sign-out with `everywhere` that rejects, such as for a logout without a response, can
          // leave the browser's Tempo ID session, so the mark applies as without `everywhere`. The
          // machine's `sessionless` guard keeps it clear after a sign-in that followed.
          if (everywhere) {
            if (actor) actor.send({ type: 'signOut.reject' })
            else markedLocal = true
            if (!actor || context().marked) await mark(true)
          }
          throw error
        })
        // The logout ended the Tempo ID session, so its mark clears, unless a sign-out without
        // `everywhere` set the instance's own since. A reload during the logout drops this step,
        // so its mark stays until the next sign-in, since no context knows whether the logout ended
        // the Tempo ID session.
        if (logout && !holdsMark()) await unmark(logout)
      })().finally(() => {
        // Each run follows the one before it, so the runs finish in the order that they started.
        actor?.send({ everywhere, type: 'signOut.finish' })
        if (latest === run) latest = undefined
      })
      latest = run
      return run
    },
    status: { get: getStatus, subscribe: subscribeStatus },
    subscribe(listener) {
      if (!actor) return () => {}
      // A saved session whose access key expired is no sign-in: `load` empties it, and the next
      // authorization renews it.
      const visible = (snapshot: machines.session.Context) => {
        const { loaded, session } = snapshot
        if (!loaded && session && Session.expired(session)) return undefined
        return session
      }
      let previous = visible(context())
      const subscription = actor.subscribe((snapshot) => {
        const session = visible(snapshot.context)
        if (session === previous) return
        const before = previous
        previous = session
        listener(session, before)
      })
      return () => subscription.unsubscribe()
    },
  }

  /** Ends the session: at once in this instance, then at Tempo ID under the refresh lock. */
  async function end(options: {
    everywhere: boolean
    revoked?: string | undefined
  }) {
    const hydrated = await hydrate().catch(() => undefined)
    // A save in progress, such as a sign-in's, completes first, so the store holds no earlier
    // session than this instance's.
    const started = await flushed()
    // The first read of a new instance, such as a CLI's at its logout, serves as `before`, so the
    // sign-out reads the store no more before the lock. A change in this instance since reads it
    // again. Another process without a shared channel can save a refreshed session after that read.
    // The empty write then erases it, and the sign-out revokes the rotated token, as after a save
    // that lands after any read here, only one store round trip sooner.
    // A change here during the read, such as a sign-in, saves its session after the read started,
    // and a reload can set a session that the store held before it. The read then tells nothing of
    // the instance's session, so the sign-out waits for the writes and reads the store again.
    // A store that rejects the read, such as a Redis that is down, still holds what it held, so the
    // instance's session counts as the stored one, and the sign-out revokes its tokens.
    let unread = false
    const onError = () => {
      unread = true
    }
    let version = started
    let before =
      hydrated && started === 0 ? hydrated.stored : await read({ onError })
    while (actor && context().version !== version) {
      version = await flushed()
      unread = false
      before = await read({ onError })
    }
    // The instance's session is read after the store, with no wait before the sign-out empties it.
    // A refresh here that commits during the read rotated the token of the earlier session, so the
    // sign-out ends the session that it empties.
    const local = actor ? context().session : undefined
    if (unread) before = local
    // After a failed write, the store can hold an earlier copy of the session, or none, such as after
    // a sign-in whose save the store refused. The instance then holds the latest tokens.
    // Only the session that the failed write held counts, not one that the instance adopted since.
    const unsaved = !!local && writes?.unsaved() === local
    const logouts = obtainedLogouts
    // The sign-out changes the session, so the time that the instance obtained its tokens is read first.
    const since = obtained
    // The session empties at once, also while a refresh in another tab holds the lock.
    actor?.send({ type: 'signOut' })
    const ownSignIns = actor ? context().signIns : 0
    rotated.clear()
    const emptied = settle(writes?.flush())

    // The revocation waits for the lock that a refresh holds, so it revokes the refresh token that
    // is current, never one that a refresh rotated. A refresh in another tab can save its rotated
    // token after the sign-out, so the store is read and emptied again.
    return exclusive(async () => {
      // The empty session saves first, so the store holds another context's session only when that
      // context saved it after the sign-out. After a failed save, the store holds this instance's
      // earlier copy, or a newer one that another context saved since.
      // The revoked digests and the unanswered entry change only under the lock, so they are read
      // once, beside the store's session.
      const [{ failed, stored }, earlier, digests, entries] = await Promise.all(
        [
          emptied.then(async (failed) => ({ failed, stored: await read() })),
          unanswered.read(),
          revoked.read(),
          unsaved ? rotations.read() : undefined,
        ],
      )
      // After a failed write, another context without a shared channel, such as another process, can
      // have rotated the instance's token and signed out. A revocation of a rotated token counts as a
      // reuse, so the instance's own token ends only while the rotations show it unrotated.
      // Another tab's logout since the instance obtained its session revokes that session's tokens.
      // A store that holds an earlier copy of the instance's user never held the instance's tokens.
      const held =
        !before || !local || Session.subject(before) !== Session.subject(local)
      const revocable = (token: string | undefined) =>
        machines.revocable({
          entries,
          held,
          live:
            token && entries ? rotations.successor(entries, token) : undefined,
          remote: !!actor && context().logouts.remote !== logouts,
          revoked: options.revoked,
          since,
          token,
        })
      // The instance's session is read after the store, so a sign-in that commits during the read
      // counts as this instance's later sign-in, which the sign-out never ends.
      const current = actor ? context().session : undefined
      const ending = machines.ending({
        before,
        current,
        failed: unsaved,
        local,
        stored,
      })
      // The store then holds the instance's session again, or none.
      if (ending.empty)
        actor?.send({ type: current ? 'save' : 'signOut.empty' })

      // A failed save still ends the server session and revokes the refresh token. Its error wins
      // over the sign-out's, since the store still holds the session.
      const saved = ending.empty ? await settle(writes?.flush()) : undefined
      const erased = failed ?? saved
      const ended = ending.session
      // A refresh that the sign-out overtook ended its own new session already.
      const skipped = ended?.refreshToken
        ? rotated.get(ended.refreshToken)
        : undefined
      // A refresh token that Tempo ID revoked already, such as at a disconnection, needs no
      // revocation. It still enters the store's revoked digests, so another context that holds it
      // sends no revocation of it, which would count as a reuse.
      const known =
        !!ended?.refreshToken && ended.refreshToken === options.revoked
      const stale =
        unsaved && ended === local && !revocable(ended?.refreshToken)
      const revoking =
        known ||
        stale ||
        (ended?.refreshToken && rotated.has(ended.refreshToken)) ||
        revoked.has(digests, ended)
          ? undefined
          : ended
      // The revocations of earlier sign-outs without an answer run beside this one.
      // A token that the revoked digests hold received its answer, though its entry stayed, such as
      // after a failed write, so it is sent no more.
      // The instance's unsaved session, which no store holds, ends beside them too.
      const unsavedToken = revocable(ending.unsaved?.refreshToken)
        ? ending.unsaved?.refreshToken
        : undefined
      const resent = machines.resent({
        remote: actor ? context().logouts.remote : undefined,
        retained,
      })
      const pending = [
        ...new Set([
          ...(earlier ?? []),
          ...resent,
          ...(unsavedToken ? [unsavedToken] : []),
        ]),
      ].filter(
        (token) =>
          token !== revoking?.refreshToken &&
          !revoked.has(digests, { refreshToken: token }),
      )
      const answered = new Set<string>()
      // The errors of the pending revocations without an answer, by token.
      const errors = new Map<string, unknown>()
      const signedOut = await settle(
        signOut(revoking, {
          // A later sign-in in this instance owns the Tempo ID session, so the sign-out then ends no
          // logout. The revocations run first, and a sign-in can commit during them, so the decision
          // reads the count of sign-ins before the logout. A restore reads the session that the
          // sign-out ends, so it counts as no sign-in.
          logout: () =>
            machines.logout({
              everywhere: options.everywhere,
              kept: ending.kept,
              signIns: actor ? context().signIns : 0,
              started: ownSignIns,
            }),
          // The machine counts the logout that succeeded, and the one of unknown outcome, which a
          // restore that the sign-out overtook reads. Only after a logout that Tempo ID refused,
          // that restore revokes its own tokens.
          onLoggedOut: () => actor?.send({ type: 'logout.succeed' }),
          onLogoutUnknown: () => actor?.send({ type: 'logout.unknown' }),
          // Only an answered revocation marks its token, also when the logout after it fails. One
          // without an answer leaves the next sign-out to send it again.
          onRevoked: revoking
            ? () => {
                answered.add(revoking.refreshToken!)
                return Promise.resolve()
              }
            : undefined,
          pending: pending.map((refreshToken) => ({
            onRevoked: () => {
              answered.add(refreshToken)
              return Promise.resolve()
            },
            onUnanswered: (error: unknown) => {
              errors.set(refreshToken, error)
            },
            refreshToken,
          })),
          unrevoked: skipped,
        }),
      )
      // Only a sign-out that rejects leaves its token live, since a page's logout ends it.
      const live = pending.filter((token) => !answered.has(token))
      if (
        signedOut &&
        revoking?.refreshToken &&
        !answered.has(revoking.refreshToken)
      )
        live.push(revoking.refreshToken)
      // The answered tokens are marked in one write, beside the write of the entry. Either write
      // alone keeps an answered token from a second revocation. The sign-out's own token is marked
      // last, so the pending tokens never push its digest out.
      const marks = [
        ...(known && ended?.refreshToken ? [ended.refreshToken] : []),
        ...pending.filter((token) => answered.has(token)),
        ...(revoking?.refreshToken && answered.has(revoking.refreshToken)
          ? [revoking.refreshToken]
          : []),
      ]
      const [, persisted] = await Promise.all([
        revoked.write(digests, marks),
        (async () => {
          // An entry that the sign-out could not read is never replaced, so a new read adds the live
          // tokens to it. The entries before the filter count, so an answered revocation of this
          // sign-out's own token removes its earlier entry too.
          if (earlier === undefined) {
            const again = live.length > 0 ? await unanswered.read() : undefined
            if (!again) return live.length === 0 ? [] : undefined
            return unanswered.write([
              ...again.filter((token) => !live.includes(token)),
              ...live,
            ])
          }
          if (earlier.length > 0 || live.length > 0)
            return unanswered.write(live)
          return []
        })(),
      ])
      // The live tokens that no store holds stay in this instance until the entry holds them: the
      // sign-out's own, whose session the store holds no more, and the unsaved sessions'. After a
      // failed erase, the store can still hold the sign-out's session, which another context can
      // refresh, so the next sign-out ends the stored session with its rotation checks, and the
      // token is not retained. Only the last empty write counts, since a second one that succeeds
      // erases what the first one left. A token of an earlier sign-out stays in the entry that the
      // store refused to replace.
      const refusal = ending.empty ? saved : failed
      const kept = machines.retains({
        live,
        logouts,
        persisted,
        retained,
        unsaved: [
          ...(revoking?.refreshToken && !refusal
            ? [revoking.refreshToken]
            : []),
          ...(unsavedToken ? [unsavedToken] : []),
          ...(unsaved && local?.refreshToken ? [local.refreshToken] : []),
        ],
      })
      retained.clear()
      for (const [token, remote] of kept) retained.set(token, remote)
      if (erased) throw erased.error
      if (signedOut) throw signedOut.error
      // The revocation of an unsaved session's token, or of a retained one, is the only end of that
      // token, so one without an answer rejects, as the sign-out's own does. So is the revocation of
      // an earlier sign-out's token when this sign-out ends no session, such as a retry after a
      // failed sign-out. The next sign-out sends it again. A token that the revoked digests hold
      // received its answer already, so it was not sent.
      const unsent = [
        ...(unsavedToken ? [unsavedToken] : []),
        ...resent,
        ...(ended ? [] : (earlier ?? [])),
      ]
      const failing = unsent.find(
        (token) => pending.includes(token) && !answered.has(token),
      )
      // The revocation's own error carries Tempo ID's status and reason, such as a rate limit.
      if (failing && errors.has(failing)) throw errors.get(failing)
      if (failing)
        throw new RequestError({
          code: 'server_error',
          message:
            'Revocation failed: no response for the refresh token of the unsaved session. Sign out again once online.',
          status: 0,
        })
    })
  }
}

export declare namespace create {
  type Options = {
    /**
     * Returns the instance's chain. A committed session's access key on another chain waits in
     * `accessKeys`.
     */
    chainId: () => number
    /** Whether the session holds a signed-in user. A backend's instance holds none. */
    enabled: boolean
    /**
     * Runs the ceremony of a passkey that owns a restored session's account, in place of
     * `navigator.credentials.get`.
     */
    getFn?: TempoAccount.deserialize.Options['getFn']
    /**
     * Whether the instance holds guest sessions. Without it, a stored guest session reads as signed
     * out, and stays in the store, so an instance with `guest` restores it.
     */
    guest?: boolean | undefined
    /**
     * Reads the stored chain selection, which the first read of the session awaits, so a restored
     * session selects the access key of the instance's chain. Absent, the chain is the configured one.
     */
    loadChain?: (() => Promise<void>) | undefined
    /** The key of the saved session in `store`. */
    name: string
    /**
     * Runs after a change sets a session without an access key that a switch overtook, whose
     * account the change dropped, so the instance reads the account on its chain.
     */
    onMoved?: ((session: Session.Any) => void) | undefined
    /** Runs after a change sets a session. */
    onSignIn?: ((session: Session.Any) => Promise<void> | void) | undefined
    /** Runs after another tab's sign-out empties the session. */
    onSignOut?: (() => Promise<void> | void) | undefined
    /** Ends the server session, and revokes the tokens of the session that ended, when one did. */
    signOut: (
      session: Session.Any | undefined,
      options?: {
        /**
         * Whether the Tempo ID session ends too, or a function that returns it, which the sign-out
         * calls after the revocations, before the logout. Defaults to `true`.
         */
        logout?: boolean | (() => boolean) | undefined
        /** Runs once the logout succeeds, which ended the Tempo ID session and revoked its tokens. */
        onLoggedOut?: (() => void) | undefined
        /**
         * Runs once the logout fails with an unknown outcome: without an answer, or with one that is
         * no refusal, such as a server error. Such a logout can have ended the Tempo ID session and
         * revoked its tokens. Only a refusal, with a status from 400 to 499, or of a redirect, ended
         * nothing.
         */
        onLogoutUnknown?: (() => void) | undefined
        /** Runs once Tempo ID answers the revocation, so other contexts send it no more. */
        onRevoked?: (() => Promise<void>) | undefined
        /**
         * The refresh tokens of earlier sign-outs whose revocation received no answer. The sign-out
         * revokes them beside its own, before any logout, and runs each `onRevoked` at the answer,
         * or after a page's logout, which ends them.
         */
        pending?:
          | readonly {
              onRevoked: () => Promise<void>
              /** Runs with the error of a revocation that received no answer, or a rate limit. */
              onUnanswered?: ((error: unknown) => void) | undefined
              refreshToken: string
            }[]
          | undefined
        /**
         * Whether the logout of the Tempo ID session that issued the tokens, such as a restore's, or
         * a later sign-in, revokes them, so a first-party app skips the revocation.
         */
        restored?: boolean | undefined
        /**
         * The error of an unanswered refresh that may have rotated the session's refresh token,
         * which the sign-out then leaves unrevoked. Absent when the sign-out revokes its tokens.
         */
        unrevoked?: { error: unknown } | undefined
      },
    ) => Promise<void>
    /** Where the session saves. Absent, it lives in memory only. */
    store?: Store | undefined
  }

  type ReturnType = {
    /** The actor of the session, or `undefined` for a session that holds nothing. */
    actor: machines.session.Actor | undefined
    /**
     * Runs `fn`, an authorization of the browser's Tempo ID session, and holds the status at
     * `pending`, or at `reauthorizing` while it renews a saved session whose access key expired.
     */
    authorize: <value>(fn: () => Promise<value>) => Promise<value>
    /** Begins a change to the session, or with `update`, a change of the current session's tokens. */
    change: (options?: ChangeOptions) => Change
    /**
     * Runs `fn`, a callback inside an authorization, such as a function `reauthorize` or a plugin's
     * `restore` hook. While it runs, `idle` waits for that authorization no more, so a call in `fn`
     * that waits for `idle` never waits for itself.
     */
    delegate: <value>(fn: () => Promise<value>) => Promise<value>
    /**
     * Revokes the refresh token of `session`, which no change saved, such as a renewal that a retry
     * discards, beside the caller. It ends no Tempo ID session. A revocation without an answer enters
     * the unanswered entry, so the next sign-out sends it again.
     */
    discard: (session: Session.Any) => void
    /**
     * Resolves once every sign-out that runs now settles, with its revocation and logout, with
     * whether one ran. Resolves at once with `false` without one. Never rejects.
     */
    ended: () => Promise<boolean>
    /** Returns the session, without reading the store. */
    get: () => Session.Any | undefined
    /**
     * Resolves once every authorization that runs now settles, except one per callback that
     * `delegate` runs, with whether it waited. Never rejects.
     */
    idle: () => Promise<boolean>
    /**
     * Reads the saved session once, and returns the session. Empties a session whose access key
     * expired, under the lock unless `options.locked` says that the caller holds it. With
     * `expired: 'keep'`, an expired session stays in the store, the status stays `pending`, and the
     * load returns `undefined`.
     */
    load: (options?: {
      /**
       * What the load does with a saved session whose access key expired: `'empty'` empties it and
       * revokes its refresh token, and `'keep'` leaves it for a later read. Defaults to `'empty'`.
       */
      expired?: 'empty' | 'keep' | undefined
      locked?: boolean | undefined
    }) => Promise<Session.Any | undefined>
    /**
     * Runs `fn` while no other run of the same session's `exclusive` does, also in another tab of a
     * browser, through its Web Locks.
     */
    exclusive: <value>(fn: () => Promise<value>) => Promise<value>
    /**
     * Starts the one read of the saved session that `load` shares, such as beside a restore's own
     * reads. The next `load` takes its result, a failure too, and a later `load` reads again. Never
     * rejects.
     */
    preload: () => Promise<void>
    /**
     * Reads the stored session again, and returns the session. Sets the stored session when it is
     * the same user's with other tokens, such as after another tab's refresh. With `hooks`, an
     * adoption in place of no session, or another user's, runs the plugins' `afterSignIn` hooks,
     * for a caller that commits no session after it. Defaults to `false`.
     */
    reload: (options?: {
      /** Whether an adoption runs the plugins' `afterSignIn` hooks. Defaults to `false`. */
      hooks?: boolean | undefined
    }) => Promise<Session.Any | undefined>
    /**
     * Moves the access keys of the kept session whose access key expired to `chainId`, as a switch of
     * chain moves the session's, so a renewal requests none on the chain that the switch left.
     */
    move: (chainId: number) => void
    /**
     * Returns the saved session whose access key expired, which the next authorization in this
     * instance renews. `undefined` after a change sets a session, and after a sign-out.
     */
    renewing: () => Session.Any | undefined
    /**
     * Reads the store's refresh token rotations, for the `rotations` of a change with `sent`.
     * Resolves `undefined` when the read fails. Never rejects.
     */
    rotations: () => Promise<readonly Rotation[] | undefined>
    /**
     * Resolves once every authorization that runs now, through `authorize`, settles, with whether one
     * ran. Resolves at once with `false` without one. Never rejects.
     */
    settled: () => Promise<boolean>
    /**
     * Returns whether a sign-out without `everywhere` followed the last sign-in, here or in another
     * context on the store. A refresh never clears it. If the instance holds the mark and runs no
     * sign-out, the call reads the store, and sets a stored session of another context.
     */
    signedOut: () => Promise<boolean>
    /** Empties the session, and revokes its refresh token. */
    signOut: (options?: {
      /** Whether the user's Tempo ID session ends too, for every app. Defaults to `false`. */
      everywhere?: boolean | undefined
      /**
       * A refresh token that Tempo ID revoked already, such as at a disconnection. The sign-out sends
       * no revocation of it. Absent, the sign-out revokes the session's refresh token.
       */
      revoked?: string | undefined
    }) => Promise<void>
    /** The status of the session, with the session to show. */
    status: Status
    /** Calls `listener` with each new session and the one before it. Returns the unsubscribe. */
    subscribe: (
      listener: (
        session: Session.Any | undefined,
        previous: Session.Any | undefined,
      ) => void,
    ) => () => void
  }
}

/** The status of a session, which `get` reads and `subscribe` follows. */
export type Status<session extends Session.Any = Session.Any> = {
  /**
   * Returns the status, with the session to show. An unchanged status returns the same object, so
   * `useSyncExternalStore` takes `get` as it is. `signedOut` for a session that holds nothing.
   */
  get: () => Session.Status<session>
  /**
   * Calls `listener` with each new status and the one before it. Returns the unsubscribe. A session
   * that holds nothing never calls it.
   */
  subscribe: (
    listener: (
      status: Session.Status<session>,
      previous: Session.Status<session>,
    ) => void,
  ) => () => void
}

/** The number of rotations that the store keeps. */
const rotationLimit = 8

/**
 * The longest wait of an authorization for another instance's authorization of the same session, in
 * milliseconds, after which it runs beside it.
 */
const authorizeWait = 3_000

/** The status of a session that holds nothing, such as a backend's. */
const signedOut_status: Session.Status<Session.Any> = {
  session: undefined,
  status: 'signedOut',
}

/**
 * The session as the store keeps it: the account as `TempoAccount.serialize` writes it, since a
 * `TempoAccount` holds functions, which a store cannot clone. `version` is the format's version.
 */
type Saved = {
  state: {
    session:
      | (Omit<Session.Any, 'account'> & {
          account?: TempoAccount.Serialized | undefined
        })
      | undefined
  }
  version: number
}

/**
 * Returns `session` on `chainId`: its access key on that chain as `accessKey`, and its other access
 * keys in `accessKeys`. The account drops with the access key that leaves `accessKey`, since an
 * account's address can differ by chain. Returns `session` itself when `accessKey` is on `chainId`
 * already, or when it holds no access key.
 *
 * @example
 * ```ts
 * const next = toChain(session, { chainId: tempoTestnet.id })
 * ```
 */
export function toChain(
  session: Session.Any,
  options: toChain.Options,
): Session.Any {
  const { chainId } = options
  if (!session.accessKey && !session.accessKeys?.length) return session
  if (session.accessKey && Number(session.accessKey.chainId) === chainId)
    return session

  const all = [session.accessKey, ...(session.accessKeys ?? [])].filter(
    (entry): entry is NonNullable<typeof entry> => !!entry,
  )
  const accessKey = all.find((entry) => Number(entry.chainId) === chainId)
  const accessKeys = all.filter((entry) => entry !== accessKey)
  const {
    accessKey: _accessKey,
    accessKeys: _accessKeys,
    account: _account,
    ...rest
  } = session
  return {
    ...rest,
    ...(accessKey ? { accessKey } : {}),
    ...(accessKeys.length ? { accessKeys } : {}),
  }
}

export declare namespace toChain {
  type Options = {
    /** The chain to select. */
    chainId: number
  }
}

/**
 * Returns the session that a change commits. A sign-in requests its access key on the instance's
 * chain at its start, which a switch can leave during it. That session follows the instance's
 * chain: its access key waits in `accessKeys`, and an account without an access key drops, since it
 * belongs to the earlier chain. A sign-in that names another chain on purpose keeps its access key.
 */
function moved(
  session: Session.Any | undefined,
  options: {
    /** The instance's chain at the commit. */
    chainId: number
    /** The instance's chain at the change's start. */
    startedChain: number
    /** Whether the change updates the held session, such as a switch's own move. */
    update: boolean
  },
): Session.Any | undefined {
  const { chainId, startedChain, update } = options
  if (!session || update || startedChain === chainId) return session
  // A session without an access key on any chain as `accessKey` that holds some in `accessKeys` is
  // on the instance's chain already, such as a retry's, which moved itself.
  if (!session.accessKey && session.accessKeys?.length) return session
  if (session.accessKey && Number(session.accessKey.chainId) !== startedChain)
    return session
  if (!session.accessKey && !session.accessKeys?.length) {
    const { account: _, ...rest } = session
    return rest
  }
  return toChain(session, { chainId })
}

/**
 * Returns `session` on `chainId` when `accessKeys` holds its access key on that chain, such as a copy
 * that another context saved on another chain, with or without an `accessKey` there. Its account then
 * drops, since it belongs to the other chain. A session without an access key on `chainId`, such as
 * a sign-in that names another chain on purpose, stays as it is.
 */
function selected(
  session: Session.Any | undefined,
  options: { chainId: number },
): Session.Any | undefined {
  const { chainId } = options
  if (!session || Number(session.accessKey?.chainId) === chainId) return session
  if (!session.accessKeys?.some((entry) => Number(entry.chainId) === chainId))
    return session
  return toChain(session, { chainId })
}

/** Returns the sorted IDs of the access keys of `session`, on every chain, as one string. */
function accessKeyIds(session: Session.Any) {
  return [session.accessKey, ...(session.accessKeys ?? [])]
    .flatMap((entry) =>
      entry ? [entry.keyAuthorization.keyId.toLowerCase()] : [],
    )
    .sort()
    .join()
}

/** Returns the session as the store keeps it. */
function toSaved(session: Session.Any | undefined): Saved['state']['session'] {
  if (!session) return undefined
  const { account, ...rest } = session
  return account ? { ...rest, account: TempoAccount.serialize(account) } : rest
}

/** Returns the session from the form that the store keeps. */
function fromSaved(
  saved: Saved['state']['session'],
  options: TempoAccount.deserialize.Options = {},
): Session.Any | undefined {
  if (!saved) return undefined
  // A session that an earlier release saved names `accessKey` as `key`, and `accessKeys` as `keys`.
  const {
    account,
    key: earlierAccessKey,
    keys: earlierAccessKeys,
    ...rest
  } = saved as typeof saved & {
    key?: Session.Any['accessKey']
    keys?: Session.Any['accessKeys']
  }
  const accessKey = rest.accessKey ?? earlierAccessKey
  const accessKeys = rest.accessKeys ?? earlierAccessKeys
  return Session.from({
    ...(rest as Omit<Session.Any, 'account'>),
    ...(accessKey ? { accessKey } : {}),
    ...(accessKeys ? { accessKeys } : {}),
    ...(account
      ? {
          account: TempoAccount.deserialize(account, {
            getFn: options.getFn,
          }),
        }
      : {}),
  } as Session.Any)
}

/**
 * Returns the order of `session` among saved copies of one session: the expiry of its access token,
 * which each refresh moves later, or a local session's revision, which each sign-in moves later. A
 * local session's access keys are no order, since a sign-in can add one that expires sooner.
 */
function order(session: Session.Any) {
  return Session.tempoId(session) ? session.expiresAt : session.revision
}

/**
 * The clock of the session's actor, whose timers keep no dropped instance alive, such as a server's
 * instance for each request. The actor holds each pending timer, which it receives as the timer's
 * ID, and the platform's timer holds it only weakly. A delay above a timer's limit, about 24.8 days,
 * waits in steps, and an infinite one schedules nothing. A Node process, such as a CLI's, exits with
 * a timer pending.
 */
const clock = {
  clearTimeout(timer: clock.Timer | undefined) {
    clearTimeout(timer?.handle)
  },
  setTimeout(callback: () => void, delay: number): clock.Timer {
    const timer: clock.Timer = { callback, handle: undefined }
    if (!Number.isFinite(delay)) return timer
    const at = Date.now() + delay
    const ref = new WeakRef(timer)
    // A step can end early, so each one waits for the time left, and the callback never runs early.
    const step = () => {
      const timer = ref.deref()
      if (!timer) return
      const left = at - Date.now()
      if (left <= 0) return timer.callback()
      wait(timer, left)
    }
    const wait = (timer: clock.Timer, left: number) => {
      timer.handle = setTimeout(step, Math.min(left, 2 ** 31 - 1))
      ;(timer.handle as { unref?: () => void }).unref?.()
    }
    wait(timer, delay)
    return timer
  },
}

declare namespace clock {
  /** A pending timer of {@link clock}. */
  type Timer = {
    /** The actor's callback, which runs at the delay's end. */
    callback: () => void
    /** The platform's timer of the current step, or `undefined` for an infinite delay. */
    handle: ReturnType<typeof setTimeout> | undefined
  }
}

/** Returns `promise` settled: `undefined` when it resolves, its error when it rejects. */
function settle(promise: Promise<unknown> | undefined) {
  return (promise ?? Promise.resolve()).then(
    () => undefined,
    (error: unknown) => ({ error }),
  )
}

/**
 * Returns the writes of the session to `store`, which keeps each value as it is, so IndexedDB keeps
 * a non-extractable `CryptoKey`. Writes run in order, and `flush` resolves when every earlier write
 * completed.
 */
function queue(store: Store, options: queue.Options = {}) {
  let pending: Promise<void> = Promise.resolve()
  // Whether the last write failed, which leaves an earlier copy in the store.
  let failed = false
  // The session that the last write failed to save, which no store holds.
  let unsaved: Session.Any | undefined

  /** Runs `write` of `session` after every earlier write. A failed write fails only its own change. */
  const enqueue = (
    write: () => Promise<void>,
    session: Session.Any | undefined,
  ) => {
    const next = pending
      .catch(() => undefined)
      .then(write)
      .then(
        () => {
          failed = false
          unsaved = undefined
        },
        (error: unknown) => {
          failed = true
          unsaved = session
          throw error
        },
      )
    pending = next
    return next
  }

  const storage = {
    /** Decodes a value that `read` returns. Throws for a record that holds no valid session. */
    decode(value: Saved | null | undefined) {
      if (value == null) return undefined
      const session = fromSaved(value.state?.session, options)
      // An instance without `guest` reads a guest session that another configuration saved as
      // signed out, so its session never holds a kind that its type excludes.
      if (session && Session.guest(session) && !options.guest)
        return { session: undefined }
      return { session }
    },
    /** Reads the stored session. A custom store may return `null` for a missing item. */
    async getItem(name: string) {
      const value = (await store.getItem(name)) as Saved | null | undefined
      return storage.decode(value)
    },
    /** Reads the saved value, without a decode. */
    async read(name: string) {
      return (await store.getItem(name)) as Saved | null | undefined
    },
  }

  return {
    failed: () => failed,
    /** Returns the session that the last write failed to save, or `undefined` after a saved write. */
    unsaved: () => unsaved,
    /**
     * Resolves when every earlier write completed. It reads the queue after a microtask, since a
     * change that a subscriber sends during another change is processed only once that change's
     * event ends, and its write enqueues then.
     */
    flush: async () => {
      await Promise.resolve()
      return pending
    },
    /** Writes `session` after every earlier write. */
    save: (name: string, session: Session.Any | undefined) =>
      enqueue(
        () =>
          store.setItem(name, {
            state: { session: toSaved(session) },
            version: 0,
          }),
        session,
      ),
    storage,
  }
}

declare namespace queue {
  type Options = TempoAccount.deserialize.Options & {
    /** Whether the instance holds guest sessions. Without it, a stored guest session reads as signed out. */
    guest?: boolean | undefined
  }
}

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The machine. Every event that changes a value of {@link select} targets `settling`, which selects
   * the status. A snapshot is never in `settling`, since its transitions take no event.
   */
  export const session = setup({
    actions: {
      /** Sets the session that another tab saved, and counts the change, and the sign-in when it is one. A session clears the instance's copy of the signed-out mark. */
      adopt: assign((args) => {
        assertEvent(args.event, 'adopt')
        const { context, event } = args
        return {
          loaded: true,
          // The next authorization renews the expired session that another tab emptied, or keeps
          // renewing this instance's own, as `set` does.
          ...machines.keeps({ context, event }),
          // An adopted session clears this instance's copy of the signed-out mark, so `signedOut` reads the
          // stored mark, which another tab's sign-in removes and a refresh keeps.
          marked: event.session ? false : context.marked,
          session: event.session,
          signIns: event.signIn ? context.signIns + 1 : context.signIns,
          version: context.version + 1,
        }
      }),
      /** Counts an authorization that started. */
      authorize: assign((args) => ({
        // An authorization that starts reads the store for the kept expired session itself, so it
        // sees a session that another context saved after an earlier one read it.
        checked: undefined,
        authorizations: args.context.authorizations + 1,
      })),
      /** Clears the signed-out mark after a change committed a session that is no update. */
      commit: assign({ marked: false }),
      /** Counts a callback that started inside an authorization. */
      delegate: assign((args) => ({
        delegations: args.context.delegations + 1,
      })),
      /** Counts a callback inside an authorization that ended. */
      delegated: assign((args) => ({
        delegations: args.context.delegations - 1,
      })),
      /**
       * Counts an authorization that ended. An authorization that set no session keeps the expired
       * session, which the next one renews.
       */
      authorized: assign((args) => ({
        authorizations: args.context.authorizations - 1,
        // A later authorization reads the store again.
        checked:
          args.context.authorizations > 1 ? args.context.checked : undefined,
      })),
      /**
       * Counts an authorization that started in the callback of the only authorization in progress,
       * such as `authorize` in a function `reauthorize`. It keeps that authorization's read of the
       * store, as the authorization's own request does.
       */
      nest: assign((args) => ({
        authorizations: args.context.authorizations + 1,
      })),
      /**
       * Counts an authorization that ended during a callback inside an authorization. A later
       * authorization in the callback, such as a fallback, reads the store again.
       */
      unnest: assign((args) => ({
        authorizations: args.context.authorizations - 1,
        checked: undefined,
      })),
      /** Starts the wait of a refusal's end for the lock. */
      refusing: assign((args) => {
        assertEvent(args.event, 'refusal.start')
        return { refusing: [...args.context.refusing, args.event.userId] }
      }),
      /** Ends the wait of a refusal's end for the lock. */
      refused: assign((args) => {
        assertEvent(args.event, 'refusal.end')
        // Each end removes only its own entry, so an overlapping end of the same user keeps the user.
        const index = args.context.refusing.indexOf(args.event.userId)
        if (index === -1) return {}
        return {
          refusing: args.context.refusing.filter((_, entry) => entry !== index),
        }
      }),
      /**
       * Records that the authorizations in progress read the store for the kept expired session, at
       * the version that the read left.
       */
      check: assign((args) => ({
        checked:
          args.context.authorizations > 0 ? args.context.version : undefined,
      })),
      /** Empties the session again after a sign-out, and records the version of that sign-out. */
      empty: assign((args) => ({
        session: undefined,
        signedOut: args.context.version + 1,
        version: args.context.version + 1,
      })),
      /**
       * Marks the session whose access keys expired while the instance held it. The instance keeps
       * it, so a read empties it and a transaction's retry renews it, as before its expiry.
       */
      expire: assign((args) => ({ expired: args.context.session })),
      /**
       * Sets the session that the store holds. A change that completed first is newer, so it stays.
       * A read after `load`, such as a retry after a failed read, sets only a session whose access
       * key holds, which `load` would keep. `load` checks the first read itself.
       */
      hydrate: assign((args) => {
        assertEvent(args.event, 'hydrate')
        if (args.context.version > 0) return {}
        if (args.context.loaded && args.event.expired) return {}
        return { session: args.event.session }
      }),
      /**
       * Counts a run of this instance that emptied the session. A later call joins it only while no
       * change followed.
       */
      advance: assign((args) => {
        const { signingOut } = args.context
        if (!signingOut || signingOut.pending < 1) return {}
        return {
          signingOut: { ...signingOut, pending: signingOut.pending - 1 },
        }
      }),
      /** Counts a sign-out that shares the one in progress. It ends the expired session too. */
      join: assign((args) => ({
        renewing: undefined,
        signOuts: args.context.signOuts + 1,
      })),
      /**
       * Counts a sign-out run that ended, and the logout in progress for one with `everywhere`. The
       * last run ends the sign-out in progress.
       */
      finish: assign((args) => {
        assertEvent(args.event, 'signOut.finish')
        const { logouts, signingOut } = args.context
        const runs = (signingOut?.runs ?? 1) - 1
        return {
          logouts: args.event.everywhere
            ? { ...logouts, running: logouts.running - 1 }
            : logouts,
          // The runs end in order, so a run that ended without emptying the session is no longer pending.
          signingOut:
            signingOut && runs > 0
              ? {
                  ...signingOut,
                  pending: Math.min(signingOut.pending, runs),
                  runs,
                }
              : undefined,
        }
      }),
      /** Records that `load` checked the stored session. */
      load: assign({ loaded: true }),
      /**
       * Sets the signed-out mark after a sign-out with `everywhere` that rejected, since the browser's
       * Tempo ID session can outlive it.
       */
      reject: assign({ marked: true }),
      /**
       * Sets the signed-out mark of another tab's sign-out without `everywhere`, which the store holds,
       * so a call with `reauthorize` here authorizes nothing and holds no status. A sign-out with
       * `everywhere` keeps the mark of an earlier sign-out here, since no sign-in followed it.
       */
      remote: assign((args) => {
        assertEvent(args.event, 'signOut.remote')
        return { marked: args.event.marked || args.context.marked }
      }),
      /** Moves the access keys of the kept expired session to the selected chain. */
      move: assign((args) => {
        assertEvent(args.event, 'renewing.move')
        const { renewing } = args.context
        const { chainId } = args.event
        return {
          moved: chainId,
          renewing: renewing && toChain(renewing, { chainId }),
        }
      }),
      /** Counts another tab's logout, which revokes the tokens of this tab's restore. */
      logout: assign((args) => ({
        logouts: {
          ...args.context.logouts,
          remote: args.context.logouts.remote + 1,
          started: args.context.logouts.started + 1,
        },
      })),
      /**
       * Empties the session at a refusal marked `signedIn`, and counts the refusal and the change.
       * The refused sign-in can be another user's, so outside an authorization it ends the renewal.
       */
      refuse: assign((args) => ({
        loaded: true,
        refusals: args.context.refusals + 1,
        renewing:
          args.context.authorizations > 0 ? args.context.renewing : undefined,
        session: undefined,
        version: args.context.version + 1,
      })),
      /** Saves `context.session` to the store. `Session.ts` provides it. */
      save: () => {},
      /** Sets the session, and counts the change, and the sign-in when it is one. */
      set: assign((args) => {
        assertEvent(args.event, 'set')
        const { context, event } = args
        return {
          loaded: true,
          // A new session replaces the expired one that an authorization renews. Without one, the
          // next authorization renews it, also after `load` emptied it outside an authorization.
          ...machines.keeps({ context, event }),
          session: event.session,
          signIns: event.signIn ? context.signIns + 1 : context.signIns,
          version: context.version + 1,
        }
      }),
      /**
       * Records a sign-out run that started, which becomes the latest, and sets the signed-out mark of
       * a sign-out without `everywhere`. A run with `everywhere` counts a logout that starts and runs.
       */
      start: assign((args) => {
        assertEvent(args.event, 'signOut.start')
        const { logouts, signingOut } = args.context
        const { everywhere } = args.event
        return {
          logouts: everywhere
            ? {
                ...logouts,
                running: logouts.running + 1,
                started: logouts.started + 1,
              }
            : logouts,
          marked: !everywhere,
          signingOut: {
            everywhere,
            pending: (signingOut?.pending ?? 0) + 1,
            runs: (signingOut?.runs ?? 0) + 1,
          },
        }
      }),
      /**
       * Empties the session at a sign-out, which overtakes every change that started before it. It
       * ends the expired session too, so no authorization shows it again.
       */
      signOut: assign((args) => ({
        loaded: true,
        renewing: undefined,
        session: undefined,
        signedOut: args.context.version + 1,
        signOuts: args.context.signOuts + 1,
        version: args.context.version + 1,
      })),
      /**
       * Counts a logout of this instance of unknown outcome, which can have revoked the Tempo ID
       * session's tokens.
       */
      doubt: assign((args) => ({
        logouts: {
          ...args.context.logouts,
          unknown: args.context.logouts.unknown + 1,
        },
      })),
      /** Counts a logout of this instance that succeeded, which revoked the Tempo ID session's tokens. */
      succeed: assign((args) => ({
        logouts: {
          ...args.context.logouts,
          succeeded: args.context.logouts.succeeded + 1,
        },
      })),
    },
    delays: {
      /**
       * The time until the session's access keys expire, in milliseconds, as {@link expiresAt}
       * decides. `Session.ts` provides it from the clock. Here, the longest delay of a timer stands
       * in for it, so the machine reads no clock.
       */
      expiry: () => 2 ** 31 - 1,
    },
    guards: {
      /** Whether a callback inside an authorization runs. */
      delegating: (args) => args.context.delegations > 0,
      /**
       * Whether a sign-out joins the one in progress. It joins a run that has not emptied the
       * session yet, whose emptying overtakes every change before it, and otherwise only while no
       * change followed that sign-out, such as a sign-in. A call with `everywhere` never joins one
       * without it.
       */
      joins: (args) => {
        assertEvent(args.event, 'signOut.join')
        const { signedOut, signingOut, version } = args.context
        if (!signingOut) return false
        if (signingOut.pending === 0 && signedOut !== version) return false
        return signingOut.everywhere || !args.event.everywhere
      },
      /**
       * Whether an authorization starts in a callback of the only authorization in progress, so no
       * other authorization starts beside it.
       */
      nested: (args) =>
        args.context.delegations > 0 && args.context.authorizations === 1,
      /** Whether the store holds the session that a `set` sets, so no write follows. */
      saved: (args) => {
        assertEvent(args.event, 'set')
        return !!args.event.saved
      },
      /** Whether the instance holds no session, so no sign-in followed the sign-out. */
      sessionless: (args) => !args.context.session,
      /** Whether {@link select} selects `params.status` for the context. */
      selects: (
        args,
        params: { status: Session.Status<Session.Any>['status'] },
      ) => select(args.context) === params.status,
    },
    types: {
      context: {} as machines.session.Context,
      events: {} as machines.session.Event,
    },
  }).createMachine({
    context: {
      authorizations: 0,
      checked: undefined,
      delegations: 0,
      expired: undefined,
      loaded: false,
      logouts: { remote: 0, running: 0, started: 0, succeeded: 0, unknown: 0 },
      marked: false,
      moved: undefined,
      refusals: 0,
      refusing: [],
      renewing: undefined,
      session: undefined,
      signedOut: undefined,
      signingOut: undefined,
      signIns: 0,
      signOuts: 0,
      version: 0,
    },
    id: 'session',
    initial: 'pending',
    on: {
      // The store already holds another tab's change, so neither saves it again.
      adopt: { actions: 'adopt', target: '.settling' },
      'authorize.end': [
        { actions: 'unnest', guard: 'delegating', target: '.settling' },
        { actions: 'authorized', target: '.settling' },
      ],
      'authorize.start': [
        { actions: 'nest', guard: 'nested', target: '.settling' },
        { actions: 'authorize', target: '.settling' },
      ],
      // The events that change no value of `select` stay in the state.
      'change.commit': { actions: 'commit' },
      // The runner empties the store under the lock, after any refresh that holds it.
      'change.refuse': { actions: 'refuse', target: '.settling' },
      'delegate.end': { actions: 'delegated' },
      'delegate.start': { actions: 'delegate' },
      hydrate: { actions: 'hydrate', target: '.settling' },
      'lapsed.checked': { actions: 'check' },
      load: { actions: 'load', target: '.settling' },
      'logout.remote': { actions: 'logout' },
      'logout.succeed': { actions: 'succeed' },
      'logout.unknown': { actions: 'doubt' },
      // The end of a refusal changes no value of `select`.
      'refusal.end': { actions: 'refused' },
      'refusal.start': { actions: 'refusing' },
      'renewing.move': { actions: 'move', target: '.settling' },
      save: { actions: 'save' },
      // The write follows the assignment, so it saves the new session, unless the store holds it.
      set: [
        { actions: 'set', guard: 'saved', target: '.settling' },
        { actions: ['set', 'save'], target: '.settling' },
      ],
      signOut: { actions: ['signOut', 'advance', 'save'], target: '.settling' },
      'signOut.empty': { actions: ['empty', 'save'], target: '.settling' },
      'signOut.finish': { actions: 'finish' },
      'signOut.join': { actions: 'join', guard: 'joins', target: '.settling' },
      // A sign-in that followed the sign-out holds the Tempo ID session, so the mark stays clear.
      'signOut.reject': { actions: 'reject', guard: 'sessionless' },
      'signOut.remote': { actions: ['signOut', 'remote'], target: '.settling' },
      'signOut.start': { actions: 'start' },
    },
    states: {
      pending: {},
      reauthorizing: {},
      settling: {
        always: [
          { guard: selects('signedIn'), target: 'signedIn' },
          { guard: selects('reauthorizing'), target: 'reauthorizing' },
          { guard: selects('pending'), target: 'pending' },
          { target: 'signedOut' },
        ],
      },
      // Each change of the session leaves `signedIn` through `settling`, so the timer follows it.
      signedIn: {
        after: { expiry: { actions: 'expire', target: 'settling' } },
      },
      signedOut: {},
    },
  })

  /** The types of {@link session}. */
  export namespace session {
    /**
     * The context of the machine. `session` and `renewing` are the values to show. The counters order
     * the changes, as {@link Event} describes, and no app reads them.
     */
    export type Context = {
      /** The number of authorizations in progress, which hold the status at `pending` or `reauthorizing`. */
      authorizations: number
      /**
       * The version at which the authorizations in progress read the store for the kept expired
       * session. A load at that version inside one reads nothing more. `undefined` once the last one
       * ends.
       */
      checked: number | undefined
      /**
       * The chain that the last switch selected since a change set a session. A kept expired session
       * that the instance adopts later, such as from a read that started before the switch, moves to
       * it too.
       */
      moved: number | undefined
      /**
       * The number of callbacks in progress inside an authorization, such as a function
       * `reauthorize`. Each one holds its authorization, which a read of the session then waits for
       * no more, since the authorization waits for the callback.
       */
      delegations: number
      /**
       * The session whose access keys expired while the instance held it, which the status shows as
       * signed out. A load empties it. Another session in `session` leaves it stale.
       */
      expired: Session.Any | undefined
      /**
       * Whether the stored session loaded, or a change set the session first. Before that, the stored
       * copy can hold an expired access key, so the status stays `pending`.
       */
      loaded: boolean
      /**
       * The sign-outs with `everywhere` in this instance, and the logouts of other tabs: how many
       * started, and how many of this instance's still run, succeeded, or have an unknown outcome.
       * A logout that succeeds revokes the tokens that the Tempo ID session issued. One that Tempo ID
       * refuses revokes none.
       */
      logouts: {
        /** The number of other tabs' logouts that started. */
        remote: number
        /** The number of this instance's sign-outs with `everywhere` in progress. */
        running: number
        /** The number of logouts that started, here or in another tab. */
        started: number
        /**
         * The number of this instance's logouts that succeeded. No tab learns the outcome of
         * another tab's logout.
         */
        succeeded: number
        /**
         * The number of this instance's logouts of unknown outcome, which can have revoked the
         * tokens: one that failed without a refusal, such as without an answer or with a server
         * error, and one of an overtaken sign-in, which no restore waits for.
         */
        unknown: number
      }
      /**
       * Whether a sign-out without `everywhere` followed the last sign-in, in this instance or in
       * another tab. The store's copy holds it for other tabs and later runs. A refresh, or another
       * tab's save, never clears it.
       */
      marked: boolean
      /**
       * The number of refusals marked `signedIn` that emptied the session. Each one overtakes an
       * update that started before it, as a sign-out does.
       */
      refusals: number
      /**
       * The users of the sessions that a refusal marked `signedIn` emptied, whose end waits for the
       * lock, one entry per end. The store keeps each session, or another context's successor of
       * it, until its end.
       */
      refusing: readonly string[]
      /**
       * The saved session whose access key expired, which the next authorization renews. Absent
       * after a change sets a session, after a sign-out, and after a refusal outside an authorization.
       */
      renewing: Session.Any | undefined
      /** The signed-in session, or `undefined` while signed out. */
      session: Session.Any | undefined
      /** The `version` that the latest sign-out produced, until another change follows it. */
      signedOut: number | undefined
      /**
       * The sign-out in progress, which a second call of the same scope joins, so the session's
       * token is revoked once. Absent while no sign-out runs.
       */
      signingOut:
        | {
            /** Whether the latest run ends the Tempo ID session too. */
            everywhere: boolean
            /** The number of runs that have not emptied the session yet. */
            pending: number
            /** The number of runs in progress. Each run follows the one before it. */
            runs: number
          }
        | undefined
      /** The number of sign-ins, which overtake a restore that started before them. */
      signIns: number
      /** The number of sign-outs, which overtake every change that started before them. */
      signOuts: number
      /** The number of completed changes. A change that began before a newer one completed is overtaken. */
      version: number
    }

    /**
     * An event of the machine. Each one that sets the session counts a change in `version`, and saves
     * the session through `save`, except `hydrate`, which reads it from the store.
     */
    export type Event =
      | {
          /**
           * The instance's session whose access key expired, which another context emptied to renew
           * it. The next authorization here renews it too, and the status shows it while one runs.
           */
          renewing?: Session.Any | undefined
          /**
           * The session that another tab saved, which the store already holds, or `undefined` for an
           * empty store that no sign-out emptied, such as a renewal of an expired session.
           */
          session: Session.Any | undefined
          /** Whether the session is another user's, which overtakes a restore that started before it. */
          signIn: boolean
          /** Another tab saved a newer session, or emptied it, which this instance sets without a write. */
          type: 'adopt'
        }
      | {
          /** An authorization of the browser's Tempo ID session ended. */
          type: 'authorize.end'
        }
      | {
          /** An authorization of the browser's Tempo ID session started. */
          type: 'authorize.start'
        }
      | {
          /** A change that is no update committed a session, which clears the signed-out mark. */
          type: 'change.commit'
        }
      | {
          /** A callback inside an authorization ended. */
          type: 'delegate.end'
        }
      | {
          /** A callback inside an authorization, such as a function `reauthorize`, started. */
          type: 'delegate.start'
        }
      | {
          /** A refusal marked `signedIn` emptied the session that the change started from. */
          type: 'change.refuse'
        }
      | {
          /**
           * Whether the session's access key expired, which the running module reads from the clock.
           * A read after `load` sets no expired session.
           */
          expired: boolean
          /** The session that the store holds. A change that completed first is newer, so it stays. */
          session: Session.Any | undefined
          /** The store's session loaded. */
          type: 'hydrate'
        }
      | {
          /** The authorizations in progress read the store for the kept expired session. */
          type: 'lapsed.checked'
        }
      | {
          /** The end of a refusal emptied the store, or failed. */
          type: 'refusal.end'
          /** The user of the session that the refusal ended. */
          userId: string
        }
      | {
          /** The end of a refusal waits for the lock. */
          type: 'refusal.start'
          /** The user of the session that the refusal ended. */
          userId: string
        }
      | {
          /** `load` found the stored session valid, or found none. */
          type: 'load'
        }
      | {
          /** The chain that a switch selected. */
          chainId: number
          /** A switch of chain moves the kept expired session's access keys. */
          type: 'renewing.move'
        }
      | {
          /** Another tab's sign-out with `everywhere` started its logout. */
          type: 'logout.remote'
        }
      | {
          /** A logout of this instance succeeded, so Tempo ID ended its session and revoked its tokens. */
          type: 'logout.succeed'
        }
      | {
          /**
           * A logout of this instance has an unknown outcome: it failed without a refusal, or an
           * overtaken sign-in started it.
           */
          type: 'logout.unknown'
        }
      | {
          /** Saves the current session again, such as after a sign-out read a stale copy in the store. */
          type: 'save'
        }
      | {
          /**
           * The session whose access key expired, which `load` emptied. The next authorization in
           * this instance renews it, and the status shows it while one runs.
           */
          renewing?: Session.Any | undefined
          /** Whether the store holds the new session already, so the runner writes nothing. */
          saved?: boolean | undefined
          /** The new session, or `undefined` to empty it. */
          session: Session.Any | undefined
          /** Whether the change is a sign-in, which overtakes a restore that started before it. */
          signIn?: boolean | undefined
          /** A change set the session. */
          type: 'set'
        }
      | {
          /** A sign-out emptied the session, and overtakes every change that started before it. */
          type: 'signOut'
        }
      | {
          /** A sign-out emptied the store again, after another context saved the session it ended. */
          type: 'signOut.empty'
        }
      | {
          /** Whether the run ends the Tempo ID session too. */
          everywhere: boolean
          /** A sign-out run ended, with or without an error. */
          type: 'signOut.finish'
        }
      | {
          /** Whether the call ends the Tempo ID session too, which a run without it never serves. */
          everywhere: boolean
          /**
           * A second sign-out shares the one in progress, and overtakes the changes that started
           * before it. The `joins` guard refuses a call that cannot share it.
           */
          type: 'signOut.join'
        }
      | {
          /**
           * A sign-out run with `everywhere` rejected, such as for a logout without a response, so
           * the browser's Tempo ID session can outlive it.
           */
          type: 'signOut.reject'
        }
      | {
          /**
           * Whether the sign-out marked the store signed out, since it kept the browser's Tempo ID
           * session, as a sign-out without `everywhere` does.
           */
          marked: boolean
          /**
           * Another tab's sign-out emptied the store, and overtakes every change that started before
           * it. The instance empties the session without a write.
           */
          type: 'signOut.remote'
        }
      | {
          /** Whether the run ends the Tempo ID session too. */
          everywhere: boolean
          /** A sign-out run started, which follows the run before it. */
          type: 'signOut.start'
        }

    /** A running instance of {@link machine}. */
    export type Actor = XStateActor<typeof session>

    /** A snapshot of {@link machine}. */
    export type Snapshot = ReturnType<Actor['getSnapshot']>
  }

  /**
   * Returns whether a read of another tab's save, which started at `version`, still applies: no
   * change completed during the read, and no sign-out runs here. A sign-out reads the store again
   * under the lock, and handles later saves.
   */
  export function adoptable(
    options: machines.adoptable.Options,
  ): machines.adoptable.ReturnType {
    const { current, version } = options
    return current.version === version && !current.signingOut
  }

  export declare namespace adoptable {
    type Options = {
      /** The instance's context once the read completes. */
      current: session.Context
      /** The `version` when the read started. */
      version: number
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a reload's read of the store, which started at `version`, still applies: no
   * change completed during the read, and no sign-out in progress here holds the session empty.
   * That sign-out reads the store again under the lock, and ends the session that another context
   * saved after it. A change that followed the sign-out, such as a sign-in, holds a session that
   * the read still applies to.
   */
  export function reloadable(
    options: machines.reloadable.Options,
  ): machines.reloadable.ReturnType {
    const { current, version } = options
    if (current.version !== version) return false
    return !current.signingOut || current.signedOut !== current.version
  }

  export declare namespace reloadable {
    type Options = {
      /** The instance's context once the read completes. */
      current: session.Context
      /** The `version` when the read started. */
      version: number
    }

    type ReturnType = boolean
  }

  /**
   * Returns what a sign-out ends, once it holds the lock, from the sessions that it read:
   *
   * - `session`: the session whose tokens the sign-out revokes. Another context's refresh can save
   *   the session's later tokens after the sign-out, and those end in place of the rotated ones.
   *   After a failed write, the instance's session ends when the store holds none, such as after a
   *   sign-in whose save the store refused.
   * - `empty`: whether the store holds the ended session's tokens, its own or later ones, and empties
   *   again, so no later load restores them.
   * - `kept`: whether the store holds another context's later sign-in of another user. That sign-in
   *   holds the browser's Tempo ID session, so the sign-out sends no logout, which would end it.
   */
  export function ending(
    options: machines.ending.Options,
  ): machines.ending.ReturnType {
    const { before, current, failed, local, stored } = options
    // After a failed write, an empty store can be a save that the store refused, such as a sign-in's,
    // so the instance's session ends. A stored session still ends as the newer one, since the
    // sign-out empties the store and no other context revokes it.
    const ended = (() => {
      if (failed && !before) return local
      return machines.newer(before, local) ? before : local
    })()
    // After a failed write, a stored session of another user and the instance's session both hold
    // live tokens, such as after a sign-in whose save the store refused. The sign-out erases the
    // store, so both end.
    const unsaved =
      failed &&
      before &&
      local &&
      Session.subject(before) !== Session.subject(local)
        ? local
        : undefined
    if (!stored || !ended)
      return { empty: false, kept: false, session: ended, unsaved }
    // No store held the instance's unsaved session, so no stored copy holds its tokens or their
    // successor. A stored session then is another context's sign-in.
    const held = !(failed && !before)

    // A change in this instance after the sign-out, such as a sign-in, holds a session that the
    // sign-out never ends.
    const own = stored.refreshToken === current?.refreshToken
    // A refresh and a chain switch keep the session's access keys, so a stored copy with other access
    // keys is a later sign-in, such as another tab's, which stays. Any other stored copy, such as this
    // instance's earlier one, is not the session's latest.
    const later =
      held &&
      !own &&
      Session.subject(stored) === Session.subject(ended) &&
      accessKeyIds(stored) === accessKeyIds(ended) &&
      stored.refreshToken !== ended.refreshToken &&
      order(stored) >= order(ended)
    // A stored copy of the ended session's own tokens, such as one that another context saved again.
    const stale =
      held &&
      !own &&
      stored.refreshToken === ended.refreshToken &&
      Session.subject(stored) === Session.subject(ended)
    // A stored session of the same user can be another tab's restore of the session that ends, which
    // the logout ends.
    const kept =
      !own &&
      !later &&
      !stale &&
      Session.subject(stored) !== Session.subject(ended)

    return {
      empty: later || stale,
      kept,
      session: later ? stored : ended,
      unsaved,
    }
  }

  export declare namespace ending {
    type Options = {
      /** The stored session before the sign-out emptied it. */
      before: Session.Any | undefined
      /** The instance's session once the sign-out holds the lock, such as a later sign-in's. */
      current: Session.Any | undefined
      /**
       * Whether the last write before the sign-out failed, so an empty `before` can be a save that
       * the store refused.
       */
      failed: boolean
      /** The instance's session before the sign-out emptied it. */
      local: Session.Any | undefined
      /** The stored session once the sign-out holds the lock. */
      stored: Session.Any | undefined
    }

    type ReturnType = {
      /** Whether the store empties again, or saves the instance's later session. */
      empty: boolean
      /** Whether the store holds another user's later sign-in, which keeps the Tempo ID session. */
      kept: boolean
      /** The session whose tokens the sign-out revokes, or `undefined` for none. */
      session: Session.Any | undefined
      /**
       * The instance's session, whose save failed, that ends beside `session` when the store held
       * another user's session. Absent otherwise.
       */
      unsaved: Session.Any | undefined
    }
  }

  /**
   * Returns whether a context that holds `refreshToken` adopts the `stored` session, as `newer`
   * decides. The token is the `held` session's own, or a successor that `entries` record with its
   * expiry. Without the expiry, adoption is unknown, so the result is false.
   */
  export function adopts(
    options: machines.adopts.Options,
  ): machines.adopts.ReturnType {
    const { entries, held, refreshToken, stored } = options
    // A local or guest session holds no tokens that another context rotates.
    if (!Session.tempoId(held)) return false
    const expiresAt =
      refreshToken === held.refreshToken
        ? held.expiresAt
        : entries.find((entry) => entry.to === refreshToken)?.expiresAt
    if (!stored || expiresAt === undefined) return false
    return newer(stored, { ...held, expiresAt, refreshToken })
  }

  export declare namespace adopts {
    type Options = {
      /** The rotations that the store records, oldest first. */
      entries: readonly Rotation[]
      /** The session that the sign-in replaced. */
      held: Session.Any
      /** The token that another context can hold: the held session's own, or its successor. */
      refreshToken: string
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether the store's rotations can lack a rotation of a refresh token that the instance
   * read at `since`. A full list, or a list that lacks earlier rotations, lacks it if it starts after
   * that read, with one second of slack for clock steps.
   */
  export function lacks(
    options: machines.lacks.Options,
  ): machines.lacks.ReturnType {
    const { entries, since } = options
    const [first] = entries
    if (!first) return false
    if (entries.length < rotationLimit && !first.truncated) return false
    return first.at > since - 1_000
  }

  export declare namespace lacks {
    type Options = {
      /** The rotations that the store records, oldest first. */
      entries: readonly Rotation[]
      /** When the instance read the refresh token, in milliseconds since the epoch. */
      since: number
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a sign-out after a failed write revokes the instance's own refresh token, which
   * the store may never hold. Another context can have rotated it, or revoked it, so the sign-out
   * revokes it only when the store's rotations show it unrotated:
   *
   * - No token, or a token that Tempo ID revoked already, such as at a disconnection: `false`.
   * - Another tab's logout since the instance obtained the token, which revokes it: `false`.
   * - Unreadable rotations, or a full or truncated list that can lack the rotation: `false`.
   * - A token whose lineage leads elsewhere, or is unknown: `false`.
   * - Otherwise: `true`.
   */
  /**
   * Returns the retained tokens that a sign-out sends again: those that no other tab's logout ended
   * since they entered. That logout revoked them, and a second revocation counts as a reuse.
   * Without a context, as in a backend's instance, every retained token is sent.
   */
  export function resent(
    options: machines.resent.Options,
  ): machines.resent.ReturnType {
    const { remote, retained } = options
    return [...retained]
      .filter(([, entered]) => remote === undefined || remote === entered)
      .map(([token]) => token)
  }

  export declare namespace resent {
    type Options = {
      /** The count of other tabs' logouts now, or `undefined` without a context. */
      remote: number | undefined
      /** The retained tokens, each with the count of other tabs' logouts when it entered. */
      retained: ReadonlyMap<string, number>
    }

    type ReturnType = string[]
  }

  /**
   * Returns the tokens that the instance retains after a sign-out, each with the count of other tabs'
   * logouts when it entered. Only the live tokens that no store holds stay.
   *
   * | A live token                                              | Retained            |
   * | --------------------------------------------------------- | ------------------- |
   * | The unanswered entry holds it                             | no                  |
   * | Retained before the sign-out                              | yes, with its count |
   * | Named in `unsaved`, such as a saved session's own         | yes, with `logouts` |
   * | Otherwise, such as an earlier sign-out's in a kept entry  | no                  |
   */
  export function retains(
    options: machines.retains.Options,
  ): machines.retains.ReturnType {
    const { live, logouts, persisted, retained, unsaved } = options
    const result = new Map<string, number>()
    for (const token of live) {
      if (persisted?.includes(token)) continue
      const entered = retained.get(token)
      if (entered !== undefined) result.set(token, entered)
      else if (unsaved.includes(token)) result.set(token, logouts)
    }
    return result
  }

  export declare namespace retains {
    type Options = {
      /** The tokens whose revocation received no answer in this sign-out. */
      live: readonly string[]
      /** The count of other tabs' logouts when the instance obtained its session. */
      logouts: number
      /** The tokens that the unanswered entry holds, or `undefined` when the store refused it. */
      persisted: readonly string[] | undefined
      /** The tokens retained before the sign-out. */
      retained: ReadonlyMap<string, number>
      /**
       * The refresh tokens that no store holds: the sign-out's own, whose session the store holds no
       * more, and those of its unsaved sessions.
       */
      unsaved: readonly string[]
    }

    type ReturnType = Map<string, number>
  }

  export function revocable(
    options: machines.revocable.Options,
  ): machines.revocable.ReturnType {
    const { entries, held, live, remote, revoked, since, token } = options
    if (!token || token === revoked) return false
    if (remote) return false
    // No other context reads a token that no store held, so none rotated it.
    if (!held) return true
    if (!entries || machines.lacks({ entries, since })) return false
    return live === token
  }

  export declare namespace revocable {
    type Options = {
      /** The rotations that the store records, oldest first, or `undefined` when the read failed. */
      entries: readonly Rotation[] | undefined
      /**
       * Whether a store can have held the token. After a failed write, a store that holds an
       * earlier copy of the same user never held the instance's tokens.
       */
      held: boolean
      /** The latest refresh token of the token's lineage in `entries`, or `undefined` when unknown. */
      live: string | undefined
      /** Whether another tab's logout started since the instance obtained the token. */
      remote: boolean
      /** The refresh token that Tempo ID revoked already, such as at a disconnection. */
      revoked: string | undefined
      /** When the instance obtained the token, in milliseconds since the epoch. */
      since: number
      /** The instance's refresh token. */
      token: string | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a logout that ends the Tempo ID session overlapped a change: one started since
   * the change started, or one ran when it started. A sign-in that such a logout overtook logs out
   * again, also after a logout that failed. {@link restored} decides for a restore.
   */
  export function loggedOut(
    options: machines.loggedOut.Options,
  ): machines.loggedOut.ReturnType {
    const { current, started } = options
    if (current.logouts.started !== started.logouts.started) return true
    return started.logouts.running > 0
  }

  export declare namespace loggedOut {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** The instance's context when the change started. */
      started: session.Context
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a logout can have revoked the tokens of a restore that a sign-out overtook, so
   * the restore sends no revocation, which would count as a reuse. Returns `undefined` while a
   * sign-out with `everywhere` of this instance runs. The first row that applies decides.
   *
   * | Since the restore started                                 | Result      |
   * | --------------------------------------------------------- | ----------- |
   * | Another tab's logout started, whose outcome no tab learns | `true`      |
   * | A logout of this instance succeeded                       | `true`      |
   * | A logout of this instance has an unknown outcome          | `true`      |
   * | A sign-out with `everywhere` of this instance runs now    | `undefined` |
   * | Otherwise, such as after a logout that Tempo ID refused   | `false`     |
   */
  export function restored(
    options: machines.restored.Options,
  ): machines.restored.ReturnType {
    const { current, started } = options
    if (current.logouts.remote !== started.logouts.remote) return true
    if (current.logouts.succeeded !== started.logouts.succeeded) return true
    if (current.logouts.unknown !== started.logouts.unknown) return true
    if (current.logouts.running > 0) return undefined
    return false
  }

  export declare namespace restored {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** The instance's context when the restore started. */
      started: session.Context
    }

    type ReturnType = boolean | undefined
  }

  /**
   * Returns whether a sign-out ends the Tempo ID session. Only a sign-out with `everywhere` does,
   * and none after a later sign-in in this instance, or with another user's sign-in in the store.
   * Those sign-ins hold the Tempo ID session.
   */
  export function logout(
    options: machines.logout.Options,
  ): machines.logout.ReturnType {
    const { everywhere, kept, signIns, started } = options
    if (!everywhere) return false
    if (signIns !== started) return false
    return !kept
  }

  export declare namespace logout {
    type Options = {
      /** Whether the sign-out asked to end the Tempo ID session. */
      everywhere: boolean
      /** Whether the store holds another user's later sign-in, as `ending` returns. */
      kept: boolean
      /** The number of sign-ins in this instance now. */
      signIns: number
      /** The number of sign-ins in this instance when the sign-out emptied the session. */
      started: number
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a sign-out or a refusal marked `signedIn` emptied the session since a change
   * started. An update that sent a refresh token then revokes its own new session, and the sign-out
   * or the refusal skips the token that the update rotated.
   */
  export function ended(
    options: machines.ended.Options,
  ): machines.ended.ReturnType {
    const { current, started } = options
    if (current.refusals !== started.refusals) return true
    return current.signOuts !== started.signOuts
  }

  export declare namespace ended {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** The instance's context when the change started. */
      started: session.Context
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether another context can hold the new refresh token of a refresh that ends, so the
   * refresh never revokes it. A second revocation of a token counts as a reuse.
   *
   * | Case                                                          | Result |
   * | ------------------------------------------------------------- | ------ |
   * | The read of the rotations failed                              | true   |
   * | The revoked digests hold the new token                        | true   |
   * | A rotation names the new token as its successor or its source | true   |
   * | Otherwise                                                     | false  |
   */
  export function shares(
    options: machines.shares.Options,
  ): machines.shares.ReturnType {
    const { digest, digests, entries, received } = options
    if (!entries) return true
    if (digests.includes(digest)) return true
    return entries.some(
      (entry) => entry.to === received || entry.from === digest,
    )
  }

  export declare namespace shares {
    type Options = {
      /** The SHA-256 digest of the new refresh token. */
      digest: string
      /** The digests of the refresh tokens that a context revoked. */
      digests: readonly string[]
      /** The store's rotations, or `undefined` after a failed read. */
      entries: readonly Rotation[] | undefined
      /** The new refresh token. */
      received: string
    }

    type ReturnType = boolean
  }

  /**
   * Returns how the end of a refusal marked `signedIn` treats the store under the lock: whether it
   * empties the store, and the session whose refresh token it revokes.
   *
   * | Case                                                    | `empty` | `session`          |
   * | ------------------------------------------------------- | ------- | ------------------ |
   * | A sign-in followed the refusal, here or adopted         | false   | the ended session  |
   * | The store holds another user's session                  | false   | the ended session  |
   * | Otherwise                                               | true    | the stored session, or the ended one |
   *
   * The stored session of the same user can be another tab's successor of the ended session, which
   * ends in its place, so no rotated token is revoked.
   */
  export function refusal(
    options: machines.refusal.Options,
  ): machines.refusal.ReturnType {
    const { current, ended, refused, stored } = options
    if (current.signIns !== refused.signIns)
      return { empty: false, session: ended }
    if (stored && Session.subject(stored) !== Session.subject(ended))
      return { empty: false, session: ended }
    return { empty: true, session: stored ?? ended }
  }

  export declare namespace refusal {
    type Options = {
      /** The instance's context now, under the lock. */
      current: session.Context
      /** The session that the refusal emptied. */
      ended: Session.Any
      /** The instance's context right after the refusal. */
      refused: session.Context
      /** The session that the store holds now, under the lock. */
      stored: Session.Any | undefined
    }

    type ReturnType = {
      /** Whether the store empties. */
      empty: boolean
      /** The session whose refresh token the end revokes. */
      session: Session.Any
    }
  }

  /**
   * Returns whether a refusal marked `signedIn` in this instance emptied the session since a change
   * started. Another tab's change never counts, since this instance adopts it without a refusal.
   */
  export function refused(
    options: machines.refused.Options,
  ): machines.refused.ReturnType {
    const { current, started } = options
    return current.refusals !== started.refusals
  }

  export declare namespace refused {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** The instance's context when the change started. */
      started: session.Context
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether the stored session is newer than the instance's: another tab's sign-out, another
   * user's session, or the same user's session with later tokens, which a refresh issues.
   */
  export function newer(
    stored: Session.Any | undefined,
    current: Session.Any | undefined,
  ) {
    if (!stored || !current) return stored !== current
    if (Session.subject(stored) !== Session.subject(current)) return true
    return order(stored) > order(current)
  }

  /**
   * Returns the session of another context that a sign-in's save replaces in the store, such as a
   * second run of a CLI's login, which the sign-in then revokes. Returns `undefined` for no stored
   * session, for the session that the instance holds, and for an earlier copy of it, which
   * `newer` rejects.
   */
  export function overwrites(
    options: machines.overwrites.Options,
  ): machines.overwrites.ReturnType {
    const { held, stored } = options
    if (!stored?.refreshToken) return undefined
    if (!newer(stored, held)) return undefined
    return stored
  }

  export declare namespace overwrites {
    type Options = {
      /** The session that the instance holds before the sign-in. */
      held: Session.Any | undefined
      /** The session that the store holds before the sign-in's save. */
      stored: Session.Any | undefined
    }

    type ReturnType = Session.Any | undefined
  }

  /**
   * Returns whether a sign-in of `kept` yields to `overwritten`, the session of another context's
   * sign-in that its save replaced in the store. That context adopts `kept` only as `newer` decides,
   * so only a session of the same user whose tokens Tempo ID issued later, such as from a request
   * that was sent later and answered first, takes the place of `kept`. A session whose access token another DPoP key binds
   * never takes the place of `kept`.
   */
  export function yields(
    options: machines.yields.Options,
  ): machines.yields.ReturnType {
    const { kept, overwritten } = options
    // A local or guest session holds no tokens, so neither yields to the other.
    if (!Session.tempoId(kept) || !Session.tempoId(overwritten)) return false
    // A DPoP key binds each access token, and the instance holds only the key that bound `kept`, so
    // a session that another key binds is of no use to it.
    if (Api.jkt(kept.accessToken) !== Api.jkt(overwritten.accessToken))
      return false
    // Another context that loaded `kept` adopts `overwritten` only if it is newer, so an equal
    // expiry keeps `kept`, whose token that context can still hold.
    if (Session.subject(kept) !== Session.subject(overwritten)) return false
    // A call in progress, such as a retry after a limit, checked the account of `kept`, so the yield
    // never switches the instance to another Tempo Account of the user.
    if (kept.address?.toLowerCase() !== overwritten.address?.toLowerCase())
      return false
    return overwritten.expiresAt > kept.expiresAt
  }

  /**
   * Returns how a sign-in's yield to an overwritten session of another context ends, from the state
   * that the runner reads under the lock.
   *
   * | Result     | Condition                                                                 |
   * | ---------- | ------------------------------------------------------------------------- |
   * | `declined` | The store or the instance no longer holds `kept`, such as after a sign-out |
   * | `rotated`  | A context rotated or revoked the overwritten token, or rotations are unknown |
   * | `kept`     | A context rotated or revoked `kept`, or the overwritten session refreshes the replaced one |
   * | `yield`    | Otherwise                                                                 |
   */
  export function handoff(
    options: machines.handoff.Options,
  ): machines.handoff.ReturnType {
    const { held, kept, lacks, overwritten, refreshed, stored } = options
    if (!stored || !held) return 'declined'
    if (
      overwritten.ended ||
      lacks ||
      overwritten.successor !== overwritten.token
    )
      return 'rotated'
    if (kept.ended || kept.successor !== kept.token || refreshed) return 'kept'
    return 'yield'
  }

  export declare namespace handoff {
    type Token = {
      /** Whether a context rotated or revoked the token, as this instance or the store records. */
      ended: boolean
      /** The token that the rotations name in its place, or the token itself without a rotation. */
      successor: string | undefined
      /** The refresh token. */
      token: string
    }

    type Options = {
      /** Whether the instance holds `kept`. */
      held: boolean
      /** The refresh token of the sign-in's session. */
      kept: Token
      /** Whether the rotations since the sign-in's read of the store can be missing. */
      lacks: boolean
      /** The refresh token of the overwritten session. */
      overwritten: Token
      /** Whether the overwritten session is a refresh of the session that the sign-in replaced. */
      refreshed: boolean
      /** Whether the store holds `kept`. */
      stored: boolean
    }

    type ReturnType = 'declined' | 'kept' | 'rotated' | 'yield'
  }

  export declare namespace yields {
    type Options = {
      /** The session that the sign-in saved. */
      kept: Session.Any
      /** The session of another context that the sign-in's save replaced. */
      overwritten: Session.Any
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a change that overtakes another one completed since that one started:
   *
   * - An update, such as a refresh, yields to any change.
   * - A restore yields to a sign-in. It reads the Tempo ID session that a sign-out ends, so it also
   *   yields when a sign-out ran as it started, or runs now.
   * - Every change yields to a sign-out.
   */
  export function overtaken(
    options: machines.overtaken.Options,
  ): machines.overtaken.ReturnType {
    const { current, restore, started, update } = options
    if (update) return current.version !== started.version
    if (restore && current.signIns !== started.signIns) return true
    if (restore && current.signingOut) return true
    if (restore && started.signingOut) return true
    return current.signOuts !== started.signOuts
  }

  export declare namespace overtaken {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** Whether the change restores the browser's Tempo ID session, as {@link ChangeOptions} describes. */
      restore?: boolean | undefined
      /** The instance's context when the change started. */
      started: session.Context
      /** Whether the change updates the current session's tokens, as {@link ChangeOptions} describes. */
      update?: boolean | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether a commit clears the signed-out mark. A sign-out that started after the change,
   * and that has not emptied the session yet, keeps its mark. One that emptied it overtook the change.
   */
  export function clears(
    options: machines.clears.Options,
  ): machines.clears.ReturnType {
    const { current, started } = options
    if (!current.signingOut) return true
    if (!started.signingOut) return false
    return current.signingOut.runs <= started.signingOut.runs
  }

  export declare namespace clears {
    type Options = {
      /** The instance's context now. */
      current: session.Context
      /** The instance's context when the change started. */
      started: session.Context
    }

    type ReturnType = boolean
  }

  /**
   * Returns the stored session as the instance holds it. A save of the same user's access keys on
   * the same chains, such as another context's refresh, keeps the instance's layout of `accessKey`
   * and `accessKeys`, and its account, with the stored tokens and access key entries, while that
   * layout holds the access key of `chainId`. An `accessKey` that the store authorizes for another
   * account drops the account. A save that holds the instance's layout already, or a session
   * without access keys, replaces the session as it is. Any other session selects its access key on
   * `chainId`, once the stored chain selection loaded.
   */
  export function arranged(
    options: machines.arranged.Options,
  ): machines.arranged.ReturnType {
    const { chainId, current, stored } = options
    // A guest session holds no access keys to arrange.
    if (stored && Session.guest(stored)) return stored

    // One public key can act on several chains, so the chain and the key ID identify an entry.
    const id = (entry: NonNullable<Session.Any['accessKey']>) =>
      `${Number(entry.chainId)}:${entry.keyAuthorization.keyId.toLowerCase()}`
    const ids = (session: Session.Any) =>
      [session.accessKey, ...(session.accessKeys ?? [])]
        .flatMap((entry) => (entry ? [id(entry)] : []))
        .sort()
        .join()
    const relaid =
      !!stored &&
      !!current &&
      Session.subject(stored) === Session.subject(current) &&
      ids(current) !== '' &&
      ids(stored) === ids(current) &&
      (stored.accessKey && id(stored.accessKey)) !==
        (current.accessKey && id(current.accessKey)) &&
      (chainId === undefined || selected(current, { chainId }) === current)
    if (!relaid) {
      if (chainId === undefined) return stored
      return selected(stored, { chainId })
    }

    // The stored entries hold the latest authorizations, such as a sign-in's with the same public
    // key, so they replace the instance's entries in the instance's layout.
    const entries = new Map(
      [stored.accessKey, ...(stored.accessKeys ?? [])].flatMap((entry) =>
        entry ? [[id(entry), entry]] : [],
      ),
    )
    const latest = (entry: NonNullable<Session.Any['accessKey']>) =>
      entries.get(id(entry)) ?? entry
    const {
      accessKey: _accessKey,
      accessKeys: _accessKeys,
      account: _account,
      ...tokens
    } = stored
    const { accessKey, accessKeys } = current
    // The account belongs to `accessKey`, or without one to the instance's chain, where no entry
    // sits. A stored authorization of `accessKey` for another account drops it, and the first
    // signature reads the account again.
    const account =
      !accessKey ||
      latest(accessKey).account.toLowerCase() ===
        accessKey.account.toLowerCase()
        ? current.account
        : undefined
    return {
      ...tokens,
      ...(account ? { account } : {}),
      ...(accessKey ? { accessKey: latest(accessKey) } : {}),
      ...(accessKeys ? { accessKeys: accessKeys.map(latest) } : {}),
    }
  }

  export declare namespace arranged {
    type Options = {
      /** The instance's chain, or `undefined` before the stored selection loads. */
      chainId: number | undefined
      /** The session that the instance holds. */
      current: Session.Any | undefined
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = Session.Any | undefined
  }

  /**
   * Returns whether the stored session replaces the instance's, as {@link newer} decides. After a
   * failed write, the store can hold this instance's earlier copy, such as the session that a
   * sign-out failed to empty, so only the same user's later tokens replace it.
   */
  export function replaces(
    options: machines.replaces.Options,
  ): machines.replaces.ReturnType {
    const { current, failed, stored } = options
    if (!failed) return machines.newer(stored, current)
    if (!stored || !current) return false
    if (Session.subject(stored) !== Session.subject(current)) return false
    return order(stored) > order(current)
  }

  export declare namespace replaces {
    type Options = {
      /** The instance's session. */
      current: Session.Any | undefined
      /** Whether the last write to the store failed. */
      failed: boolean
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether an empty result of a change, such as an `authorize` that found no Tempo ID
   * session, or a refusal that marks the user signed in, empties the session and writes the store.
   * An instance that holds no session changes nothing, so it writes nothing, since a write would
   * erase another context's later save, such as another tab's sign-in. After a failed write, the
   * store can hold this instance's earlier copy, such as the session that a sign-out failed to
   * empty, so the write runs.
   */
  export function empties(
    options: machines.empties.Options,
  ): machines.empties.ReturnType {
    const { current, failed } = options
    return failed || current !== undefined
  }

  export declare namespace empties {
    type Options = {
      /** The instance's session. */
      current: Session.Any | undefined
      /** Whether the last write to the store failed. */
      failed: boolean
    }

    type ReturnType = boolean
  }

  /**
   * Returns the instance's session whose access key expired when the store holds no session, such
   * as after another tab emptied it to renew it. An authorization in progress renews it, so the
   * status shows it. Returns `undefined` otherwise.
   */
  export function renews(
    options: machines.renews.Options,
  ): machines.renews.ReturnType {
    const { current, expired, stored } = options
    if (stored || !current || !expired) return undefined
    return current
  }

  export declare namespace renews {
    type Options = {
      /** The instance's session. */
      current: Session.Any | undefined
      /** Whether the access key of `current` expired, which the runner reads from the clock. */
      expired: boolean
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = Session.Any | undefined
  }

  /**
   * Returns whether the instance's first load of the stored session ended, or a change set the
   * session first. Until then, the load's read is the current one, so a caller reads the store no
   * more.
   */
  export function loaded(snapshot: machines.session.Snapshot): boolean {
    return snapshot.context.loaded
  }

  /**
   * Returns whether the instance holds a session whose access keys expired while it held it, which
   * the status shows as signed out until a read empties it.
   */
  export function expired(snapshot: machines.session.Snapshot): boolean {
    return (
      snapshot.context.session !== undefined &&
      snapshot.context.session === snapshot.context.expired
    )
  }

  /**
   * Returns the status of `snapshot`, and the session to show: the expired session while
   * `reauthorizing`, the session while `signedIn`, and none otherwise.
   */
  export function status(
    snapshot: machines.session.Snapshot,
  ): Session.Status<Session.Any> {
    const { context } = snapshot
    if (snapshot.matches('signedIn') && context.session)
      return { session: context.session, status: 'signedIn' }
    // Until `load` empties it, the held session that expired is the one that the authorization renews.
    const renewing = context.renewing ?? context.session
    if (snapshot.matches('reauthorizing') && renewing)
      return { session: renewing, status: 'reauthorizing' }
    if (snapshot.matches('signedOut'))
      return { session: undefined, status: 'signedOut' }
    return { session: undefined, status: 'pending' }
  }

  /**
   * Returns whether a read of the session waits for no authorization: the session is set, such as
   * by one of several authorizations, or every authorization in progress waits for a callback inside
   * it, which can make the read, or none runs.
   */
  /**
   * Returns whether a load reads the store for the kept expired session no more: an authorization
   * in progress read it at the current version.
   */
  export function checked(context: machines.session.Context) {
    return context.authorizations > 0 && context.checked === context.version
  }

  /**
   * Returns the kept expired session after an event that sets the session: none beside a session,
   * else the event's, moved to the chain that the last switch selected, or the one kept already.
   */
  export function keeps(options: {
    context: machines.session.Context
    event: {
      renewing?: Session.Any | undefined
      session: Session.Any | undefined
    }
  }): Pick<machines.session.Context, 'moved' | 'renewing'> {
    const { context, event } = options
    if (event.session) return { moved: undefined, renewing: undefined }
    if (!event.renewing)
      return { moved: context.moved, renewing: context.renewing }
    return {
      moved: context.moved,
      renewing:
        context.moved === undefined
          ? event.renewing
          : toChain(event.renewing, { chainId: context.moved }),
    }
  }

  /**
   * Returns whether a read of the account saves it in the session: the session's access token
   * authenticated the read, the session holds no account, and the instance still selects the chain
   * of the read. A later session, such as a refresh's or another sign-in's, takes no account, since
   * its user can have selected another one. An access key names the account's chain and address.
   */
  export function keepsAccount(
    options: machines.keepsAccount.Options,
  ): machines.keepsAccount.ReturnType {
    const { accessToken, account, chainId, selected, session } = options
    if (!session || session.account) return false
    if (session.accessToken !== accessToken) return false
    if (selected !== chainId) return false
    if (!session.accessKey) return true
    if (Number(session.accessKey.chainId) !== chainId) return false
    return (
      session.accessKey.account.toLowerCase() === account.address.toLowerCase()
    )
  }

  export declare namespace keepsAccount {
    type Options = {
      /** The access token that authenticated the read. */
      accessToken: string
      /** The account that the read returned. */
      account: Pick<TempoAccount.TempoAccount, 'address'>
      /** The chain of the read. */
      chainId: number
      /** The chain that the instance selects now. */
      selected: number
      /** The session that the instance holds now. */
      session: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  export function idle(snapshot: machines.session.Snapshot) {
    if (snapshot.matches('signedIn')) return true
    const { authorizations, delegations } = snapshot.context
    return authorizations <= delegations
  }

  /**
   * Returns whether `snapshot` is `signedOut` after a sign-out without `everywhere` in this
   * instance or in another tab, so a call with `reauthorize` authorizes nothing and holds no
   * status. It reads no store, so another tab's mark still applies inside the authorization.
   */
  export function declined(snapshot: machines.session.Snapshot) {
    return snapshot.matches('signedOut') && snapshot.context.marked
  }

  /**
   * Returns whether `current` holds newer tokens of the user of `started`, which a refresh or a
   * sign-in obtained after `startedAt`, while the refresh waited for the lock, in this instance or
   * another context, and whose access token holds at `now`. The refresh then returns `current`, and
   * sends no request. `receivedAt` is when the context that saved `current` received it. Without it, `expiresAt`
   * less `lifetime` is no later than that time.
   */
  export function rotated(
    options: machines.rotated.Options,
  ): machines.rotated.ReturnType {
    const { current, lifetime, now, started, startedAt } = options
    // A local or guest session holds no tokens to refresh.
    if (!Session.tempoId(current)) return false
    // An instance that held no session when the call started, such as one that has not read the
    // store yet, decides by the time alone.
    if (started && !started.refreshToken) return false
    if (started && Session.subject(current) !== Session.subject(started))
      return false
    // An access token that expired while the call waited, such as in a suspended tab, refreshes.
    if (current.expiresAt <= now) return false
    // The lifetime of a token counts from its request, which starts before its response, so only
    // `receivedAt` names a response that arrived while the call waited for the lock.
    const received =
      current.receivedAt ??
      (lifetime === undefined ? undefined : current.expiresAt - lifetime)
    // Tokens that another context obtained before the call, which this instance has not read yet,
    // refresh, as does a token without a known receipt.
    if (received === undefined) return false
    // Tokens received in the millisecond the call started count as earlier: the call cannot tell them
    // from tokens that another context saved just before it, which refresh.
    if (received <= startedAt) return false
    return current.refreshToken !== started?.refreshToken
  }

  export declare namespace rotated {
    type Options = {
      /** The session that the refresh read under the lock. */
      current: Session.Any
      /** The lifetime of the access token of `current`, in milliseconds. Absent when unknown. */
      lifetime: number | undefined
      /** The time of the read under the lock, in milliseconds since the epoch. */
      now: number
      /** The instance's session when the refresh started. Absent for an instance without one, such as one that has not read the store yet. */
      started: Session.Any | undefined
      /** When the refresh started, in milliseconds since the epoch. */
      startedAt: number
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether `stored` is the session of a user whose refusal end waits for the lock, so a
   * reload never sets it again. The end empties any stored session of that user, such as another
   * context's successor of the ended session.
   */
  export function refusing(
    options: machines.refusing.Options,
  ): machines.refusing.ReturnType {
    const { context, stored } = options
    if (!stored) return false
    return context.refusing.includes(Session.subject(stored))
  }

  export declare namespace refusing {
    type Options = {
      /** The instance's context. */
      context: session.Context
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether an adopted session counts as a sign-in for the plugins' `afterSignIn` hooks:
   * the instance held no session, or another user's.
   */
  export function signsIn(
    options: machines.signsIn.Options,
  ): machines.signsIn.ReturnType {
    const { current, session } = options
    if (!session) return false
    return !Session.same(current, session)
  }

  export declare namespace signsIn {
    type Options = {
      /** The instance's session before the adoption. */
      current: Session.Any | undefined
      /** The instance's session after the adoption. */
      session: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether another tab's sign-out message signs the instance out: the store holds no
   * session, or the sign-out ended the Tempo ID session with `everywhere`, the store is local, the
   * message came from another tab and not through the store's `connect`, and the instance signed
   * in before the message. A local store, such as `Store.memory`,
   * holds each tab's own session, which the other tab's sign-out cannot empty. Its logout revoked
   * the tokens of the browser's Tempo ID session, also those of that store. A sign-in after the
   * message, such as while the message waited for the lock, follows the logout, so it stays.
   */
  export function signsOut(
    options: machines.signsOut.Options,
  ): machines.signsOut.ReturnType {
    const { at, connected, everywhere, local, signedIn, signOut, stored } =
      options
    if (!signOut) return false
    if (!stored) return true
    // A message through the store's `connect` comes from an instance on the same store, so the
    // stored session is the sender's too, as on a shared store.
    if (everywhere !== true || local !== true || connected === true)
      return false
    // A message without a time orders nothing, so the logout can follow any session.
    return at === undefined || signedIn <= at
  }

  export declare namespace signsOut {
    type Options = {
      /**
       * When the other tab posted the message, in milliseconds since the epoch. Absent from a
       * message that states no time.
       */
      at: number | undefined
      /** Whether the message came through the store's `connect`, from an instance on the same store. */
      connected: boolean | undefined
      /** Whether the other tab's sign-out ended the Tempo ID session too. */
      everywhere: boolean | undefined
      /** Whether the store holds only this tab's values, as `Store.memory` does. */
      local: boolean | undefined
      /**
       * When a sign-in last committed the instance's session, in milliseconds since the epoch. A
       * refresh and a restore, such as `authorize`, keep it, since a logout after either revokes
       * their tokens too.
       */
      signedIn: number
      /** Whether the message names a sign-out. */
      signOut: boolean
      /** The session that the store holds, or `undefined` when it holds none or the read failed. */
      stored: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns whether the stored session is another user's than the instance's. Such a session counts
   * as a sign-in, which overtakes a restore that started before it.
   */
  export function switches(
    options: machines.switches.Options,
  ): machines.switches.ReturnType {
    const { current, stored } = options
    if (!stored || !current) return false
    return Session.subject(stored) !== Session.subject(current)
  }

  export declare namespace switches {
    type Options = {
      /** The instance's session. */
      current: Session.Any | undefined
      /** The session that the store holds. */
      stored: Session.Any | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns the status that `context` selects, in the order of the table below. The machine's
   * `settling` state selects it after each event, so every snapshot's state is `select(context)`.
   *
   * | Status          | When                                                            |
   * | --------------- | --------------------------------------------------------------- |
   * | `signedIn`      | The session loaded, or a change set it, and it did not expire.  |
   * | `reauthorizing` | An authorization renews a session whose access key expired.     |
   * | `pending`       | The session has not loaded, or an authorization is in progress. |
   * | `signedOut`     | Otherwise.                                                      |
   */
  export function select(
    context: machines.session.Context,
  ): Session.Status<Session.Any>['status'] {
    if (
      context.loaded &&
      context.session &&
      context.session !== context.expired
    )
      return 'signedIn'
    // Until `load` empties it, the held session that expired is the one that the authorization
    // renews, so the status shows no `pending` between `signedOut` and `reauthorizing`.
    const renewing =
      context.renewing ??
      (context.session !== undefined && context.session === context.expired
        ? context.session
        : undefined)
    if (context.authorizations > 0 && renewing) return 'reauthorizing'
    if (!context.loaded || context.authorizations > 0) return 'pending'
    return 'signedOut'
  }

  /**
   * Returns the time at which {@link Session.expired} becomes true for `session`, in milliseconds
   * since the epoch, or `Infinity` for a session that time alone never expires: the latest expiry
   * of its access keys, where an access key without an expiry never expires.
   */
  export function expiresAt(session: Session.Any): number {
    const times = [
      ...(session.accessKey ? [session.accessKey] : []),
      ...(session.accessKeys ?? []),
    ].map((key) => AccessKey.expiry(key) ?? Infinity)
    // Without an access key, the access token's expiry counts too, unless a refresh token renews it.
    // A guest session's key pair signs as long as the store keeps it.
    if (Session.guest(session)) return Infinity
    if (!session.accessKey && Session.tempoId(session))
      times.push(session.refreshToken ? Infinity : session.expiresAt)
    // A session that holds no expiry, such as a local one without an access key, expired already.
    return Math.max(0, ...times)
  }

  /** Returns the guard of `settling`'s transition to `status`. */
  function selects(status: Session.Status<Session.Any>['status']) {
    return { params: { status }, type: 'selects' } as const
  }
}
