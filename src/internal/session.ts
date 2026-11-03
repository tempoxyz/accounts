/**
 * The session of an instance: an XState actor of `SessionMachine` that holds the session, its
 * status, and the race guard of its changes, and saves the session to the instance's `Store` in the
 * order of its writes.
 * @module
 */
import { createActor } from 'xstate'
import { RequestError, SupersededError } from '../Id.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'
import * as TempoAccount from '../TempoAccount.js'
import * as SessionMachine from './session.machine.js'

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
        SessionMachine.machine.provide({
          actions: {
            // The write enqueues during the event, so a `flush` right after it awaits the write.
            // The message names a sign-out, which other tabs count as one. Another empty write,
            // such as a renewal of an expired session, empties their session as `set` does.
            save: (args) => {
              const message = {
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
  // The sign-out in progress, which a second call shares, so the session's token is revoked once.
  let signingOut: Promise<void> | undefined

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
      if (writes.failed())
        return (
          stored !== undefined &&
          current !== undefined &&
          stored.user.id === current.user.id &&
          stored.expiresAt > current.expiresAt
        )
      return SessionMachine.newer(stored, current)
    })()
    // Another context's sign-in of another user overtakes a restore, as a sign-in here does. A
    // session where this instance holds none can be another tab's restore of the same user.
    if (adopt)
      set(stored, {
        signIn: !!stored && !!current && stored.user.id !== current.user.id,
      })
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
    if (!actor || !writes || signingOut) return undefined
    await hydrate()
    await writes.flush().catch(() => undefined)
    const started = context().version
    const read = await (async () => writes.storage.getItem(name))().then(
      (value) => ({ stored: value?.session }),
      () => undefined,
    )
    const { renewing, session: current, version } = context()
    if (version !== started || signingOut) return undefined
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
    const adopted = writes.failed()
      ? stored !== undefined &&
        current !== undefined &&
        stored.user.id === current.user.id &&
        stored.expiresAt > current.expiresAt
      : SessionMachine.newer(stored, current)
    if (!adopted) return undefined
    if (stored && Session.expired(stored)) return undefined
    const signIn = !!stored && !!current && stored.user.id !== current.user.id
    actor.send({ session: stored, signIn, type: 'adopt' })
    return stored && (!current || signIn)
      ? async () => onSignIn?.(stored)
      : undefined
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
    const next = SessionMachine.status(actor.getSnapshot())
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

      const started = context()
      // A restore that starts while a sign-out runs reads the Tempo ID session that it ends.
      const startedSigningOut = signingOut !== undefined
      /** Returns whether a change that overtakes this one completed since it started. */
      const overtaken = () => {
        const { signIns, signOuts, version } = context()
        if (options.update) return version !== started.version
        if (options.restore && signIns !== started.signIns) return true
        // A restore reads the Tempo ID session that a sign-out in progress ends, so a restore that
        // overlaps a sign-out never completes.
        if (options.restore && (signingOut || startedSigningOut)) return true
        return signOuts !== started.signOuts
      }
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
        // the session that it read revokes its tokens.
        const { signedOut, version } = context()
        if (signedOut === version)
          await signOut(session, {
            logout: !options.restore,
            restored: options.restore,
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
    signOut() {
      // A sign-out in progress ends the session that this call ends too, unless a change followed
      // it, such as a sign-in. That session then ends in a sign-out of its own, after the first.
      // A shared sign-out still overtakes the changes in progress, such as a sign-in that started
      // after the first sign-out emptied the session.
      if (actor && signingOut && context().signedOut === context().version) {
        actor.send({ type: 'signOut.join' })
        return signingOut
      }
      const previous = signingOut
      const run: Promise<void> = (async () => {
        await previous?.catch(() => undefined)
        await end()
      })().finally(() => {
        if (signingOut === run) signingOut = undefined
      })
      signingOut = run
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
  async function end() {
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
      const ending = SessionMachine.ending({ before, current, local, stored })
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
        await signOut(
          ended?.refreshToken && rotated.has(ended.refreshToken)
            ? undefined
            : ended,
          {
            logout: signIns === ownSignIns && !ending.kept,
            unrevoked: skipped,
          },
        )
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
        /**
         * Whether a Tempo ID session issued the tokens, such as a restore's. Its logout, or a later
         * sign-in, revokes them, so a first-party app skips the revocation.
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
    actor: SessionMachine.Actor | undefined
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
    /** Empties the session, and ends the server session. */
    signOut: () => Promise<void>
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
