/**
 * The state machine of an instance's session: the session, its status, and the counters of the
 * race guard that orders its changes. It holds no I/O. `session.ts` provides the `save` action, and
 * runs the reads, the writes, and the locks around it.
 * @module
 */
import { type Actor as XStateActor, assertEvent, assign, setup } from 'xstate'
import type * as Session from '../Session.js'

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
   * The saved session whose access key expired, which an authorization in progress renews. Absent
   * outside an authorization, after a change sets a session, and after a sign-out.
   */
  renewing: Session.Session | undefined
  /** The signed-in session, or `undefined` while signed out. */
  session: Session.Session | undefined
  /** The `version` that the latest sign-out produced, until another change follows it. */
  signedOut: number | undefined
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
      /**
       * Another tab's sign-out emptied the store, and overtakes every change that started before
       * it. The instance empties the session without a write.
       */
      type: 'signOut.remote'
    }
  | {
      /** A second sign-out shares the one in progress, and overtakes the changes that started before it. */
      type: 'signOut.join'
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
export function select(context: Context): Session.Status['status'] {
  if (context.loaded && context.session) return 'signedIn'
  if (context.authorizations > 0 && context.renewing) return 'reauthorizing'
  if (!context.loaded || context.authorizations > 0) return 'pending'
  return 'signedOut'
}

/** Returns the guard of `settling`'s transition to `status`. */
function selects(status: Session.Status['status']) {
  return { params: { status }, type: 'selects' } as const
}

/**
 * The machine. Every event that changes a value of {@link select} targets `settling`, which selects
 * the status. A snapshot is never in `settling`, since its transitions take no event.
 */
export const machine = setup({
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
    /** Records that `load` checked the stored session. */
    load: assign({ loaded: true }),
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
    /** Whether {@link select} selects `params.status` for the context. */
    selects: (args, params: { status: Session.Status['status'] }) =>
      select(args.context) === params.status,
  },
  types: {
    context: {} as Context,
    events: {} as Event,
  },
}).createMachine({
  context: {
    authorizations: 0,
    loaded: false,
    renewing: undefined,
    session: undefined,
    signedOut: undefined,
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
    hydrate: { actions: 'hydrate', target: '.settling' },
    load: { actions: 'load', target: '.settling' },
    save: { actions: 'save' },
    // The write follows the assignment, so it saves the new session.
    set: { actions: ['set', 'save'], target: '.settling' },
    signOut: { actions: ['signOut', 'save'], target: '.settling' },
    'signOut.empty': { actions: ['empty', 'save'], target: '.settling' },
    'signOut.join': { actions: 'join', target: '.settling' },
    'signOut.remote': { actions: 'signOut', target: '.settling' },
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

/** A running instance of {@link machine}. */
export type Actor = XStateActor<typeof machine>

/** A snapshot of {@link machine}. */
export type Snapshot = ReturnType<Actor['getSnapshot']>

/**
 * Returns the status of `snapshot`, and the session to show: the expired session while
 * `reauthorizing`, the session while `signedIn`, and none otherwise.
 */
export function status(snapshot: Snapshot): Session.Status {
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
 * Returns what a sign-out ends, once it holds the lock, from the sessions that it read:
 *
 * - `session`: the session whose tokens the sign-out revokes. Another context's refresh can save
 *   the session's later tokens after the sign-out, and those end in place of the rotated ones.
 * - `empty`: whether the store holds the ended session's tokens, its own or later ones, and empties
 *   again, so no later load restores them.
 * - `kept`: whether the store holds another context's later sign-in of another user. That sign-in
 *   holds the browser's Tempo ID session, so the sign-out sends no logout, which would end it.
 */
export function ending(options: ending.Options): ending.ReturnType {
  const { before, current, local, stored } = options
  const ended = newer(before, local) ? before : local
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
    stored.key?.keyAuthorization.keyId === ended.key?.keyAuthorization.keyId &&
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
