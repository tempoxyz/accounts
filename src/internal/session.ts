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
} from 'xstate'
import { RequestError, SupersededError } from '../Id.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'
import * as TempoAccount from '../TempoAccount.js'

/** How a change yields to others. A sign-out overtakes every change that started before it. */
export type ChangeOptions = {
  /**
   * Whether the change restores the session of the browser's Tempo ID session, such as
   * `authorize`, which a sign-in that completes first overtakes too.
   */
  restore?: boolean | undefined
  /**
   * The refresh token that the change sent, which Tempo ID rotates. When a sign-out overtakes the
   * change, the sign-out revokes the change's new tokens, and never this token again.
   */
  sent?: string | undefined
  /**
   * Whether the change updates the current session's tokens, such as a refresh, which any other
   * change overtakes, so an update never writes an earlier user's tokens.
   */
  update?: boolean | undefined
}

/** The message that a tab posts to the instance's other tabs after it saves the session. */
type Message = {
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
  commit: (
    session: Session.Session | undefined,
    failure?: Failure,
  ) => Promise<void>
  /**
   * Rethrows a sign-in's error. A refusal marked `signedIn` empties the session. An arrow function,
   * which `catch` takes unbound.
   */
  fail: (error: unknown, options?: FailOptions) => Promise<never>
  /** Returns whether a change that overtakes this one completed, without a side effect. */
  overtaken: () => boolean
}

/**
 * Creates the session of an instance. Without `enabled`, the session holds nothing, and each change
 * only runs its checks. With a `store`, the session saves to it, under `name`.
 */
export function create(options: create.Options): create.ReturnType {
  const { enabled, name, onSignIn, onSignOut, signOut, store } = options

  const writes = store ? queue(store, { getFn: options.getFn }) : undefined
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
  if (channel)
    channel.onmessage = (event: MessageEvent<Message>) => {
      const options = { signOut: event.data?.signOut === true }
      // Another tab's logout revokes the tokens of this tab's restore, as this tab's own does.
      if (event.data?.everywhere) actor?.send({ type: 'logout.remote' })
      // The plugins' hooks run after the lock releases, since a hook that takes the lock, such as
      // through `exclusive`, would otherwise wait for itself.
      void (async () => {
        const hooks = await (options.signOut && exclusives === 0
          ? adopt(options)
          : exclusive(() => adopt(options)))
        await hooks?.()
      })().catch(() => undefined)
    }
  const actor = enabled
    ? createActor(
        machines.session.provide({
          actions: {
            // The write enqueues during the event, so a `flush` right after it awaits the write.
            // The message names a sign-out, which other tabs count as one. Another empty write,
            // such as a renewal of an expired session, empties their session as `set` does.
            save: (args) => {
              const message = {
                everywhere: args.context.signingOut?.everywhere,
                signOut: args.event.type.startsWith('signOut'),
              } satisfies Message
              writes
                ?.save(name, args.context.session)
                .then(() => channel?.postMessage(message))
                .catch(() => undefined)
            },
          },
        }),
      ).start()
    : undefined

  /** Returns the machine's context. */
  const context = () => actor!.getSnapshot().context

  /** Sets the session, and counts the change. */
  function set(
    session: Session.Session | undefined,
    options: { renewing?: Session.Session | undefined; signIn?: boolean } = {},
  ) {
    actor?.send({
      renewing: options.renewing,
      session,
      signIn: options.signIn,
      type: 'set',
    })
  }

  // The read of the stored session, which every `load` shares, until one succeeds.
  let hydrating: Promise<void> | undefined
  // The number of runs of `exclusive` in this instance that hold the lock or wait for it.
  let exclusives = 0
  // The last run of `exclusive` where no lock spans the processes, which the next one follows.
  let running: Promise<unknown> = Promise.resolve()
  // The run of the latest sign-out, which a call that joins it returns, and the next one follows.
  // The machine's `signingOut` decides whether a sign-out runs. This holds only its promise.
  let latest: Promise<void> | undefined
  // The signed-out mark of an instance without a session, which runs no machine and holds no store.
  // An instance with a session holds the mark in the machine's `marked`.
  let markedLocal = false

  /**
   * Reads the stored session once. Every read of the session before a change awaits it. A failed
   * read leaves the session unread, so the next read of the session tries again.
   */
  async function hydrate() {
    if (!actor) return
    if (!writes) return
    const attempt = (hydrating ??= (async () => {
      const session = (await writes.storage.getItem(name))?.session
      const expired = session !== undefined && Session.expired(session)
      actor.send({ expired, session, type: 'hydrate' })
    })())
    await attempt.catch(() => {
      if (hydrating === attempt) hydrating = undefined
    })
  }

  /**
   * Runs `fn` while no other run of the session's `exclusive` does. A browser's tabs share the
   * session through its store, so their Web Lock spans them.
   */
  function exclusive<value>(fn: () => Promise<value>): Promise<value> {
    const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
      ?.locks
    const counted = async () => {
      exclusives += 1
      try {
        return await fn()
      } finally {
        exclusives -= 1
      }
    }
    if (locks) return locks.request(`${name}:exclusive`, counted)
    const run = running.catch(() => undefined).then(counted)
    running = run
    return run
  }

  /**
   * Reads the stored session again, and sets it when it is newer than the instance's: another tab's
   * sign-out, another user's sign-in, or the same user's later tokens. An earlier copy, such as one
   * that a failed save left behind, never replaces the session.
   */
  async function reload() {
    if (!actor) return undefined
    await hydrate()
    if (!writes) return context().session
    // A failed write fails only its own change. The store then holds an earlier copy, or a newer
    // one that another tab saved since, so only the same user's later tokens replace the session.
    await writes.flush().catch(() => undefined)
    const started = context().version
    const stored = (await writes.storage.getItem(name))?.session
    const { session: current, version } = context()
    // A change in this instance during the read, such as a sign-in, is newer than what it read.
    if (version !== started) return current
    const adopt = (() => {
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
    // session where this instance holds none can be another tab's restore of the same user.
    if (adopt) set(stored, { signIn: machines.switches({ current, stored }) })
    return context().session
  }

  /**
   * Sets the session that another tab saved, without a write, since the store already holds it. A
   * failed read, an expired copy, or a change in this instance during the read changes nothing.
   * Another tab's sign-out overtakes every change that started before it, as a sign-out here does,
   * also a restore that holds no session yet. The plugins' hooks run for another tab's sign-out, and
   * for its sign-in where this instance held no session or another user's. Returns the run of those
   * hooks, which the caller starts once it holds no lock.
   */
  async function adopt(options: {
    signOut: boolean
  }): Promise<(() => Promise<void>) | undefined> {
    // A sign-out in progress here reads the store again under the lock, and handles later saves.
    if (!actor || !writes || context().signingOut) return undefined
    await hydrate()
    await writes.flush().catch(() => undefined)
    const started = context().version
    const read = await (async () => writes.storage.getItem(name))().then(
      (value) => ({ stored: value?.session }),
      () => undefined,
    )
    const { renewing, session: current } = context()
    if (!machines.adoptable({ current: context(), version: started }))
      return undefined
    // Another tab's sign-out ends this session also when the store cannot show it, after a failed
    // read or a failed write here. A sign-in that followed it holds the store, and its own message
    // then sets its session.
    // A renewal of an expired session still shows its user, so its end is a sign-out too.
    if (options.signOut && !read?.stored) {
      actor.send({ type: 'signOut.remote' })
      return current || renewing ? async () => onSignOut?.() : undefined
    }
    if (!read) return undefined
    const { stored } = read
    // After a failed write, the store can hold this instance's earlier copy, such as the session
    // that a sign-out here failed to empty, so only the same user's later tokens replace it.
    const adopted = machines.replaces({
      current,
      failed: writes.failed(),
      stored,
    })
    if (!adopted) return undefined
    if (stored && Session.expired(stored)) return undefined
    const signIn = machines.switches({ current, stored })
    actor.send({ session: stored, signIn, type: 'adopt' })
    // The hooks run where this instance held no session, or another user's.
    return stored && current?.user.id !== stored.user.id
      ? async () => onSignIn?.(stored)
      : undefined
  }

  /**
   * The refresh tokens that a context revoked, such as another tab, as SHA-256 digests. A second
   * revocation counts as a reuse, which revokes the app's tokens on the user's other devices. Reads
   * and writes run under the lock. A failed read or write marks nothing.
   */
  const revoked = {
    async has(session: Session.Session | undefined) {
      if (!store || !session?.refreshToken) return false
      return (await readRevoked()).includes(digest(session.refreshToken))
    },
    // ponytail: the 16 latest digests, enough for the sessions that one store's contexts hold.
    async add(session: Session.Session) {
      if (!store || !session.refreshToken) return
      const digests = [
        ...(await readRevoked()),
        digest(session.refreshToken),
      ].slice(-16)
      await (async () => store.setItem(`${name}:revoked`, digests))().catch(
        () => undefined,
      )
    },
  }

  /** Reads the digests of the revoked refresh tokens, or none when the read fails. */
  async function readRevoked(): Promise<readonly string[]> {
    const value = await (async () => store?.getItem(`${name}:revoked`))().catch(
      () => undefined,
    )
    return Array.isArray(value) ? value : []
  }

  /** Returns the SHA-256 digest of `token`. React Native has no `crypto.subtle`, so ox hashes it. */
  function digest(token: string) {
    return Hash.sha256(Bytes.fromString(token), { as: 'Hex' })
  }

  /**
   * Writes the signed-out mark to the store. The caller sets the instance's own copy at once, before
   * the write. A failed write fails nothing.
   */
  async function mark(value: boolean) {
    const key = `${name}:signed-out`
    await (async () =>
      value ? store?.setItem(key, true) : store?.removeItem(key))().catch(
      () => undefined,
    )
  }

  /** Reads the stored session, or `undefined` when the read fails. */
  async function read() {
    if (!writes) return undefined
    const { storage } = writes
    const stored = await (async () => storage.getItem(name))().catch(
      () => undefined,
    )
    return stored?.session
  }

  // The last status that `status` returned, which an unchanged status returns again, so a render
  // that reads it does not repeat.
  let shown: Session.Status = signedOut_status

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
    listener: (status: Session.Status, previous: Session.Status) => void,
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

  return {
    actor,
    async authorize(fn) {
      if (!actor) return await fn()
      actor.send({ type: 'authorize.start' })
      try {
        return await fn()
      } finally {
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
            if (session) await onSignIn?.(session)
          },
          fail: (error) => Promise.reject(error),
          overtaken: () => false,
        }

      // The context when the change starts, such as whether a sign-out runs, which a restore reads.
      const started = context()
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
        session?: Session.Session,
        error?: unknown,
        failure: FailOptions = {},
      ) => {
        // An update that sent no refresh token, such as the account of a session without an access key,
        // holds the tokens that the sign-out ended already.
        if (options.update && !options.sent) return new SupersededError()
        // A refresh that a sign-out overtook rotated the token that the sign-out holds, so the
        // sign-out skips that token, and the refresh revokes its own new one. A refresh sets no
        // Tempo ID session, so it sends no logout, which would end another tab's later sign-in.
        if (options.sent && context().signOuts !== started.signOuts) {
          // Only a refresh that Tempo ID refused at each attempt rotated nothing, so the sign-out
          // revokes the token it sent. An unanswered attempt may have rotated it, so the sign-out
          // skips that token.
          const refused =
            !failure.unanswered &&
            error instanceof RequestError &&
            error.status >= 400 &&
            error.status < 500
          if (session) rotated.set(options.sent, undefined)
          else if (!refused) rotated.set(options.sent, { error })
          if (session) await signOut(session, { logout: false })
          return new SupersededError()
        }
        // A restore, such as `authorize`, reads a Tempo ID session and sets none, so it sends no
        // logout, which would end a Tempo ID session that another tab started since. The logout of
        // the session that it read revokes its tokens. Only a sign-out with `everywhere` logs out.
        const { signedOut, version } = context()
        const logout = machines.loggedOut({
          current: context(),
          started,
        })
        if (signedOut === version)
          await signOut(session, {
            logout: logout && !options.restore,
            restored: logout && options.restore,
          })
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
          // A restore, such as `authorize`, reads the same Tempo ID session, so it overtakes none.
          set(session, {
            signIn: !!session && !options.update && !options.restore,
          })
          await writes?.flush()
          if (session && !options.update) {
            actor.send({ type: 'change.commit' })
            await mark(false)
          }
          if (session) await onSignIn?.(session)
        },
        fail: async (error, failure = {}) => {
          if (overtaken()) throw await superseded(undefined, error, failure)
          // A refusal empties only the session that this change started from, not a newer sign-in's.
          if (
            error instanceof RequestError &&
            error.signedIn &&
            context().version === started.version
          ) {
            set(undefined)
            await writes?.flush()
          }
          throw error
        },
        overtaken,
      }
    },
    exclusive,
    get: () => actor?.getSnapshot().context.session,
    async load() {
      if (!actor) return undefined
      await hydrate()
      const session = context().session
      if (!session || !Session.expired(session)) {
        actor.send({ type: 'load' })
        return session
      }
      // Another tab can hold a newer session than this instance's expired copy, which stays.
      const latest = await reload()
      if (!latest || !Session.expired(latest)) {
        actor.send({ type: 'load' })
        return latest
      }
      // An authorization in progress renews the expired session, and the status shows it until then.
      set(undefined, { renewing: latest })
      await writes?.flush()
      return undefined
    },
    reload,
    async signedOut() {
      if (actor ? context().marked : markedLocal) return true
      const stored = await (async () =>
        store?.getItem(`${name}:signed-out`))().catch(() => undefined)
      return stored === true
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
      const marked = mark(!everywhere)
      const run: Promise<void> = (async () => {
        await previous?.catch(() => undefined)
        await Promise.all([end({ everywhere }), marked])
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
      let previous = context().session
      const subscription = actor.subscribe((snapshot) => {
        const { session } = snapshot.context
        if (session === previous) return
        const before = previous
        previous = session
        listener(session, before)
      })
      return () => subscription.unsubscribe()
    },
  }

  /** Ends the session: at once in this instance, then at Tempo ID under the refresh lock. */
  async function end(options: { everywhere: boolean }) {
    await hydrate()
    // A save in progress, such as a sign-in's, completes first, so the store holds no earlier
    // session than this instance's.
    await writes?.flush().catch(() => undefined)
    const local = actor ? context().session : undefined
    const before = await read()
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
      const failed = await emptied
      const stored = await read()
      // The instance's session is read after the store, so a sign-in that commits during the read
      // counts as this instance's later sign-in, which the sign-out never ends.
      const current = actor ? context().session : undefined
      const ending = machines.ending({ before, current, local, stored })
      // The store then holds the instance's session again, or none.
      if (ending.empty)
        actor?.send({ type: current ? 'save' : 'signOut.empty' })

      // A failed save still ends the server session and revokes the refresh token.
      try {
        const saved = ending.empty ? await settle(writes?.flush()) : undefined
        if (failed) throw failed.error
        if (saved) throw saved.error
      } finally {
        const ended = ending.session
        // A refresh that the sign-out overtook ended its own new session already. A later sign-in
        // in this instance owns the Tempo ID session, so the sign-out then ends no logout. A
        // restore reads the session that the sign-out ends, so it counts as no sign-in.
        const skipped = ended?.refreshToken
          ? rotated.get(ended.refreshToken)
          : undefined
        const signIns = actor ? context().signIns : 0
        const revoking =
          (ended?.refreshToken && rotated.has(ended.refreshToken)) ||
          (await revoked.has(ended))
            ? undefined
            : ended
        await signOut(revoking, {
          logout: machines.logout({
            everywhere: options.everywhere,
            kept: ending.kept,
            signIns,
            started: ownSignIns,
          }),
          // Only an answered revocation marks its token, also when the logout after it fails. One
          // without an answer leaves the next sign-out to send it again.
          onRevoked: revoking ? () => revoked.add(revoking) : undefined,
          unrevoked: skipped,
        })
      }
    })
  }
}

export declare namespace create {
  type Options = {
    /** Whether the session holds a signed-in user. A backend's instance holds none. */
    enabled: boolean
    /**
     * Runs the ceremony of a passkey that owns a restored session's account, in place of
     * `navigator.credentials.get`.
     */
    getFn?: TempoAccount.deserialize.Options['getFn']
    /** The key of the saved session in `store`. */
    name: string
    /** Runs after a change sets a session. */
    onSignIn?: ((session: Session.Session) => Promise<void> | void) | undefined
    /** Runs after another tab's sign-out empties the session. */
    onSignOut?: (() => Promise<void> | void) | undefined
    /** Ends the server session, and revokes the tokens of the session that ended, when one did. */
    signOut: (
      session: Session.Session | undefined,
      options?: {
        /** Whether the Tempo ID session ends too. Defaults to `true`. */
        logout?: boolean | undefined
        /** Runs once Tempo ID answers the revocation, so other contexts send it no more. */
        onRevoked?: (() => Promise<void>) | undefined
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
     * `pending`, or at `reauthorizing` while it renews a saved session that `load` empties during it.
     */
    authorize: <value>(fn: () => Promise<value>) => Promise<value>
    /** Begins a change to the session, or with `update`, a change of the current session's tokens. */
    change: (options?: ChangeOptions) => Change
    /** Returns the session, without reading the store. */
    get: () => Session.Session | undefined
    /**
     * Reads the saved session once, and returns the session. Empties a session whose access key expired.
     */
    load: () => Promise<Session.Session | undefined>
    /**
     * Runs `fn` while no other run of the same session's `exclusive` does, also in another tab of a
     * browser, through its Web Locks.
     */
    exclusive: <value>(fn: () => Promise<value>) => Promise<value>
    /**
     * Reads the stored session again, and returns the session. Sets the stored session when it is
     * the same user's with other tokens, such as after another tab's refresh.
     */
    reload: () => Promise<Session.Session | undefined>
    /**
     * Returns whether a sign-out without `everywhere` followed the last sign-in, here or in another
     * context on the store. A refresh never clears it.
     */
    signedOut: () => Promise<boolean>
    /** Empties the session, and revokes its refresh token. */
    signOut: (options?: {
      /** Whether the user's Tempo ID session ends too, for every app. Defaults to `false`. */
      everywhere?: boolean | undefined
    }) => Promise<void>
    /** The status of the session, with the session to show. */
    status: Status
    /** Calls `listener` with each new session and the one before it. Returns the unsubscribe. */
    subscribe: (
      listener: (
        session: Session.Session | undefined,
        previous: Session.Session | undefined,
      ) => void,
    ) => () => void
  }
}

/** The status of a session, which `get` reads and `subscribe` follows. */
export type Status = {
  /**
   * Returns the status, with the session to show. An unchanged status returns the same object, so
   * `useSyncExternalStore` takes `get` as it is. `signedOut` for a session that holds nothing.
   */
  get: () => Session.Status
  /**
   * Calls `listener` with each new status and the one before it. Returns the unsubscribe. A session
   * that holds nothing never calls it.
   */
  subscribe: (
    listener: (status: Session.Status, previous: Session.Status) => void,
  ) => () => void
}

/** The status of a session that holds nothing, such as a backend's. */
const signedOut_status: Session.Status = {
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
      | (Omit<Session.Session, 'account'> & {
          account?: TempoAccount.Serialized | undefined
        })
      | undefined
  }
  version: number
}

/** Returns the session as the store keeps it. */
function toSaved(
  session: Session.Session | undefined,
): Saved['state']['session'] {
  if (!session) return undefined
  const { account, ...rest } = session
  return account ? { ...rest, account: TempoAccount.serialize(account) } : rest
}

/** Returns the session from the form that the store keeps. */
function fromSaved(
  saved: Saved['state']['session'],
  options: TempoAccount.deserialize.Options = {},
): Session.Session | undefined {
  if (!saved) return undefined
  const { account, ...rest } = saved
  return account
    ? {
        ...rest,
        account: TempoAccount.deserialize(account, { getFn: options.getFn }),
      }
    : rest
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
function queue(store: Store, options: TempoAccount.deserialize.Options = {}) {
  let pending: Promise<void> = Promise.resolve()
  // Whether the last write failed, which leaves an earlier copy in the store.
  let failed = false

  /** Runs `write` after every earlier write. A failed write fails only its own change. */
  const enqueue = (write: () => Promise<void>) => {
    const next = pending
      .catch(() => undefined)
      .then(write)
      .then(
        () => {
          failed = false
        },
        (error: unknown) => {
          failed = true
          throw error
        },
      )
    pending = next
    return next
  }

  const storage = {
    /** Reads the stored session. A custom store may return `null` for a missing item. */
    async getItem(name: string) {
      const value = (await store.getItem(name)) as Saved | null | undefined
      if (value == null) return undefined
      return { session: fromSaved(value.state?.session, options) }
    },
  }

  return {
    failed: () => failed,
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
    save: (name: string, session: Session.Session | undefined) =>
      enqueue(() =>
        store.setItem(name, {
          state: { session: toSaved(session) },
          version: 0,
        }),
      ),
    storage,
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
      /** Sets the session that another tab saved, and counts the change, and the sign-in when it is one. */
      adopt: assign((args) => {
        assertEvent(args.event, 'adopt')
        const { context, event } = args
        return {
          loaded: true,
          // An authorization in progress keeps renewing the expired session, as `set` does.
          renewing:
            event.session || context.authorizations === 0
              ? undefined
              : context.renewing,
          session: event.session,
          signIns: event.signIn ? context.signIns + 1 : context.signIns,
          version: context.version + 1,
        }
      }),
      /** Counts an authorization that started. */
      authorize: assign((args) => ({
        authorizations: args.context.authorizations + 1,
      })),
      /** Clears the signed-out mark after a change committed a session that is no update. */
      commit: assign({ marked: false }),
      /** Counts an authorization that ended. The last one ends the renewal, whatever it returned. */
      authorized: assign((args) => {
        const authorizations = args.context.authorizations - 1
        if (authorizations > 0) return { authorizations }
        return { authorizations, renewing: undefined }
      }),
      /** Empties the session again after a sign-out, and records the version of that sign-out. */
      empty: assign((args) => ({
        session: undefined,
        signedOut: args.context.version + 1,
        version: args.context.version + 1,
      })),
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
          signingOut:
            signingOut && runs > 0 ? { ...signingOut, runs } : undefined,
        }
      }),
      /** Records that `load` checked the stored session. */
      load: assign({ loaded: true }),
      /** Counts another tab's logout, which revokes the tokens of this tab's restore. */
      logout: assign((args) => ({
        logouts: {
          ...args.context.logouts,
          started: args.context.logouts.started + 1,
        },
      })),
      /** Saves `context.session` to the store. `session.ts` provides it. */
      save: () => {},
      /** Sets the session, and counts the change, and the sign-in when it is one. */
      set: assign((args) => {
        assertEvent(args.event, 'set')
        const { context, event } = args
        return {
          loaded: true,
          // A new session replaces the expired one that an authorization renews.
          renewing: event.session
            ? undefined
            : context.authorizations > 0
              ? (event.renewing ?? context.renewing)
              : undefined,
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
            ? { running: logouts.running + 1, started: logouts.started + 1 }
            : logouts,
          marked: !everywhere,
          signingOut: { everywhere, runs: (signingOut?.runs ?? 0) + 1 },
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
    },
    guards: {
      /**
       * Whether a sign-out joins the one in progress. It joins only while no change followed that
       * sign-out, such as a sign-in. A call with `everywhere` never joins one without it.
       */
      joins: (args) => {
        assertEvent(args.event, 'signOut.join')
        const { signedOut, signingOut, version } = args.context
        if (!signingOut || signedOut !== version) return false
        return signingOut.everywhere || !args.event.everywhere
      },
      /** Whether {@link select} selects `params.status` for the context. */
      selects: (args, params: { status: Session.Status['status'] }) =>
        select(args.context) === params.status,
    },
    types: {
      context: {} as machines.session.Context,
      events: {} as machines.session.Event,
    },
  }).createMachine({
    context: {
      authorizations: 0,
      loaded: false,
      logouts: { running: 0, started: 0 },
      marked: false,
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
      'authorize.end': { actions: 'authorized', target: '.settling' },
      'authorize.start': { actions: 'authorize', target: '.settling' },
      // The events that change no value of `select` stay in the state.
      'change.commit': { actions: 'commit' },
      hydrate: { actions: 'hydrate', target: '.settling' },
      load: { actions: 'load', target: '.settling' },
      'logout.remote': { actions: 'logout' },
      save: { actions: 'save' },
      // The write follows the assignment, so it saves the new session.
      set: { actions: ['set', 'save'], target: '.settling' },
      signOut: { actions: ['signOut', 'save'], target: '.settling' },
      'signOut.empty': { actions: ['empty', 'save'], target: '.settling' },
      'signOut.finish': { actions: 'finish' },
      'signOut.join': { actions: 'join', guard: 'joins', target: '.settling' },
      'signOut.remote': { actions: 'signOut', target: '.settling' },
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
      signedIn: {},
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
       * Whether the stored session loaded, or a change set the session first. Before that, the stored
       * copy can hold an expired access key, so the status stays `pending`.
       */
      loaded: boolean
      /**
       * The sign-outs with `everywhere` in this instance, and the logouts of other tabs: how many
       * started, and how many of this instance's still run. Their logout revokes the tokens that the
       * Tempo ID session issued.
       */
      logouts: {
        /** The number of this instance's sign-outs with `everywhere` in progress. */
        running: number
        /** The number of logouts that started, here or in another tab. */
        started: number
      }
      /**
       * Whether a sign-out without `everywhere` followed the last sign-in in this instance. The
       * store's copy holds it for other tabs and later runs. A refresh, or another tab's save, never
       * clears it.
       */
      marked: boolean
      /**
       * The saved session whose access key expired, which an authorization in progress renews. Absent
       * outside an authorization, after a change sets a session, and after a sign-out.
       */
      renewing: Session.Session | undefined
      /** The signed-in session, or `undefined` while signed out. */
      session: Session.Session | undefined
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
           * The session that another tab saved, which the store already holds, or `undefined` for an
           * empty store that no sign-out emptied, such as a renewal of an expired session.
           */
          session: Session.Session | undefined
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
          /**
           * Whether the session's access key expired, which the running module reads from the clock.
           * A read after `load` sets no expired session.
           */
          expired: boolean
          /** The session that the store holds. A change that completed first is newer, so it stays. */
          session: Session.Session | undefined
          /** The store's session loaded. */
          type: 'hydrate'
        }
      | {
          /** `load` found the stored session valid, or found none. */
          type: 'load'
        }
      | {
          /** Another tab's sign-out with `everywhere` started its logout. */
          type: 'logout.remote'
        }
      | {
          /** Saves the current session again, such as after a sign-out read a stale copy in the store. */
          type: 'save'
        }
      | {
          /**
           * The session whose access key expired, which `load` emptied. An authorization in progress
           * renews it, so the status shows it until then.
           */
          renewing?: Session.Session | undefined
          /** The new session, or `undefined` to empty it. */
          session: Session.Session | undefined
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
   * Returns what a sign-out ends, once it holds the lock, from the sessions that it read:
   *
   * - `session`: the session whose tokens the sign-out revokes. Another context's refresh can save
   *   the session's later tokens after the sign-out, and those end in place of the rotated ones.
   * - `empty`: whether the store holds the ended session's tokens, its own or later ones, and empties
   *   again, so no later load restores them.
   * - `kept`: whether the store holds another context's later sign-in of another user. That sign-in
   *   holds the browser's Tempo ID session, so the sign-out sends no logout, which would end it.
   */
  export function ending(
    options: machines.ending.Options,
  ): machines.ending.ReturnType {
    const { before, current, local, stored } = options
    const ended = machines.newer(before, local) ? before : local
    if (!stored || !ended) return { empty: false, kept: false, session: ended }

    // A change in this instance after the sign-out, such as a sign-in, holds a session that the
    // sign-out never ends.
    const own = stored.refreshToken === current?.refreshToken
    // A refresh keeps the session's access key, so a stored copy with another access key is a later
    // sign-in, such as another tab's, which stays. Any other stored copy, such as this instance's
    // earlier one, is not the session's latest.
    const later =
      !own &&
      stored.user.id === ended.user.id &&
      stored.key?.keyAuthorization.keyId ===
        ended.key?.keyAuthorization.keyId &&
      stored.refreshToken !== ended.refreshToken &&
      stored.expiresAt >= ended.expiresAt
    // A stored copy of the ended session's own tokens, such as one that another context saved again.
    const stale = !own && stored.refreshToken === ended.refreshToken
    // A stored session of the same user can be another tab's restore of the session that ends, which
    // the logout ends.
    const kept = !own && !later && !stale && stored.user.id !== ended.user.id

    return {
      empty: later || stale,
      kept,
      session: later ? stored : ended,
    }
  }

  export declare namespace ending {
    type Options = {
      /** The stored session before the sign-out emptied it. */
      before: Session.Session | undefined
      /** The instance's session once the sign-out holds the lock, such as a later sign-in's. */
      current: Session.Session | undefined
      /** The instance's session before the sign-out emptied it. */
      local: Session.Session | undefined
      /** The stored session once the sign-out holds the lock. */
      stored: Session.Session | undefined
    }

    type ReturnType = {
      /** Whether the store empties again, or saves the instance's later session. */
      empty: boolean
      /** Whether the store holds another user's later sign-in, which keeps the Tempo ID session. */
      kept: boolean
      /** The session whose tokens the sign-out revokes, or `undefined` for none. */
      session: Session.Session | undefined
    }
  }

  /**
   * Returns whether a logout that ends the Tempo ID session overlapped a change: one started since
   * the change started, or one ran when it started. That logout revokes the tokens that the
   * session issued, so the change revokes none.
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
   * Returns whether the stored session is newer than the instance's: another tab's sign-out, another
   * user's session, or the same user's session with later tokens, which a refresh issues.
   */
  export function newer(
    stored: Session.Session | undefined,
    current: Session.Session | undefined,
  ) {
    if (!stored || !current) return stored !== current
    if (stored.user.id !== current.user.id) return true
    return stored.expiresAt > current.expiresAt
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
    if (stored.user.id !== current.user.id) return false
    return stored.expiresAt > current.expiresAt
  }

  export declare namespace replaces {
    type Options = {
      /** The instance's session. */
      current: Session.Session | undefined
      /** Whether the last write to the store failed. */
      failed: boolean
      /** The session that the store holds. */
      stored: Session.Session | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns the status of `snapshot`, and the session to show: the expired session while
   * `reauthorizing`, the session while `signedIn`, and none otherwise.
   */
  export function status(snapshot: machines.session.Snapshot): Session.Status {
    const { context } = snapshot
    if (snapshot.matches('signedIn') && context.session)
      return { session: context.session, status: 'signedIn' }
    if (snapshot.matches('reauthorizing') && context.renewing)
      return { session: context.renewing, status: 'reauthorizing' }
    if (snapshot.matches('signedOut'))
      return { session: undefined, status: 'signedOut' }
    return { session: undefined, status: 'pending' }
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
    return stored.user.id !== current.user.id
  }

  export declare namespace switches {
    type Options = {
      /** The instance's session. */
      current: Session.Session | undefined
      /** The session that the store holds. */
      stored: Session.Session | undefined
    }

    type ReturnType = boolean
  }

  /**
   * Returns the status that `context` selects, in the order of the table below. The machine's
   * `settling` state selects it after each event, so every snapshot's state is `select(context)`.
   *
   * | Status          | When                                                            |
   * | --------------- | --------------------------------------------------------------- |
   * | `signedIn`      | The session loaded, or a change set it.                         |
   * | `reauthorizing` | An authorization renews a session whose access key expired.     |
   * | `pending`       | The session has not loaded, or an authorization is in progress. |
   * | `signedOut`     | Otherwise.                                                      |
   */
  export function select(
    context: machines.session.Context,
  ): Session.Status['status'] {
    if (context.loaded && context.session) return 'signedIn'
    if (context.authorizations > 0 && context.renewing) return 'reauthorizing'
    if (!context.loaded || context.authorizations > 0) return 'pending'
    return 'signedOut'
  }

  /** Returns the guard of `settling`'s transition to `status`. */
  function selects(status: Session.Status['status']) {
    return { params: { status }, type: 'selects' } as const
  }
}
